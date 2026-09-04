import { describe, it, expect } from "vitest";
import { modelFor } from "../../src/agent/models";

describe("modelFor", () => {
  it("returns judgment-matched defaults per role", () => {
    expect(modelFor("author", {})).toEqual({ model: "claude-opus-4-8", effort: "medium" });
    expect(modelFor("ingest", {})).toEqual({ model: "claude-opus-4-8", effort: "high" });
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

describe("review role", () => {
  it("defaults to the author-tier model at medium effort", () => {
    expect(modelFor("review", {})).toEqual({ model: "claude-opus-4-8", effort: "medium" });
  });
  it("honors MINDSIZER_REVIEW_MODEL and MINDSIZER_REVIEW_EFFORT", () => {
    expect(modelFor("review", { MINDSIZER_REVIEW_MODEL: "claude-sonnet-5", MINDSIZER_REVIEW_EFFORT: "low" }))
      .toEqual({ model: "claude-sonnet-5", effort: "low" });
  });
  it("falls back to legacy MINDSIZER_MODEL", () => {
    expect(modelFor("review", { MINDSIZER_MODEL: "claude-fable-5" }).model).toBe("claude-fable-5");
  });
});
