import { describe, it, expect } from "vitest";
import {
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
  ensureSectionId,
} from "../../src/outline/inject";

const SLIDE = `<section data-slide-id="s_intro" data-layout="analogy">
  <h3 class="s-title" data-bind="title">Eventual consistency</h3>
  <p class="s-body" data-bind="concept">Every copy agrees eventually.</p>
  <p class="s-analogy" data-bind="analogy"><b>Office gossip</b> spreads.</p>
  <div class="s-label">think of it like</div>
</section>`;

describe("readBoundRegions", () => {
  it("extracts each data-bind slot's inner HTML", () => {
    const regions = readBoundRegions(SLIDE);
    expect(regions.title).toBe("Eventual consistency");
    expect(regions.concept).toBe("Every copy agrees eventually.");
    expect(regions.analogy).toContain("<b>Office gossip</b>");
  });
});

describe("updateBoundRegions", () => {
  it("updates only the named slots and leaves design untouched", () => {
    const out = updateBoundRegions(SLIDE, { title: "Strong consistency" });
    expect(out).toContain("Strong consistency");
    expect(out).not.toContain("Eventual consistency");
    // unrelated bound content preserved
    expect(out).toContain("Every copy agrees eventually.");
    // design (non-bound) preserved
    expect(out).toContain('class="s-label">think of it like');
    expect(out).toContain('data-layout="analogy"');
  });

  it("ignores slots not present in the slide", () => {
    const out = updateBoundRegions(SLIDE, { nonexistent: "x" });
    expect(out).toContain("Eventual consistency");
  });
});

describe("validateSlideSection", () => {
  it("passes when there is one section with the expected id", () => {
    expect(validateSlideSection(SLIDE, "s_intro")).toEqual([]);
  });

  it("flags an id mismatch", () => {
    const issues = validateSlideSection(SLIDE, "s_other");
    expect(issues.map((i) => i.message)).toContain(
      'data-slide-id "s_intro" != expected "s_other"',
    );
  });

  it("flags when there is not exactly one section", () => {
    const issues = validateSlideSection("<div>no section</div>", "s_x");
    expect(issues[0].message).toContain("expected exactly one");
  });
});

describe("validateSlideSection — interactive slides", () => {
  const ok = `<section data-slide-id="s_x" data-layout="bespoke">hi</section>`;

  it("accepts a section followed by a scoped IIFE script", () => {
    const html = ok + `<script>(function(){document.querySelector('#s_x .k');})();</script>`;
    expect(validateSlideSection(html, "s_x")).toEqual([]);
  });

  it("still accepts a leading style + section (no script)", () => {
    const html = `<style>#s_x .k{color:red}</style>` + ok;
    expect(validateSlideSection(html, "s_x")).toEqual([]);
  });

  it("warns when a script never references the slide id", () => {
    const html = ok + `<script>(function(){document.body.innerHTML='';})();</script>`;
    const issues = validateSlideSection(html, "s_x");
    expect(issues.some((i) => /scope/i.test(i.message))).toBe(true);
  });

  it("still rejects the wrong section id", () => {
    expect(validateSlideSection(`<section data-slide-id="nope">x</section>`, "s_x"))
      .toHaveLength(1);
  });
});

describe("ensureSectionId", () => {
  it("injects id when the section has only data-slide-id", () => {
    const out = ensureSectionId(`<section data-slide-id="s_x" data-layout="bespoke">hi</section>`, "s_x");
    expect(out).toContain('<section id="s_x" data-slide-id="s_x" data-layout="bespoke">');
  });

  it("is idempotent when a standalone id is already present", () => {
    const html = `<section id="s_x" data-slide-id="s_x" data-layout="bespoke">hi</section>`;
    expect(ensureSectionId(html, "s_x")).toBe(html);
  });

  it("leaves a leading <style> and trailing <script> untouched", () => {
    const html = `<style>#s_x .k{color:red}</style><section data-slide-id="s_x" data-layout="bespoke"><b class="k">x</b></section><script>/*#s_x*/</script>`;
    const out = ensureSectionId(html, "s_x");
    expect(out).toContain("<style>#s_x .k{color:red}</style>");
    expect(out).toContain("<script>/*#s_x*/</script>");
    expect(out).toContain('<section id="s_x" data-slide-id="s_x"');
  });

  it("returns the input unchanged when there is no section", () => {
    expect(ensureSectionId(`<div>nope</div>`, "s_x")).toBe(`<div>nope</div>`);
  });
});
