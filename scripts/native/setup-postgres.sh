#!/usr/bin/env bash
# One-time Postgres setup for running Subspace without Docker (WSL / Linux).
# Creates the app role + database and a separate test database, using values from .env.
# Usage (from the repo root):  wsl -d Ubuntu -- bash scripts/native/setup-postgres.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy .env.example and fill it in)"; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
PGUSER_APP="$(get POSTGRES_USER)"; PGUSER_APP="${PGUSER_APP:-subspace}"
PGPASS_APP="$(get POSTGRES_PASSWORD)"
PGDB_APP="$(get POSTGRES_DB)"; PGDB_APP="${PGDB_APP:-subspace_frequency}"
PGDB_TEST="${PGDB_APP}_test"
[ -n "$PGPASS_APP" ] || { echo "POSTGRES_PASSWORD is empty in .env"; exit 1; }

# Identifiers are validated so they can be interpolated safely.
for v in "$PGUSER_APP" "$PGDB_APP" "$PGDB_TEST"; do
  [[ "$v" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Invalid identifier: $v"; exit 1; }
done

sudo -u postgres psql -v ON_ERROR_STOP=1 -v pass="$PGPASS_APP" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PGUSER_APP') THEN
    CREATE ROLE $PGUSER_APP LOGIN;
  END IF;
END \$\$;
ALTER ROLE $PGUSER_APP WITH LOGIN PASSWORD :'pass' CREATEDB;
SELECT 'CREATE DATABASE $PGDB_APP OWNER $PGUSER_APP'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$PGDB_APP') \gexec
SELECT 'CREATE DATABASE $PGDB_TEST OWNER $PGUSER_APP'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$PGDB_TEST') \gexec
SQL

echo "Postgres ready: role '$PGUSER_APP', databases '$PGDB_APP' and '$PGDB_TEST' on localhost:5432"
