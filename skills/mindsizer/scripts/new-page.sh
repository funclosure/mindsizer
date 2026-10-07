#!/usr/bin/env bash
# Start a mindsizer page in one of the five styles: copies assets/template.html and fills in the style.
# Usage: new-page.sh <neat|graphite|ink|margins|pencil> <out.html>
set -euo pipefail
style="${1:?style: neat | graphite | ink | margins | pencil}"; out="${2:?output file}"
dir="$(cd "$(dirname "$0")/.." && pwd)"
css="$dir/assets/styles/$style.css"
[ -f "$css" ] || { echo "unknown style '$style' (neat, graphite, ink, margins, pencil)" >&2; exit 1; }
[ -e "$out" ] && { echo "$out already exists; not overwriting" >&2; exit 1; }
fonts="$(sed -n 's#.*fonts: \(https://[^ ]*\).*#\1#p' "$css" | head -1)"
link=""; [ -n "$fonts" ] && link="<link rel=\"stylesheet\" href=\"$fonts\">"
STYLE_CSS="$css" FONT_LINK="$link" python3 - "$dir/assets/template.html" "$out" <<'PY'
import os, sys
src, out = sys.argv[1], sys.argv[2]
page = open(src).read()
page = page.replace("/*__STYLE__*/", open(os.environ["STYLE_CSS"]).read().rstrip(), 1)
page = page.replace("<!--__FONTS__-->", os.environ["FONT_LINK"], 1)
open(out, "w").write(page)
PY
echo "new page: $out (style: $style)"
