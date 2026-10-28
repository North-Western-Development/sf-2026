# The Rich Presence protocol

The [SDKs](/developers/rich-presence/) speak this for you. Use it directly from any language with a WebSocket client.

## Finding the desktop app

The desktop app runs a WebSocket server on `127.0.0.1`, on the first free port from **6473 to 6482**. Try them in order, and use the first that completes the handshake:

```
ws://127.0.0.1:6473/?v=1&client_id=<application id>
```

| Query | |
| --- | --- |
| `v` | Must be `1`, or the handshake is refused with HTTP `400` ("Unsupported protocol version") |
| `client_id` | Your application id: 1 to 19 digits, not starting with `0`. Otherwise `400`. |

Only the query is read; the path doesn't matter.

- **Browsers cannot connect**: any request with an `Origin` header is refused with `403`, so a website can't set someone's activity.
- The desktop app takes up to **8** connections at once. Beyond that, the connection is dropped before the handshake.
- If no port answers, the desktop app is closed: try again later (the SDKs retry every 15 seconds).

## Messages

After the handshake the server sends:

```json
{ "evt": "READY", "v": 1 }
```

Commands are JSON text frames with a `nonce` of your choosing, which the reply carries back:

```json
{ "cmd": "SET_ACTIVITY", "nonce": "1", "args": { "activity": { "details": "In a match", "startedAt": 1792000000000 } } }
{ "cmd": "CLEAR_ACTIVITY", "nonce": "2" }
```

```json
{ "nonce": "1", "ok": true }
{ "nonce": "2", "ok": false, "error": "Unknown command" }
```

| Command | `args` | |
| --- | --- | --- |
| `SET_ACTIVITY` | `{ activity }` | Sets [the activity](/developers/rich-presence/#the-activity). `activity: null` (or no `activity`) clears it. |
| `CLEAR_ACTIVITY` | | Clears it |

| Error | When |
| --- | --- |
| `Unknown command` | Any other `cmd` |
| `args.activity must be an object` | `activity` is a string, a number, … |
| `Message too large` | A frame over **16 KB**. This reply has **no `nonce`**. |
| `Not JSON` | A frame that isn't JSON. No `nonce` either. |

`ok: true` means the desktop app took the activity, not that it is valid: invalid fields are dropped later, and so is an activity whose `client_id` isn't an application on the player's instance. Binary frames, and close frames, end the connection.

## Lifetime

- The activity ends when your connection closes. Keep the connection open while the activity should show.
- When several connections have set an activity, the one reported most recently is shown.
- If the desktop app quits, your connection closes: reconnect when it comes back and send the activity again.
- There is no rate limit on the socket; others see at most one update every 2 seconds.
