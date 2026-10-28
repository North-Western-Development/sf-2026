#!/usr/bin/env bash
# Publish the SDKs to the self-hosted package registry at https://<domain>/packages (run on the
# operator's machine). Collects every SDK (scripts/registry/collect.mjs), uploads what is new, and
# rebuilds the indexes on the server (registry-index.mjs). A version already published is never
# replaced: bump the version to publish a change.
#   deploy/server/publish-packages.sh
set -euo pipefail
HOST="${HOST:-deploy@74.208.95.245}"
KEY="${SSH_KEY:-$HOME/.ssh/subspace_deploy}"
DOMAIN="${DOMAIN:-subspace.click}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Git Bash on Windows: node needs the Windows form of the temporary path.
node "$ROOT/scripts/registry/collect.mjs" "$(cygpath -w "$STAGE/packages" 2>/dev/null || echo "$STAGE/packages")"
tar -C "$STAGE" -czf "$STAGE/packages.tar.gz" packages
scp -q -i "$KEY" -o BatchMode=yes "$STAGE/packages.tar.gz" "$ROOT/deploy/server/registry-index.mjs" "$HOST:/tmp/"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "set -e
  sudo install -d -m 755 /var/www/packages
  # --skip-old-files: what is already published stays exactly as it was.
  sudo tar -C /var/www --skip-old-files --no-same-owner -xzf /tmp/packages.tar.gz
  sudo chmod -R a+rX /var/www/packages
  sudo node /tmp/registry-index.mjs /var/www/packages https://$DOMAIN/packages
  rm -f /tmp/packages.tar.gz /tmp/registry-index.mjs"
echo "published: https://$DOMAIN/packages/"
