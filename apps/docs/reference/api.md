# API overview

Everything is under `/api/v1` on the instance's origin, JSON in and out. Real-time events arrive over the gateway WebSocket at `/gateway`.

## IDs

Every ID is a **snowflake**, as Discord uses: a 64-bit integer, always sent as a decimal string (`"1234567890123456789"`), because JavaScript numbers cannot hold 64 bits exactly.

| Bits | Holds |
| --- | --- |
| 63 to 22 | Milliseconds since 2026-01-01T00:00:00Z |
| 21 to 12 | The worker that made it |
| 11 to 0 | A sequence within that millisecond |

So IDs sort by creation time, and `Number(BigInt(id) >> 22n) + 1767225600000` is when one was made. A malformed ID is refused with a 400 or a 404.

## Authentication

Send the access token as `Authorization: Bearer <token>`. Bots use `Authorization: Bot <token>` instead (see [Bots](/developers/bots)).

- Access tokens last 15 minutes; refresh them with `POST /api/v1/auth/refresh` and the refresh token (it rotates; each works once).
- `401` means the session is missing, expired or signed out. A wrong password on a sensitive change is `400` with `PASSWORD_INCORRECT`, so clients never mistake it for a lost session.

Routes that work signed out are marked public in the code, and a test lists every one with its reason:

- sign-up and sign-in;
- refresh and logout;
- the Subspace Directives;
- invite previews;
- passkey sign-in;
- email verification links;
- cloud-drive OAuth callbacks;
- vault file links;
- embed images;
- the instance info.

## Groups

| Prefix | What |
| :--- | :--- |
| `/auth` | Sign-up, sign-in, 2FA, sessions (devices), password, email, account removal, email verification |
| `/auth/passkeys` | Passkey registration, management and sign-in |
| `/users`, `/affiliations`, `/blacklist` | Profiles, friends, blocking |
| `/beacons`, `/beacons/:id/relays`, `/beacons/:id/clearances`, `/invites` | Communities, channels, roles, invites |
| `/channels/:type/:id/transmissions` | History and sending for relays, threads, direct links and meshes |
| `/transmissions/:id` | Edit, delete, reactions, pins, removing link previews |
| `/links`, `/meshes`, `/requests` | Direct links, group links, message requests |
| `/calls` | Direct-link and mesh calls: ring, decline, join |
| `/relays/:id/comm-link` | Comm-Link voice grants |
| `/relays/:id/archival`, `/relays/:id/visual` | Forums and galleries |
| `/search` | Quick Scan and deep transmission search |
| `/unfurl`, `/embed-proxy` | Link previews |
| `/e2ee` | Encryption devices, prekey bundles, encrypting a link, key signals |
| `/push` | Mobile push tokens |
| `/read-states`, `/notification-settings` | Unread markers and notification levels |
| `/reports`, `/console` | Reporting and the Command Console |
| `/vault`, `/media` | Files, uploads and cloud drives (file service) |
| `/applications`, `/teams`, `/bots`, `/interactions`, `/webhooks` | [Developer Applications](/developers/), [bots](/developers/bots), [commands](/developers/commands), [webhooks](/developers/webhooks) |
| `/oauth2` | [Sign in with Subspace](/developers/oauth2) |

The detailed contract (shapes, events, rules) is kept with the code in `docs/api/parity-contract.md`.

## Gateway

Connect to `/gateway` and the server sends `HELLO` (op 10, `{ heartbeat_interval: 30000 }`). Reply with `IDENTIFY` (op 2, `{ token }`) within 10 seconds and you receive `READY` with presences, voice states and activities, then `DISPATCH` events (op 0), for example `TRANSMISSION_CREATE`, `VOICE_STATE_UPDATE` and `CALL_CREATE`. Heartbeat with op 1 every 30 seconds. Signing a device out closes its socket with code 4005.

The full protocol is in [Gateway](/developers/gateway), and the events in [Gateway events](/developers/events).

## Building on Subspace

Bots, webhooks, slash commands, OAuth2 and Rich Presence have their own section: start at [Getting started for developers](/developers/), or go straight to the [REST API for bots](/developers/rest).
