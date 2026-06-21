import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { FitResult } from "../../src/render/fit-check";
import type { AuthorRequest } from "../../src/render/design-brief";

const slide = { id: "s_x", layout: "plain" as const, title: "T", markdown: "body" };
const deck = { title: "D", slideTitles: ["T"] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function recordingAuthor(seq: string[]) {
  const reqs: AuthorRequest[] = [];
  let i = 0;
  const author: SlideAuthor = {
    async authorSlide(req) {
      reqs.push(req);
      return seq[Math.min(i++, seq.length - 1)];
    },
  };
  return { author, reqs };
}
const fitsAlways = { check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits" }) };

describe("buildSlide", () => {
  it("returns on the first attempt when it fits", async () => {
    const a = recordingAuthor([ok]);
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitsAlways });
    expect(r).toEqual({ html: ok, passes: 1, fits: true, approved: true });
    expect(a.reqs).toHaveLength(1);
    expect(a.reqs[0].fix).toBeUndefined();
  });

  it("re-authors with the overflow problem, then succeeds", async () => {
    const a = recordingAuthor([ok, ok]);
    let n = 0;
    const fit = {
      check: async (): Promise<FitResult> =>
        ++n === 1
          ? { fits: false, overflowPx: 100, detail: "overflows by 100px" }
          : { fits: true, overflowPx: 0, detail: "fits" },
    };
    const r = await buildSlide(slide, deck, { author: a.author, fit });
    expect(r.fits).toBe(true);
    expect(r.passes).toBe(2);
    expect(a.reqs[1].fix?.problem).toBe("overflows by 100px");
    expect(a.reqs[1].fix?.previousHtml).toBe(ok);
  });

  it("gives up after maxPasses, flagging fits:false", async () => {
    const a = recordingAuthor([ok]);
    const fit = { check: async (): Promise<FitResult> => ({ fits: false, overflowPx: 200, detail: "overflows by 200px" }) };
    const r = await buildSlide(slide, deck, { author: a.author, fit, maxPasses: 2 });
    expect(r.fits).toBe(false);
    expect(r.passes).toBe(2);
    expect(a.reqs).toHaveLength(2);
  });

  it("treats a malformed section as a problem and re-authors", async () => {
    const a = recordingAuthor(["<div>not a section</div>", ok]);
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitsAlways });
    expect(r.fits).toBe(true);
    expect(a.reqs).toHaveLength(2);
    expect(a.reqs[1].fix).toBeDefined();
  });

  it("accepts an authored slide that leads with an id-scoped <style>", async () => {
    const styled =
      `<style>#s_x .k{color:red}</style>` +
      `<section data-slide-id="s_x" data-layout="bespoke"><div class="k">hi</div></section>`;
    const a = recordingAuthor([styled]);
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitsAlways });
    expect(r.fits).toBe(true);
    expect(r.passes).toBe(1); // not treated as malformed
    expect(r.html).toContain("<style>");
  });
});

describe("buildSlide with a vision critic", () => {
  const png = Buffer.from("fakepng");
  const fitOK = {
    check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits", png }),
  };

  it("re-authors when the critic rejects, then approves", async () => {
    const a = recordingAuthor([ok, ok]);
    let n = 0;
    const critic = {
      critique: async () =>
        ++n === 1
          ? { approved: false, problems: ["lower third is empty"] }
          : { approved: true, problems: [] },
    };
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitOK, critic });
    expect(r.approved).toBe(true);
    expect(r.passes).toBe(2);
    expect(a.reqs[1].fix?.problem).toContain("lower third is empty");
    expect(a.reqs[1].fix?.previousPng).toBeDefined(); // author SEES its own render on the fix pass
  });

  it("exhausts with approved:false when the critic keeps rejecting", async () => {
    const a = recordingAuthor([ok]);
    const critic = { critique: async () => ({ approved: false, problems: ["too sparse"] }) };
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitOK, critic, maxPasses: 2 });
    expect(r.approved).toBe(false);
    expect(r.passes).toBe(2);
  });
});
