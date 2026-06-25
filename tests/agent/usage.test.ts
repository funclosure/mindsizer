import { describe, it, expect } from "vitest";
import { addUsage, fromSdkUsage, inputSide, cacheHitRatio, fmtTokens, ZERO_USAGE } from "../../src/agent/usage";

describe("usage", () => {
  it("addUsage sums field-wise", () => {
    expect(addUsage({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, { input: 10, output: 20, cacheRead: 30, cacheCreate: 40 }))
      .toEqual({ input: 11, output: 22, cacheRead: 33, cacheCreate: 44 });
  });
  it("fromSdkUsage maps snake_case keys; missing → 0", () => {
    expect(fromSdkUsage({ input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 9 }))
      .toEqual({ input: 5, output: 7, cacheRead: 9, cacheCreate: 0 });
    expect(fromSdkUsage(undefined)).toEqual(ZERO_USAGE);
  });
  it("inputSide + cacheHitRatio", () => {
    const u = { input: 10, output: 0, cacheRead: 90, cacheCreate: 0 };
    expect(inputSide(u)).toBe(100);
    expect(cacheHitRatio(u)).toBe(0.9);
    expect(cacheHitRatio(ZERO_USAGE)).toBe(0);
  });
  it("fmtTokens", () => {
    expect(fmtTokens(2_100_000)).toBe("2.1M");
    expect(fmtTokens(42_000)).toBe("42k");
    expect(fmtTokens(500)).toBe("500");
  });
});
