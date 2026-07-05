// src/review/extract-deck.ts
import { parse, type HTMLElement } from "node-html-parser";

export interface DeckSlide { id: string; fragment: string }

/**
 * Split a sealed deck into per-slide fragments: each slide's id-scoped <style> block(s),
 * its <section data-slide-id>, and its trailing <script> block(s), in document order.
 * Grouping rule over `.deck`'s child elements: a <style> starts a new group when the current
 * group already has its <section>; the deck-level nav script lives OUTSIDE `.deck`, so it is
 * never visited. Non-element noise (text, comments) between slides is ignored.
 *
 * Correct attribution relies on no fragment beginning with a bare <script>: only <style>/<section>
 * open groups, so a leading <script> would attach to the PRIOR slide. This holds because every
 * sealed fragment is normalized by extractSlideHtml (src/agent/extract-slide.ts), which slices from
 * the first <style>/<section> and drops anything before it. Preserve that invariant if either changes.
 */
export function extractSlides(deckHtml: string): DeckSlide[] {
  const root = parse(deckHtml);
  const deck = root.querySelector(".deck");
  if (!deck) return [];

  const out: DeckSlide[] = [];
  let buf: HTMLElement[] = [];
  let section: HTMLElement | null = null;

  const flush = () => {
    if (!section) { buf = []; return; }
    const id = section.getAttribute("data-slide-id");
    if (id) out.push({ id, fragment: buf.map((n) => n.toString()).join("\n") });
    buf = [];
    section = null;
  };

  for (const node of deck.childNodes) {
    const el = node as HTMLElement;
    if (typeof el.tagName !== "string" || !el.tagName) continue; // skip text/comment nodes
    const tag = el.tagName.toUpperCase();
    if (tag === "STYLE" && section) flush();          // a style after a section opens the next slide
    if (tag === "SECTION") {
      if (section) flush();                            // back-to-back sections (style-less slide)
      section = el;
    }
    if (tag === "STYLE" || tag === "SECTION" || tag === "SCRIPT") buf.push(el);
  }
  flush();
  return out;
}
