#!/usr/bin/env bash
# Publish a desktop build (run on the operator's machine): the Windows installer, a stable
# "latest" copy for download links, and latest.json, which installed apps check for updates.
#
# Build first, signed with the updater key (its public half is in apps/desktop/src-tauri/tauri.conf.json):
#   TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.subspace/desktop-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
#     pnpm --filter @subspace/desktop exec tauri build --bundles nsis
#   deploy/server/publish-desktop.sh "What changed"
# Bump the version in tauri.conf.json, Cargo.toml and package.json for every release: installed
# apps only update to a higher version.
set -euo pipefail
HOST="${HOST:-deploy@74.208.95.245}"
KEY="${SSH_KEY:-$HOME/.ssh/subspace_deploy}"
DOMAIN="${DOMAIN:-subspace.click}"
NOTES="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/apps/desktop/src-tauri"

VERSION="$(node -p "require('./tauri.conf.json').version")"
SRC="target/release/bundle/nsis/Subspace Frequency_${VERSION}_x64-setup.exe"
[ -f "$SRC" ] && [ -f "$SRC.sig" ] || { echo "No signed $VERSION installer: build it first (see the top of this script)"; exit 1; }
NAME="Subspace-Frequency-${VERSION}-x64-setup.exe"
BASE="https://$DOMAIN/downloads/desktop"

TMP="$(mktemp -d)"
cp "$SRC" "$TMP/$NAME"
SIG="$(cat "$SRC.sig")" VERSION="$VERSION" NOTES="$NOTES" URL="$BASE/$NAME" node -e '
  const { VERSION, NOTES, SIG, URL } = process.env;
  const manifest = { version: VERSION, notes: NOTES, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": { signature: SIG, url: URL } } };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(manifest, null, 2) + "\n");
' "$TMP/latest.json"

scp -q -i "$KEY" -o BatchMode=yes "$TMP/$NAME" "$TMP/latest.json" "$HOST:/tmp/"
# The installer goes up before the manifest that points at it.
ssh -i "$KEY" -o BatchMode=yes "$HOST" "set -e
  D=/var/www/subspace-downloads/desktop
  sudo install -d -m 755 \$D
  sudo install -m 644 /tmp/$NAME \$D/$NAME
  sudo install -m 644 /tmp/$NAME \$D/Subspace-Frequency-Setup.exe
  sudo install -m 644 /tmp/latest.json \$D/latest.json.new && sudo mv \$D/latest.json.new \$D/latest.json
  rm -f /tmp/$NAME /tmp/latest.json"
rm -rf "$TMP"
echo "desktop $VERSION published: $BASE/Subspace-Frequency-Setup.exe"
