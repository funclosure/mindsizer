// tests/render/build-deck.test.ts
import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { Outline } from "../../src/outline/types";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;

describe("buildDeck", () => {
  it("authors every slide and keys sections by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const r = await buildDeck(outline, { author });
    expect([...r.sections.keys()]).toEqual(["s_a", "s_b"]);
    expect(r.warnings).toEqual([]);
  });

  it("collects per-slide warnings with the slide id prefix", async () => {
    const author: SlideAuthor = { async authorSlide() { return `<div>bad</div>`; } };
    const r = await buildDeck(outline, { author });
    expect(r.warnings.every((w) => /^s_[ab]:/.test(w))).toBe(true);
    expect(r.warnings.length).toBe(2);
  });

  it("passes deck-context-derived materials to the author", async () => {
    let seenAngle = "";
    const author: SlideAuthor = {
      async authorSlide(req) { seenAngle = req.materials.angle; return section(req.slide.id); },
    };
    await buildDeck(outline, { author, context: { digest: ["p"], angle: "lens" } });
    expect(seenAngle).toBe("lens");
  });
});
