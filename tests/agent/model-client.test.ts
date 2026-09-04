import { describe, it, expect } from "vitest";
import {
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
  ArtDirectionSchema,
  INSTRUMENTS,
  DeckPlanSchema,
  deckPlanSchema,
} from "../../src/agent/model-client";

describe("agent schemas", () => {
  it("accepts a valid digest and rejects a malformed one", () => {
    expect(
      DigestSchema.parse({ title: "T", keyPoints: ["a"], sourceCharacter: "spec" }),
    ).toBeTruthy();
    expect(() => DigestSchema.parse({ title: "T" })).toThrow();
  });

  it("accepts valid directions", () => {
    expect(
      DirectionsSchema.parse([{ id: "x", label: "L", description: "d" }]),
    ).toHaveLength(1);
  });

  it("accepts a draft deck and rejects an unknown layout", () => {
    expect(
      DraftDeckSchema.parse({
        title: "T",
        slides: [{ title: "A", layout: "analogy", markdown: "b" }],
      }),
    ).toBeTruthy();
    expect(() =>
      DraftDeckSchema.parse({
        title: "T",
        slides: [{ title: "A", layout: "carousel", markdown: "b" }],
      }),
    ).toThrow();
  });

  it("accepts a valid art direction and rejects an off-palette instrument", () => {
    const v = ArtDirectionSchema.parse({
      conceit: "a ledger", motif: "ruled lines",
      slides: [{ role: "intro", instrument: "toggle" }, { role: "formalize", instrument: "slider" }],
    });
    expect(v.slides).toHaveLength(2);
    expect(() =>
      ArtDirectionSchema.parse({ conceit: "x", motif: "y", slides: [{ role: "r", instrument: "hologram" }] }),
    ).toThrow();
    expect(INSTRUMENTS).toContain("none");
  });
});

describe("DeckPlanSchema", () => {
  const slide = { claim: "c", mechanism: "m", device: { kind: "static", resting: "r" } };
  const plan = { direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide, slide] };
  it("accepts direction + a slide array", () => {
    expect(DeckPlanSchema.safeParse(plan).success).toBe(true);
  });
  it("deckPlanSchema(n) rejects a wrong slide count", () => {
    expect(deckPlanSchema(2).safeParse(plan).success).toBe(true);
    const r = deckPlanSchema(3).safeParse(plan);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/3 slides/);
  });
});
