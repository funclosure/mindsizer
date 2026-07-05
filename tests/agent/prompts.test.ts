import { describe, it, expect } from "vitest";
import { digestPrompt, directionPrompt, outlinePrompt, artDirectionPrompt } from "../../src/agent/prompts";

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
