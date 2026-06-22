// tests/render/build-slide.test.ts
import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { AuthorRequest } from "../../src/render/design-brief";
import type { RenderResult } from "../../src/render/fit-check";
import type { SlideMaterials } from "../../src/render/materials";

const slide = { id: "s_x", layout: "bespoke" as const, title: "T", markdown: "b" };
const deck = { title: "D", slideTitles: ["T"] };
const materials: SlideMaterials = { digest: ["p"], angle: "a", neighborTitles: [] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function fakeAuthor(html: string) {
  const reqs: AuthorRequest[] = [];
  const author: SlideAuthor = { async authorSlide(req) { reqs.push(req); return html; } };
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

  it("warns on a malformed section but still returns it", async () => {
    const bad = `<div>not a section</div>`;
    const a = fakeAuthor(bad);
    const r = await buildSlide(slide, deck, materials, { author: a.author });
    expect(r.html).toBe(bad);
    expect(r.warnings.length).toBeGreaterThan(0);
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
});
