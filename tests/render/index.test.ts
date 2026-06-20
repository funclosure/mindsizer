import { describe, it, expect } from "vitest";
import { renderSlide, renderPreviewPage, extractSlots } from "../../src/render/index";

describe("render barrel", () => {
  it("re-exports the public render API", () => {
    expect(typeof renderSlide).toBe("function");
    expect(typeof renderPreviewPage).toBe("function");
    expect(typeof extractSlots).toBe("function");
  });
});
