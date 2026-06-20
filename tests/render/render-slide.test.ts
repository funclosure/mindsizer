import { describe, it, expect } from "vitest";
import { renderSlide } from "../../src/render/render-slide";
import { validateSlideSection, readBoundRegions } from "../../src/outline/index";
import type { OutlineSlide } from "../../src/outline/types";

const intro: OutlineSlide = {
  id: "s_intro",
  layout: "analogy",
  title: "Eventual consistency",
  markdown: "Every copy agrees eventually.\n\n> Like **office gossip**.",
};

describe("renderSlide", () => {
  it("renders analogy and fits the step-1 seam", () => {
    const html = renderSlide(intro);
    expect(validateSlideSection(html, "s_intro")).toEqual([]);
    const regions = readBoundRegions(html);
    expect(Object.keys(regions).sort()).toEqual(["analogy", "concept", "title"]);
    expect(regions.analogy).toContain("<strong>office gossip</strong>");
  });

  it("renders plain with a body region", () => {
    const html = renderSlide({
      id: "s_p",
      layout: "plain",
      title: "P",
      markdown: "- a\n- b",
    });
    expect(html).toContain('data-layout="plain"');
    expect(readBoundRegions(html).body).toContain("<li>a</li>");
  });

  it("throws for a layout with no static renderer (bespoke)", () => {
    expect(() =>
      renderSlide({ id: "s_b", layout: "bespoke", title: "x", markdown: "" }),
    ).toThrow(/no static renderer/);
  });
});
