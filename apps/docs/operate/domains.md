# Domains and DNS

## One origin for the app

Everything the clients talk to lives on a single origin, for example `https://subspace.click`:

| Path | Goes to |
| :--- | :--- |
| `/` | The web app |
| `/api/...` | API service (and the file service for `/api/v1/vault` and `/api/v1/media`) |
| `/gateway` | Real-time WebSocket gateway |
| `/rtc` | LiveKit signaling |
| `/subspace-vault/...`, `/subspace-media/...` | Object storage (presigned and public files) |

The web edge container does this routing, so the host only proxies one address. A single origin is deliberate:

- **Passkeys** are bound to one relying-party domain.
- **No CORS:** browsers send no cross-origin credentials at all.
- **One TLS certificate** and one Content Security Policy cover everything.
- **Storage URLs** are signed for the exact host people use.

Older plans split the API, gateway, storage and LiveKit onto their own subdomains (`api.`, `gateway.`, `vault.`, `s3.`, `livekit.`). That is not needed and not supported; the paths above replace them.

## Records

| Name | Type | Points to | Purpose |
| :--- | :--- | :--- | :--- |
| `subspace.click` | A / AAAA | your server | The app |
| `app.subspace.click` | CNAME | `subspace.click` | Redirects to the main address |
| `docs.subspace.click` | CNAME | `subspace.click` | This documentation |
| `storage.subspace.click` | CNAME | `subspace.click` | MinIO console (staff only, IP-restricted) |

Voice and video media does not use a hostname. Browsers connect to the server's public IP on UDP 50000-50100 (TCP 7881 as a fallback), which LiveKit discovers by itself (`use_external_ip` in `docker/livekit.staging.yaml`).
