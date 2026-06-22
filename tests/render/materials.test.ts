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
