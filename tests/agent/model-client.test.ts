import { describe, it, expect } from "vitest";
import {
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
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
});
