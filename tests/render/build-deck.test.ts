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
    // a valid section (so it isn't rejected by the guard) whose <script> doesn't reference the
    // slide id → validateSlideSection emits an advisory warning per slide.
    const author: SlideAuthor = {
      async authorSlide(req) {
        return { html: `<section data-slide-id="${req.slide.id}" data-layout="bespoke"><script>doStuff()</script></section>` };
      },
    };
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

  it("isolates a permanently failing slide and finishes the rest", async () => {
    const author: SlideAuthor = {
      async authorSlide(req) { if (req.slide.id === "s_a") throw new Error("boom"); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink, sleep: () => Promise.resolve() });
    expect(events.some((e) => e.type === "slide_failed")).toBe(true);
    expect(events[events.length - 1].type).toBe("deck_done");
    expect([...r.sections.keys()]).toEqual(["s_b"]);
  });

  it("runs at most `concurrency` slides at once", async () => {
    const big: Outline = {
      meta: outline.meta,
      slides: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, layout: "bespoke" as const, title: `T${i}`, markdown: "m" })),
    };
    let active = 0;
    let peak = 0;
    const author: SlideAuthor = {
      async authorSlide(req) {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { html: section(req.slide.id) };
      },
    };
    await buildDeck(big, { author, concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("retries an overloaded slide and recovers", async () => {
    const attempts: Record<string, number> = {};
    const author: SlideAuthor = {
      async authorSlide(req) {
        attempts[req.slide.id] = (attempts[req.slide.id] ?? 0) + 1;
        if (req.slide.id === "s_a" && attempts.s_a < 3) throw new Error("529 overloaded");
        return { html: section(req.slide.id) };
      },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink, sleep: () => Promise.resolve() });
    expect(events.filter((e) => e.type === "slide_retry").length).toBe(2); // s_a failed twice, retried twice
    expect(events.filter((e) => e.type === "slide_done").length).toBe(2);
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });

  it("reuses cached slides without calling the author, authoring the rest", async () => {
    const authored: string[] = [];
    const author: SlideAuthor = {
      async authorSlide(req) { authored.push(req.slide.id); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const reuse = new Map([["s_a", section("s_a")]]);
    const r = await buildDeck(outline, { author, sink, reuse });
    expect(authored).toEqual(["s_b"]); // s_a reused, only s_b authored
    expect(events.some((e) => e.type === "slide_reused" && e.id === "s_a")).toBe(true);
    expect(events.some((e) => e.type === "slide_start" && e.id === "s_a")).toBe(false); // reused → no slide_start
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });
});
