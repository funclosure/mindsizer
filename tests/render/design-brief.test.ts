import { describe, it, expect } from "vitest";
import { DESIGN_BRIEF, slideAuthorPrompt } from "../../src/render/design-brief";

const slide = {
  id: "s_demo",
  layout: "analogy" as const,
  title: "Eventual consistency",
  markdown: "Every copy agrees.\n\n> Like office gossip.",
};
const deck = { title: "EC Deck", slideTitles: ["Eventual consistency", "Trade-off"] };

describe("design brief", () => {
  it("DESIGN_BRIEF carries the Field language + output contract", () => {
    expect(DESIGN_BRIEF).toContain("#4DD9E0");
    expect(DESIGN_BRIEF).toContain("Fraunces");
    expect(DESIGN_BRIEF).toContain("data-slide-id");
    expect(DESIGN_BRIEF).toContain("16:9");
    expect(DESIGN_BRIEF.toLowerCase()).toContain("avoid generic");
  });

  it("slideAuthorPrompt includes the slide id, title, content, and deck title", () => {
    const p = slideAuthorPrompt({ slide, deck });
    expect(p.user).toContain("s_demo");
    expect(p.user).toContain("Eventual consistency");
    expect(p.user).toContain("Like office gossip");
    expect(p.user).toContain("EC Deck");
    expect(p.system).toBe(DESIGN_BRIEF);
  });

  it("includes the fix problem + previous html on a revision", () => {
    const p = slideAuthorPrompt({
      slide,
      deck,
      fix: { previousHtml: "<section>old</section>", problem: "overflows by 120px" },
    });
    expect(p.user).toContain("overflows by 120px");
    expect(p.user).toContain("<section>old</section>");
  });
});
