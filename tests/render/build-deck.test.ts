// tests/render/build-deck.test.ts
import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { Outline } from "../../src/outline/types";
import type { ProgressEvent, SlideTiming } from "../../src/render/progress";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;
const timing: SlideTiming = { totalMs: 10, passes: [{ pass: 1, modelMs: 6, renderMs: 2, overflowPx: 0, consoleErrors: 0 }], byCategory: { author: 6, revise: 0, render: 2, finalize: 2 } };

function recordingSink() {
  const events: ProgressEvent[] = [];
  return { sink: { emit: (e: ProgressEvent) => events.push(e) }, events };
}

describe("buildDeck", () => {
  it("authors every slide and keys sections by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return { html: section(req.slide.id) }; } };
    const r = await buildDeck(outline, { author });
    expect([...r.sections.keys()]).toEqual(["s_a", "s_b"]);
    expect(r.warnings).toEqual([]);
  });

  it("collects per-slide warnings with the slide id prefix", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: `<div>bad</div>` }; } };
    const r = await buildDeck(outline, { author });
    expect(r.warnings.every((w) => /^s_[ab]:/.test(w))).toBe(true);
    expect(r.warnings.length).toBe(2);
  });

  it("passes deck-context-derived materials to the author", async () => {
    let seenAngle = "";
    const author: SlideAuthor = {
      async authorSlide(req) { seenAngle = req.materials.angle; return { html: section(req.slide.id) }; },
    };
    await buildDeck(outline, { author, context: { digest: ["p"], angle: "lens" } });
    expect(seenAngle).toBe("lens");
  });

  it("emits slide_start / render_pass / slide_done per slide and a final deck_done", async () => {
    const author: SlideAuthor = {
      async authorSlide(req, onPass) {
        onPass?.({ pass: 1, modelMs: 6, renderMs: 2, overflowPx: 0, consoleErrors: 0 });
        return { html: section(req.slide.id), timing };
      },
    };
    const { sink, events } = recordingSink();
    await buildDeck(outline, { author, sink });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("slide_start");
    expect(types).toContain("render_pass");
    expect(types.filter((t) => t === "slide_done").length).toBe(2);
    expect(types[types.length - 1]).toBe("deck_done");
    const done = events.find((e) => e.type === "deck_done") as Extract<ProgressEvent, { type: "deck_done" }>;
    expect(done.slides).toBe(2);
    expect(done.byCategory.render).toBe(4); // 2 slides × renderMs 2
  });

  it("emits slide_failed and keeps going when an author throws", async () => {
    let n = 0;
    const author: SlideAuthor = {
      async authorSlide(req) { if (n++ === 0) throw new Error("kaboom"); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink });
    expect(events.some((e) => e.type === "slide_failed")).toBe(true);
    expect(events[events.length - 1].type).toBe("deck_done");
    expect([...r.sections.keys()]).toEqual(["s_b"]); // first failed, second authored
  });
});
