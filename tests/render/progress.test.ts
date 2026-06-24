import { describe, it, expect } from "vitest";
import { computeSlideTiming, ZERO_TIMING, type PassTiming } from "../../src/render/progress";

describe("computeSlideTiming", () => {
  it("attributes all time to four categories that sum to the total", () => {
    const passes: PassTiming[] = [
      { pass: 1, modelMs: 100, renderMs: 20, overflowPx: 80, consoleErrors: 0 },
      { pass: 2, modelMs: 50, renderMs: 10, overflowPx: 0, consoleErrors: 0 },
    ];
    const t = computeSlideTiming(0, passes, 200);
    expect(t.totalMs).toBe(200);
    expect(t.byCategory).toEqual({ author: 100, revise: 50, render: 30, finalize: 20 });
    const sum = Object.values(t.byCategory).reduce((a, b) => a + b, 0);
    expect(sum).toBe(t.totalMs);
    expect(t.passes).toBe(passes);
  });

  it("puts all model time in author when there are no render passes", () => {
    const t = computeSlideTiming(1000, [], 5000);
    expect(t.byCategory).toEqual({ author: 4000, revise: 0, render: 0, finalize: 0 });
    expect(t.passes).toEqual([]);
  });

  it("ZERO_TIMING is an all-zero slide timing", () => {
    expect(ZERO_TIMING.totalMs).toBe(0);
    expect(ZERO_TIMING.byCategory).toEqual({ author: 0, revise: 0, render: 0, finalize: 0 });
  });
});
