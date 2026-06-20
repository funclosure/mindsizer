import { describe, it, expect } from "vitest";
import { parseOutline } from "../../src/outline/parse";

const SAMPLE = `---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually.

> Like office gossip — everyone hears eventually.

---

<!-- slide id=s_tradeoff layout=build-up -->
# The trade-off

- Instant accuracy vs. always-available
- Eventual consistency picks availability
`;

describe("parseOutline", () => {
  it("parses deck frontmatter into meta", () => {
    const o = parseOutline(SAMPLE);
    expect(o.meta).toEqual({
      title: "Eventual Consistency Explained",
      purpose: "teach",
      theme: "field",
    });
  });

  it("parses each slide's id, layout, and title", () => {
    const o = parseOutline(SAMPLE);
    expect(o.slides.map((s) => s.id)).toEqual(["s_intro", "s_tradeoff"]);
    expect(o.slides.map((s) => s.layout)).toEqual(["analogy", "build-up"]);
    expect(o.slides.map((s) => s.title)).toEqual([
      "Eventual consistency",
      "The trade-off",
    ]);
  });

  it("captures the body markdown without the meta comment or heading", () => {
    const o = parseOutline(SAMPLE);
    expect(o.slides[0].markdown).toContain("Every copy of the data agrees");
    expect(o.slides[0].markdown).toContain("> Like office gossip");
    expect(o.slides[0].markdown).not.toContain("<!-- slide");
    expect(o.slides[0].markdown).not.toContain("# Eventual consistency");
  });

  it("defaults a missing layout to bespoke", () => {
    const o = parseOutline(
      `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_x -->\n# Heading\n\nBody.\n`,
    );
    expect(o.slides[0].layout).toBe("bespoke");
  });
});

describe("parseOutline — robustness", () => {
  it("does not split a slide when --- appears in the body", () => {
    const o = parseOutline(
      `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n` +
        `<!-- slide id=s_x layout=plain -->\n# H\n\nbefore\n\n---\n\nafter\n`,
    );
    expect(o.slides).toHaveLength(1);
    expect(o.slides[0].markdown).toContain("before");
    expect(o.slides[0].markdown).toContain("after");
    expect(o.slides[0].markdown).toContain("---");
  });

  it("still splits real multi-slide decks on --- between slide comments", () => {
    const o = parseOutline(
      `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n` +
        `<!-- slide id=s_a layout=plain -->\n# A\n\naaa\n\n---\n\n` +
        `<!-- slide id=s_b layout=plain -->\n# B\n\nbbb\n`,
    );
    expect(o.slides.map((s) => s.id)).toEqual(["s_a", "s_b"]);
    expect(o.slides[0].markdown).toBe("aaa");
    expect(o.slides[1].markdown).toBe("bbb");
  });
});
