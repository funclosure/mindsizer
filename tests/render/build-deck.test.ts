import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import { parseOutline } from "../../src/outline/index";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { FitResult } from "../../src/render/fit-check";

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=plain -->
# A

aaa

---

<!-- slide id=s_b layout=plain -->
# B

bbb
`;

const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">${id}</section>`;

describe("buildDeck", () => {
  it("builds a section per slide, keyed by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const fit = { check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits" }) };
    const res = await buildDeck(parseOutline(MD), { author, fit });
    expect([...res.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
    expect(res.sections.get("s_a")).toContain('data-slide-id="s_a"');
    expect(res.warnings).toEqual([]);
  });

  it("records a warning for a slide that never fits", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const fit = { check: async (): Promise<FitResult> => ({ fits: false, overflowPx: 99, detail: "overflows by 99px" }) };
    const res = await buildDeck(parseOutline(MD), { author, fit, maxPasses: 1 });
    expect(res.warnings.length).toBe(2);
    expect(res.warnings[0]).toContain("s_a");
  });
});
