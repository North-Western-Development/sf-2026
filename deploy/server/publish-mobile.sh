#!/usr/bin/env bash
# Publish the mobile apps for download (run on the operator's machine), with stable names for
# the download links:
#   /downloads/mobile/Subspace-Frequency.apk   Android, signed with the publisher's key
#   /downloads/mobile/Subspace-Frequency.ipa   iOS, unsigned, for sideloading (no push)
#
# Android: pnpm --filter @subspace/mobile build:android   (needs ~/.subspace/android-release.*)
# iOS:     run the "iOS app (unsigned IPA)" GitHub workflow and download its ios-ipa artifact.
#   deploy/server/publish-mobile.sh [path/to/app.apk] [path/to/app.ipa]
# With no arguments it publishes apps/mobile/build/Subspace-Frequency-<version>.{apk,ipa}, whichever exist.
# Bump "version" (and android.versionCode, ios.buildNumber) in apps/mobile/app.json for every
# release: Android only installs a higher versionCode over an older copy.
set -euo pipefail
HOST="${HOST:-deploy@74.208.95.245}"
KEY="${SSH_KEY:-$HOME/.ssh/subspace_deploy}"
DOMAIN="${DOMAIN:-subspace.click}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cd "$ROOT/apps/mobile" && node -p "require('./app.json').expo.version")"
FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  for ext in apk ipa; do
    f="$ROOT/apps/mobile/build/Subspace-Frequency-$VERSION.$ext"
    [ -f "$f" ] && FILES+=("$f")
  done
fi
[ ${#FILES[@]} -gt 0 ] || { echo "Nothing to publish: build the apps first (see the top of this script)"; exit 1; }

for f in "${FILES[@]}"; do
  case "$f" in
    *.apk | *.ipa) ;;
    *) echo "Not an .apk or .ipa: $f"; exit 1 ;;
  esac
  [ -f "$f" ] || { echo "No such file: $f"; exit 1; }
done

scp -q -i "$KEY" -o BatchMode=yes "${FILES[@]}" "$HOST:/tmp/"
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  ext="${name##*.}"
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "set -e
    D=/var/www/subspace-downloads/mobile
    sudo install -d -m 755 \$D
    sudo install -m 644 '/tmp/$name' \"\$D/Subspace-Frequency-$VERSION.$ext\"
    sudo install -m 644 '/tmp/$name' \"\$D/Subspace-Frequency.$ext.new\" && sudo mv \"\$D/Subspace-Frequency.$ext.new\" \"\$D/Subspace-Frequency.$ext\"
    rm -f '/tmp/$name'"
  echo "published: https://$DOMAIN/downloads/mobile/Subspace-Frequency.$ext ($VERSION)"
done
