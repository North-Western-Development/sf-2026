# Running Subspace without Docker

The services are plain Node processes; only the infrastructure has to come from somewhere.
On Windows the simplest source is WSL (Ubuntu), whose `localhost` ports are reachable from Windows.

| Dependency | Required | Default address |
| --- | --- | --- |
| PostgreSQL 16+ | yes | `127.0.0.1:5432` |
| Redis 7+ | yes | `127.0.0.1:6379` |
| MinIO (or any S3) | for Subspace Vault uploads | `127.0.0.1:9000` |
| LiveKit server | for Comm-Link voice/video | `127.0.0.1:7880` |

## One-time setup

1. `cp .env.example .env` and fill in every value marked REQUIRED.
2. Install Postgres and Redis (WSL example):
   ```bash
   wsl -d Ubuntu -- sudo apt-get install -y postgresql redis-server
   ```
3. Create the role and the app/test databases from `.env`:
   ```bash
   wsl -d Ubuntu -- bash scripts/native/setup-postgres.sh
   ```

## Everyday use

```bash
pnpm dev:native     # builds shared packages, syncs the schema, starts every service + web
pnpm test:native    # unit + e2e suites against the POSTGRES_DB_test database
```

The web client is served at http://localhost:5173; Vite proxies `/api`, `/gateway`,
`/api/v1/vault`, `/rtc` and `/subspace-vault` to the local services exactly like the
Docker nginx edge does.

URLs derived from `.env` (override any of them by setting it explicitly) are listed at the
bottom of `.env.example`; see `scripts/native/env.mjs`.
