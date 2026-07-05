import { describe, it, expect } from "vitest";
import { computeOverflow, OVERFLOW_TOLERANCE_PX, horizontalOverflow, resolveOverflow } from "../../src/render/render-helpers";

describe("computeOverflow", () => {
  it("is 0 when content fits", () => {
    expect(computeOverflow({ sh: 720, ch: 720, sw: 1280, cw: 1280 })).toBe(0);
  });
  it("reports the largest of vertical/horizontal overflow", () => {
    expect(computeOverflow({ sh: 800, ch: 720, sw: 1300, cw: 1280 })).toBe(80);
    expect(computeOverflow({ sh: 730, ch: 720, sw: 1400, cw: 1280 })).toBe(120);
  });
  it("never goes negative", () => {
    expect(computeOverflow({ sh: 700, ch: 720, sw: 1200, cw: 1280 })).toBe(0);
  });
});

describe("OVERFLOW_TOLERANCE_PX", () => {
  it("is 2", () => { expect(OVERFLOW_TOLERANCE_PX).toBe(2); });
});
describe("horizontalOverflow", () => {
  it("is max(0, sw-cw)", () => {
    expect(horizontalOverflow({ sh: 700, ch: 720, sw: 1300, cw: 1280 })).toBe(20);
    expect(horizontalOverflow({ sh: 700, ch: 720, sw: 1280, cw: 1280 })).toBe(0);
  });
});
describe("resolveOverflow", () => {
  const rest = (sh: number, sw = 1280) => ({ sh, ch: 720, sw, cw: 1280 });
  it("none when resting fits and no expansion", () => {
    expect(resolveOverflow({ resting: rest(720), expandedHoriz: [], expandedBeyondFrame: [] }))
      .toEqual({ overflowPx: 0, axis: "none", detail: expect.stringMatching(/fits/i) });
  });
  it("resting vertical overflow wins", () => {
    const r = resolveOverflow({ resting: rest(820), expandedHoriz: [0], expandedBeyondFrame: [0] });
    expect(r.overflowPx).toBe(100); expect(r.axis).toBe("resting");
  });
  it("resting horizontal overflow counts as resting", () => {
    const r = resolveOverflow({ resting: rest(720, 1330), expandedHoriz: [], expandedBeyondFrame: [] });
    expect(r.overflowPx).toBe(50); expect(r.axis).toBe("resting");
  });
  it("ignores within-frame expansion (expandedBeyondFrame 0)", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [0, 0], expandedBeyondFrame: [0, 0] });
    expect(r.overflowPx).toBe(0); expect(r.axis).toBe("none");
  });
  it("flags an expanded state that grows beyond the frame", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [0], expandedBeyondFrame: [140] });
    expect(r.overflowPx).toBe(140); expect(r.axis).toBe("expanded-vertical");
  });
  it("flags expanded horizontal spill", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [30], expandedBeyondFrame: [0] });
    expect(r.overflowPx).toBe(30); expect(r.axis).toBe("expanded-horizontal");
  });
});
