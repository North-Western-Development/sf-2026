#!/usr/bin/env bash
# Platform for Subspace Frequency on one Debian 13 host (run as root; safe to re-run).
#
# Every service runs as its own system user with no shell and no write access to the code:
#   subspace-api, subspace-gateway, subspace-files, subspace-badges   Node services (127.0.0.1 only)
#   minio                                                              object storage (127.0.0.1)
#   livekit                                                            voice and video
#   subspace-build                                                     builds releases, runs nothing
# Postgres and Redis give each service its own login with only what it needs. Secrets live in
# /etc/subspace/<service>.env, readable by root and that service alone.
set -euo pipefail

DOMAIN="${DOMAIN:-subspace.click}"
NODE_MAJOR=22
PNPM_VERSION=10.30.2
LIVEKIT_VERSION=1.13.7

export DEBIAN_FRONTEND=noninteractive

# ---- Packages -----------------------------------------------------------------------------
apt-get install -y -q gnupg >/dev/null
if ! command -v node >/dev/null || ! node -v | grep -q "^v${NODE_MAJOR}\."; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
apt-get install -y -q golang-go openssl acl >/dev/null
corepack enable >/dev/null 2>&1 || npm install -g "pnpm@${PNPM_VERSION}" >/dev/null
corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null 2>&1 || true

# ---- Users and directories ------------------------------------------------------------------
for u in subspace-api subspace-gateway subspace-files subspace-badges subspace-build minio livekit; do
  id "$u" >/dev/null 2>&1 || useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$u"
done
# The builder needs a home for the pnpm store and caches.
usermod --home /var/lib/subspace-build subspace-build
install -d -m 750 -o subspace-build -g subspace-build /var/lib/subspace-build
install -d -m 755 -o root -g root /opt/subspace /opt/subspace/releases
install -d -m 755 -o root -g root /etc/subspace
install -d -m 750 -o minio -g minio /var/lib/minio
install -d -m 750 -o livekit -g livekit /etc/livekit /etc/livekit/certs
install -d -m 755 -o root -g root /var/www/certbot /var/www/subspace-docs

# ---- MinIO and LiveKit binaries ----------------------------------------------------------------
# Built as subspace-build, from a directory it can enter (Go cannot run its compiler otherwise).
cd /var/lib/subspace-build
if [ ! -x /usr/local/bin/minio ]; then
  # MinIO no longer publishes community binaries: build it (Go fetches a newer toolchain if needed).
  sudo -u subspace-build env HOME=/var/lib/subspace-build GOTOOLCHAIN=auto GOPATH=/var/lib/subspace-build/go go install github.com/minio/minio@latest
  install -m 755 /var/lib/subspace-build/go/bin/minio /usr/local/bin/minio
fi
if [ ! -x /usr/local/bin/mc ]; then
  sudo -u subspace-build env HOME=/var/lib/subspace-build GOTOOLCHAIN=auto GOPATH=/var/lib/subspace-build/go go install github.com/minio/mc@latest
  install -m 755 /var/lib/subspace-build/go/bin/mc /usr/local/bin/mc
fi
if [ ! -x /usr/local/bin/livekit-server ] || ! /usr/local/bin/livekit-server --version 2>/dev/null | grep -q "$LIVEKIT_VERSION"; then
  tmp=$(mktemp -d)
  base="https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}"
  curl -fsSL -o "$tmp/lk.tgz" "$base/livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz"
  curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
  (cd "$tmp" && grep "livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz" checksums.txt | sed 's/livekit_.*$/lk.tgz/' | sha256sum -c -)
  tar -xzf "$tmp/lk.tgz" -C "$tmp" livekit-server
  install -m 755 "$tmp/livekit-server" /usr/local/bin/livekit-server
  rm -rf "$tmp"
fi

# ---- Secrets (generated once) ---------------------------------------------------------------
gen() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48; }
SECRETS=/etc/subspace/.generated
if [ ! -f "$SECRETS" ]; then
  umask 077
  cat > "$SECRETS" <<EOF
