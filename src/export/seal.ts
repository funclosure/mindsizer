import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Outline } from "../outline/types";
import { validateOutline } from "../outline/validate";
import { renderSlide } from "../render/render-slide";
import { escapeHtml } from "../render/html";
import { fontFaceCss } from "./fonts";
import { DECK_CSS, NAV_JS } from "./deck-runtime";

const THEME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "theme",
);

/** Assemble an Outline into one self-contained, offline deck.html string. */
export function sealDeck(outline: Outline): string {
  const issues = validateOutline(outline);
  if (issues.length > 0) {
    throw new Error(
      "invalid outline:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  const sections = outline.slides.map((s) => renderSlide(s)).join("\n");
  const fieldCss = readFileSync(join(THEME_DIR, "field.css"), "utf8");
  const title = escapeHtml(outline.meta.title || "deck");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${fontFaceCss()}
${fieldCss}
${DECK_CSS}
</style>
</head>
<body>
<div class="deck">
${sections}
</div>
<div class="deck-counter"></div>
<div class="deck-progress"></div>
<script>
${NAV_JS}
</script>
</body>
</html>`;
}
