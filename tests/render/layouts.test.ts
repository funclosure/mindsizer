import { describe, it, expect } from "vitest";
import { renderAnalogy } from "../../src/render/layouts/analogy";
import { renderPlain } from "../../src/render/layouts/plain";
import type { OutlineSlide } from "../../src/outline/types";

const slide = (over: Partial<OutlineSlide> = {}): OutlineSlide => ({
  id: "s_x",
  layout: "analogy",
  title: "A & B",
  markdown: "",
  ...over,
});

describe("renderAnalogy", () => {
  it("emits a section with seam attributes, slots, and escaped title", () => {
    const html = renderAnalogy(
      { concept: "<p>c</p>", analogy: "<strong>g</strong>" },
      slide(),
    );
    expect(html).toContain('data-slide-id="s_x"');
    expect(html).toContain('data-layout="analogy"');
    expect(html).toContain('data-bind="title"');
    expect(html).toContain('data-bind="concept"');
    expect(html).toContain('data-bind="analogy"');
    expect(html).toContain("A &amp; B"); // title escaped
    expect(html).toContain("<p>c</p>");
    expect(html).toContain("<strong>g</strong>");
    expect(html).toContain("think of it like");
  });
});

describe("renderPlain", () => {
  it("emits a section with title and a single body slot", () => {
    const html = renderPlain(
      { body: "<ul><li>a</li></ul>" },
      slide({ layout: "plain", title: "P" }),
    );
    expect(html).toContain('data-layout="plain"');
    expect(html).toContain('data-bind="body"');
    expect(html).toContain("<li>a</li>");
  });
});
