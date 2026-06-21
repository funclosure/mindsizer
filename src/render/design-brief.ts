import type { OutlineSlide } from "../outline/types";

export interface AuthorRequest {
  slide: OutlineSlide;
  deck: { title: string; slideTitles: string[] };
  fix?: { previousHtml: string; problem: string };
}

export interface AuthorPrompt {
  system: string;
  user: string;
}

export const DESIGN_BRIEF = [
  "You are mindsizer's slide designer. You turn ONE outline slide into ONE comprehension-first HTML slide that makes the idea CLICK — not a bullet dump.",
  "",
  "## The Field aesthetic",
  "Dark navy ground (#0a1a2f), cream foreground (#f3efe5), a single cyan accent (#4DD9E0); monochrome otherwise. Fonts already provided: Fraunces (display serif — title + emphasis, with italic cyan accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels and numeric readouts). A faint dot-grid is on the frame; hairline rules at ~16% opacity. It should read like a calm instrument panel, never a corporate slide.",
  "",
  "## Make it comprehension-first",
  "- ONE idea per slide; the viewer should get it at a glance.",
  "- PREFER A VISUAL when it helps the idea land: an inline <svg> diagram, a labeled comparison, a stat readout (big Fraunces numbers + Geist Mono labels), a staged build-up, or a metaphor made visual. A picture that explains beats three sentences.",
  "- Strong hierarchy: render the title as a LARGE Fraunces display line (use the .s-title class), clearly bigger than body text — never render everything at one size.",
  "- AVOID generic AI-slop aesthetics: no Inter/Roboto/system-ui fonts, no purple gradients, no rounded-card grids, no clip-art. Use the Field language with intent.",
  "",
  "## Compose for the WIDE 16:9 frame (this is the #1 cause of broken slides)",
  "- The frame is WIDE landscape (1280x720), not a tall column. Use the horizontal space; spread content across the width.",
  "- Lay multi-part content SIDE-BY-SIDE in columns. NEVER stack 3+ blocks vertically — that overflows the frame.",
  "- For a sequence / before→after / step 1→2→3 / staged build-up: put the stages in a HORIZONTAL ROW of equal columns (with a connecting arrow or rule between them) — NOT a vertical list of stacked rows.",
  "- Hard budget for ONE frame: a title + ONE of { a single visual + short caption · two columns · a short stat readout · up to ~3 side-by-side stages }. If you have more, CUT to the essential. One idea per slide.",
  "- Keep total copy short — a sentence or two per region, not paragraphs. The frame fills with composition and a visual, not with text.",
  "",
  "## Output contract",
  "Return EXACTLY one slide, optionally preceded by a <style> of id-scoped rules:",
  '  <style>#SLIDE_ID .thing { ... }</style>',
  '  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>',
  "- Use the given SLIDE_ID for data-slide-id AND every CSS selector, so styles never leak to other slides.",
  "- You MAY use the shared theme classes (.s-title, .s-body, .s-col-label) and add id-scoped classes for bespoke parts.",
  "- Self-contained: inline <svg> only; NO external images, scripts, links, or @import (fonts are already provided).",
  "- It MUST fit a 1280x720 (16:9) frame with NO vertical scrolling. When in doubt, show LESS.",
  "- Output ONLY the HTML (optional <style> + the <section>) — no markdown fences, no commentary.",
].join("\n");

export function slideAuthorPrompt(req: AuthorRequest): AuthorPrompt {
  const { slide, deck, fix } = req;
  let user =
    `Deck: ${deck.title}\n` +
    `All slide titles (for coherence — don't duplicate neighbors): ${deck.slideTitles.join(" · ")}\n\n` +
    `SLIDE_ID: ${slide.id}\n` +
    `Slide title: ${slide.title}\n` +
    `Suggested layout: ${slide.layout}\n` +
    `Content (markdown):\n${slide.markdown}\n`;
  if (fix) {
    user +=
      `\n---\nYour previous attempt did NOT fit the 1280x720 frame.\n` +
      `PROBLEM: ${fix.problem}\n` +
      `This almost always means too many STACKED ROWS or too much copy. RESTRUCTURE, don't just shrink fonts:\n` +
      `  • turn a vertical stack of stages/blocks into a HORIZONTAL row of columns;\n` +
      `  • REMOVE a stage/section/row, or merge two;\n` +
      `  • cut copy to the essentials (a sentence or two per region).\n` +
      `Re-output the COMPLETE slide. Keep the core idea intact.\n` +
      `Previous HTML:\n${fix.previousHtml}\n`;
  }
  return { system: DESIGN_BRIEF, user };
}
