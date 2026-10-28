#!/usr/bin/env bash
# systemd units and nginx for Subspace (run as root after 03-platform.sh; safe to re-run).
# Run from the directory holding this script (deploy/server in a release).
set -euo pipefail
DOMAIN="${DOMAIN:-subspace.click}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Sandboxing shared by every service: no privileges, read-only system, no home directories,
# no devices, loopback-and-internet sockets only.
HARDEN='NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077'

node_unit() { # name user dir description
  cat > "/etc/systemd/system/subspace-$1.service" <<EOF
[Unit]
Description=Subspace Frequency $4
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target

[Service]
User=$2
Group=$2
EnvironmentFile=/etc/subspace/$1.env
WorkingDirectory=/opt/subspace/current/apps/$3
ExecStart=/usr/bin/node --enable-source-maps dist/index.js
Restart=on-failure
RestartSec=3
$HARDEN

[Install]
WantedBy=multi-user.target
EOF
}
node_unit api subspace-api api-service "API"
node_unit gateway subspace-gateway gateway-service "real-time gateway"
node_unit files subspace-files file-service "file service"
node_unit badges subspace-badges badge-worker "badge worker"

cat > /etc/systemd/system/subspace-minio.service <<EOF
[Unit]
Description=MinIO object storage for Subspace
After=network-online.target
Wants=network-online.target

[Service]
User=minio
Group=minio
EnvironmentFile=/etc/subspace/minio.env
ExecStart=/usr/local/bin/minio server /var/lib/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
ReadWritePaths=/var/lib/minio
Restart=on-failure
LimitNOFILE=65536
$HARDEN

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/subspace-livekit.service <<EOF
[Unit]
Description=LiveKit media server for Subspace
After=network-online.target
Wants=network-online.target

[Service]
User=livekit
Group=livekit
ExecStart=/usr/local/bin/livekit-server --config /etc/livekit/livekit.yaml
Restart=on-failure
LimitNOFILE=65536
# Every port it binds is above 1024, so it needs no capabilities.
$HARDEN

[Install]
WantedBy=multi-user.target
EOF
# LiveKit only starts TURN/TLS once its certificate exists; until then run without TURN.
if [ ! -s /etc/livekit/certs/fullchain.pem ]; then
  sed -i 's/^  enabled: true/  enabled: false/' /etc/livekit/livekit.yaml
fi

# ---- nginx --------------------------------------------------------------------------------------
split() { # file -> /etc/nginx/<dir>/<name> for each "### name" section
  awk -v dir="$2" '/^### /{f=dir"/"$2; next} f{print > f}' "$1"
}
install -d /etc/nginx/snippets
split "$HERE/nginx/snippets.conf" /etc/nginx/snippets
cp "$HERE/nginx/subspace-app.conf" /etc/nginx/snippets/subspace-app.conf
tmp=$(mktemp -d); split "$HERE/nginx/sites.conf" "$tmp"
cp "$tmp/subspace-base.conf" /etc/nginx/sites-available/subspace-base.conf
sed "s/__DOMAIN__/$DOMAIN/g" "$tmp/subspace-tls.conf" > /etc/nginx/sites-available/subspace-tls.conf
rm -rf "$tmp"
[ -f /etc/nginx/subspace-staff-ips.conf ] || echo '# allow 203.0.113.10;' > /etc/nginx/subspace-staff-ips.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/subspace-base.conf /etc/nginx/sites-enabled/subspace-base.conf
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  ln -sf /etc/nginx/sites-available/subspace-tls.conf /etc/nginx/sites-enabled/subspace-tls.conf
fi
sed -i 's/^\(\s*\)# *server_tokens off;/\1server_tokens off;/' /etc/nginx/nginx.conf
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx || systemctl restart nginx

systemctl daemon-reload
systemctl enable subspace-minio subspace-livekit >/dev/null
systemctl restart subspace-minio subspace-livekit

# The file service gets its own MinIO login, limited to the two Subspace buckets.
. /etc/subspace/.generated
export MC_CONFIG_DIR=/root/.mc
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && break; sleep 1; done
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing local/subspace-vault local/subspace-media >/dev/null
cat > /root/.mc/subspace-files-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::subspace-vault", "arn:aws:s3:::subspace-vault/*", "arn:aws:s3:::subspace-media", "arn:aws:s3:::subspace-media/*"]
    }
  ]
}
JSON
mc admin policy create local subspace-files /root/.mc/subspace-files-policy.json >/dev/null
mc admin user add local "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" >/dev/null
mc admin policy attach local subspace-files --user "$MINIO_APP_USER" >/dev/null 2>&1 || true
echo "services installed"
