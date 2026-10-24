# Subspace Frequency Roadmap

What exists today, what is left, and how it is tested. Status was last checked against the code on 2026-10-23 (branch `ui-parity`).

- **API source of truth:** [docs/api/parity-contract.md](api/parity-contract.md)
- **Terminology:** [docs/terminology.md](terminology.md) (Beacon = server, Relay = channel, Transmission = message, and so on)
- **Phase specs (original plan):** [docs/phases/](phases/)

Status key: **Done** works end to end and is covered by tests. **API only** has a server with no web UI yet. **Placeholder** is shown greyed out with a "Coming soon" tooltip. **Not started** means nothing exists yet.

## 1. Feature status

### Identity and accounts

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Register, sign in (by `name#0000` or email), sign out | Done | Argon2id hashing; 4-digit random tag per username |
| Rotating refresh tokens; typed JWTs (access, refresh, 2FA challenge) | Done | A refresh token is single-use; tokens cannot be used as another type |
| Authenticator-app 2FA with backup codes | Done | |
| Subspace Directives (instance rules) gate | Done | |
| Password change (signs other devices out) | Done | |
| Email change, username change (both ask for the password) | Done | |
| Logged-in devices: list, sign one out, sign all others out | Done | Revocation takes effect on the next request and closes the device's gateway socket |
| Disable account (restore by signing in), delete account | Done | Delete refuses while the user owns beacons, then anonymises to "Deleted User" |
| Passkeys / security keys | Placeholder | Schema and `PasskeyManager` exist; no routes or UI |
| SMTP email verification | Not started | Accounts are created verified |
| Phone number, account standing | Placeholder | |

### Profiles and presence

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Display name, pronouns, About Me (markdown), avatar, banner, theme colours, name style | Done | Global and per-beacon profiles |
| Profile visibility (everyone, beacons, friends) | Done | |
| Online, Idle, Do Not Disturb, Invisible (shown as offline to others) | Done | Ghost Mode masking is server-side |
| Custom status | Done | |
| Commendations (badges) and the staff insignia | Done | `apps/badge-worker` awards them from Redis Streams |
| Avatar decorations, profile effects | Placeholder | |

### Beacons (servers) and relays (channels)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Create, rename, icon, banner, delete, leave | Done | |
| Beacon folders (Clusters): drag to create, rename, colour, ungroup | Done | Folder badge sums its beacons' mentions |
| Clearances (roles), 64-bit permissions, hierarchy rules, relay overwrites | Done | |
| Invites, invite page, bans, kicks | Done | |
| Onboarding rules agreement | Done | |
| Discovery directory | Done | Opt-in; private beacons are invisible to non-members |
| Frequency Bands (categories), hide relays, unhideable relays | Done | |
| Custom emoji (Signal Glyphs) | Done | |
| Text relays | Done | Markdown, mentions, replies, reactions, edits, deletes, pins, typing, unread and mention badges |
| Archival relays (forums): posts, tags, search, lock, pin | Done | |
| Visual relays (galleries): upload with caption, live grid, viewer, delete | Done | Images and video |
| Comm-Links: voice, video, screen share (Holo-Cast), mute and deafen, chat beside the call | Done | LiveKit SFU; verified live in the browser suite |
| Boosts, stickers, GIFs, soundboard, threads in text relays, activities | Placeholder | |
| Audit log, AutoMod, insights, templates, widget | Placeholder | Beacon Settings pages |

### Direct messages and social

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 1-on-1 DMs (Point-to-Point Links) | Done | |
| Group DMs (Subspace Meshes) | Done | |
| Friend (Affiliation) requests with a note, live in both directions | Done | |
| Message Requests from non-friends (one message, 7-day expiry) | Done | |
| Blocking (users, messages, beacons) | Done | |
| DM voice and video calls | Placeholder | |