PG_OWNER_PASSWORD=$(gen)
PG_API_PASSWORD=$(gen)
PG_GATEWAY_PASSWORD=$(gen)
PG_FILES_PASSWORD=$(gen)
PG_BADGES_PASSWORD=$(gen)
REDIS_API_PASSWORD=$(gen)
REDIS_GATEWAY_PASSWORD=$(gen)
REDIS_FILES_PASSWORD=$(gen)
REDIS_BADGES_PASSWORD=$(gen)
MINIO_ROOT_USER=root-$(openssl rand -hex 6)
MINIO_ROOT_PASSWORD=$(gen)
MINIO_APP_USER=files-$(openssl rand -hex 6)
MINIO_APP_PASSWORD=$(gen)
JWT_SECRET=$(openssl rand -hex 64)
MEDIA_PROXY_SECRET=$(openssl rand -hex 32)
DRIVE_TOKEN_KEY=$(openssl rand -hex 32)
LIVEKIT_API_KEY=API$(openssl rand -hex 8)
LIVEKIT_API_SECRET=$(gen)
EOF
  chmod 600 "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

# ---- Postgres: an owner for schema changes, and one DML-only login per service ------------------
systemctl enable --now postgresql >/dev/null
psql_root() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAX "$@"; }
role() {
  if [ "$(psql_root -c "SELECT 1 FROM pg_roles WHERE rolname='$1'")" = "1" ]; then
    psql_root -c "ALTER ROLE $1 WITH LOGIN PASSWORD '$2'"
  else
    psql_root -c "CREATE ROLE $1 WITH LOGIN PASSWORD '$2'"
  fi
}
role subspace_owner "$PG_OWNER_PASSWORD"
role subspace_api "$PG_API_PASSWORD"
role subspace_gateway "$PG_GATEWAY_PASSWORD"
role subspace_files "$PG_FILES_PASSWORD"
role subspace_badges "$PG_BADGES_PASSWORD"
[ "$(psql_root -c "SELECT 1 FROM pg_database WHERE datname='subspace_frequency'")" = "1" ] || psql_root -c "CREATE DATABASE subspace_frequency OWNER subspace_owner"
psql_root -d subspace_frequency <<'SQL'
REVOKE ALL ON DATABASE subspace_frequency FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE subspace_frequency TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
GRANT USAGE ON SCHEMA public TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
ALTER DEFAULT PRIVILEGES FOR ROLE subspace_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
ALTER DEFAULT PRIVILEGES FOR ROLE subspace_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO subspace_api, subspace_gateway, subspace_files, subspace_badges;
SQL
psql_root -c "ALTER SCHEMA public OWNER TO subspace_owner" -d subspace_frequency
# Local TCP only, with passwords (scram); the postgres superuser keeps peer auth on the socket.
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /etc/postgresql/*/main/postgresql.conf
systemctl restart postgresql

# ---- Redis: no default user; one ACL login per service ------------------------------------------
cat > /etc/redis/users.acl <<EOF
user default off
user api on >${REDIS_API_PASSWORD} ~* &* +@all -@admin -@dangerous +info
user gateway on >${REDIS_GATEWAY_PASSWORD} ~* &* +@all -@admin -@dangerous +info
user files on >${REDIS_FILES_PASSWORD} ~* &* +@all -@admin -@dangerous +info
user badges on >${REDIS_BADGES_PASSWORD} ~* &* +@all -@admin -@dangerous +info
EOF
chown redis:redis /etc/redis/users.acl; chmod 640 /etc/redis/users.acl
sed -i 's/^#\? *aclfile .*/aclfile \/etc\/redis\/users.acl/' /etc/redis/redis.conf
grep -q '^aclfile' /etc/redis/redis.conf || echo 'aclfile /etc/redis/users.acl' >> /etc/redis/redis.conf
sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
sed -i 's/^#\? *rename-command CONFIG.*//' /etc/redis/redis.conf
systemctl enable redis-server >/dev/null; systemctl restart redis-server

# ---- MinIO ------------------------------------------------------------------------------------
cat > /etc/subspace/minio.env <<EOF
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_BROWSER_REDIRECT_URL=https://storage.${DOMAIN}
EOF
chown root:minio /etc/subspace/minio.env; chmod 640 /etc/subspace/minio.env

# ---- LiveKit ------------------------------------------------------------------------------------
cat > /etc/livekit/livekit.yaml <<EOF
# Signaling on 127.0.0.1:7880 behind nginx (/rtc). Media: UDP 7882 (one port for everyone),
# ICE over TCP 7881, and TURN for restrictive networks (UDP 3478, TLS 5349 on turn.${DOMAIN}).
port: 7880
bind_addresses:
  - "127.0.0.1"
