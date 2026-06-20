import { describe, it, expect } from "vitest";
import type { Outline, OutlineSlide, DeckMeta } from "../../src/outline/types";

describe("types", () => {
  it("constructs a well-formed Outline value", () => {
    const meta: DeckMeta = { title: "Demo", purpose: "teach", theme: "field" };
    const slide: OutlineSlide = {
      id: "s_abc12345",
      layout: "analogy",
      title: "A title",
      markdown: "Some body.",
    };
    const outline: Outline = { meta, slides: [slide] };
    expect(outline.slides[0].id).toBe("s_abc12345");
    expect(outline.meta.purpose).toBe("teach");
  });
});
