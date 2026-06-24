// tests/render/design-brief.test.ts
import { describe, it, expect } from "vitest";
import { slideAuthorPrompt, IDENTITY_BRIEF, type AuthorRequest } from "../../src/render/design-brief";

const req: AuthorRequest = {
  slide: { id: "s_x", layout: "bespoke", title: "The lens", markdown: "- a\n- b" },
  deck: { title: "Deck", slideTitles: ["intro", "The lens", "end"] },
  materials: {
    digest: ["point one", "point two"],
    angle: "How to think about it",
    sourceExcerpt: "the relevant source span",
    neighborTitles: ["intro", "end"],
  },
};

describe("IDENTITY_BRIEF", () => {
  it("states the instrument-not-landing-page identity, the 16:9 constraint, eyes, and convergence", () => {
    expect(IDENTITY_BRIEF).toMatch(/landing page/i);
    expect(IDENTITY_BRIEF).toMatch(/1280|16:9/);
    expect(IDENTITY_BRIEF).toMatch(/render/i);             // it has eyes
    expect(IDENTITY_BRIEF).toMatch(/clean/i);              // converge: stop when clean
  });
});

describe("slideAuthorPrompt", () => {
  it("uses IDENTITY_BRIEF as the system prompt", () => {
    expect(slideAuthorPrompt(req).system).toBe(IDENTITY_BRIEF);
  });
  it("feeds the author the idea: title, slide id, angle, digest, source excerpt, neighbours", () => {
    const u = slideAuthorPrompt(req).user;
    expect(u).toContain("s_x");
    expect(u).toContain("The lens");
    expect(u).toContain("How to think about it");
    expect(u).toContain("point one");
    expect(u).toContain("the relevant source span");
    expect(u).toContain("intro");
  });
});
