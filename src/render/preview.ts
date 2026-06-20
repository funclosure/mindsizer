import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONTS_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..900,0..100;1,9..144,400..900,0..100&family=Geist:wght@300..600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">';

/**
 * Wrap a slide fragment in a complete, openable HTML page that centers the
 * slide at 16:9 with the Field theme + fonts. Authoring/preview only — not
 * the export artifact (that is step 3).
 */
export function renderPreviewPage(
  fragment: string,
  opts: { cssPath?: string } = {},
): string {
  const cssPath = opts.cssPath ?? join(process.cwd(), "theme", "field.css");
  const css = readFileSync(cssPath, "utf8");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FONTS_LINK}
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #070d16;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .stage { width: min(960px, 92vw); }
${css}
</style>
</head>
<body>
<div class="stage">${fragment}</div>
</body>
</html>`;
}
