# Introduction

Subspace Frequency is a self-hosted chat, voice and video platform. If you have used Discord, you already know how it works; the names are space-themed (see [Terminology](/reference/terminology)).

| You may know it as | In Subspace |
| :--- | :--- |
| Server | Beacon |
| Channel | Relay (text, forum, gallery, or Comm-Link for voice) |
| Message | Transmission |
| DM / Group DM | Point-to-Point Link / Subspace Mesh |
| Roles | Clearances |
| Admin panel | Command Console |

## What it is made of

| Part | What it does | Code |
| :--- | :--- | :--- |
| Web edge | Serves the web app and routes `/api`, `/gateway`, `/rtc` and storage on one origin | `docker/nginx/web.conf` |
| API service | Accounts, beacons, relays, transmissions, search, calls, encryption keys | `apps/api-service` |
| Gateway | Real-time events over WebSocket: presence, typing, voice states, calls | `apps/gateway-service` |
| File service | The Subspace Vault (uploads, quotas), media uploads, cloud drive imports | `apps/file-service` |
| Badge worker | Awards commendations from event streams | `apps/badge-worker` |
| PostgreSQL | All persistent data | `packages/database` |
| Redis | Sessions, rate limits, presence, pub/sub between services | |
| MinIO (S3) | File storage | |
| LiveKit | Voice and video (SFU) | |

Clients: the web app (`apps/web`), the desktop app (`apps/desktop`, Tauri) and the mobile app (`apps/mobile`, Expo). The desktop and mobile apps open your instance in a native shell, so every instance automatically has all three.

## Where to go next

- Trying it on your machine: [Run it locally](/guide/local-development).
- Putting it on a server: [Deployment](/operate/deployment).
- How accounts, sessions and encryption are protected: [Security and encryption](/guide/security).
