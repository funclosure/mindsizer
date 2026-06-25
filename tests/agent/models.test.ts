import { describe, it, expect } from "vitest";
import { modelFor } from "../../src/agent/models";

describe("modelFor", () => {
  it("returns judgment-matched defaults per role", () => {
    expect(modelFor("author", {})).toEqual({ model: "claude-opus-4-8", effort: "medium" });
    expect(modelFor("ingest", {})).toEqual({ model: "claude-sonnet-4-6", effort: "medium" });
    expect(modelFor("judge", {})).toEqual({ model: "claude-haiku-4-5-20251001", effort: "low" });
  });
  it("per-role env overrides model + effort", () => {
    expect(modelFor("author", { MINDSIZER_AUTHOR_MODEL: "x", MINDSIZER_AUTHOR_EFFORT: "high" }))
      .toEqual({ model: "x", effort: "high" });
  });
  it("legacy MINDSIZER_MODEL overrides the model for every role", () => {
    expect(modelFor("ingest", { MINDSIZER_MODEL: "legacy" }).model).toBe("legacy");
    expect(modelFor("author", { MINDSIZER_MODEL: "legacy" }).model).toBe("legacy");
  });
  it("a per-role model beats the legacy override", () => {
    expect(modelFor("author", { MINDSIZER_MODEL: "legacy", MINDSIZER_AUTHOR_MODEL: "specific" }).model).toBe("specific");
  });
  it("an invalid effort falls back to the role default", () => {
    expect(modelFor("judge", { MINDSIZER_JUDGE_EFFORT: "ultra" }).effort).toBe("low");
  });
});
