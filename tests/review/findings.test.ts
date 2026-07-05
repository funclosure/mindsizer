import { describe, it, expect } from "vitest";
import { SlideFindingsSchema, CoherenceFindingsSchema } from "../../src/review/findings";

describe("SlideFindingsSchema", () => {
  it("accepts a valid findings payload", () => {
    const v = SlideFindingsSchema.parse({
      findings: [
        { check: "visual", severity: "high", summary: "s", detail: "d", suggestion: "fix" },
        { check: "content", severity: "low", summary: "s2", detail: "d2", suggestion: "fix2" },
      ],
    });
    expect(v.findings).toHaveLength(2);
  });
  it("accepts an empty findings list (slide passes)", () => {
    expect(SlideFindingsSchema.parse({ findings: [] }).findings).toEqual([]);
  });
  it("rejects unknown check kinds and severities", () => {
    expect(() => SlideFindingsSchema.parse({ findings: [{ check: "vibes", severity: "high", summary: "", detail: "", suggestion: "" }] })).toThrow();
    expect(() => SlideFindingsSchema.parse({ findings: [{ check: "visual", severity: "fatal", summary: "", detail: "", suggestion: "" }] })).toThrow();
  });
});

describe("CoherenceFindingsSchema", () => {
  it("accepts findings with a slideId or null", () => {
    const v = CoherenceFindingsSchema.parse({
      findings: [
        { slideId: "s_a", check: "coherence", severity: "medium", summary: "s", detail: "d", suggestion: "x" },
        { slideId: null, check: "coherence", severity: "low", summary: "s", detail: "d", suggestion: "x" },
      ],
    });
    expect(v.findings[1].slideId).toBeNull();
  });
});
