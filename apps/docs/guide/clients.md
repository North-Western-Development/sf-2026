# Clients

Every instance gets three clients. The desktop and mobile apps are native shells around the instance's web app, so they always match the server's version and need no separate releases when the server updates.

## Web

Served by the instance itself at its public address. Works in current Chrome, Edge, Firefox and Safari. End-to-end encryption needs IndexedDB and WebCrypto (all of them have it); encrypted calls need insertable streams (Chromium-based browsers and Safari).

## Desktop (Windows, macOS, Linux)

`apps/desktop` is a [Tauri v2](https://tauri.app) app.

- First run asks for the server address and checks that it answers like a Subspace instance.
- The instance's pages get no native access at all; links to other sites open in the system browser.
- Closing the window keeps Subspace in the tray (**Open**, **Change Server**, **Quit**); a second launch focuses the running app.

Build it on each target OS (Rust stable and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) required):

```bash
pnpm --filter @subspace/desktop package          # installers in src-tauri/target/release/bundle
pnpm --filter @subspace/desktop check            # cargo check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

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
