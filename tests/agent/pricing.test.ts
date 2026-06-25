import { describe, it, expect } from "vitest";
import { costUsd, fmtUsd } from "../../src/agent/pricing";

const M = 1_000_000;

describe("costUsd", () => {
  it("reproduces the known Opus build cost (~$31.39)", () => {
    const u = { input: 98, output: 261889, cacheRead: 1139843, cacheCreate: 535128 };
    expect(costUsd(u, "claude-opus-4-8", {})).toBeCloseTo(31.39, 1);
  });
  it("prices each family by 1M input tokens", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-opus-4-8", {})).toBeCloseTo(15, 5);
    expect(costUsd(u, "claude-sonnet-4-6", {})).toBeCloseTo(3, 5);
    expect(costUsd(u, "claude-haiku-4-5-20251001", {})).toBeCloseTo(0.8, 5);
  });
  it("unknown model → opus rates", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "mystery-model", {})).toBeCloseTo(15, 5);
  });
  it("honours a MINDSIZER_PRICE_<FAMILY> override", () => {
    const u = { input: M, output: M, cacheRead: M, cacheCreate: M };
    expect(costUsd(u, "claude-opus-4-8", { MINDSIZER_PRICE_OPUS: "1,2,3,4" })).toBeCloseTo(10, 5);
  });
  it("ignores a malformed override (falls back to default)", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-opus-4-8", { MINDSIZER_PRICE_OPUS: "bad" })).toBeCloseTo(15, 5);
  });
});

describe("fmtUsd", () => {
  it("formats by magnitude", () => {
    expect(fmtUsd(31.39)).toBe("$31.39");
    expect(fmtUsd(0.18)).toBe("$0.180");
  });
});
