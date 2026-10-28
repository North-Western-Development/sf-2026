#!/usr/bin/env bash
# Ship the working tree to the server and make it the live release (run on the operator's machine).
#   SSH_KEY=~/.ssh/subspace_deploy HOST=deploy@74.208.95.245 deploy/server/deploy.sh
# Sends tracked and new (not ignored) files: never .env, node_modules or build output.
set -euo pipefail
HOST="${HOST:-deploy@74.208.95.245}"
KEY="${SSH_KEY:-$HOME/.ssh/subspace_deploy}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ID="$(date -u +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"
TAR="$(mktemp -d)/$ID.tar.gz"

cd "$ROOT"
git ls-files -z --cached --others --exclude-standard | grep -zv '^\.claude/' | tar --null -T - -czf "$TAR"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "sudo install -d -m 750 -o root -g root /opt/subspace/incoming"
scp -q -i "$KEY" -o BatchMode=yes "$TAR" "$HOST:/tmp/$ID.tar.gz"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "sudo mv /tmp/$ID.tar.gz /opt/subspace/incoming/ && sudo bash -c 'cd /tmp && tar -xzf /opt/subspace/incoming/$ID.tar.gz -O deploy/server/release.sh > /root/release.sh' && sudo bash /root/release.sh $ID"
rm -f "$TAR"
