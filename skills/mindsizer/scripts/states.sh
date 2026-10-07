#!/usr/bin/env bash
# Screenshot every interactive state of a mindsizer page and flag problems (see states.mjs).
# Usage: states.sh <page.html> [out-dir]   (installs playwright once into ~/.cache/mindsizer)
set -euo pipefail
page="$1"; out="${2:-$(dirname "$page")/states}"
cache="${MINDSIZER_CACHE:-$HOME/.cache/mindsizer}"
if [ ! -d "$cache/node_modules/playwright" ]; then
  mkdir -p "$cache" && npm i --prefix "$cache" --silent --no-save playwright@1.61 >/dev/null
fi
PLAYWRIGHT_MODULE="$cache/node_modules/playwright" node "$(dirname "$0")/states.mjs" "$page" "$out"
