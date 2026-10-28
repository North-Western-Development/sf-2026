#!/usr/bin/env bash
# Start the instance over with no data (run as root on the server). Deletes every account,
# message and file: the database schema, Redis and both storage buckets. Keeps the roles,
# grants, configuration and certificates. Deploy afterwards: the release step migrates the
# empty database.
#   reset-data.sh --yes-delete-everything
set -euo pipefail
[ "${1:-}" = "--yes-delete-everything" ] || { echo "usage: reset-data.sh --yes-delete-everything"; exit 1; }

systemctl stop subspace-api subspace-gateway subspace-files subspace-badges || true

# Postgres: an empty public schema with the same owner and grants as 03-platform.sh sets up.
sudo -u postgres psql -v ON_ERROR_STOP=1 -qX -d subspace_frequency <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION subspace_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
ALTER DEFAULT PRIVILEGES FOR ROLE subspace_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
ALTER DEFAULT PRIVILEGES FOR ROLE subspace_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
SQL
echo "database emptied"

# Redis: no login may flush it (by design), so remove its saved data while it is stopped.
systemctl stop redis-server
rm -f /var/lib/redis/dump.rdb
rm -rf /var/lib/redis/appendonly*
systemctl start redis-server
echo "redis emptied"

# MinIO: empty both buckets, keep them and their policies.
set -a; . /etc/subspace/minio.env; set +a
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for b in subspace-vault subspace-media; do mc rm --recursive --force "local/$b" >/dev/null 2>&1 || true; done
echo "storage emptied"
