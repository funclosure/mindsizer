import { describe, it, expect } from "vitest";
import { serializeContext, parseContext, type DeckContext } from "../../src/agent/context-sidecar";

const ctx: DeckContext = {
  sourcePath: "adolescence.txt",
  digest: ["point one", "point two"],
  angle: "How to think about it",
  perSlideExcerpt: { s_a: "excerpt for a" },
};

describe("context sidecar", () => {
  it("round-trips a DeckContext through JSON", () => {
    expect(parseContext(serializeContext(ctx))).toEqual(ctx);
  });
  it("parseContext returns null on malformed JSON", () => {
    expect(parseContext("{not json")).toBeNull();
  });
  it("parseContext returns null when required fields are missing", () => {
    expect(parseContext(JSON.stringify({ digest: ["x"] }))).toBeNull(); // no angle
  });
});

describe("DeckContext.direction round-trip", () => {
  it("serializes + parses a direction block", () => {
    const withDir: DeckContext = {
      digest: ["a"], angle: "ang",
      direction: { conceit: "a ledger", motif: "ruled lines", roleById: { s_a: "intro" }, instrumentById: { s_a: "toggle" } },
    };
    const back = parseContext(serializeContext(withDir));
    expect(back?.direction?.conceit).toBe("a ledger");
    expect(back?.direction?.instrumentById.s_a).toBe("toggle");
  });
  it("parses an OLD sidecar with no direction (backward compat)", () => {
    const back = parseContext(JSON.stringify({ digest: ["a"], angle: "ang" }));
    expect(back).not.toBeNull();
    expect(back?.direction).toBeUndefined();
  });
});
