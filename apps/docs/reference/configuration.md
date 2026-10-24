# Configuration

All configuration is environment variables, read from `.env` at the repository root (copy `.env.example`). Docker Compose passes them to the services; native runs read the same file.

Generate secrets with `openssl rand -hex 32`. In production a missing required secret stops the service instead of falling back to a development default.

## Required

| Variable | Used by | Meaning |
| :--- | :--- | :--- |
| `PUBLIC_ORIGIN` | API, file service | The exact address people use, e.g. `https://subspace.click`. Passkeys, email links and storage URLs are bound to it. |
| `JWT_SECRET` | all services | Signs access and refresh tokens. Other keys derive from it unless set. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | database | Database credentials. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | storage | Object storage credentials. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | API, LiveKit | Voice and video. |

## Web edge

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `WEB_PORT` | `8080` | Port of the web edge (loopback-only in staging). |
| `LIVEKIT_PUBLIC_URL` | same origin | Only if LiveKit signaling is served from a different address than `/rtc`. |

## Accounts and security

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `WEBAUTHN_ORIGINS` | `PUBLIC_ORIGIN` | Comma-separated origins allowed to use passkeys and to appear in email links. |
| `RP_ID` | origin hostname | Passkey relying-party id. Set it to the bare domain to share passkeys across subdomains. |
| `MEDIA_PROXY_SECRET` | from `JWT_SECRET` | Signs link-preview image proxy URLs. |

## Email

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `SMTP_HOST` | unset | Turns on email (and email verification). |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465). |
| `SMTP_USER`, `SMTP_PASS` | unset | SMTP credentials. |
| `SMTP_FROM` | `Subspace Frequency <no-reply@subspace.click>` | Sender. |
| `EMAIL_LINK_BASE` | origin in use | Fix links in email to one address. |

## Cloud drives

| Variable | Meaning |
| :--- | :--- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Drive import |
| `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET` | OneDrive import |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | Dropbox import |
| `DRIVE_REDIRECT_BASE` | Fix OAuth redirects to one address (default: the origin in use). |
| `DRIVE_TOKEN_KEY` | Encrypts stored drive tokens (default: from `JWT_SECRET`). |

## Mobile push

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `EXPO_ACCESS_TOKEN` | unset | Only with Expo "enhanced push security". |
| `EXPO_PUSH_URL` | Expo's endpoint | Override for testing. |

## Development only

Ignored in production.

| Variable | Meaning |
| :--- | :--- |
| `VITE_BACKEND_HOST` | Where the Vite dev server proxies to (default `127.0.0.1`). |
| `UNFURL_ALLOW_PRIVATE_HOSTS` | Hostnames link previews may fetch even though they resolve privately (the browser tests use `localhost`). |
| `DRIVE_MOCK_ORIGIN` | Points every cloud drive at a local mock (tests). |
| `SMTP_INSECURE` | `true` skips STARTTLS, for local SMTP sinks. |
| `REGISTER_RATE_LIMIT` | Raises the per-hour sign-up limit (tests). |
| `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` | Derived by `scripts/native/env.mjs` for native runs. |
