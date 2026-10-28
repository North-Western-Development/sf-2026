# Clients

Every instance gets three clients. The desktop and mobile apps are native shells around the instance's web app, so they always match the server's version and need no separate releases when the server updates.

## Web

Served by the instance itself at its public address. Works in current Chrome, Edge, Firefox and Safari. End-to-end encryption needs IndexedDB and WebCrypto (all of them have it); encrypted calls need insertable streams (Chromium-based browsers and Safari).

## Desktop (Windows, macOS, Linux)

`apps/desktop` is a [Tauri v2](https://tauri.app) app.

- First run asks for the server address and checks that it answers like a Subspace instance.
- The instance's pages get no native access at all; links to other sites open in the system browser.
- Closing the window keeps Subspace in the tray (**Open**, **Change Server**, **Quit**); a second launch focuses the running app.
- It updates itself from its publisher (`https://subspace.click/downloads/desktop/latest.json`). An update found while it starts installs straight away; one found later waits for **Restart to Update** in the tray. Updates must be signed with the publisher's updater key.

Download it for Windows from **User Settings › Activity Privacy**, or at `/downloads/desktop/Subspace-Frequency-Setup.exe` on an instance that publishes it. The installer is not code-signed yet, so Windows SmartScreen asks before running it (**More info › Run anyway**).

Build it on each target OS (Rust stable and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) required):

```bash
pnpm --filter @subspace/desktop package          # installers in src-tauri/target/release/bundle
pnpm --filter @subspace/desktop check            # cargo check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### Publishing a release

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml` and `package.json`. Installed apps only move to a higher version.
2. Build the installer signed with the updater key (kept off the repository; its public half is in `tauri.conf.json`):
   ```bash
   TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.subspace/desktop-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""      pnpm --filter @subspace/desktop exec tauri build --bundles nsis
   ```
3. `deploy/server/publish-desktop.sh "What changed"` uploads it to `/downloads/desktop/` and updates `latest.json`.

Losing the updater key means installed apps can never be updated again: back it up.

## What's New

People see a **What's New** popup the first time they open the web, desktop or mobile app after an update that concerns that app, like Discord's. It is in **User Settings › What's New** after that.

Entries live in `apps/web/src/features/changelog/changelog.ts`, newest first, and ship with the web app. Give each release people would notice an entry: an `id` (its date, `2026-11-02`, or `2026-11-02b` for a second release that day), a title, and **New Features**, **Improvements** and **Bug Fixes** items. Limit an entry or an item to the platforms it concerns with `platforms: ['desktop']`.

Each account remembers the newest entry it has seen on each platform. Someone whose account is newer than an entry never gets it as a popup, and at most three entries pop up at once.

## Mobile (iOS, Android)

`apps/mobile` is an [Expo](https://expo.dev) (SDK 57) app.

- A connect screen, then the instance in a WebView with native notifications, haptics, Android back navigation, and camera and microphone permissions for calls.
- The web Notification API is bridged to native notifications. Tapping a push opens the conversation it was about.

```bash
pnpm --filter @subspace/mobile start        # Expo dev server
pnpm --filter @subspace/mobile typecheck
pnpm --filter @subspace/mobile test
pnpm --filter @subspace/mobile bundle       # production JS bundle for Android
```

For store builds use EAS (`eas build`). Push notifications need an EAS project id in `app.json` (`extra.eas.projectId`); see [Mobile push](/operate/push).
