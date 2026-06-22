import { describe, it, expect } from "vitest";
import { computeOverflow } from "../../src/render/render-helpers";

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
