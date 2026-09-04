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
  it("teaches the edits-over-full-html revision habit and the DONE finalize contract", () => {
    const b = identityBrief();
    expect(b).toMatch(/prefer `edits`/);
    expect(b).toMatch(/reply DONE/);
    expect(b).toMatch(/ONLY if you never called `render`/);
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
  it("appends a repair section when a previous attempt was rejected", () => {
    const u = slideAuthorPrompt({ ...req, repair: { html: "<section>the dud</section>", reason: "looks like a debug/probe scaffold" } }).user;
    expect(u).toMatch(/Previous attempt REJECTED/);
    expect(u).toContain("looks like a debug/probe scaffold");
    expect(u).toContain("<section>the dud</section>");
    expect(u).toContain("<<<REJECTED_HTML\n<section>the dud</section>\nREJECTED_HTML>>>");
    expect(u).toMatch(/inert markup/);
  });
  it("has no repair section without a seed", () => {
    expect(slideAuthorPrompt(req).user).not.toMatch(/REJECTED/);
  });
});

describe("slideAuthorPrompt — art direction", () => {
  it("adds advisory art-direction lines when present, and varies instruments", () => {
    const u = slideAuthorPrompt({
      ...req,
      materials: { ...req.materials, conceit: "a ledger", motif: "ruled lines", role: "introduce the tension", instrument: "toggle", otherInstruments: ["slider", "chart"] },
    }).user;
    expect(u).toMatch(/controlling metaphor/i);
    expect(u).toContain("a ledger");
    expect(u).toContain("introduce the tension");
    expect(u).toContain("a toggle");
    expect(u).toContain("slider, chart"); // vary-from list
  });
  it("omits the art-direction lines when absent", () => {
    expect(slideAuthorPrompt(req).user).not.toMatch(/controlling metaphor/i);
  });
});

describe("slideAuthorPrompt — slide plan", () => {
  const plan = {
    claim: "Founders supply momentum by hand.",
    mechanism: "growth = push + momentum",
    device: { kind: "instrument" as const, operate: "drag a crank", changes: "curve splits", resting: "crank at 40%" },
    aha: "release early → zero",
    data: "m(t)=m(t-1)*(1+r)",
    source: "you have to go out and get them",
  };
  it("renders every plan field and tells the author to implement, not re-plan", () => {
    const p = slideAuthorPrompt({ ...req, materials: { ...req.materials, plan } });
    expect(p.user).toContain("## Slide plan");
    for (const s of ["Founders supply momentum", "growth = push", "instrument", "drag a crank", "curve splits", "crank at 40%", "release early", "m(t)=", "go out and get them"]) {
      expect(p.user).toContain(s);
    }
    expect(p.user).toMatch(/implement this plan/i);
    expect(p.user.indexOf("## Slide plan")).toBeLessThan(p.user.indexOf("Slide content (markdown)"));
  });
  it("has no plan block without a plan", () => {
    expect(slideAuthorPrompt(req).user).not.toContain("## Slide plan");
  });
});
