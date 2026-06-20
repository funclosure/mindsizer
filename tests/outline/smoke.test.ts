import { describe, it, expect } from "vitest";
import { OUTLINE_LIB_READY } from "../../src/outline/smoke";

describe("scaffold", () => {
  it("loads the outline module", () => {
    expect(OUTLINE_LIB_READY).toBe(true);
  });
});
