# Subspace Frequency Roadmap

What exists today, what is left, and how it is tested. Last checked against the code on 2026-10-23 (branch `ui-parity`).

- **Documentation site:** `apps/docs` (operators, deployment, security, configuration)
- **API source of truth:** [docs/api/parity-contract.md](https://github.com/North-Western-Development/sf-2026/blob/main/docs/api/parity-contract.md)
- **Terminology:** [docs/terminology.md](terminology.md) (Beacon = server, Relay = channel, Transmission = message, and so on)
- **Phase specs (original plan):** [docs/phases/](https://github.com/North-Western-Development/sf-2026/tree/main/docs/phases)

Status key:

- **Done:** works end to end and is covered by tests.
- **Ready, not deployed:** built and verified locally, waiting on a server.
- **Placeholder:** shown greyed out with a "Coming soon" tooltip.
- **Not started:** nothing exists yet.

## 1. Feature status

### Identity and accounts

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Register, sign in (by `name#0000` or email), sign out | Done | Argon2id hashing; 4-digit random tag per username |
| Rotating refresh tokens; typed JWTs (access, refresh, 2FA challenge) | Done | A refresh token is single-use; tokens cannot be used as another type |
| Authenticator-app 2FA with backup codes | Done | |
| Passkeys: add, rename, remove; passwordless sign-in | Done | WebAuthn with user verification; Chrome virtual authenticator in the browser suite |
| Email verification over SMTP; notice bar with Resend | Done | Hashed single-use tokens, 24 h; email change re-verifies and tells the old address |
| Subspace Directives (instance rules) gate | Done | |
| Password, email and username changes (password-gated) | Done | A password change signs other devices out |
| Logged-in devices: list, sign one out, sign all others out | Done | Revocation is immediate in the API, file service and gateway |
| Disable account (restore by signing in), delete account | Done | Delete refuses while the user owns beacons, then anonymises to "Deleted User" |
| Phone number, account standing | Done | Twilio texts; off without Twilio. Limits per account, number and address; no VPNs or proxies |

### Profiles and presence

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Display name, pronouns, About Me, avatar, banner, theme colours, name style | Done | Global and per-beacon profiles |
| Profile visibility (everyone, beacons, friends) | Done | |
| Online, Idle, Do Not Disturb, Invisible | Done | Ghost Mode masking is server-side |
| Custom status, commendations (badges), staff insignia | Done | |
| Avatar decorations, profile effects | Done | Built-in sets |

### Beacons (servers) and relays (channels)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Create, rename, icon, banner, delete, leave; folders (Clusters) | Done | |
| Clearances (roles), 52 fine-grained permissions, hierarchy, relay overwrites | Done | Video and Holo-Cast, mute and deafen, create and manage relays, invites, expressions, threads, mentions, insights are separate |
| Frequency Band (category) permissions, sync and Sync Now | Done | Editing a synced relay copies the band's permissions and un-syncs it, as Discord does |
| Slowmode, polls, voice messages, private threads | Done | Each behind its own permission (Bypass Slowmode, Create Polls, Send Voice Messages, Create Private Threads) |
| Push-to-talk, Priority Speaker | Done | No Use Voice Activity forces push-to-talk; Priority Speaker plays others quieter while held |
| Invites, invite page, bans, kicks, onboarding, Discovery | Done | |
| Frequency Bands (categories), hide relays, custom emoji | Done | |
| Text relays: markdown, mentions, replies, reactions, edits, deletes, pins, typing, unread | Done | |
| Link previews (embeds), with a Chat setting to turn them off | Done | SSRF-guarded fetcher, Redis cache, signed same-origin image proxy |
| Archival relays (forums), visual relays (galleries) | Done | |
| Comm-Links: voice, video, screen share, chat beside the call | Done | LiveKit SFU, real WebRTC in the browser suite |
| End-to-end encrypted Comm-Links (relay setting) | Done | Insertable streams; frame key shared by Double Ratchet signals, changed when someone leaves |
| Stickers, GIFs, soundboard, threads in text relays | Done | |
| Activity status: game detection and Rich Presence, with Activity Privacy | Done | Desktop app finds known games and runs a local RPC server; SDKs for JavaScript (`packages/rich-presence`), C++, C#, Unity and Unreal (`sdk/`; the Unreal plugin is not yet compiled against the engine); Steam covers, replaced by a verified application's icon (Command Console › Verified Games); bots see activity only with the Activity Status intent; off by default, never stored; guide in `apps/docs/guide/rich-presence.md` |
| Developer policy: who can create applications and use privileged intents | Done | Command Console › Developers: verified means email, phone and/or hand-verified by staff; apps for anyone or verified accounts, plus required email/phone; each intent (Message Content, Activity Status) for any or verified developers |
| Verified bots, APP/HOOK/BEACON tags, Add App on public bots, development teams | Done | Staff verify bots in Command Console › Transmitters; teams with owner/admin/developer/read-only roles; application icons |
| Announcement relays that other beacons follow | Done | Publish from the context menu; copies carry the BEACON tag and never ping |
| Bot SDKs (JavaScript, Deno, Python, Java, C#, C++) and the package registry | Done | Served from `/packages/` (npm, PyPI, Maven, NuGet, archives), built by `deploy/server/publish-packages.sh` |
| Custom Activities from developers | Done | Staff-approved, sandboxed iframes on the developer's origin, `@subspace/activity-sdk`; see `apps/docs/developers/activities.md` |
| Inbox (Unreads, Mentions, Bookmarks, Reminders), Mark Unread, scheduled transmissions, notes, status answers | Done | Scheduled transmissions stay on the device that scheduled them; NOTE_MAX_LENGTH |
| Activities (Watch Together, Whiteboard), Clips, Stages | Done | Several activities per comm-link; clips mix in everyone in the room and warn them |
| Voice moderation: server mute, server deafen, move, disconnect | Done | Mute Members / Move Members; enforced by LiveKit |
| Webhooks, bots, slash commands and interactions; bot SDK | Done | Manage Webhooks / Use Application Commands; ephemeral and deferred replies; Ed25519-signed HTTP interactions; `packages/bot-sdk`; guide in `apps/docs/guide/bots.md` |
| Audit log, AutoMod, insights, templates, widget | Done | Beacon Settings pages |

### Direct messages and social

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 1-on-1 DMs (Point-to-Point Links), group DMs (Subspace Meshes) | Done | |
| Friend requests with a note, message requests, blocking | Done | |
| Voice and video calls in DMs and meshes | Done | Ringing prompt, ringtone, "started a call" and missed-call messages, ring again |
| End-to-end encrypted DMs (text and attachments) | Done | X3DH + Double Ratchet (packages/e2ee); server stores ciphertext only |
| End-to-end encrypted DM calls | Done | Automatic in encrypted links and meshes |
| End-to-end encrypted meshes | Done | Each message sealed per member device (pairwise, as Signal does for small groups); members need a device to be added |

### Search, files and notifications

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Quick Scan (`Ctrl+K`) | Done | |
| Search panel: text plus from:, mentions:, has:, in:, before:, during:, after:, pinned: | Done | Beacons or DMs, paged, sort, Jump to result |
| Subspace Vault: uploads, quota, list, delete | Done | Recording accepts only the caller's own ticketed object, at its real size |
| Cloud drive import (Google Drive, OneDrive, Dropbox) | Done | OAuth + PKCE, browser-bound state, encrypted tokens; tested against a provider mock |
| Unread markers, mentions, notification levels and mutes | Done | |
| Desktop notifications and ping sound | Done | |
| Mobile push (DMs, mentions, incoming calls) | Done | Expo push; respects mutes, mobile-push-off and Do Not Disturb |

### Moderation and instance staff

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Report a transmission, user or beacon | Done | Snapshot of the reported content |
| Command Console: reports, suspend and restore, quarantine files | Done | Suspending ends every session at once |
| Staff ranks | Done | Custom ranks with their own permissions, color and badge, ordered; staff act only below their own rank. Built-in Root, Admin and Moderator. First Root set in the database |
| Custom badges and the staff log | Done | Badges given by staff, worn by a rank, or earned by a rule; every console action is logged |
| Storage groups | Done | Admins give accounts their own Vault quota and upload limit; DEFAULT_STORAGE_QUOTA_MB / DEFAULT_MAX_UPLOAD_MB for everyone else |
| Themes: Deep Space, AMOLED | Done | Per device; more themes to come |

### Clients

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Web app (`apps/web`, React 19 + Vite) | Done | |
| Desktop app (`apps/desktop`, Tauri v2) | Done | Native shell: connect screen, tray, close to tray, single instance, external links in the browser; 1.6 MB NSIS installer built on Windows |
| Mobile app (`apps/mobile`, Expo SDK 57) | Done | Native shell: connect screen, WebView, notification bridge, push, haptics, permissions; Android bundle built |
| Store releases (signed installers, App Store, Play Store) | Not started | Needs signing certificates and store accounts |

### Deployment

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Production compose with a schema migrate step | Ready, not deployed | The previous compose never created the schema |
| Staging overlay, LiveKit public config, host nginx | Ready, not deployed | `docker-compose.staging.yml`, `deploy/nginx/subspace.conf` |
| Live smoke suite (`pnpm test:live`) | Done | Passes against `subspace.click`, with media through TURN |
| Documentation site (`apps/docs`) | Done | Builds with zero broken links |
| Native deployment (systemd, one user per service) | Done | `deploy/server`: hardening, platform, services, certificates, releases |
| Snowflake IDs | Done | 64-bit, time-ordered, sent as strings; a worker number per service, and `subspace_snowflake()` in Postgres for SQL inserts |
| Generated SQL migrations | Done | `packages/database/drizzle`; databases built by schema push are adopted once; tests fail on a schema change without a migration |
| Live on `subspace.click` | Done | Hardened server, Let's Encrypt certificates, LiveKit with TURN |

## 2. Security model

- **Secure by default.** Every route needs a valid access token unless marked `config: { public: true }`. Each public route has a reason in `tests/e2e/security-route-coverage.test.ts`, which also attacks every route with forged, expired and wrong-type tokens and fuzzes the public ones.
- **Sessions.** Each sign-in is a device session in Redis that the API, file service and gateway all check. Signing a device out, changing the password, or disabling, deleting or suspending an account cuts access at once.
- **Sensitive changes** re-check the current password, and answer a wrong one with 400 rather than 401.
- **Scoped real-time events.** The gateway delivers an event only to its resolved audience; call states stay inside their conversation.
- **Outbound requests** (link previews, embed images) refuse private, loopback, link-local, CGNAT and multicast addresses on every redirect hop, and pin the checked address.
- **End-to-end encryption.** In encrypted DMs and calls the server holds only public keys and ciphertext; see Security and encryption on the docs site.

## 3. How it is tested

| Suite | Command | Count |
| :--- | :--- | :--- |
| Backend unit and end-to-end (Vitest) | `pnpm test:native` | 57 files, 369 tests |
| Web unit (Vitest + Testing Library) | `pnpm --filter @subspace/web test` | 50 tests |
| Browser (Playwright) | `pnpm test:ui` | 117 tests on an isolated stack (real Postgres, Redis, MinIO, LiveKit; mock drives and an SMTP sink) |
| Live smoke (Playwright) | `LIVE_URL=… pnpm test:live` | 5 tests |
| Desktop (Rust) | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 2 tests |
| Mobile | `pnpm --filter @subspace/mobile test` / `typecheck` | 4 tests |
| Docs | `pnpm --filter @subspace/docs build` | Broken-link check |

## 4. What is left

1. **Production follow-ups** on `subspace.click`: SMTP and Twilio credentials, and the first instance-staff account.
2. **Store releases:** desktop code signing, EAS builds and store listings for mobile.

