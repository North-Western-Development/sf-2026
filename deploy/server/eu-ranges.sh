#!/usr/bin/env bash
# Address ranges for BLOCK_EU (run as root): the EU, EEA and UK rows of DB-IP's free IP-to-country
# database (DB-IP Lite, CC BY 4.0, https://db-ip.com; the block page credits it), written to
# /etc/subspace/eu-ranges.csv as "first,last,country". The services re-read the file when it
# changes. DB-IP publishes monthly; the subspace-eu-ranges timer runs this weekly.
#   eu-ranges.sh [output]
set -euo pipefail
OUT="${1:-/etc/subspace/eu-ranges.csv}"
# Keep in step with GDPR_COUNTRIES in packages/constants/src/gdpr.ts (a unit test checks).
COUNTRIES="AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE AX GF GP MQ MF RE YT IS LI NO GB GI"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
this=$(date -u +%Y-%m)
last=$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%Y-%m)
for m in "$this" "$last"; do
  curl -fsSL --max-time 300 -o "$tmp/db.csv.gz" "https://download.db-ip.com/free/dbip-country-lite-$m.csv.gz" && break
  rm -f "$tmp/db.csv.gz"
done
[ -s "$tmp/db.csv.gz" ] || { echo "eu-ranges: download failed; keeping $OUT"; exit 1; }

gunzip -c "$tmp/db.csv.gz" | awk -F, -v list="$COUNTRIES" '
  BEGIN { n = split(list, a, " "); for (i = 1; i <= n; i++) keep[a[i]] = 1 }
  { gsub(/"|\r/, "") } ($3 in keep) { print $1 "," $2 "," $3 }' >"$tmp/eu.csv"
rows=$(wc -l <"$tmp/eu.csv")
# A truncated or reshaped download must not empty the block.
[ "$rows" -gt 50000 ] || { echo "eu-ranges: only $rows ranges; keeping $OUT"; exit 1; }
install -m 644 "$tmp/eu.csv" "$OUT"
echo "eu-ranges: $rows ranges"
