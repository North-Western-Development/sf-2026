#!/usr/bin/env bash
# Build and switch to a release (run as root on the server). The source tarball is built by
# deploy.sh on the operator's machine and uploaded to /opt/subspace/incoming/<id>.tar.gz.
#   release.sh <id>
# The build runs as subspace-build; the result is owned by root and read-only to the services.
# Migrations run with the owner role, then services restart. The previous release stays
# for rollback: ln -sfn /opt/subspace/releases/<old> /opt/subspace/current && restart.
set -euo pipefail
ID="$1"
SRC="/opt/subspace/incoming/$ID.tar.gz"
REL="/opt/subspace/releases/$ID"
[ -f "$SRC" ] || { echo "no $SRC"; exit 1; }

rm -rf "$REL"; install -d -o subspace-build -g subspace-build "$REL"
sudo -u subspace-build tar -xzf - -C "$REL" < "$SRC"
cd "$REL"
B() { sudo -u subspace-build env HOME=/var/lib/subspace-build CI=true "$@"; }
B pnpm install --frozen-lockfile --prod=false
B pnpm -r --filter './packages/**' build
for p in @subspace/api-service @subspace/gateway-service @subspace/file-service @subspace/badge-worker; do
  B pnpm --filter "$p" build
done
B pnpm --filter @subspace/web build
B pnpm --filter @subspace/docs build || echo "docs build failed; keeping the old docs"

# Schema: the generated SQL migrations in packages/database/drizzle, as the owner role (the
# builder runs them; only this step sees that password). A database built by schema push
# before migrations existed is pushed one last time (no --force: a change that would drop
# data stops for an operator) and adopted, then only ever migrated.
OWNER_URL=$(sed -n 's/^DATABASE_URL=//p' /etc/subspace/migrate.env)
M() { (cd packages/database && sudo -u subspace-build env HOME=/var/lib/subspace-build DATABASE_URL="$OWNER_URL" timeout 300 "$@" < /dev/null); }
if [ "$(M node scripts/migrate.mjs --status)" = "unadopted" ]; then
  out=$(M npx drizzle-kit push 2>&1) || true
  echo "$out" | tail -5
  if echo "$out" | grep -qiE "error|data loss|Are you sure"; then echo "schema push needs an operator; release not switched"; exit 2; fi
  M node scripts/migrate.mjs --adopt
fi
M node scripts/migrate.mjs || { echo "migrations failed; release not switched"; exit 2; }

# Lock it: root owns the release, services can only read it.
chown -R root:root "$REL"
chmod -R go-w "$REL"

ln -sfn "$REL" /opt/subspace/current
if [ -d apps/docs/.vitepress/dist ]; then rsync -a --delete apps/docs/.vitepress/dist/ /var/www/subspace-docs/; fi
# Each service makes snowflake IDs under its own worker number, so two can never collide.
i=1
for s in api gateway files badges; do
  install -d "/etc/systemd/system/subspace-$s.service.d"
  printf '[Service]\nEnvironment=SNOWFLAKE_WORKER_ID=%s\n' "$i" >"/etc/systemd/system/subspace-$s.service.d/snowflake.conf"
  i=$((i + 1))
done
# BLOCK_EU: one switch for the services people reach (api, gateway, files) in
# /etc/subspace/region.env, made once and then left to the operator. The address ranges are
# fetched now if there are none, then weekly by a timer.
[ -f /etc/subspace/region.env ] || printf '# true: refuse the EU, the EEA and the UK (addresses, emails, phone numbers)\nBLOCK_EU=true\n' >/etc/subspace/region.env
chmod 644 /etc/subspace/region.env
for s in api gateway files; do
  printf '[Service]\nEnvironmentFile=-/etc/subspace/region.env\n' >"/etc/systemd/system/subspace-$s.service.d/region.conf"
done
[ -s /etc/subspace/eu-ranges.csv ] || bash "$REL/deploy/server/eu-ranges.sh" || echo "eu-ranges: none yet; addresses are not checked"
cat >/etc/systemd/system/subspace-eu-ranges.service <<'UNIT'
[Unit]
Description=Subspace BLOCK_EU address ranges (DB-IP Lite)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/bash /opt/subspace/current/deploy/server/eu-ranges.sh
UNIT
cat >/etc/systemd/system/subspace-eu-ranges.timer <<'UNIT'
[Unit]
Description=Weekly Subspace BLOCK_EU address ranges

