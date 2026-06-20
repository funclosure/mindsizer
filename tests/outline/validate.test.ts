import { describe, it, expect } from "vitest";
import { validateOutline, crossValidate } from "../../src/outline/validate";
import type { Outline } from "../../src/outline/types";

function deck(slides: Outline["slides"]): Outline {
  return { meta: { title: "T", purpose: "teach", theme: "field" }, slides };
}

describe("validateOutline", () => {
  it("returns no issues for a valid outline", () => {
    const o = deck([
      { id: "s_a", layout: "analogy", title: "A", markdown: "x" },
    ]);
    expect(validateOutline(o)).toEqual([]);
  });

  it("flags a missing id, duplicate id, missing title, and unknown layout", () => {
    const o = deck([
      { id: "", layout: "analogy", title: "A", markdown: "" },
      { id: "s_dup", layout: "plain", title: "", markdown: "" },
      { id: "s_dup", layout: "wat", title: "C", markdown: "" },
    ]);
    const msgs = validateOutline(o).map((i) => i.message);
    expect(msgs).toContain("slide missing id");
    expect(msgs).toContain("slide missing title (#) heading");
    expect(msgs).toContain("duplicate slide id");
    expect(msgs).toContain("unknown layout: wat");
  });

  it("flags an empty deck title", () => {
    const o: Outline = {
      meta: { title: "", purpose: "teach", theme: "field" },
      slides: [],
    };
    expect(validateOutline(o).map((i) => i.message)).toContain(
      "deck title is empty",
    );
  });
});

describe("crossValidate", () => {
  it("flags missing render files and orphan render files", () => {
    const o = deck([
      { id: "s_a", layout: "plain", title: "A", markdown: "" },
      { id: "s_b", layout: "plain", title: "B", markdown: "" },
    ]);
    const issues = crossValidate(o, ["s_a", "s_orphan"]);
    const byId = issues.map((i) => `${i.slideId}:${i.message}`);
    expect(byId).toContain("s_b:missing render file");
    expect(byId).toContain("s_orphan:orphan render file (id not in outline)");
  });
});
