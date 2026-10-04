import { describe, it, expect } from "vitest";
import {
  clippedText, textIntersect,
  parseColor, luminance, contrastRatio, blend, aaThreshold, isLargeText, intersectArea, findOverlaps, outsideFrame,
  contrastFailures, computeCraft, craftCap, type TextBox,
} from "../../eval/lib/craft";

const box = (p: Partial<TextBox> & { id: number }): TextBox => ({
  ancestors: [], text: `t${p.id}`, color: { r: 255, g: 255, b: 255, a: 1 }, fontPx: 16, bold: false, x: 0, y: 0, w: 100, h: 20, ...p,
});

describe("parseColor", () => {
  it("parses rgb/rgba/hex/CSS4 forms", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10,20,30,0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0a1a2f")).toEqual({ r: 10, g: 26, b: 47, a: 1 });
    expect(parseColor("#00000080")!.a).toBeCloseTo(0.502, 2);
    expect(parseColor("transparent")!.a).toBe(0);
    expect(parseColor("hsl(0 0% 0%)")).toBeUndefined();
  });
});

describe("WCAG contrast", () => {
  it("black on white is 21:1 and identical colors are 1:1", () => {
    const w = { r: 255, g: 255, b: 255, a: 1 };
    const k = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(k, w)).toBeCloseTo(21, 5);
    expect(contrastRatio(w, k)).toBeCloseTo(21, 5);
    expect(contrastRatio(w, w)).toBeCloseTo(1, 5);
  });
  it("matches known reference values", () => {
    // #777 on white ≈ 4.48:1 (the classic just-fails-AA grey)
    expect(contrastRatio(parseColor("#777777")!, parseColor("#ffffff")!)).toBeCloseTo(4.48, 2);
    expect(luminance(parseColor("#ffffff")!)).toBeCloseTo(1, 5);
  });
  it("composites translucent text over the background", () => {
    const bg = { r: 0, g: 0, b: 0, a: 1 };
    const half = { r: 255, g: 255, b: 255, a: 0.5 };
    expect(blend(half, bg).r).toBeCloseTo(127.5, 5);
    expect(contrastRatio(half, bg)).toBeLessThan(contrastRatio({ ...half, a: 1 }, bg));
  });
  it("uses 3:1 for large text and 4.5:1 otherwise", () => {
    expect(isLargeText(24, false)).toBe(true);
    expect(isLargeText(19, true)).toBe(true);
    expect(isLargeText(19, false)).toBe(false);
    expect(aaThreshold(12, false)).toBe(4.5);
    expect(aaThreshold(30, false)).toBe(3);
  });
  it("counts failures only where a background was sampled", () => {
    const grey = { r: 119, g: 119, b: 119, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const r = contrastFailures([
      box({ id: 0, color: grey, bg: white, fontPx: 12 }), // 4.48 < 4.5 → fail
      box({ id: 1, color: grey, bg: white, fontPx: 32 }), // large → 3:1 passes
      box({ id: 2, color: grey }),                         // no bg → skipped
    ]);
    expect(r.checked).toBe(2);
    expect(r.fails).toHaveLength(1);
    expect(r.fails[0].need).toBe(4.5);
    expect(r.minRatio).toBeCloseTo(4.48, 2);
  });
});

describe("overlap detection", () => {
  it("computes intersection area", () => {
    expect(intersectArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(intersectArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
  });
  it("flags colliding sibling text but not nested or grazing boxes", () => {
    const a = box({ id: 0, x: 0, y: 0, w: 100, h: 20 });
    const b = box({ id: 1, x: 10, y: 5, w: 100, h: 20 });        // big collision
    const nested = box({ id: 2, ancestors: [0], x: 0, y: 0, w: 50, h: 20 }); // child of a
    const graze = box({ id: 3, x: 0, y: 24, w: 100, h: 20 });     // 1px row overlap with b → below minArea/frac
    const o = findOverlaps([a, b, nested, graze]);
    expect(o).toHaveLength(2); // a×b and b×nested (nested is not b's descendant)
    expect(o.some((x) => x.a === "t0" && x.b === "t1")).toBe(true);
    expect(o.some((x) => x.a === "t0" && x.b === "t2")).toBe(false);
    expect(o.some((x) => x.b === "t3" || x.a === "t3")).toBe(false);
  });
});

describe("per-line text rects", () => {
  it("does not flag a wrapped inline run against the inline sibling on its first line", () => {
    // <b>The crank</b> — the unscalable things you'll do to get it / going   (2 lines)
    const bold = box({ id: 0, x: 100, y: 350, w: 72, h: 20 });
    const rest = box({ id: 1, x: 100, y: 350, w: 370, h: 44, rects: [{ x: 176, y: 350, w: 294, h: 20 }, { x: 100, y: 372, w: 40, h: 20 }] });
    expect(intersectArea(bold, rest)).toBeGreaterThan(1000); // the union boxes collide…
    expect(textIntersect(bold, rest)).toBe(0);               // …the actual lines don't
    expect(findOverlaps([bold, rest])).toHaveLength(0);
  });
  it("reports partly cut-off text but not fully hidden text", () => {
    const r = clippedText([box({ id: 0, clippedFrac: 0.4 }), box({ id: 1, clippedFrac: 1 }), box({ id: 2, clippedFrac: 0 })]);
    expect(r).toEqual([{ text: "t0", hiddenFrac: 0.4 }]);
    expect(craftCap(computeCraft([box({ id: 0, clippedFrac: 0.4 })], 0, [])).cap).toBe(3);
  });
});

describe("frame + caps", () => {
  it("finds text outside 1280×720 beyond tolerance", () => {
    const r = outsideFrame([box({ id: 0, x: 1250, w: 40 }), box({ id: 1, x: 1239, w: 40 }), box({ id: 2, y: -10 })]);
    expect(r.map((x) => x.px)).toEqual([10, 10]);
  });
  it("caps craft on hard defects", () => {
    const clean = computeCraft([box({ id: 0 })], 0, []);
    expect(craftCap(clean).cap).toBe(4);
    expect(craftCap(computeCraft([box({ id: 0 })], 30, [])).cap).toBe(2);
    expect(craftCap(computeCraft([box({ id: 0 })], 0, ["boom"])).cap).toBe(2);
    const overlapping = computeCraft([box({ id: 0 }), box({ id: 1, x: 5 })], 0, []);
    expect(craftCap(overlapping)).toMatchObject({ cap: 3 });
  });
});
