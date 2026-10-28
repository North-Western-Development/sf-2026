"""The bot client: REST, the gateway, and interactions."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from typing import Any, Awaitable, Callable, Optional, Union
from urllib.parse import quote

import aiohttp

from .types import BotUser, ChannelType, CommandDefinition, InteractionPayload, Message, Reply

log = logging.getLogger("subspace_bot")

Handler = Callable[..., Union[None, Awaitable[None]]]

#: Event names, the same as the JavaScript SDK. snake_case aliases are accepted too.
EVENTS = ("ready", "message", "messageUpdate", "messageDelete", "interaction", "dispatch", "close", "error")
_ALIASES = {"message_update": "messageUpdate", "message_delete": "messageDelete"}

RECONNECT_DELAY = 2.0


class SubspaceApiError(Exception):
    """An error answer from the API (or a refused gateway token)."""

    def __init__(self, message: str, status: int, code: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code

    def __repr__(self) -> str:
        return f"SubspaceApiError({self.message!r}, status={self.status}, code={self.code!r})"


def _reply_body(reply: Union[Reply, str, dict[str, Any]]) -> dict[str, Any]:
    return {"content": reply} if isinstance(reply, str) else dict(reply)


class Interaction:
    """A slash command someone used: read its options, then answer within 3 seconds (or defer)."""

    def __init__(self, bot: "SubspaceBot", raw: InteractionPayload) -> None:
        self._bot = bot
        self.raw = raw

    @property
    def id(self) -> str:
        return self.raw["id"]

    @property
    def token(self) -> str:
        return self.raw["token"]

    @property
    def command_name(self) -> str:
        return self.raw["data"]["name"]

    @property
    def user(self) -> dict[str, Any]:
        return self.raw["user"]

    @property
    def channel(self) -> dict[str, Any]:
        return self.raw["channel"]

    @property
    def beacon_id(self) -> str:
        return self.raw["beaconId"]

    def option(self, name: str, default: Any = None) -> Any:
        """An option's value, or ``default`` when it was not given."""
        for o in self.raw.get("data", {}).get("options", []) or []:
            if o.get("name") == name:
                return o.get("value")
        return default

    def _path(self, suffix: str) -> str:
        return f"/interactions/{self.id}/{self.token}/{suffix}"

    async def reply(self, reply: Union[Reply, str, dict[str, Any]]) -> Any:
        """Answer now."""
        return await self._bot.rest("POST", self._path("callback"), {"type": 4, "data": _reply_body(reply)}, as_bot=False)

    async def defer(self, *, ephemeral: Optional[bool] = None) -> Any:
        """"Thinking...": the answer follows with follow_up (within 15 minutes)."""
        data = {} if ephemeral is None else {"ephemeral": ephemeral}
        return await self._bot.rest("POST", self._path("callback"), {"type": 5, "data": data}, as_bot=False)

    async def follow_up(self, reply: Union[Reply, str, dict[str, Any]]) -> Any:
        return await self._bot.rest("POST", self._path("followup"), _reply_body(reply), as_bot=False)

    async def edit_reply(self, reply: Union[Reply, str, dict[str, Any]]) -> Any:
        return await self._bot.rest("PATCH", self._path("original"), _reply_body(reply), as_bot=False)

    # camelCase names, as in the JavaScript SDK.
    followUp = follow_up
    editReply = edit_reply


