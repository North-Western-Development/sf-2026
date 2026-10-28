# Python bots

`subspace-bot` is an asyncio SDK for the REST API, the gateway, slash commands and interactions (over the gateway or signed HTTP). It is typed (`py.typed`). Source: `sdk/bot/python`.

| | |
| --- | --- |
| Package | `subspace-bot` (import `subspace_bot`) |
| Python | 3.10+ |
| Depends on | `aiohttp` (REST and WebSocket), `cryptography` (Ed25519), `typing_extensions` on 3.10 |

## Install

From the [package registry](/developers/registry). Use `--extra-index-url`, so the dependencies still come from PyPI:

```bash
pip install --extra-index-url https://subspace.click/packages/pypi/simple/ subspace-bot
```

## Quick start

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

A runnable version is `sdk/bot/python/examples/dice_bot.py`.

## API

### `SubspaceBot(token, base_url, *, gateway_url=None, session=None)`

`token` is the bot token without `Bot `. `gateway_url` defaults to `base_url` with `ws(s)://` and `/gateway`. Pass your own `aiohttp.ClientSession` as `session` to share one; otherwise the bot makes one and closes it in `close()`.

### Methods

All are coroutines except `on`, `off` and `emit`.

| Method | Calls |
| --- | --- |
| `connect()` | Opens the gateway; returns at `READY` |
| `run()` | `connect()`, then waits until the bot is disconnected |
| `wait_closed()` | Waits until the gateway loop ends |
| `disconnect()` | Closes the gateway and stops reconnecting |
| `close()` | `disconnect()`, and closes the HTTP session if the bot made it. `async with bot:` calls it for you. |
| `me()` | `GET /bots/@me`; also sets `bot.user` |
| `send(channel_type, channel_id, message)` | Posts a transmission (`"relay"` or `"thread"`); `message` is a string or a dict (`{"content", "replyToId"}`). Returns it. |
| `edit(transmission_id, content)`, `delete(transmission_id)` | Edit or delete one |
| `react(transmission_id, emoji)` | Add a reaction |
| `register_commands(commands, beacon_id=None)` | Replaces the global commands, or one beacon's (alias `registerCommands`) |
| `rest(method, path, body=None)` | Any other [REST](/developers/rest) call; `path` is after `/api/v1` |

A failed call raises `SubspaceApiError` with `.message`, `.status` and `.code`.

### Events

Register with `bot.on(event, handler)` or the `@bot.on(event)` decorator; remove with `bot.off(event, handler)`. Handlers can be plain functions or coroutines.

| Event | Arguments |
| --- | --- |
| `ready` | The `READY` payload |
| `message` | A new transmission (dict), with `channelType` and `channelId` |
| `messageUpdate` (or `message_update`) | The updated transmission |
| `messageDelete` (or `message_delete`) | The `TRANSMISSION_DELETE` payload |
| `interaction` | An `Interaction` |
| `dispatch` | `(type, data)` for every [gateway event](/developers/events) |
| `close` | `(code, reason)` |
| `error` | An exception: from a handler, or a fatal close |

### Interaction

| Member | |
| --- | --- |
| `id`, `token`, `command_name`, `user`, `channel`, `beacon_id`, `raw` | From the [interaction](/developers/commands#receiving-interactions) |
| `option(name, default=None)` | An option's value |
| `await reply(reply)` | A string, or `{"content", "embeds", "ephemeral"}` |
| `await defer(*, ephemeral=None)` | "Thinking…" |
| `await follow_up(reply)` | Another reply (alias `followUp`) |
| `await edit_reply(reply)` | Edit the reply (alias `editReply`) |

## HTTP interactions

```python
from aiohttp import web
from subspace_bot import verify_interaction, respond_with
import json, os

async def interactions(request: web.Request) -> web.Response:
    body = await request.read()
    if not verify_interaction(body, request.headers.get("X-Signature-Ed25519", ""),
                              request.headers.get("X-Signature-Timestamp", ""), os.environ["PUBLIC_KEY"]):
        return web.Response(status=401)
    interaction = json.loads(body)
    return web.json_response(respond_with(f"Hello {interaction['user']['username']}"))

app = web.Application()
app.router.add_post("/interactions", interactions)
web.run_app(app, port=3000)
```

| Function | |
| --- | --- |
| `verify_interaction(raw_body, signature, timestamp, public_key_hex) -> bool` | `raw_body` as `bytes` or `str`. Rejects timestamps more than 5 minutes off. |
| `respond_with(reply)` | `{"type": 4, "data": …}` |
| `defer_with(*, ephemeral=None)` | `{"type": 5, "data": …}` |

## Async model

- One asyncio loop. Gateway payloads are handled in order. A plain-function handler runs inline and blocks the loop while it runs; a coroutine handler is scheduled as its own task, so slow ones run alongside the next events.
- An exception in a handler goes to your `error` handlers, or to the `subspace_bot` logger if there are none.
- Heartbeats run in their own task.
- After a disconnect it waits 2 seconds and reconnects (identifying again). Close code `4003` (bad token) stops it: raised from `connect()` before `READY`, emitted as `error` after. There is no resume.
- If the gateway can't be reached, `connect()` keeps retrying until it can.
