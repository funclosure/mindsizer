// tests/render/build-slide.test.ts
import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { AuthorRequest } from "../../src/render/design-brief";
import type { RenderResult } from "../../src/render/fit-check";
import type { SlideMaterials } from "../../src/render/materials";
import type { PassTiming, SlideTiming } from "../../src/render/progress";

const slide = { id: "s_x", layout: "bespoke" as const, title: "T", markdown: "b" };
const deck = { title: "D", slideTitles: ["T"] };
const materials: SlideMaterials = { digest: ["p"], angle: "a", neighborTitles: [] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function fakeAuthor(html: string) {
  const reqs: AuthorRequest[] = [];
  const author: SlideAuthor = { async authorSlide(req) { reqs.push(req); return { html }; } };
  return { author, reqs };
}

describe("buildSlide", () => {
  it("returns the authored html and passes materials through", async () => {
    const a = fakeAuthor(ok);
    const r = await buildSlide(slide, deck, materials, { author: a.author });
    expect(r.html).toBe(ok);
    expect(r.warnings).toEqual([]);
    expect(a.reqs[0].materials).toEqual(materials);
  });

  it("throws when the author returns no usable <section> (malformed output)", async () => {
    const a = fakeAuthor(`<div>not a section</div>`);
    await expect(buildSlide(slide, deck, materials, { author: a.author })).rejects.toThrow(/no usable <section>/);
  });

  it("runs a final fit-check when a renderer is given and warns on overflow", async () => {
    const a = fakeAuthor(ok);
    const renderer = {
      render: async (): Promise<RenderResult> =>
        ({ shots: [Buffer.from("p")], overflowPx: 80, fits: false, consoleErrors: [] }),
    };
    const r = await buildSlide(slide, deck, materials, { author: a.author, renderer });
    expect(r.fits).toBe(false);
    expect(r.warnings.some((w) => /80px/.test(w))).toBe(true);
  });

  it("surfaces console errors from the fit-check", async () => {
    const a = fakeAuthor(ok);
    const renderer = {
      render: async (): Promise<RenderResult> =>
        ({ shots: [Buffer.from("p")], overflowPx: 0, fits: true, consoleErrors: ["boom"] }),
    };
    const r = await buildSlide(slide, deck, materials, { author: a.author, renderer });
    expect(r.warnings.some((w) => /boom/.test(w))).toBe(true);
  });

  it("returns the author's timing and forwards onPass", async () => {
    const pass: PassTiming = { pass: 1, modelMs: 5, renderMs: 2, overflowPx: 0, consoleErrors: 0 };
    const timing: SlideTiming = { totalMs: 10, passes: [pass], byCategory: { author: 5, revise: 0, render: 2, finalize: 3 } };
    const seen: PassTiming[] = [];
    const author: SlideAuthor = {
      async authorSlide(_req, onPass) { onPass?.(pass); return { html: ok, timing }; },
    };
    const r = await buildSlide(slide, deck, materials, { author }, (p) => seen.push(p));
    expect(r.timing).toEqual(timing);
    expect(seen).toEqual([pass]);
  });
});

describe("buildSlide output guard", () => {
  const slide = { id: "s_a", layout: "bespoke" as const, title: "A", markdown: "a" };
  const deck = { title: "D", slideTitles: ["A"] };
  const materials = { digest: [], angle: "", sourceExcerpt: "", neighborTitles: [] };

  it("throws when the author returns no usable <section> (transient error text)", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: "API Error: socket connection closed unexpectedly" }; } };
    await expect(buildSlide(slide, deck, materials, { author })).rejects.toThrow(/no usable <section>/);
  });

  it("returns normally when the author returns a valid section", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: `<section data-slide-id="s_a" data-layout="bespoke">x</section>` }; } };
    const built = await buildSlide(slide, deck, materials, { author });
    expect(built.html).toContain("s_a");
  });
});
