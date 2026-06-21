import { describe, it, expect } from "vitest";
import { CRITIC_BRIEF, critiqueUserText, CritiqueSchema } from "../../src/render/critic-brief";

describe("critic brief", () => {
  it("names the judged dimensions and asks for JSON", () => {
    expect(CRITIC_BRIEF).toContain("FIT");
    expect(CRITIC_BRIEF).toContain("HIERARCHY");
    expect(CRITIC_BRIEF).toContain("CLARITY");
    expect(CRITIC_BRIEF.toLowerCase()).toContain("json");
  });

  it("critiqueUserText includes the title and overflow", () => {
    const t = critiqueUserText(
      { id: "s_x", layout: "plain", title: "My Slide", markdown: "x" },
      42,
    );
    expect(t).toContain("My Slide");
    expect(t).toContain("42px");
  });

  it("CritiqueSchema accepts a verdict and rejects a bad one", () => {
    expect(CritiqueSchema.parse({ approved: true, problems: [] })).toBeTruthy();
    expect(() => CritiqueSchema.parse({ approved: "yes", problems: [] })).toThrow();
  });
});
