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

describe("gatherMaterials — plan", () => {
  const plan = { claim: "c", mechanism: "m", device: { kind: "figure" as const, resting: "r" } };
  it("forwards slide.plan", () => {
    const o: Outline = { ...outline, slides: [{ ...outline.slides[0], plan }, outline.slides[1], outline.slides[2]] };
    expect(gatherMaterials(o.slides[0], o, undefined).plan).toEqual(plan);
  });
  it("uses front-matter direction for conceit/motif when the sidecar has none", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "fm-conceit", motif: "fm-motif", arc: "x" } } };
    const m = gatherMaterials(o.slides[0], o, { digest: [], angle: "" });
    expect(m.conceit).toBe("fm-conceit");
    expect(m.motif).toBe("fm-motif");
  });
  it("prefers front-matter direction over the sidecar's art direction", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "fm", motif: "fm-motif", arc: "x" } } };
    const ctx: DeckContext = { digest: [], angle: "", direction: { conceit: "sc", motif: "sc-motif", roleById: {}, instrumentById: {} } };
    const m = gatherMaterials(o.slides[0], o, ctx);
    expect(m.conceit).toBe("fm");
    expect(m.motif).toBe("fm-motif");
  });
  it("keeps role/instrument from the sidecar even when front-matter wins conceit/motif", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "fm", motif: "fm", arc: "x" } } };
    const ctx: DeckContext = {
      digest: [], angle: "",
      direction: { conceit: "sc", motif: "sc", roleById: { s_a: "intro" }, instrumentById: { s_a: "toggle", s_b: "slider" } },
    };
    const m = gatherMaterials(o.slides[0], o, ctx);
    expect(m.role).toBe("intro");
    expect(m.instrument).toBe("toggle");
    expect(m.otherInstruments).toEqual(["slider"]);
  });
  it("falls through to the sidecar when front-matter conceit/motif are empty strings", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "", motif: "", arc: "x" } as never } };
    const ctx: DeckContext = { digest: [], angle: "", direction: { conceit: "sc-conceit", motif: "sc-motif", roleById: {}, instrumentById: {} } };
    const m = gatherMaterials(o.slides[0], o, ctx);
    expect(m.conceit).toBe("sc-conceit");
    expect(m.motif).toBe("sc-motif");
  });
});

describe("gatherMaterials — arc", () => {
  it("carries the deck arc from front-matter direction", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "c", motif: "m", arc: "tension → mechanism → payoff" } } };
    expect(gatherMaterials(o.slides[0], o, undefined).arc).toBe("tension → mechanism → payoff");
  });
  it("is undefined with no front-matter direction (the sidecar has no arc)", () => {
    const ctx: DeckContext = { digest: [], angle: "", direction: { conceit: "c", motif: "m", roleById: {}, instrumentById: {} } };
    expect(gatherMaterials(outline.slides[0], outline, ctx).arc).toBeUndefined();
  });
});
