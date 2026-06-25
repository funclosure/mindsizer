// tests/render/design-brief.test.ts
import { describe, it, expect } from "vitest";
import { slideAuthorPrompt, identityBrief, FIELD_AESTHETIC, type AuthorRequest } from "../../src/render/design-brief";

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

describe("identityBrief", () => {
  it("keeps the universal guidance and injects the given aesthetic", () => {
    const b = identityBrief("## Aesthetic — Test\nbright orange everything.");
    expect(b).toMatch(/landing page/i);   // genre (universal)
    expect(b).toMatch(/1280|16:9/);       // format (universal)
    expect(b).toMatch(/clean/i);          // EYES/converge (universal)
    expect(b).toContain("bright orange everything."); // injected aesthetic
    expect(b).not.toContain("#0a1a2f");   // Field's navy is NOT present
  });
  it("defaults to the Field aesthetic", () => {
    expect(identityBrief()).toContain("#0a1a2f");
    expect(identityBrief()).toBe(identityBrief(FIELD_AESTHETIC));
  });
});

describe("slideAuthorPrompt", () => {
  it("uses identityBrief(aesthetic) as the system prompt", () => {
    const aesthetic = "## Aesthetic — Test\nbright orange.";
    expect(slideAuthorPrompt(req, aesthetic).system).toBe(identityBrief(aesthetic));
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
