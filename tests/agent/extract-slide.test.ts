import { describe, it, expect } from "vitest";
import { extractSlideHtml } from "../../src/agent/extract-slide";

const section = `<section data-slide-id="s_x" data-layout="bespoke">hi</section>`;

describe("extractSlideHtml", () => {
  it("returns clean section markup untouched", () => {
    expect(extractSlideHtml(section)).toBe(section);
  });

  it("strips leading commentary before the section", () => {
    const raw = `All three states verified: ... Here is the final slide.\n\n${section}`;
    expect(extractSlideHtml(raw)).toBe(section);
  });

  it("strips trailing commentary after the section", () => {
    const raw = `${section}\n\nThat completes the slide — let me know if you want tweaks.`;
    expect(extractSlideHtml(raw)).toBe(section);
  });

  it("keeps a leading id-scoped <style> and a trailing <script>", () => {
    const full =
      `<style>#s_x .k{color:cyan}</style>${section}<script>(function(){/*#s_x*/})();</script>`;
    const raw = `Here is the slide:\n\`\`\`html\n${full}\n\`\`\`\nDone!`;
    expect(extractSlideHtml(raw)).toBe(full);
  });

  it("drops markdown fences", () => {
    const raw = "```html\n" + section + "\n```";
    expect(extractSlideHtml(raw)).toBe(section);
  });

  it("returns the raw text when no slide markup is present", () => {
    expect(extractSlideHtml("just prose, no html")).toBe("just prose, no html");
  });
});