class SubspaceBot:
    """A Subspace bot.

    ::

        bot = SubspaceBot(token=os.environ["BOT_TOKEN"], base_url="https://subspace.click")

        @bot.on("interaction")
        async def on_interaction(i: Interaction):
            if i.command_name == "ping":
                await i.reply("Pong!")

        async def main():
            await bot.register_commands([{"name": "ping", "description": "Check the bot is alive"}])
            await bot.run()
    """

    def __init__(
        self,
        token: str,
        base_url: str,
        *,
        gateway_url: Optional[str] = None,
        session: Optional[aiohttp.ClientSession] = None,
    ) -> None:
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.gateway_url = gateway_url or (
            ("ws" + self.base_url[4:] if self.base_url.startswith("http") else self.base_url) + "/gateway"
        )
        self._session = session
        self._own_session = session is None
        self._handlers: dict[str, list[Handler]] = {}
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._gateway_task: Optional[asyncio.Task[None]] = None
        self._heartbeat_task: Optional[asyncio.Task[None]] = None
        self._handler_tasks: set[asyncio.Task[Any]] = set()
        self._closing = False
        #: Who the bot is, once connected or after ``me()``.
        self.user: Optional[BotUser] = None

    # ---- events -------------------------------------------------------------------------

    def on(self, event: str, handler: Optional[Handler] = None) -> Any:
        """Add a handler (sync or async). Use as ``bot.on("message", fn)`` or ``@bot.on("message")``."""
        name = _ALIASES.get(event, event)

        def add(fn: Handler) -> Handler:
            self._handlers.setdefault(name, []).append(fn)
            return fn

        return add(handler) if handler is not None else add

    def off(self, event: str, handler: Handler) -> None:
        name = _ALIASES.get(event, event)
        if handler in self._handlers.get(name, []):
            self._handlers[name].remove(handler)

    def emit(self, event: str, *args: Any) -> None:
        for fn in list(self._handlers.get(event, [])):
            try:
                result = fn(*args)
            except Exception as err:  # noqa: BLE001
                self._handler_failed(event, err)
                continue
            if inspect.isawaitable(result):
                task = asyncio.ensure_future(result)
                self._handler_tasks.add(task)
                task.add_done_callback(lambda t, ev=event: self._handler_done(ev, t))

    def _handler_done(self, event: str, task: "asyncio.Future[Any]") -> None:
        self._handler_tasks.discard(task)  # type: ignore[arg-type]
        if not task.cancelled() and task.exception() is not None:
            self._handler_failed(event, task.exception())  # type: ignore[arg-type]

    def _handler_failed(self, event: str, err: BaseException) -> None:
        if event != "error" and self._handlers.get("error"):
            self.emit("error", err)
        else:
            log.exception("Unhandled error in %r handler", event, exc_info=err)

    # ---- REST ---------------------------------------------------------------------------

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._own_session = True
        return self._session

    async def rest(self, method: str, path: str, body: Any = None, *, as_bot: bool = True) -> Any:
        """A REST call; ``as_bot=False`` for the interaction endpoints, where the URL's token is the credential."""
        headers: dict[str, str] = {}
        if as_bot:
            headers["authorization"] = f"Bot {self.token}"
        data: Optional[bytes] = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        session = await self._http()
        async with session.request(method, f"{self.base_url}/api/v1{path}", headers=headers, data=data) as res:
            if res.status == 204:
                return None
            text = await res.text()
            try:
                payload = json.loads(text) if text else {}
            except ValueError:
                payload = {}
            if res.status >= 400:
                err = payload if isinstance(payload, dict) else {}
                raise SubspaceApiError(err.get("error") or res.reason or "Request failed", res.status, err.get("code"))
            return payload

    async def me(self) -> BotUser:
        bot: BotUser = (await self.rest("GET", "/bots/@me"))["bot"]
        self.user = bot
        return bot

    async def send(self, channel_type: ChannelType, channel_id: str, message: Union[str, dict[str, Any]]) -> Message:
        """Post in a relay or thread the bot can see. ``message`` is text or ``{"content", "replyToId", "embeds"}``."""
        body = {"content": message} if isinstance(message, str) else message
        return (await self.rest("POST", f"/channels/{channel_type}/{channel_id}/transmissions", body))["transmission"]

    async def edit(self, transmission_id: str, content: str) -> Any:
        return await self.rest("PATCH", f"/transmissions/{transmission_id}", {"content": content})

    async def delete(self, transmission_id: str) -> Any:
        return await self.rest("DELETE", f"/transmissions/{transmission_id}")

    async def react(self, transmission_id: str, emoji: str) -> Any:
        return await self.rest("PUT", f"/transmissions/{transmission_id}/reactions/{quote(emoji, safe='')}/@me")

    async def register_commands(self, commands: list[CommandDefinition], beacon_id: Optional[str] = None) -> list[dict[str, Any]]:
        """Replace the bot's commands: everywhere, or in one beacon. Returns them with their ids."""
        app_id = (self.user or await self.me())["appId"]
        path = f"/applications/{app_id}/beacons/{beacon_id}/commands" if beacon_id else f"/applications/{app_id}/commands"
        return (await self.rest("PUT", path, list(commands)))["commands"]

    # ---- gateway ------------------------------------------------------------------------

    async def connect(self) -> None:
        """Connect to the gateway and return once READY arrives. The bot then reconnects on its own until ``disconnect()``.

        Emits ``ready``, ``message``, ``messageUpdate``, ``messageDelete``, ``interaction``, ``dispatch`` (type, data),
        ``close`` (code, reason) and ``error``.
        """
        if self.user is None:
            await self.me()
        self._closing = False
        loop = asyncio.get_running_loop()
        ready: asyncio.Future[None] = loop.create_future()
        self._gateway_task = asyncio.create_task(self._gateway_loop(ready))
        done, _ = await asyncio.wait({ready, self._gateway_task}, return_when=asyncio.FIRST_COMPLETED)
        if ready in done:
            ready.result()
            return
        # The gateway loop ended before READY: raise why (e.g. an invalid token).
        self._gateway_task.result()
        if not ready.done():
            ready.cancel()

    async def run(self) -> None:
        """Connect and stay connected until ``disconnect()``."""
        await self.connect()
        await self.wait_closed()

    async def wait_closed(self) -> None:
        if self._gateway_task is not None:
            await asyncio.shield(self._gateway_task)

    async def _gateway_loop(self, ready: "asyncio.Future[None]") -> None:
        while True:
            code, reason = await self._session_once(ready)
            self.emit("close", code, reason)
            if code == 4003:
                err = SubspaceApiError("Invalid bot token", 401, "INVALID_BOT_TOKEN")
                if not ready.done():
                    raise err
                self.emit("error", err)
                return
            if self._closing:
                return
            await asyncio.sleep(RECONNECT_DELAY)
            if self._closing:
                return

    async def _session_once(self, ready: "asyncio.Future[None]") -> tuple[int, str]:
        session = await self._http()
        try:
            ws = await session.ws_connect(self.gateway_url, autoping=True, heartbeat=None)
        except (aiohttp.ClientError, OSError) as err:
            self.emit("error", err)
            return 1006, str(err)
        self._ws = ws
        reason = ""
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        payload = json.loads(msg.data)
                    except ValueError:
                        continue
                    await self._on_payload(ws, payload, ready)
                elif msg.type == aiohttp.WSMsgType.CLOSE:
                    reason = msg.extra or ""
                    break
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    self.emit("error", ws.exception())
                    break
        finally:
            self._stop_heartbeat()
            if not ws.closed:
                await ws.close()
            if self._ws is ws:
                self._ws = None
        return ws.close_code or 1006, reason

    async def _on_payload(self, ws: aiohttp.ClientWebSocketResponse, msg: dict[str, Any], ready: "asyncio.Future[None]") -> None:
        op = msg.get("op")
        if op == 10:
            every = ((msg.get("d") or {}).get("heartbeat_interval") or 30_000) / 1000
            self._stop_heartbeat()
            self._heartbeat_task = asyncio.create_task(self._heartbeat(ws, every))
            await ws.send_str(json.dumps({"op": 2, "d": {"token": f"Bot {self.token}"}}))
            return
        if op != 0:
            return
        t, d = msg.get("t"), msg.get("d") or {}
        if t == "READY":
            self.emit("ready", d)
            if not ready.done():
                ready.set_result(None)
        elif t == "TRANSMISSION_CREATE" and d.get("transmission"):
            self.emit("message", {**d["transmission"], "channelType": d.get("channelType"), "channelId": d.get("channelId")})
        elif t == "TRANSMISSION_UPDATE" and d.get("transmission"):
            self.emit("messageUpdate", d["transmission"])
        elif t == "TRANSMISSION_DELETE":
            self.emit("messageDelete", d)
        elif t == "INTERACTION_CREATE":
            self.emit("interaction", Interaction(self, d))
        self.emit("dispatch", t, d)

    async def _heartbeat(self, ws: aiohttp.ClientWebSocketResponse, every: float) -> None:
        try:
            while not ws.closed:
                await asyncio.sleep(every)
                if not ws.closed:
                    await ws.send_str('{"op":1}')
        except (ConnectionError, RuntimeError, aiohttp.ClientError):
            pass

    def _stop_heartbeat(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

    async def disconnect(self) -> None:
        """Close the gateway connection and stop reconnecting."""
        self._closing = True
        self._stop_heartbeat()
        if self._ws is not None and not self._ws.closed:
            await self._ws.close()
        if self._gateway_task is not None:
            try:
                await self._gateway_task
            except Exception:  # noqa: BLE001 - already reported through events
                pass

    async def close(self) -> None:
        """Disconnect and release the HTTP session (if the bot made it)."""
        await self.disconnect()
        if self._handler_tasks:
            await asyncio.gather(*self._handler_tasks, return_exceptions=True)
        if self._own_session and self._session is not None and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> "SubspaceBot":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    # camelCase names, as in the JavaScript SDK.
    registerCommands = register_commands