[Timer]
OnCalendar=weekly
RandomizedDelaySec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now subspace-eu-ranges.timer >/dev/null
# Privacy (GDPR): nginx never writes a full client address to its access log (IPv4's last octet
# zeroed, IPv6 cut to its /48), and keeps its logs, including the error log that names clients,
# for 7 days at most. Logs written before this are anonymized once.
cat >/etc/nginx/conf.d/subspace-privacy.conf <<'CONF'
map $remote_addr $subspace_anon_addr {
  "~^(?<net>\d+\.\d+\.\d+)\.\d+$" "$net.0";
  "~^(?<net>[0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):" "$net::";
  default "0.0.0.0";
}
log_format subspace_anon '$subspace_anon_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';
access_log /var/log/nginx/access.log subspace_anon;
CONF
sed -i -E 's|^(\s*)access_log\s+/var/log/nginx/access\.log;|\1# access_log /var/log/nginx/access.log; (see conf.d/subspace-privacy.conf)|' /etc/nginx/nginx.conf
if [ -f /etc/logrotate.d/nginx ]; then
  sed -i -E 's/^(\s*)(weekly|monthly)\b/\1daily/; s/^(\s*)rotate\s+[0-9]+/\1rotate 7/' /etc/logrotate.d/nginx
  grep -q 'maxage' /etc/logrotate.d/nginx || sed -i -E 's/^(\s*)rotate 7$/&\n\1maxage 7/' /etc/logrotate.d/nginx
fi
if [ ! -f /etc/subspace/.nginx-logs-anonymized ]; then
  ANON='s/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+ /\1.0 /; s/^([0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):[0-9a-fA-F:]* /\1:: /; s/(client: [0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.0/g; s/(client: [0-9a-fA-F]*:[0-9a-fA-F]*:[0-9a-fA-F]*):[0-9a-fA-F:]*/\1::/g'
  for f in /var/log/nginx/*.log*; do
    [ -f "$f" ] || continue
    case "$f" in
      *.gz) zcat "$f" | sed -E "$ANON" | gzip >"$f.anon" && cat "$f.anon" >"$f" && rm -f "$f.anon" ;;
      *) sed -i -E "$ANON" "$f" ;;
    esac
  done
  touch /etc/subspace/.nginx-logs-anonymized
fi
systemctl enable subspace-api subspace-gateway subspace-files subspace-badges >/dev/null
systemctl restart subspace-api subspace-gateway subspace-files subspace-badges
# The app's nginx routes and shared snippets (security headers, proxy settings) ship with each
# release; the previous ones come back if nginx refuses them.
install -d -m 755 /var/www/subspace-downloads
# (Carriage returns stripped: a file saved on Windows must not name a snippet "x.conf\r".)
NGINX_SNIPPETS="subspace-app.conf $(tr -d '\r' <"$REL/deploy/server/nginx/snippets.conf" | sed -n 's/^### //p')"
for s in $NGINX_SNIPPETS; do [ -f "/etc/nginx/snippets/$s" ] && cp "/etc/nginx/snippets/$s" "/etc/nginx/snippets/$s.prev"; done
awk -v dir=/etc/nginx/snippets '{sub(/\r$/, "")} /^### /{f=dir"/"$2; next} f{print > f}' "$REL/deploy/server/nginx/snippets.conf"
cp "$REL/deploy/server/nginx/subspace-app.conf" /etc/nginx/snippets/subspace-app.conf
nginx -t 2>/dev/null || {
  echo "nginx refused the new routes; keeping the previous ones"
  for s in $NGINX_SNIPPETS; do [ -f "/etc/nginx/snippets/$s.prev" ] && mv "/etc/nginx/snippets/$s.prev" "/etc/nginx/snippets/$s"; done
}
nginx -t && systemctl reload nginx

# Keep the three newest releases.
ls -1dt /opt/subspace/releases/*/ | tail -n +4 | xargs -r rm -rf
ls -1t /opt/subspace/incoming/*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
echo "release $ID is live"
