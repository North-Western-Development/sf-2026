"""The SDK against an in-process fake instance: REST under /api/v1 and a gateway WebSocket."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from aiohttp import WSMsgType, web

from subspace_bot import Interaction, SubspaceApiError, SubspaceBot


class FakeInstance:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.identify_tokens: list[str] = []
        self.heartbeats = 0
        self.sockets: list[web.WebSocketResponse] = []
        self.connected = asyncio.Event()
        self.runner: web.AppRunner | None = None
        self.base = ""

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get("/gateway", self.gateway)
        app.router.add_route("*", "/api/v1/{tail:.*}", self.api)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]  # type: ignore[union-attr]
        self.base = f"http://127.0.0.1:{port}"

    async def stop(self) -> None:
        for ws in self.sockets:
            await ws.close()
        assert self.runner is not None
        await self.runner.cleanup()

    async def gateway(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets.append(ws)
        await ws.send_json({"op": 10, "d": {"heartbeat_interval": 50}})
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            data = json.loads(msg.data)
            if data["op"] == 1:
                self.heartbeats += 1
            elif data["op"] == 2:
                token = data["d"]["token"]
                self.identify_tokens.append(token)
                if token != "Bot good":
                    await ws.close(code=4003, message=b"Invalid or expired authentication ticket")
                    break
                await ws.send_json({"op": 0, "t": "READY", "d": {"transmitter": {"id": "10", "username": "dice"}, "session_id": "s"}})
                self.connected.set()
        return ws

    async def api(self, request: web.Request) -> web.StreamResponse:
        text = await request.text()
        body = json.loads(text) if text else None
        path = request.path
        self.calls.append({"method": request.method, "path": request.raw_path, "auth": request.headers.get("authorization"), "body": body})
        auth = request.headers.get("authorization")
        if path == "/api/v1/bots/@me":
            if auth in ("Bot good", "Bot good-rest-only"):
                return web.json_response({"bot": {"id": "10", "username": "dice", "appId": "20", "beaconIds": ["30"]}})
            return web.json_response({"error": "Invalid bot token", "code": "INVALID_BOT_TOKEN"}, status=401)
        if path == "/api/v1/applications/20/commands" and request.method == "PUT":
            return web.json_response({"commands": [{"id": str(100 + i), **c} for i, c in enumerate(body)]})
        if path == "/api/v1/applications/20/beacons/30/commands" and request.method == "PUT":
            return web.json_response({"commands": [{"id": str(200 + i), **c} for i, c in enumerate(body)]})
        if path == "/api/v1/channels/relay/40/transmissions":
            return web.json_response({"transmission": {"id": "50", "content": body["content"]}})
        if path.startswith("/api/v1/transmissions/") or path.startswith("/api/v1/interactions/"):
            return web.Response(status=204)
        return web.json_response({"error": "Not found", "code": "NOT_FOUND"}, status=404)

    def by_path(self, p: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["path"] == p]


@pytest.fixture
async def fake():
    f = FakeInstance()
    await f.start()
    yield f
    await f.stop()


async def test_rest_calls(fake: FakeInstance) -> None:
    async with SubspaceBot("good", fake.base) as bot:
        me = await bot.me()
        assert me["appId"] == "20" and bot.user == me
        cmds = await bot.register_commands([{"name": "roll", "description": "Roll", "options": [{"type": "integer", "name": "sides", "description": "Sides"}]}])
        assert cmds[0]["id"] == "100"
        assert (await bot.register_commands([{"name": "x", "description": "y"}], beacon_id="30"))[0]["id"] == "200"
        sent = await bot.send("relay", "40", "hello")
        assert sent["content"] == "hello"
        await bot.send("relay", "40", {"content": "reply", "replyToId": "50"})
        assert await bot.edit("50", "edited") is None
        await bot.react("50", "\N{THUMBS UP SIGN}")
        await bot.delete("50")
        with pytest.raises(SubspaceApiError) as info:
            await bot.rest("GET", "/nowhere")
        assert (info.value.status, info.value.code) == (404, "NOT_FOUND")

    assert fake.by_path("/api/v1/channels/relay/40/transmissions")[1]["body"] == {"content": "reply", "replyToId": "50"}
    assert all(c["auth"] == "Bot good" for c in fake.calls)
    assert any(c["path"] == "/api/v1/transmissions/50/reactions/%F0%9F%91%8D/@me" and c["method"] == "PUT" for c in fake.calls)
    assert [c["method"] for c in fake.calls if c["path"] == "/api/v1/transmissions/50"] == ["PATCH", "DELETE"]


async def test_bad_token(fake: FakeInstance) -> None:
    async with SubspaceBot("nope", fake.base) as bot:
        with pytest.raises(SubspaceApiError) as info:
            await bot.me()
        assert info.value.status == 401 and info.value.code == "INVALID_BOT_TOKEN"


async def test_gateway_rejects_bad_token_with_4003(fake: FakeInstance) -> None:
    # REST accepts this token, the gateway does not: connect() raises instead of retrying forever.
    async with SubspaceBot("good-rest-only", fake.base) as bot:
        closes: list[int] = []
        bot.on("close", lambda code, reason: closes.append(code))
        with pytest.raises(SubspaceApiError) as info:
            await asyncio.wait_for(bot.connect(), 5)
        assert info.value.code == "INVALID_BOT_TOKEN"
        assert closes == [4003]


async def test_gateway_events_and_interactions(fake: FakeInstance) -> None:
    async with SubspaceBot("good", fake.base) as bot:
        ready: list[Any] = []
        messages: list[dict[str, Any]] = []
        updates: list[Any] = []
        deletes: list[Any] = []
        dispatched: list[str] = []
        answered = asyncio.Event()

        bot.on("ready", ready.append)
        bot.on("message", messages.append)
        bot.on("message_update", updates.append)
        bot.on("messageDelete", deletes.append)
        bot.on("dispatch", lambda t, d: dispatched.append(t))

        @bot.on("interaction")
        async def on_interaction(i: Interaction) -> None:
            assert i.command_name == "roll"
            assert i.option("sides") == 20 and i.option("missing", 6) == 6
            assert i.beacon_id == "30" and i.channel == {"type": "relay", "id": "40"} and i.user["username"] == "sam"
            await i.defer(ephemeral=True)
            await i.follow_up("Took a while")
            await i.edit_reply({"content": "changed"})
            await i.reply("Rolled 7")
            answered.set()

        await asyncio.wait_for(bot.connect(), 5)
        assert fake.identify_tokens == ["Bot good"]
        assert ready and ready[0]["session_id"] == "s"

        ws = fake.sockets[-1]
        await ws.send_json({"op": 0, "t": "TRANSMISSION_CREATE", "d": {"channelType": "relay", "channelId": "40", "transmission": {"id": "51", "content": "!hello", "author": {"id": "7", "username": "sam"}}}})
        await ws.send_json({"op": 0, "t": "TRANSMISSION_UPDATE", "d": {"channelType": "relay", "channelId": "40", "transmission": {"id": "51", "content": "!hi"}}})
        await ws.send_json({"op": 0, "t": "TRANSMISSION_DELETE", "d": {"channelType": "relay", "channelId": "40", "transmissionId": "51"}})
        await ws.send_json({"op": 11})
        await ws.send_json(
            {
                "op": 0,
                "t": "INTERACTION_CREATE",
                "d": {
                    "type": 2, "id": "60", "token": "itok", "applicationId": "20", "beaconId": "30",
                    "channel": {"type": "relay", "id": "40"}, "user": {"id": "7", "username": "sam"}, "memberPermissions": "0",
                    "data": {"id": "100", "name": "roll", "options": [{"name": "sides", "type": "integer", "value": 20}]},
                },
            }
        )
        await asyncio.wait_for(answered.wait(), 5)
        await asyncio.sleep(0.15)  # a few heartbeats at 50 ms

        assert messages[0]["content"] == "!hello" and messages[0]["channelType"] == "relay" and messages[0]["channelId"] == "40"
        assert updates[0]["content"] == "!hi"
        assert deletes[0]["transmissionId"] == "51"
        assert dispatched == ["READY", "TRANSMISSION_CREATE", "TRANSMISSION_UPDATE", "TRANSMISSION_DELETE", "INTERACTION_CREATE"]
        assert fake.heartbeats >= 1

        closes: list[int] = []
        bot.on("close", lambda code, reason: closes.append(code))
        await bot.disconnect()
        assert closes and len(fake.sockets) == 1

    cb = fake.by_path("/api/v1/interactions/60/itok/callback")
    assert [c["body"] for c in cb] == [{"type": 5, "data": {"ephemeral": True}}, {"type": 4, "data": {"content": "Rolled 7"}}]
    assert all(c["auth"] is None for c in fake.calls if "/interactions/" in c["path"])
    assert fake.by_path("/api/v1/interactions/60/itok/followup")[0]["body"] == {"content": "Took a while"}
    assert fake.by_path("/api/v1/interactions/60/itok/original")[0]["method"] == "PATCH"


async def test_reconnects_after_the_server_drops_it(fake: FakeInstance, monkeypatch: pytest.MonkeyPatch) -> None:
    import subspace_bot.client as client

    monkeypatch.setattr(client, "RECONNECT_DELAY", 0.05)
    async with SubspaceBot("good", fake.base) as bot:
        readies: list[Any] = []
        bot.on("ready", readies.append)
        await asyncio.wait_for(bot.connect(), 5)
        await fake.sockets[0].close(code=1001)
        for _ in range(100):
            if len(readies) >= 2:
                break
            await asyncio.sleep(0.05)
        assert len(readies) == 2 and len(fake.identify_tokens) == 2
        await bot.disconnect()


async def test_handler_errors_go_to_error_event(fake: FakeInstance) -> None:
    async with SubspaceBot("good", fake.base) as bot:
        errors: list[BaseException] = []
        bot.on("error", errors.append)

        @bot.on("ready")
        async def boom(_: Any) -> None:
            raise RuntimeError("handler failed")

        await asyncio.wait_for(bot.connect(), 5)
        await asyncio.sleep(0.05)
        assert any(isinstance(e, RuntimeError) for e in errors)
        await bot.disconnect()
