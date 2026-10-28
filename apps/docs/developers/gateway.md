# Gateway

The gateway is a WebSocket that pushes events to bots and clients as they happen: new transmissions (messages), members joining, interactions, presence, and so on. The [SDKs](/developers/sdk/javascript) speak it for you; this page is for writing your own client.

## Connect

```
wss://subspace.click/gateway
```

No query parameters are read: there is no `v`, `encoding` or `compress`. Frames are JSON text. Every payload is an envelope:

```json
{ "op": 0, "t": "TRANSMISSION_CREATE", "d": { … } }
```

`op` is the opcode, `d` the data, and `t` the event name (dispatches only). There are no sequence numbers (`s`).

A frame larger than **16 KiB** closes the connection (`1009`). A frame that is not valid JSON is ignored.

## Opcodes

| op | Name | Direction | Payload |
| --- | --- | --- | --- |
| 0 | `DISPATCH` | server → client | An event: `t` and `d` |
| 1 | `HEARTBEAT` | client → server | No `d` needed. The server answers op 11. |
| 2 | `IDENTIFY` | client → server | `{ token, presence? }` |
| 3 | `PRESENCE_UPDATE` | client → server | `{ presence }`: `online`, `idle`, `dnd`, `away`, `invisible` or `offline` |
| 4 | `VOICE_STATE_UPDATE` | client → server | Joining Comm-Links (voice channels). Ignored for bots. |
| 5 | `ACTIVITY_UPDATE` | client → server | `{ activity }`: what this account is playing, or `null` ([the activity](/developers/rich-presence/#the-activity)) |
| 10 | `HELLO` | server → client | `{ heartbeat_interval: 30000 }` |
| 11 | `HEARTBEAT_ACK` | server → client | No `d` |

Opcodes 6 (`RESUME`), 7 (`RECONNECT`) and 9 (`INVALID_SESSION`) are reserved in `GATEWAY_OPCODES` but not used: the server neither sends nor accepts them. To come back after a disconnect, open a new connection and `IDENTIFY` again.

## The handshake

1. Open the socket. The server sends `HELLO`:
   ```json
   { "op": 10, "d": { "heartbeat_interval": 30000 } }
   ```
2. Send `IDENTIFY` within **10 seconds** (or the server closes with `4001`):
   ```json
   { "op": 2, "d": { "token": "Bot <your bot token>" } }
   ```
   A bot's token is `Bot ` followed by its token. A person's client sends its access token as it is, without `Bearer `. `presence` is optional (`online` by default); bots may use `invisible` too. Any other field, such as `intents` or `properties`, is ignored: a bot's [intents](/developers/bots#privileged-intents) are set on the bot itself.
3. The server answers with the `READY` dispatch, then sends events as they happen.

Before `READY`, anything other than op 1 or op 2 closes the connection with `4004`. A second `IDENTIFY` is ignored.

### READY

```json
{
  "op": 0,
  "t": "READY",
  "d": {
    "transmitter": { "id": "…", "username": "dicebot" },
    "presence": "online",
    "presences": [{ "transmitter_id": "…", "presence": "online" }],
    "voice_states": [ … ],
    "activities": [{ "transmitter_id": "…", "activity": { … } }],
    "activity_visibility": "everyone",
    "session_id": "subspace_sess_…"
  }
}
```

| Field | Holds |
| --- | --- |
| `transmitter` | Who you are |
| `presences` | The presence of everyone you share a beacon, an affiliation (friendship), a Direct Link or a Mesh with |
| `voice_states` | Who is in which Comm-Link, in your beacons (shaped like [`VOICE_STATE_UPDATE`](/developers/events#voice-and-presence)) |
| `activities` | What they are playing. Empty for a bot without the Activity Status intent. |
| `activity_visibility` | Your own Activity Privacy; always `everyone` for a bot |
| `session_id` | An identifier for this connection. It cannot be resumed. |

`READY` does not list beacons. A bot gets them from [`GET /api/v1/bots/@me`](/developers/rest#bot-and-beacons) (`beaconIds`), and learns about new ones from [`BEACON_CREATE`](/developers/events#beacons-members-and-clearances).

## Staying connected

Send `{ "op": 1 }` every `heartbeat_interval` milliseconds (30 seconds); the server answers `{ "op": 11 }`.

Every 30 seconds the server also checks each connection: one that neither answered the WebSocket-level ping it sent last time nor sent a heartbeat since is terminated (you see `1006`). WebSocket libraries answer pings on their own, so in practice a dead connection is dropped within 30 to 60 seconds. Send heartbeats anyway: they keep you connected through proxies and tell you the connection is alive.

The gateway doesn't replay what you missed. After a reconnect, fetch history over [REST](/developers/rest) if you need it. An interaction that arrives while your bot is offline is not queued: the person sees "did not respond".

## Close codes

| Code | Reason | What to do |
| --- | --- | --- |
| `4001` | No `IDENTIFY` within 10 seconds | Reconnect and identify sooner |
| `4002` | `IDENTIFY` without a string `token` | Fix the payload |
| `4003` | The token is invalid or expired, or the session was signed out | Don't retry with the same token: reset it or sign in again |
| `4004` | An opcode other than 1 or 2 before `READY` | Identify first |
| `4005` | The session was signed out (a `SESSION_REVOKED` dispatch comes first) | Sign in again |
| `1009` | A frame over 16 KiB | Send smaller frames |
| `1006` | No answer to pings or heartbeats | Reconnect |

Anything else (a restart, a network drop): reconnect after a short delay and identify again.

::: info
Resetting a bot's token stops it working for REST calls at once. A gateway connection opened with the old token stays open until it closes; the next `IDENTIFY` with that token is refused with `4003`.
:::

The gateway also refuses the connection upgrade with HTTP `401` from regions the instance blocks.

## Updating presence

```json
{ "op": 3, "d": { "presence": "idle" } }
```

The server confirms with a `PRESENCE_CONFIRMATION` dispatch (`{ presence }`) and tells everyone who can see you (`PRESENCE_UPDATE`). An unknown value is ignored. `invisible` shows you as `offline` to others.

## Activity

A client reports what its user is playing with op 5. The desktop app does this for people, from [game detection and Rich Presence](/developers/rich-presence/); a bot can set one for itself the same way:

```json
{ "op": 5, "d": { "activity": { "type": "playing", "details": "Rolling dice" } } }
```

The server cleans the activity up (see [the activity](/developers/rich-presence/#the-activity)), sends at most one update every 2 seconds per connection (always ending on the latest), and ends it when the connection closes. `{ "activity": null }` clears it.

## Events

See [Gateway events](/developers/events) for every event a bot receives and its payload.
