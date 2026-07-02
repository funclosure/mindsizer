// tests/review/extract-deck.test.ts
import { describe, it, expect } from "vitest";
import { extractSlides } from "../../src/review/extract-deck";
import { sealDeck } from "../../src/export/index";
import type { Outline } from "../../src/outline/types";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
    { id: "s_c", layout: "bespoke", title: "C", markdown: "c" },
  ],
};
const frag = (id: string, opts: { style?: boolean; script?: boolean } = {}) =>
  (opts.style ? `<style>#${id} .x{color:red}</style>\n` : "") +
  `<section data-slide-id="${id}" data-layout="bespoke">Body of ${id} with plenty of words to look like a real slide.</section>` +
  (opts.script ? `\n<script>(function(){/* ${id} */})();</script>` : "");

describe("extractSlides", () => {
  it("round-trips a sealDeck deck: one fragment per slide, style+script attached to the right slide", () => {
    const sections = new Map([
      ["s_a", frag("s_a", { style: true, script: true })],
      ["s_b", frag("s_b")], // style-less, script-less
      ["s_c", frag("s_c", { style: true })],
    ]);
    const deck = sealDeck(outline, { sections });
    const out = extractSlides(deck);
    expect(out.map((s) => s.id)).toEqual(["s_a", "s_b", "s_c"]);
    expect(out[0].fragment).toContain("#s_a .x");
    expect(out[0].fragment).toContain("/* s_a */");
    expect(out[1].fragment).not.toContain("<style>");
    expect(out[2].fragment).toContain("#s_c .x");
    expect(out[2].fragment).not.toContain("/* s_a */"); // s_a's script must not leak forward
  });

  it("survives hand-edited whitespace and comments between slides", () => {
    const sections = new Map([
      ["s_a", frag("s_a", { style: true }) + "\n<!-- edited by hand -->\n"],
      ["s_b", frag("s_b", { script: true })],
      ["s_c", frag("s_c")],
    ]);
    const deck = sealDeck(outline, { sections });
    const out = extractSlides(deck);
    expect(out.map((s) => s.id)).toEqual(["s_a", "s_b", "s_c"]);
    expect(out[1].fragment).toContain("<script>");
  });

  it("does not swallow the deck's own nav script or css", () => {
    const deck = sealDeck(outline, { sections: new Map([["s_a", frag("s_a")], ["s_b", frag("s_b")], ["s_c", frag("s_c", { script: true })]]) });
    const out = extractSlides(deck);
    for (const s of out) expect(s.fragment).not.toMatch(/deck-progress|is-active/);
  });

  it("returns [] for html with no slide sections", () => {
    expect(extractSlides("<html><body><p>nope</p></body></html>")).toEqual([]);
  });
});
