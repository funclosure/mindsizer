#!/usr/bin/env bash
# Screenshot every interactive state of a mindsizer page and flag problems (see states.mjs).
# Usage: states.sh [--level low|medium|high] <page.html> [out-dir]   (installs playwright once into ~/.cache/mindsizer)
set -euo pipefail
level=medium
if [ "${1:-}" = "--level" ]; then level="${2:?--level needs low, medium or high}"; shift 2; fi
case "$level" in low|medium|high) ;; *) echo "unknown level '$level' (low, medium, high)" >&2; exit 1;; esac
page="$1"; out="${2:-$(dirname "$page")/states}"
cache="${MINDSIZER_CACHE:-$HOME/.cache/mindsizer}"
if [ ! -d "$cache/node_modules/playwright" ]; then
  mkdir -p "$cache" && npm i --prefix "$cache" --silent --no-save playwright@1.61 >/dev/null
fi
PLAYWRIGHT_MODULE="$cache/node_modules/playwright" node "$(dirname "$0")/states.mjs" "$page" "$out" "$level"
