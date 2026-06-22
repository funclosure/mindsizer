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
