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
| Phone number, account standing | Placeholder | |

### Profiles and presence

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Display name, pronouns, About Me, avatar, banner, theme colours, name style | Done | Global and per-beacon profiles |
| Profile visibility (everyone, beacons, friends) | Done | |
| Online, Idle, Do Not Disturb, Invisible | Done | Ghost Mode masking is server-side |
| Custom status, commendations (badges), staff insignia | Done | |
| Avatar decorations, profile effects | Placeholder | |

### Beacons (servers) and relays (channels)

| Feature | Status | Notes |
| :--- | :--- | :--- |
| Create, rename, icon, banner, delete, leave; folders (Clusters) | Done | |
| Clearances (roles), 64-bit permissions, hierarchy, relay overwrites | Done | |
| Invites, invite page, bans, kicks, onboarding, Discovery | Done | |
| Frequency Bands (categories), hide relays, custom emoji | Done | |
| Text relays: markdown, mentions, replies, reactions, edits, deletes, pins, typing, unread | Done | |
| Link previews (embeds), with a Chat setting to turn them off | Done | SSRF-guarded fetcher, Redis cache, signed same-origin image proxy |
| Archival relays (forums), visual relays (galleries) | Done | |
| Comm-Links: voice, video, screen share, chat beside the call | Done | LiveKit SFU, real WebRTC in the browser suite |
| End-to-end encrypted Comm-Links (relay setting) | Done | Insertable streams; frame key shared by Double Ratchet signals |
| Boosts, stickers, GIFs, soundboard, threads in text relays, activities | Placeholder | |
| Audit log, AutoMod, insights, templates, widget | Placeholder | Beacon Settings pages |

### Direct messages and social

| Feature | Status | Notes |
| :--- | :--- | :--- |
| 1-on-1 DMs (Point-to-Point Links), group DMs (Subspace Meshes) | Done | |
| Friend requests with a note, message requests, blocking | Done | |
| Voice and video calls in DMs and meshes | Done | Ringing prompt, ringtone, "started a call" and missed-call messages, ring again |
| End-to-end encrypted DMs (text and attachments) | Done | X3DH + Double Ratchet (packages/e2ee); server stores ciphertext only |
| End-to-end encrypted DM calls | Done | Automatic in encrypted links |
| End-to-end encrypted meshes | Not started | Needs group key management |

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
| Staff ranks (moderator, admin, root) | Done | First rank set in the database by design; the console has no rank editor yet (API only) |

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
| Live smoke suite (`pnpm test:live`) | Done | Passes against the local stack; run it against the server once deployed |
| Documentation site (`apps/docs`) | Done | Builds with zero broken links |
| Live staging on `subspace.click`, clean-slate rebuild report | Not started | Needs server access |

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
| Backend unit and end-to-end (Vitest) | `pnpm test:native` | 36 files, 278 tests |
| Web unit (Vitest + Testing Library) | `pnpm --filter @subspace/web test` | 39 tests |
| Browser (Playwright) | `pnpm test:ui` | 63 tests on an isolated stack (real Postgres, Redis, MinIO, LiveKit; mock drives and an SMTP sink) |
| Live smoke (Playwright) | `LIVE_URL=… pnpm test:live` | 5 tests |
| Desktop (Rust) | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 2 tests |
| Mobile | `pnpm --filter @subspace/mobile test` / `typecheck` | 4 tests |
| Docs | `pnpm --filter @subspace/docs build` | Broken-link check |

## 4. What is left

1. **Deploy staging** on `subspace.click` once server access is available (guide: `apps/docs/operate/deployment.md`), run `pnpm test:live` against it, then the clean-slate rebuild from the docs.
2. **Store releases:** desktop code signing, EAS builds and store listings for mobile.
3. **Encrypted meshes** (group key management) and **frame-key rotation** when someone leaves an encrypted call.
4. **Staff rank editor** in the Command Console (the API exists).
5. **Generated SQL migrations** instead of schema push, once the schema settles.
6. The Discord-only features listed as placeholders, as and when the instance needs them.
