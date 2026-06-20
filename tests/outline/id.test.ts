import { describe, it, expect } from "vitest";
import { mintSlideId } from "../../src/outline/id";

describe("mintSlideId", () => {
  it("matches the s_<8 lowercase alnum> shape", () => {
    expect(mintSlideId()).toMatch(/^s_[0-9a-z]{8}$/);
  });

  it("produces unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => mintSlideId()));
    expect(ids.size).toBe(1000);
  });
});
