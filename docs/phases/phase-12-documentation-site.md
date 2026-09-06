# Phase 12: Production Documentation Site & Setup Guide

## 1. Overview & Objective
Phase 12 delivers an authoritative, searchable, modern documentation site and comprehensive setup guide for Subspace Frequency. It provides turnkey instructions for server operators to deploy the stack, configure host NGINX reverse proxies (including systems with pre-existing port 80/443 configurations), manage SSL certificates, configure SMTP, customize instance rules, and maintain Docker container backups.

A mandatory deliverable of Phase 12 is the **Clean Slate Live Verification**:
1. Completely wiping the live test deployment created during Phase 11.
2. Re-deploying and re-configuring the entire stack from scratch solely following the newly generated Phase 12 documentation to guarantee that documentation is 100% accurate, foolproof, and reproducible.

---

## 2. Dedicated Domain & Subdomain Mapping (`subspace.click`)

For the live test site on `subspace.click`, the following domain routing topology is required:

| Service / Component | Subdomain / Target Domain | Internal Port | Description / Routing Target |
| :--- | :--- | :--- | :--- |
| **Web Client SPA** | `subspace.click` / `app.subspace.click` | `3000` | Web application front-end |
| **HTTP REST API** | `api.subspace.click` | `3001` | Fastify REST API (Auth, Beacons, Relays) |
| **WebSocket Gateway** | `gateway.subspace.click` | `3002` | WebSocket connection for real-time presence, chat & events |
| **Subspace Vault (File API)** | `vault.subspace.click` | `3003` | S3 Presigned URL manager & Drive metadata |
| **MinIO Direct S3 Storage** | `s3.subspace.click` | `9000` | MinIO S3 upload & public direct asset downloads |
| **MinIO Storage Console** | `storage.subspace.click` | `9001` | MinIO web management console (admin staff only) |
| **LiveKit SFU Signaling** | `livekit.subspace.click` | `7880` | LiveKit WebRTC signaling / room handshake |
| **Documentation Site** | `docs.subspace.click` | `4000` | Static search-indexed documentation site |

> [!NOTE]
> All subdomains terminate SSL on the host NGINX reverse proxy (port 443) and proxy over `127.0.0.1` to their respective container ports. No container publishes ports directly to `0.0.0.0`.

---

## 3. Detailed Component Specifications

### 3.1 Documentation Site Engine (`apps/docs`)
- Built with a modern, static-first, dark-themed documentation framework (Astro Starlight or VitePress).
- Features full-text client-side search (Pagefind), code copy buttons, interactive callouts, responsive mobile layout, and dark sci-fi branding.

### 3.2 Host NGINX Reverse Proxy Configuration Guide
- Modular NGINX configuration snippets for all `subspace.click` subdomains.
- WebSocket proxying with `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`.
- SSL termination recipes using Certbot with Let's Encrypt wildcard certificates (`*.subspace.click` + `subspace.click`).
- File upload tuning: `client_max_body_size 100M;` for large attachment handling.

### 3.3 Operator & Administrator Guides
- **Installation**: Step-by-step Docker Compose deployment (`.env` configuration, secret generation, initial instance admin creation).
- **Security & Directives**: Setting up the instance rules modal, SMTP email verification, and rate limiting.
- **Commendation Engine**: Setting up custom badge rules in the Command Console.
- **Backup & Disaster Recovery**: PostgreSQL database snapshots (`pg_dump`), Redis RDB state, and MinIO volume replication.

### 3.4 Wipe & Re-Setup Verification Procedure
1. Execute full teardown of the live staging environment (`docker compose down -v`, database drop, volume prune).
2. Follow `docs/guides/deployment.md` step-by-step as an external operator.
3. Verify all 8 subdomains resolve with SSL and services function normally.

---

## 4. Deliverables Matrix

| Deliverable | Description | File Path |
| :--- | :--- | :--- |
| **Documentation Site**| Searchable static documentation site | `apps/docs` |
| **NGINX Proxy Templates**| Modular reverse proxy configurations for `subspace.click` | `deploy/nginx/subspace.conf` |
| **Domain Setup Guide** | Dedicated subdomain routing & DNS mapping guide | `docs/guides/domains.md` |
| **Deployment Guide**  | Complete step-by-step administrator guide | `docs/guides/deployment.md` |
| **Reverse Proxy Guide**| Integrating with existing host web servers | `docs/guides/reverse-proxy.md` |
| **Operator Manual**   | Command Console & moderation handbook | `docs/guides/operator-manual.md` |
| **Clean Slate Report**| Validation report from the post-wipe rebuild | `docs/testing/clean-slate-rebuild.md` |

---

## 5. Verification & Acceptance Criteria

### Automated Verification
1. **Documentation Build Test**:
   ```bash
   pnpm --filter @subspace/docs build
   ```
   Docs site compiles to static HTML with zero broken internal links or markdown syntax errors.
2. **NGINX Configuration Syntax Check**:
   ```bash
   nginx -t -c deploy/nginx/subspace.conf
   ```
   Validates NGINX template structure against standard syntax parser.

### Manual Acceptance Verification
- Execute live wipe and fresh setup strictly from documentation; verify all 8 subdomains on `subspace.click` are reachable over HTTPS and functional.
