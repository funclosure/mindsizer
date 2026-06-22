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

  it("inlines an authored section that carries a leading id-scoped <style>", () => {
    const outline = parseOutline(MD);
    const sections = new Map([
      [
        "s_a",
        '<style>#s_a .k{color:cyan}</style>' +
          '<section data-slide-id="s_a" data-layout="bespoke"><div class="k">XAUTHORED</div></section>',
      ],
    ]);
    const html = sealDeck(outline, { sections });
    expect(html).toContain("<style>#s_a .k{color:cyan}</style>");
    expect(html).toContain('class="k">XAUTHORED');
  });

  it("inlines a section's scoped <script> into the deck document", () => {
    const outline = parseOutline(MD);
    const section =
      '<section data-slide-id="s_a" data-layout="bespoke">x</section>' +
      "<script>(function(){window.__s_a=1;})();</script>";
    const html = sealDeck(outline, {
      sections: new Map([["s_a", section]]),
    });
    expect(html).toContain("window.__s_a=1");
    // the slide script sits inside the deck document, before the nav runtime's closing tag
    expect(html.indexOf("window.__s_a=1")).toBeLessThan(html.lastIndexOf("</script>"));
    expect(html).not.toContain("http://"); // still self-contained, no external refs
  });
});
