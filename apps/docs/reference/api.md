# API overview

Everything is under `/api/v1` on the instance's origin, JSON in and out. Real-time events arrive over the gateway WebSocket at `/gateway`.

## Authentication

Send the access token as `Authorization: Bearer <token>`.

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

The detailed contract (shapes, events, rules) is kept with the code in `docs/api/parity-contract.md`.

## Gateway

Connect to `/gateway` and the server sends `HELLO` (op 10). Reply with `IDENTIFY` (op 2, `{ token }`) and you receive `READY` with presences and voice states, then `DISPATCH` events (op 0), for example:

- `TRANSMISSION_CREATE`;
- `VOICE_STATE_UPDATE`;
- `CALL_CREATE`.

Heartbeat with op 1 every 30 seconds. Signing a device out closes its socket with code 4005.
