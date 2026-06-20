import { describe, it, expect } from "vitest";
import { sealDeck, fontFaceCss } from "../../src/export/index";

describe("export barrel", () => {
  it("re-exports the public export API", () => {
    expect(typeof sealDeck).toBe("function");
    expect(typeof fontFaceCss).toBe("function");
  });
});
