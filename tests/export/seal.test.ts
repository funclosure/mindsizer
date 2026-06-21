import { describe, it, expect } from "vitest";
import { sealDeck, readFieldCss } from "../../src/export/seal";
import { parseOutline } from "../../src/outline/index";
import type { Outline } from "../../src/outline/types";

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=analogy -->
# A

concept here

> the **analogy**

---

<!-- slide id=s_b layout=plain -->
# B

- x
`;

describe("sealDeck", () => {
  it("seals a deck into one self-contained html document", () => {
    const html = sealDeck(parseOutline(MD));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('data-slide-id="s_a"');
    expect(html).toContain('data-slide-id="s_b"');
    expect(html).toContain("--s-cyan"); // field.css inlined
    expect(html).toContain("data:font/woff2;base64,"); // fonts embedded
    expect(html).toContain("ArrowRight"); // nav runtime inlined
  });

  it("throws listing issues for an invalid outline", () => {
    const bad: Outline = {
      meta: { title: "", purpose: "teach", theme: "field" },
      slides: [],
    };
    expect(() => sealDeck(bad)).toThrow(/invalid outline/);
  });

  it("throws naming the slide + layout for an unsupported layout", () => {
    const md = `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_x layout=bespoke -->\n# X\n\nbody\n`;
    expect(() => sealDeck(parseOutline(md))).toThrow(
      /slide s_x uses layout 'bespoke' — no static renderer yet/,
    );
  });

  it("inlines authored sections when provided, falling back to renderSlide for missing ids", () => {
    const outline = parseOutline(MD);
    const sections = new Map([
      ["s_a", '<section data-slide-id="s_a" data-layout="bespoke">AUTHORED_MARKER</section>'],
    ]);
    const html = sealDeck(outline, { sections });
    expect(html).toContain("AUTHORED_MARKER"); // s_a authored section inlined
    expect(html).toContain('data-slide-id="s_b"'); // s_b fell back to renderSlide
    expect(html).toContain("data:font/woff2;base64,"); // still sealed
  });

  it("exposes readFieldCss returning the theme stylesheet", () => {
    const css = readFieldCss();
    expect(css).toContain("--s-cyan");
    expect(css).toContain("section[data-slide-id]");
  });
});
