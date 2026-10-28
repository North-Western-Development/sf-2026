#!/usr/bin/env bash
# Certificates from Let's Encrypt, once DNS for every name points at this server (run as root).
#   CERT_EMAIL=you@example.com bash 05-certs.sh
# Running it accepts the Let's Encrypt Subscriber Agreement for that address.
# Renewal is automatic (certbot.timer); the deploy hook reloads nginx and hands LiveKit a copy
# for TURN over TLS.
set -euo pipefail
DOMAIN="${DOMAIN:-subspace.click}"
: "${CERT_EMAIL:?set CERT_EMAIL}"

for name in "$DOMAIN" "www.$DOMAIN" "docs.$DOMAIN" "storage.$DOMAIN" "turn.$DOMAIN" "push.$DOMAIN"; do
  ip=$(getent ahostsv4 "$name" | awk 'NR==1{print $1}')
  [ "$ip" = "$(curl -fsS -4 https://api.ipify.org)" ] || { echo "$name does not point here yet ($ip)"; exit 1; }
done

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/subspace.sh <<EOF
#!/bin/sh
# Copy the certificate for LiveKit's TURN/TLS listener, then reload what uses it.
install -m 640 -o root -g livekit /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/livekit/certs/fullchain.pem
install -m 640 -o root -g livekit /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/livekit/certs/privkey.pem
sed -i 's/^  enabled: false/  enabled: true/' /etc/livekit/livekit.yaml
ln -sf /etc/nginx/sites-available/subspace-tls.conf /etc/nginx/sites-enabled/subspace-tls.conf
nginx -t && systemctl reload nginx
systemctl restart subspace-livekit
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/subspace.sh

certbot certonly --webroot -w /var/www/certbot --cert-name "$DOMAIN" \
  -d "$DOMAIN" -d "www.$DOMAIN" -d "docs.$DOMAIN" -d "storage.$DOMAIN" -d "turn.$DOMAIN" -d "push.$DOMAIN" \
  --email "$CERT_EMAIL" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/subspace.sh
systemctl enable --now certbot.timer
echo "certificates installed"
