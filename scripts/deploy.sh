#!/usr/bin/env bash
# Deploy the GitHub Pages site: regenerate the homepage and refresh the example deck,
# then commit + push the gh-pages branch. Idempotent — does nothing if already current.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
WT="$(mktemp -d)/ghpages"
cleanup() { cd "$REPO"; git worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ preparing gh-pages worktree…"
git fetch origin gh-pages --quiet
git worktree add --quiet "$WT" gh-pages
git -C "$WT" reset --hard origin/gh-pages --quiet

echo "→ generating homepage…"
bun run site/build-home.ts "$WT/index.html"

echo "→ refreshing example deck…"
mkdir -p "$WT/dont-scale"
cp examples/dont-scale.deck.html "$WT/dont-scale/index.html"
touch "$WT/.nojekyll"

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "✓ already up to date — nothing to publish."
else
  git commit --quiet -m "Deploy: refresh homepage + example deck"
  git push --quiet origin gh-pages
  echo "✓ published → https://funclosure.github.io/mindsizer/"
fi
