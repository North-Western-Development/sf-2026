# Run it locally

The services are plain Node processes, so no Docker is needed for development. Only the infrastructure has to come from somewhere; on Windows the simplest source is WSL (Ubuntu), whose `localhost` ports are reachable from Windows.

## Requirements

| Dependency | Needed for | Default address |
| :--- | :--- | :--- |
| Node.js 22 and pnpm 10 | everything | |
| PostgreSQL 16+ | everything | `127.0.0.1:5432` |
| Redis 7+ | everything | `127.0.0.1:6379` |
| MinIO (or any S3) | file uploads | `127.0.0.1:9000` |
| LiveKit server | voice and video | `127.0.0.1:7880` |

## One-time setup

```bash
git clone <your fork> subspace-frequency && cd subspace-frequency
pnpm install
cp .env.example .env    # fill in every value marked REQUIRED
```

Install Postgres and Redis (WSL example), then create the role and databases named in `.env`:

```bash
wsl -d Ubuntu -- sudo apt-get install -y postgresql redis-server
wsl -d Ubuntu -- bash scripts/native/setup-postgres.sh
```

MinIO and LiveKit are optional. `scripts/native/infra.mjs` starts them when it finds them (`MINIO_BIN`, `LIVEKIT_BIN`, or `~/.local/subspace/livekit-server` inside WSL).

## Everyday use

```bash
pnpm dev:native     # builds shared packages, applies migrations, starts every service and the web app
```

### Changing the schema

The schema lives in `packages/database/src/schema*.ts`, and every change ships as a SQL migration:

```bash
pnpm --filter @subspace/database db:generate   # writes packages/database/drizzle/NNNN_*.sql
```

Review the SQL and commit it with the schema change. `pnpm dev:native`, `pnpm test:native` and the server's release step apply pending migrations. `pnpm test:native` fails if the schema changed without a migration, and generates the missing one for you to review.

Open http://localhost:5173. Vite proxies `/api`, `/gateway`, `/rtc` and storage to the local services exactly like the production edge does, so the app runs on one origin in development too.

::: tip Email in development
Without `SMTP_HOST`, verification emails are not sent; they are logged by the API and kept in the Redis list `dev:outbox`.
:::

## Tests

See [Testing](/reference/testing) for every suite. The two you will run most:

```bash
pnpm test:native    # backend unit and end-to-end tests against the *_test database
pnpm test:ui        # browser tests on an isolated copy of the app (port 4173)
```
