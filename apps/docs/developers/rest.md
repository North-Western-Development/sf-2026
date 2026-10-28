# REST API

Everything is under `/api/v1` on the instance's origin, JSON in and out:

```
https://subspace.click/api/v1/...
```

Send `Content-Type: application/json` with a body. Real-time events come over the [gateway](/developers/gateway), not by polling.

## IDs

Every ID is a **snowflake**, as Discord uses: a 64-bit integer, always sent as a decimal string (`"1234567890123456789"`), because JavaScript numbers cannot hold 64 bits exactly. IDs sort by creation time; `Number(BigInt(id) >> 22n) + 1767225600000` is when one was made (in ms). A malformed ID is refused with a `400` or a `404`. See the [API overview](/reference/api#ids) for the bit layout.

## Authentication

| Header | Who | Reaches |
| --- | --- | --- |
| `Authorization: Bot <token>` | A [bot](/developers/bots) | Only the routes in [What bots can call](#what-bots-can-call) |
| `Authorization: Bearer <access token>` | A person, signed in to a Subspace client | Everything that person may do |
| `Authorization: Bearer <OAuth2 access token>` | An app acting for someone who authorized it | Only `/oauth2/@me` and `/oauth2/@me/beacons` ([OAuth2](/developers/oauth2)) |

Interaction callbacks and webhook posts need no header: the token in their URL is the credential.

Every route needs one of these unless it is marked public in the code. Without one the answer is `401 { "error": "Authentication required" }`. A bad bot token is `401 INVALID_BOT_TOKEN`; a bot calling a route not made for bots is `403 BOT_FORBIDDEN`.

## Errors

Errors are JSON with a human-readable `error` and, usually, a machine-readable `code`:

```json
{ "error": "Transmitter lacks MANAGE_WEBHOOKS clearance", "code": "MISSING_PERMISSIONS" }
```

Match on `code`, never on the wording. A body that fails validation (an unknown field type, a string too long, a missing required field) is answered by the framework:

```json
{ "statusCode": 400, "code": "FST_ERR_VALIDATION", "error": "Bad Request", "message": "body/name must match pattern \"^[a-z0-9_-]{1,32}$\"" }
```

Unknown fields in a body are dropped, not refused.

| Status | Means |
| --- | --- |
| `400` | The request is wrong: see `code` |
| `401` | No valid credentials (or a revoked session: `SESSION_REVOKED`) |
| `403` | Signed in, but not allowed: a missing permission (`MISSING_PERMISSIONS`), a bot on a person-only route (`BOT_FORBIDDEN`), … |
| `404` | Not found, or not visible to you: the API doesn't say which |
| `409` | Already done: `BOT_ALREADY_MEMBER`, `ALREADY_PUBLISHED`, … |
| `429` | Rate limited (below) |
| `503` | A backing service (database, Redis) is unavailable: try again later |

## Rate limits

There is no global limit per bot. These apply:

| Limit | Where | Answer |
| --- | --- | --- |
| A relay's **slowmode** | Sending in a relay that has one, without `BYPASS_SLOWMODE` | `429 { code: "SLOWMODE", retryAfter: <seconds> }` |
| 5 posts per 2 seconds per webhook, and 30 a minute per address | [Webhook](/developers/webhooks) posts | `429 RATE_LIMITED` |
| 10 publishes an hour per relay | [Publishing](/developers/webhooks#announcement-relays) an announcement | `429 RATE_LIMITED` |
| Typing indicators: one event per sender per channel every 5 seconds | `POST …/typing` | `204`; calls in between send nothing |
| Per-address limits on sign-in, sign-up, invite lookups, link previews | Those routes | `429` with `Retry-After` |

Per-address limits answer in the rate-limit plugin's format, with `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` and `retry-after` headers:

```json
{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded, retry in 1 minute" }
```

Back off when you get a `429`, and honour `retryAfter` or `Retry-After`.

## What bots can call

`:channelType` is `relay` or `thread` for bots (people can also use `link` and `mesh`). Every call is checked against the bot's [permissions](/developers/bots#permissions) in that place.

### Bot and beacons

| Route | Notes |
| --- | --- |
| `GET /bots/@me` | `{ bot: { id, username, displayName, avatarUrl, appId, beaconIds } }` |
| `GET /beacons/<id>` | A beacon the bot is in |
| `GET /beacons/<id>/relays` | Its relays (channels) |
| `GET /beacons/<id>/members` | Its members |
| `GET /beacons/<id>/clearances` | Its clearances (roles) |
| `GET /beacons/<id>/bans` | Its bans (needs `BAN_MEMBERS`) |
| `GET /users/<id>/profile` | Someone's profile |

### Transmissions (messages)

| Route | Notes |
| --- | --- |
| `GET /channels/:channelType/<id>/transmissions` | History, oldest first. Query: `limit` (1 to 100, default 50), and one of `before`, `after` or `around` (a transmission id). `{ transmissions: [...] }` |
| `POST /channels/:channelType/<id>/transmissions` | Send. Body below. `201 { transmission }` |
| `PATCH /transmissions/<id>` | Edit your own: `{ content }` |
| `DELETE /transmissions/<id>` | Your own, or anyone's with `MANAGE_TRANSMISSIONS` |
| `POST /channels/:channelType/<id>/typing` | Show "*bot* is typing…" |
| `GET /channels/:channelType/<id>/pins` | Pinned transmissions |
| `PUT` / `DELETE /transmissions/<id>/pin` | Pin or unpin (`PIN_TRANSMISSIONS`) |
| `PUT` / `DELETE /transmissions/<id>/reactions/<emoji>/@me` | React, or take your reaction back. URL-encode the emoji. |
| `DELETE /transmissions/<id>/reactions/<emoji>/<userId>` | Remove someone's reaction (`MANAGE_TRANSMISSIONS`) |
| `GET /transmissions/<id>/reactions/<emoji>` | Who reacted |
| `PUT /channels/:channelType/<id>/transmissions/<tid>/poll/votes` | Vote: `{ answerIds: [1, …] }` (answer numbers, 1 to 10); `[]` takes the vote back |
| `POST /channels/:channelType/<id>/transmissions/<tid>/poll/end` | End a poll early: your own, or anyone's with `MANAGE_TRANSMISSIONS` |

The send body:

| Field | Notes |
| --- | --- |
| `content` | Up to 2000 characters. Mention people as `<@userId>` and clearances as `<@&clearanceId>`. |
| `replyToId` | Reply to a transmission in the same channel. `replyPing: false` doesn't ping its author. |
| `attachmentIds` | Up to 10 files already uploaded to the file service |
| `stickerIds` | Up to 3 stickers |
| `poll` | `{ question (≤300), answers: [{ text (≤55), emoji? }] (1 to 10), durationHours?: 1, 4, 8, 24, 72, 168 or 336, allowMultiselect? }` (`CREATE_POLLS`) |
| `nonce` | Up to 100 characters, echoed in the `TRANSMISSION_CREATE` event so you can match it |

::: warning No embeds on plain transmissions
The send route has no `embeds` field: one sent there is dropped. Rich [embeds](/developers/embeds) come from webhooks and from [interaction replies](/developers/commands#answering).
:::

### Threads

| Route | Notes |
| --- | --- |
| `GET /relays/<relayId>/threads` | The relay's threads |
| `POST /relays/<relayId>/threads` | `{ name (1 to 100), starterTransmissionId?, private?, members?: [ids] (≤50) }` |
| `PATCH /relays/<relayId>/threads/<threadId>` | `{ name?, isLocked? }` |
| `PUT` / `DELETE /relays/<relayId>/threads/<threadId>/members/<userId>` | Add or remove someone |

Post in a thread with `channelType` `thread` and the thread's id.

### Moderation

| Route | Body | Needs |
| --- | --- | --- |
| `POST /beacons/<id>/members/<userId>/kick` | | `KICK_MEMBERS` |
| `PUT /beacons/<id>/members/<userId>/timeout` | `{ seconds }`: `0` (lift it), `60`, `300`, `600`, `3600`, `86400` or `604800` | `MODERATE_MEMBERS` |
| `PUT /beacons/<id>/bans/<userId>` | `{ reason?, deleteMessageSeconds? (0 to 604800) }` | `BAN_MEMBERS` |
| `DELETE /beacons/<id>/bans/<userId>` | | `BAN_MEMBERS` |
| `POST /beacons/<id>/clearances/members/<userId>/assign` | `{ clearanceId, action: "add" \| "remove" }` | `MANAGE_CLEARANCES` |
| `PATCH /beacons/<beaconId>/voice-states/<userId>` | `{ mute?, deafen?, relayId? }` (`relayId` moves them, `null` disconnects) | `MUTE_MEMBERS`, `DEAFEN_MEMBERS`, `MOVE_MEMBERS` |

The usual hierarchy applies: a bot acts only on members whose highest clearance is below its own.

### Commands and interactions

| Route | Notes |
| --- | --- |
| `GET` / `PUT /applications/<appId>/commands` | Its global commands |
| `GET` / `PUT /applications/<appId>/beacons/<beaconId>/commands` | One beacon's |
| `POST /interactions/<id>/<token>/callback` | Answer an interaction |
| `POST /interactions/<id>/<token>/followup` | Another message |
| `PATCH /interactions/<id>/<token>/original` | Edit the reply |

See [Slash commands and interactions](/developers/commands).

## Everything else

The rest of the API (accounts, Direct Links, settings, the Command Console, …) is for Subspace clients signed in as a person. The [API overview](/reference/api) lists its groups, and the detailed contract is kept with the code in `docs/api/parity-contract.md`.
