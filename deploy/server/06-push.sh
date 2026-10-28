#!/usr/bin/env bash
# Self-hosted push for the Android app: an ntfy server at push.<domain> that UnifiedPush apps on
# phones connect to (run as root, after 05-certs.sh, once DNS for push.<domain> points here).
#   bash 06-push.sh
# ntfy here only relays UnifiedPush messages: every topic is closed except the random "up..."
# topics UnifiedPush makes, nobody can sign up or sign in, there is no web app and no
# attachments. The API encrypts each push to the phone's own keys, so ntfy only ever holds
# ciphertext, kept 12 hours for phones that are offline.
# Also points the API at it (UNIFIEDPUSH_SERVER), and adds APNs settings if a key is in place:
# put the .p8 from Apple at /etc/subspace/apns.p8 and set APNS_KEY_ID and APNS_TEAM_ID first.
set -euo pipefail
DOMAIN="${DOMAIN:-subspace.click}"
PUSH="push.$DOMAIN"
API_ENV=/etc/subspace/api.env

# ---- DNS and certificate ------------------------------------------------------------------------
ip=$(getent ahostsv4 "$PUSH" | awk 'NR==1{print $1}')
self=$(curl -fsS -4 https://api.ipify.org)
[ "$ip" = "$self" ] || { echo "$PUSH does not point here yet ($ip)"; exit 1; }
CERT=/etc/letsencrypt/live/$DOMAIN/cert.pem
if ! openssl x509 -in "$CERT" -noout -ext subjectAltName | grep -q "DNS:$PUSH"; then
  # Add the name to the instance's certificate (same Let's Encrypt account as 05-certs.sh).
  names=$(openssl x509 -in "$CERT" -noout -ext subjectAltName | grep -o 'DNS:[^,]*' | sed 's/DNS://' | sed 's/^/-d /' | tr '\n' ' ')
  certbot certonly --webroot -w /var/www/certbot --cert-name "$DOMAIN" $names -d "$PUSH" --expand --non-interactive \
    --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/subspace.sh
fi

# ---- ntfy ---------------------------------------------------------------------------------------
if ! command -v ntfy >/dev/null; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL -o /etc/apt/keyrings/ntfy.gpg https://archive.ntfy.sh/apt/keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/ntfy.gpg] https://archive.ntfy.sh/apt stable main" >/etc/apt/sources.list.d/ntfy.list
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -yq ntfy
fi
install -d -o ntfy -g ntfy -m 750 /var/lib/ntfy /var/cache/ntfy
cat >/etc/ntfy/server.yml <<EOF
base-url: "https://$PUSH"
listen-http: "127.0.0.1:2586"
behind-proxy: true
cache-file: "/var/cache/ntfy/cache.db"
cache-duration: "12h"
auth-file: "/var/lib/ntfy/user.db"
auth-default-access: "deny-all"
enable-signup: false
enable-login: false
enable-reservations: false
web-root: "disable"
# The API sends every push from this server's address: it must never be rate limited.
visitor-request-limit-exempt-hosts: "127.0.0.1,$self"
log-level: "warn"
EOF
systemctl enable ntfy >/dev/null
systemctl restart ntfy
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:2586/v1/health >/dev/null 2>&1 && break; sleep 0.5; done
# UnifiedPush topics only (their names are random and secret).
ntfy access everyone 'up*' read-write >/dev/null

# ---- nginx --------------------------------------------------------------------------------------
cat >/etc/nginx/sites-available/subspace-push.conf <<EOF
# ntfy for UnifiedPush (deploy/server/06-push.sh). Phones hold long-lived connections here.
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name $PUSH;
  server_tokens off;
  ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  client_max_body_size 16k;

  location / {
    proxy_pass http://127.0.0.1:2586;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_redirect off;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$subspace_connection_upgrade;
    proxy_connect_timeout 3m;
    proxy_send_timeout 3m;
    proxy_read_timeout 3m;
  }
}
EOF
ln -sf /etc/nginx/sites-available/subspace-push.conf /etc/nginx/sites-enabled/subspace-push.conf
nginx -t && systemctl reload nginx

# ---- the API ------------------------------------------------------------------------------------
setenv() { # name value: set or replace a line in the API's environment
  if grep -q "^$1=" "$API_ENV"; then sed -i "s|^$1=.*|$1=$2|" "$API_ENV"; else echo "$1=$2" >>"$API_ENV"; fi
}
setenv UNIFIEDPUSH_SERVER "https://$PUSH"
if [ -f /etc/subspace/apns.p8 ]; then
  chown root:subspace-api /etc/subspace/apns.p8
  chmod 640 /etc/subspace/apns.p8
  setenv APNS_KEY_FILE /etc/subspace/apns.p8
  echo "APNs key found: set APNS_KEY_ID and APNS_TEAM_ID in $API_ENV if they are not there yet"
fi
systemctl restart subspace-api
echo "push ready: https://$PUSH"
