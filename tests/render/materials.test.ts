import { describe, it, expect } from "vitest";
import { gatherMaterials } from "../../src/render/materials";
import type { Outline } from "../../src/outline/types";
import type { DeckContext } from "../../src/agent/context-sidecar";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "plain", title: "A", markdown: "abody" },
    { id: "s_b", layout: "plain", title: "B", markdown: "bbody" },
    { id: "s_c", layout: "plain", title: "C", markdown: "cbody" },
  ],
};

describe("gatherMaterials", () => {
  it("includes digest, angle, source excerpt, and neighbour titles", () => {
    const ctx: DeckContext = { digest: ["p1"], angle: "lens", perSlideExcerpt: { s_b: "exB" } };
    const m = gatherMaterials(outline.slides[1], outline, ctx);
    expect(m.digest).toEqual(["p1"]);
    expect(m.angle).toBe("lens");
    expect(m.sourceExcerpt).toBe("exB");
    expect(m.neighborTitles).toEqual(["A", "C"]);
  });

  it("degrades gracefully with no context", () => {
    const m = gatherMaterials(outline.slides[0], outline, undefined);
    expect(m.digest).toEqual([]);
    expect(m.angle).toBe("");
    expect(m.sourceExcerpt).toBeUndefined();
    expect(m.neighborTitles).toEqual(["B"]);
  });
});

describe("gatherMaterials — art direction", () => {
  it("carries direction fields and computes otherInstruments minus self", () => {
    const ctx: DeckContext = {
      digest: [], angle: "",
      direction: { conceit: "a ledger", motif: "ruled lines",
        roleById: { s_a: "intro", s_b: "formalize" },
        instrumentById: { s_a: "toggle", s_b: "slider", s_c: "none" } },
    };
    const m = gatherMaterials(outline.slides[0], outline, ctx);
    expect(m.conceit).toBe("a ledger");
    expect(m.motif).toBe("ruled lines");
    expect(m.role).toBe("intro");
    expect(m.instrument).toBe("toggle");
    expect(m.otherInstruments).toEqual(["slider"]); // s_b's slider; s_c 'none' excluded; self excluded
  });
  it("leaves direction fields undefined when the context has none", () => {
    const m = gatherMaterials(outline.slides[0], outline, { digest: [], angle: "" });
    expect(m.conceit).toBeUndefined();
    expect(m.otherInstruments).toBeUndefined();
  });
});