### Notifications

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Unread markers, mention counts, mark as read | Done | Survive reloads and reconnects |
| Per-beacon, per-relay and per-DM notification levels and mutes | Done | Mutes still badge direct mentions |
| Desktop notifications and ping sound | Done | Not while the conversation is focused or in Do Not Disturb |

### Files

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Subspace Vault: uploads via presigned MinIO URLs, quota, file list, delete | Done | First upload shows the public-link disclaimer |
| Attachments in transmissions | Done | |
| External drives (OneDrive, Google Drive, Dropbox) | API only | `apps/file-service/src/integrations`; no picker in the new web UI |
| Link unfurling (inline previews) | API only | `modules/unfurl`; previews not rendered yet |

### Search

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Quick Scan (`Ctrl+K`): beacons, relays, DMs, people | Done | |
| Full-text transmission search with filters | API only | No search panel in the web UI yet |

### Moderation and instance staff

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Report a transmission, user or beacon | Done | Saves a snapshot of the reported content |
| Command Console: reports queue, suspend and restore accounts, quarantine files | Done | Opened from User Settings by instance staff |
| Staff ranks (moderator, admin, root) | Done | No API grants the first rank, by design; set it in the database |

### Clients and encryption

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Web app (`apps/web`, React 19 + Vite) | Done | |
| Desktop app (Tauri) | Not started | |
| Mobile app (Expo) | Not started | |
| End-to-end encrypted DMs (Double Ratchet) | Not started | |
| End-to-end encrypted Comm-Links (Insertable Streams) | Not started | |

## 2. Security model

- **Secure by default.** Every API and file-service route needs a valid access token unless it is marked `config: { public: true }`. The public list is short and each entry has a reason in `tests/e2e/security-route-coverage.test.ts`.
- **Endpoint sweep.** That test sends every registered route anonymous, `alg=none`, wrong-secret, expired and refresh-as-access tokens and expects 401. It also fuzzes the public routes and fails on any 5xx. A new route has to be covered before the suite passes.
- **Scoped real-time events.** The gateway only delivers an event to the users the API resolved as its audience (relay viewers, mesh members, DM participants).
- **Sessions.** Each sign-in is a device session in Redis. Access tokens carry its id, so signing a device out, changing the password, or disabling the account cuts access right away instead of when the token expires.
- **Sensitive changes** (email, username, password, disable, delete) re-check the current password. A wrong password returns 400, not 401, so the client never mistakes it for an expired session.

## 3. How it is tested

| Suite | Command | Covers |
| :--- | :--- | :--- |
| Backend unit and end-to-end (Vitest) | `pnpm test:native` | 26 files: every module, gateway fanout, LiveKit tokens, security sweeps |
| Web unit (Vitest + Testing Library) | `pnpm --filter @subspace/web test` | Components and client logic |
| Browser (Playwright) | `pnpm test:ui` | 45 tests on a separate test copy of the app (port 4173, own database and Redis): sign-up and sign-in, messaging, notifications, friends and DMs, settings, account removal, devices, folders, beacon admin, forums, galleries, vault, reports and console, live voice and video, layout guards |

The stack runs natively without Docker; see `scripts/native/`. `pnpm dev:native` starts the dev stack. The browser suite starts (or reuses) its test copy with `node scripts/native/dev.mjs --test-stack`.

## 4. What is left

In rough priority order:

1. **Search panel** for full-text transmission search (the API exists).
2. **Link previews** in transmissions (the unfurl API exists).
3. **External drive picker** in the Vault (the API exists).
4. **Passkeys** (routes and the Security Keys settings row).
5. **SMTP email verification** and verifying a changed email.
6. **DM voice and video calls** on top of the existing Comm-Link pipeline.
7. **End-to-end encryption** for DMs and Comm-Links.
8. **Desktop (Tauri) and mobile (Expo)** clients.
9. **Staging deployment and the documentation site** (original phases 11 and 12).

The other Discord-only features stay as placeholders until someone decides which ones Subspace needs.
