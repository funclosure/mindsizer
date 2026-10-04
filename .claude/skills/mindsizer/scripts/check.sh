#!/usr/bin/env bash
# Quick check for a mindsizer page: script syntax + FULL-PAGE screenshots at desktop and phone width.
# Usage: check.sh <page.html> [out-dir]
# Works from any directory; uses `npx playwright` (first run may need: npx -y playwright install chromium).
set -euo pipefail
page="$1"; out="${2:-$(dirname "$page")}"
base="$(basename "$page" .html)"
tmp="$(mktemp -d)"

# 1. syntax-check every inline <script> body
awk '/<script>/{f=1;next} /<\/script>/{f=0} f' "$page" > "$tmp/page.js"
node --check "$tmp/page.js" && echo "script: syntax ok"

# 2. render in standards mode: add a doctype only if the page has none (the template omits it; the Artifact tool adds it)
if head -c 200 "$page" | grep -qi "<!doctype"; then cp "$page" "$tmp/$base.html"; else
  { echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'; cat "$page"; } > "$tmp/$base.html"; fi

for w in 1280 400; do
  npx -y playwright@1.61 screenshot --full-page --wait-for-timeout=1500 --viewport-size="$w,900" "file://$tmp/$base.html" "$out/$base-$w.png" >/dev/null
  echo "shot: $out/$base-$w.png"
done
rm -rf "$tmp"
