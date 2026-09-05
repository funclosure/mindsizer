import { describe, it, expect } from "vitest";
import { SlidePlanSchema, PLAN_KINDS, PlanDirectionSchema } from "../../src/outline/plan";

const instrument = {
  claim: "Founders supply the momentum by hand.",
  mechanism: "growth = manual push + self-sustaining term",
  device: { kind: "instrument", operate: "drag a crank", changes: "curve splits", resting: "crank at 40%" },
  aha: "release before the catch → zero",
  data: "m(t) = m(t-1)*(1+r)",
  source: "\"you have to go out and get them\"",
};

describe("SlidePlanSchema", () => {
  it("accepts a full instrument plan", () => {
    expect(SlidePlanSchema.safeParse(instrument).success).toBe(true);
  });
  it("requires operate/changes/aha only for instruments", () => {
    const fig = { claim: "c", mechanism: "m", device: { kind: "figure", resting: "r" } };
    expect(SlidePlanSchema.safeParse(fig).success).toBe(true);
    const bad = { claim: "c", mechanism: "m", device: { kind: "instrument", resting: "r" } };
    const res = SlidePlanSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["device.operate", "device.changes", "aha"]),
    );
  });
  it("rejects an unknown kind and a missing claim", () => {
    expect(SlidePlanSchema.safeParse({ ...instrument, device: { ...instrument.device, kind: "poster" } }).success).toBe(false);
    const { claim: _c, ...noClaim } = instrument;
    expect(SlidePlanSchema.safeParse(noClaim).success).toBe(false);
  });
  it("exposes the closed kind list", () => {
    expect(PLAN_KINDS).toEqual(["instrument", "figure", "comparison", "sequence", "static"]);
  });
});

describe("PlanDirectionSchema", () => {
  it("requires conceit + motif + arc strings", () => {
    expect(PlanDirectionSchema.safeParse({ conceit: "a", motif: "b", arc: "c" }).success).toBe(true);
    expect(PlanDirectionSchema.safeParse({ conceit: "a", motif: "b" }).success).toBe(false);
  });
});
