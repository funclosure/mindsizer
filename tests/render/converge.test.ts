// tests/render/converge.test.ts
import { describe, it, expect } from "vitest";
import { isCleanCandidate, pickBestCandidate, RENDER_PASS_CAP, FINALIZE_CLEAN, finalizeBudget, type Candidate } from "../../src/render/converge";

const c = (html: string, overflowPx: number, consoleErrors: number): Candidate => ({ html, overflowPx, consoleErrors });

describe("isCleanCandidate", () => {
  it("is clean at overflow ≤ 2 with no console errors", () => {
    expect(isCleanCandidate(c("a", 0, 0))).toBe(true);
    expect(isCleanCandidate(c("a", 2, 0))).toBe(true);
    expect(isCleanCandidate(c("a", 3, 0))).toBe(false);
    expect(isCleanCandidate(c("a", 0, 1))).toBe(false);
  });
});

describe("pickBestCandidate", () => {
  it("returns undefined for no candidates", () => {
    expect(pickBestCandidate([])).toBeUndefined();
  });
  it("prefers fewer console errors, then less overflow", () => {
    const best = pickBestCandidate([c("bad", 0, 2), c("good", 50, 0), c("ok", 10, 0)]);
    expect(best!.html).toBe("ok"); // 0 errors beats 2; among 0-error, 10 < 50
  });
  it("keeps the first-seen on a tie (so an earlier clean pass wins over a later regression)", () => {
    const best = pickBestCandidate([c("clean@4", 0, 0), c("regressed@8", 92, 0)]);
    expect(best!.html).toBe("clean@4");
  });
});

describe("RENDER_PASS_CAP", () => {
  it("is a small positive backstop", () => {
    expect(RENDER_PASS_CAP).toBe(4);
  });
});

describe("finalize messages", () => {
  it("tell the model to reply DONE, not to re-emit the html, and not to render again", () => {
    for (const msg of [FINALIZE_CLEAN, finalizeBudget(RENDER_PASS_CAP)]) {
      expect(msg).toContain("DONE");
      expect(msg).toMatch(/do NOT output the HTML again/);
      expect(msg).toMatch(/do NOT call render again/);
    }
  });
  it("the budget message names the pass cap", () => {
    expect(finalizeBudget(4)).toContain("4 passes");
  });
});