rtc:
  udp_port: 7882
  tcp_port: 7881
  use_external_ip: true
turn:
  enabled: true
  domain: turn.${DOMAIN}
  udp_port: 3478
  tls_port: 5349
  cert_file: /etc/livekit/certs/fullchain.pem
  key_file: /etc/livekit/certs/privkey.pem
  relay_range_start: 30000
  relay_range_end: 40000
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
logging:
  json: true
  level: info
EOF
chown root:livekit /etc/livekit/livekit.yaml; chmod 640 /etc/livekit/livekit.yaml

# ---- Service environments (only what each one needs) --------------------------------------------
common="NODE_ENV=production
PUBLIC_ORIGIN=https://${DOMAIN}
TRUST_PROXY=loopback"
write_env() { # file owner-group content
  printf '%s\n' "$3" > "/etc/subspace/$1"; chown "root:$2" "/etc/subspace/$1"; chmod 640 "/etc/subspace/$1"
}
write_env api.env subspace-api "$common
API_HOST=127.0.0.1
API_PORT=3001
DATABASE_URL=postgresql://subspace_api:${PG_API_PASSWORD}@127.0.0.1:5432/subspace_frequency
REDIS_URL=redis://api:${REDIS_API_PASSWORD}@127.0.0.1:6379/0
JWT_SECRET=${JWT_SECRET}
MEDIA_PROXY_SECRET=${MEDIA_PROXY_SECRET}
DRIVE_TOKEN_KEY=${DRIVE_TOKEN_KEY}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_INTERNAL_URL=http://127.0.0.1:7880
LIVEKIT_FORCE_RELAY=true
MINIO_ROOT_USER=${MINIO_APP_USER}
MINIO_ROOT_PASSWORD=${MINIO_APP_PASSWORD}
RP_ID=${DOMAIN}
WEBAUTHN_ORIGINS=https://${DOMAIN}
EMAIL_LINK_BASE=https://${DOMAIN}
CONNECTIONS_REDIRECT_BASE=https://${DOMAIN}
DRIVE_REDIRECT_BASE=https://${DOMAIN}
DEFAULT_STORAGE_QUOTA_MB=500
DEFAULT_MAX_UPLOAD_MB=50"
write_env gateway.env subspace-gateway "$common
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=3002
DATABASE_URL=postgresql://subspace_gateway:${PG_GATEWAY_PASSWORD}@127.0.0.1:5432/subspace_frequency
REDIS_URL=redis://gateway:${REDIS_GATEWAY_PASSWORD}@127.0.0.1:6379/0
JWT_SECRET=${JWT_SECRET}"
write_env files.env subspace-files "$common
FILE_HOST=127.0.0.1
FILE_PORT=3003
DATABASE_URL=postgresql://subspace_files:${PG_FILES_PASSWORD}@127.0.0.1:5432/subspace_frequency
REDIS_URL=redis://files:${REDIS_FILES_PASSWORD}@127.0.0.1:6379/0
JWT_SECRET=${JWT_SECRET}
MINIO_ROOT_USER=${MINIO_APP_USER}
MINIO_ROOT_PASSWORD=${MINIO_APP_PASSWORD}
S3_ENDPOINT=127.0.0.1:9000
S3_PUBLIC_ENDPOINT=https://${DOMAIN}
DRIVE_TOKEN_KEY=${DRIVE_TOKEN_KEY}
DRIVE_REDIRECT_BASE=https://${DOMAIN}
DEFAULT_STORAGE_QUOTA_MB=500
DEFAULT_MAX_UPLOAD_MB=50"
write_env badges.env subspace-badges "$common
DATABASE_URL=postgresql://subspace_badges:${PG_BADGES_PASSWORD}@127.0.0.1:5432/subspace_frequency
REDIS_URL=redis://badges:${REDIS_BADGES_PASSWORD}@127.0.0.1:6379/0"
# Schema changes only: read by root during a deploy, never by a running service.
write_env migrate.env root "DATABASE_URL=postgresql://subspace_owner:${PG_OWNER_PASSWORD}@127.0.0.1:5432/subspace_frequency"
chmod 600 /etc/subspace/migrate.env

echo "platform ready"
