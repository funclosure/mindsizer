import { describe, it, expect } from "vitest";
import {
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
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
