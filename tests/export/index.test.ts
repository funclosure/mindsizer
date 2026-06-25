import { describe, it, expect } from "vitest";
import { sealDeck } from "../../src/export/index";

describe("export barrel", () => {
  it("re-exports the public export API", () => {
    expect(typeof sealDeck).toBe("function");
  });
});
