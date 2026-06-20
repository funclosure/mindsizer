import { describe, it, expect } from "vitest";
import { extractSlots } from "../../src/render/slots";

describe("extractSlots", () => {
  it("analogy: first blockquote → analogy (bold preserved), rest → concept", () => {
    const s = extractSlots(
      "analogy",
      "Every copy agrees eventually.\n\n> Like **office gossip**.",
    );
    expect(s.concept).toContain("Every copy agrees eventually");
    expect(s.analogy).toContain("<strong>office gossip</strong>");
    expect(s.analogy).not.toContain("Every copy"); // separation holds
  });

  it("analogy: a list in the concept is not dropped", () => {
    const s = extractSlots("analogy", "- one\n- two\n\n> the analogy");
    expect(s.concept).toContain("<li>one</li>");
    expect(s.analogy).toContain("the analogy");
  });

  it("analogy: no blockquote → empty analogy slot", () => {
    const s = extractSlots("analogy", "Just a concept paragraph.");
    expect(s.analogy).toBe("");
    expect(s.concept).toContain("Just a concept");
  });

  it("plain: whole body → body slot", () => {
    const s = extractSlots("plain", "- a\n- b");
    expect(s.body).toContain("<li>a</li>");
  });

  it("throws for a layout with no slot mapping", () => {
    expect(() => extractSlots("quote", "x")).toThrow(/no slot mapping/);
  });
});
