import { describe, it, expect } from "vitest";
import { digestPrompt, directionPrompt, outlinePrompt, artDirectionPrompt, planPrompt } from "../../src/agent/prompts";

const digest = {
  title: "Eventual Consistency",
  keyPoints: ["replicas converge", "reads can be stale"],
  sourceCharacter: "technical spec",
};
const angle = { id: "mental-model", label: "the mental model", description: "why it works" };

describe("prompts", () => {
  it("digestPrompt includes the source and asks for JSON only", () => {
    const p = digestPrompt("SOME SOURCE TEXT");
    expect(p.user).toContain("SOME SOURCE TEXT");
    expect(p.system.toLowerCase()).toContain("json only");
  });

  it("directionPrompt includes a key point and asks for teach angles", () => {
    const p = directionPrompt(digest);
    expect(p.user).toContain("replicas converge");
    expect(p.system.toLowerCase()).toContain("json only");
  });

  it("outlinePrompt includes the angle and names the analogy/blockquote convention", () => {
    const p = outlinePrompt(digest, angle);
    expect(p.user).toContain("the mental model");
    expect(p.system).toContain("analogy");
    expect(p.system).toContain(">");
    expect(p.system.toLowerCase()).toContain("json only");
  });

  it("artDirectionPrompt feeds titles + angle and asks for conceit/motif/instrument (titles only)", () => {
    const p = artDirectionPrompt(digest, angle, ["S1", "S2"]);
    expect(p.user).toContain("S1");
    expect(p.user).toContain("S2");
    expect(p.user).toContain("the mental model");
    expect(p.system.toLowerCase()).toContain("conceit");
    expect(p.system.toLowerCase()).toContain("instrument");
    expect(p.user).not.toMatch(/markdown/i);
  });
});

describe("planPrompt", () => {
  const input = {
    sourceText: "FULL SOURCE ESSAY",
    digest,
    angle,
    art: { conceit: "a ledger", motif: "ruled lines" },
    slides: [{ title: "One", markdown: "body one" }, { title: "Two", markdown: "body two" }],
  };
  it("carries the full source, digest, angle, art direction and every slide", () => {
    const p = planPrompt(input);
    expect(p.user).toContain("FULL SOURCE ESSAY");
    expect(p.user).toContain("replicas converge");
    expect(p.user).toContain("the mental model");
    expect(p.user).toContain("a ledger");
    expect(p.user).toContain("1. One");
    expect(p.user).toContain("body two");
  });
  it("states the boundary, the kinds, and the JSON contract", () => {
    const p = planPrompt(input);
    expect(p.system).toContain("mechanism");
    expect(p.system).toContain('"instrument"');
    expect(p.system).toContain("same length and order");
    expect(p.system.toLowerCase()).toContain("json only");
  });
  it("omits the art-direction line when absent", () => {
    const p = planPrompt({ ...input, art: undefined });
    expect(p.user).not.toContain("Art direction");
  });
});
