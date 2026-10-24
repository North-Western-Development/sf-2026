# Testing

| Suite | Command | Covers |
| :--- | :--- | :--- |
| Backend unit and end-to-end | `pnpm test:native` | Every API module, the gateway, the file service, encryption, security sweeps |
| Web unit | `pnpm --filter @subspace/web test` | Components and client logic |
| Browser | `pnpm test:ui` | The real app in Chromium on an isolated copy of the stack (port 4173): accounts, messaging, search, link previews, calls, encryption, files, cloud drives, passkeys, email, settings, moderation |
| Live smoke | `LIVE_URL=https://… pnpm test:live` | A deployed instance through its public domain |
| Desktop | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Address and navigation rules of the desktop shell |
| Mobile | `pnpm --filter @subspace/mobile test` and `typecheck` | The mobile shell's helpers and types |
| Docs | `pnpm --filter @subspace/docs build` | This site; fails on broken internal links |

## The browser suite's stack

`pnpm test:ui` starts (or reuses) `node scripts/native/dev.mjs --test-stack`:

- the test database and Redis database 1;
- the web app on port 4173 and the services on 4001-4003;
- real MinIO and LiveKit.

Global setup also starts local stand-ins for outside services:

- a mock of Google Drive, OneDrive and Dropbox (`tests/support/mock-drives.ts`);
- an SMTP sink that keeps every email (`tests/support/mail-sink.ts`).

Voice and video tests use Chromium's fake camera and microphone over real WebRTC. Encrypted-call tests prove the key exchange worked by decoding the other side's video.

## The security sweeps

`tests/e2e/security-route-coverage.test.ts` sends every registered route anonymous, `alg=none`, wrong-secret, expired and wrong-type tokens, and expects `401`. It also fuzzes the public routes and fails on any server error. A new route cannot ship without passing it, or without a reason on the public list.
