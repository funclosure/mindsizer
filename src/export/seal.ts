import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Outline } from "../outline/types";
import { validateOutline } from "../outline/validate";
import { renderSlide } from "../render/render-slide";
import { escapeHtml } from "../render/html";
import { fontFaceCss } from "./fonts";
import { DECK_CSS, NAV_JS } from "./deck-runtime";
import { loadTheme, type Theme } from "../theme/load";

const THEME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "theme",
);

/** Read the bundled Field theme stylesheet. */
export function readFieldCss(): string {
  return readFileSync(join(THEME_DIR, "field.css"), "utf8");
}

/** A minimal valid section for a slide that hasn't been authored yet (partial-deck preview). */
export function placeholderSection(slide: { id: string; title: string }): string {
  return (
    `<section id="${slide.id}" data-slide-id="${slide.id}" data-layout="bespoke">` +
    `<div class="s-title">${escapeHtml(slide.title)}</div>` +
    `<div class="s-body">building…</div></section>`
  );
}

/** Assemble an Outline into one self-contained, offline deck.html string. */
export function sealDeck(
  outline: Outline,
  opts: { sections?: Map<string, string>; theme?: Theme } = {},
): string {
  const issues = validateOutline(outline);
  if (issues.length > 0) {
    throw new Error(
      "invalid outline:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  const sections = outline.slides
    .map((s) => opts.sections?.get(s.id) ?? renderSlide(s))
    .join("\n");
  const theme = opts.theme ?? loadTheme("field");
  const title = escapeHtml(outline.meta.title || "deck");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${theme.fontFaceCss}
${theme.css}
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
