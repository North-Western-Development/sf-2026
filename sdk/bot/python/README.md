# subspace-bot (Python)

Build bots for Subspace Frequency in Python: the REST API, the real-time gateway, slash commands and interactions. asyncio-based, Python 3.10+. It mirrors the JavaScript SDK (`@subspace/bot-sdk`): same events, same payloads.

## Install

From the Subspace package registry (its dependencies come from PyPI as usual):

```bash
pip install --extra-index-url https://subspace.click/packages/pypi/simple/ subspace-bot
```

Dependencies: `aiohttp` (REST and WebSocket) and `cryptography` (Ed25519 for HTTP interactions).

## A slash-command bot

```python
import asyncio, os, random
from subspace_bot import SubspaceBot, Interaction

bot = SubspaceBot(token=os.environ["BOT_TOKEN"], base_url="https://subspace.click")

@bot.on("interaction")
async def on_interaction(i: Interaction):
    if i.command_name == "ping":
        await i.reply("Pong!")
    elif i.command_name == "roll":
        sides = i.option("sides", 6)
        await i.reply({"embeds": [{"title": f"🎲 {random.randint(1, sides)}", "footer": {"text": f"d{sides}"}}]})

async def main():
    await bot.register_commands([
        {"name": "ping", "description": "Check the bot is alive"},
        {"name": "roll", "description": "Roll a die",
         "options": [{"type": "integer", "name": "sides", "description": "How many sides"}]},
    ])
    async with bot:
        await bot.run()  # connect, then stay connected (reconnects on its own)

asyncio.run(main())
```

Slow answers: `await i.defer()` within 3 seconds, then `await i.follow_up("...")` within 15 minutes. `i.edit_reply(...)` changes the reply.

## A bot that listens to messages

```python
@bot.on("message")
async def on_message(m):
    if m["content"] == "!hello":
        await bot.send(m["channelType"], m["channelId"], f"Hi {m['author']['username']}!")
```

Without the **Message Content** intent a bot sees message text only where it is mentioned (and in its own messages); other messages arrive with empty `content`.

## API

| | |
| --- | --- |
| `SubspaceBot(token, base_url, *, gateway_url=None, session=None)` | `gateway_url` defaults to `<base_url>/gateway` (ws/wss). |
| `await bot.me()` | `{id, username, appId, beaconIds}`; also kept on `bot.user`. |
| `await bot.send(channel_type, channel_id, text_or_dict)` | `"relay"` or `"thread"`; dict takes `content`, `replyToId`, `embeds`. Returns the transmission. |
| `await bot.edit(id, content)`, `bot.delete(id)`, `bot.react(id, emoji)` | |
| `await bot.register_commands(commands, beacon_id=None)` | Replaces the list (global, or one beacon). Returns them with ids. |
| `await bot.rest(method, path, body=None, as_bot=True)` | Any other endpoint under `/api/v1`. |
| `await bot.connect()` / `await bot.run()` / `await bot.disconnect()` / `await bot.close()` | `connect` returns at READY. `close` also releases the HTTP session; `async with bot:` does it for you. |
| `bot.on(event, fn)` or `@bot.on(event)` | Handlers may be sync or async. |
| `Interaction` | `id`, `command_name`, `user`, `channel`, `beacon_id`, `option(name, default=None)`, `raw`; `reply`, `defer(ephemeral=...)`, `follow_up`, `edit_reply`. |
| `SubspaceApiError` | `.status`, `.code`, `.message`. |

Events (the JavaScript SDK's names; `message_update` / `message_delete` also work): `ready`, `message`, `messageUpdate`, `messageDelete`, `interaction`, `dispatch` (`type, data` for every gateway event), `close` (`code, reason`), `error`. An exception in a handler goes to `error` handlers, or the `subspace_bot` logger.

## Interactions over HTTP

Set the app's **Interactions Endpoint URL** and answer in the response body. Check every request first:

```python
from aiohttp import web
from subspace_bot import verify_interaction, respond_with

async def interactions(request: web.Request):
    raw = await request.read()
    if not verify_interaction(raw, request.headers.get("X-Signature-Ed25519"),
                              request.headers.get("X-Signature-Timestamp"), PUBLIC_KEY_HEX):
        return web.Response(status=401)
    body = await request.json()
    return web.json_response(respond_with(f"Hello {body['user']['username']}"))
```

`defer_with(ephemeral=False)` defers instead. Requests more than five minutes old are refused.

## Develop

```bash
python -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/pytest
python -m build   # wheel + sdist in dist/
```

The full guide (webhooks, intents, command rules, embeds): `apps/docs/guide/bots.md` in the Subspace repository.

## License

The Subspace Frequency repository has no LICENSE file, so no license is granted yet.
