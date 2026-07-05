import { describe, it, expect } from "vitest";
import { terminalReport, markdownReport, jsonReport, hasHigh, type ReviewRun } from "../../src/review/report";

const run: ReviewRun = {
  meta: { deck: "/tmp/d.html", source: "/tmp/s.txt", model: "claude-opus-4-8", date: "2026-07-02T00:00:00Z" },
  slides: [
    { id: "s_a", title: "A", findings: [
      { check: "visual", severity: "high", summary: "clipped text", detail: "401px overflow", suggestion: "shrink" },
      { check: "content", severity: "low", summary: "label nit", detail: "…", suggestion: "…" },
    ]},
    { id: "s_b", title: "B", findings: [] },
  ],
  deck: [{ slideId: null, check: "coherence", severity: "medium", summary: "dup idea", detail: "…", suggestion: "…" }],
};

describe("report", () => {
  it("terminal report groups by slide, marks severities, and tallies", () => {
    const t = terminalReport(run);
    expect(t).toContain("s_a");
    expect(t).toMatch(/✗.*clipped text/);
    expect(t).toMatch(/·.*label nit/);
    expect(t).toMatch(/⚠.*dup idea/);
    expect(t).toMatch(/1 high · 1 medium · 1 low/);
    expect(t).toMatch(/s_b.*✓/); // passing slide shown as clean
  });

  it("markdown report includes meta and all findings", () => {
    const m = markdownReport(run);
    expect(m).toContain("claude-opus-4-8");
    expect(m).toContain("401px overflow");
    expect(m).toContain("Deck-level");
  });

  it("json report round-trips the run", () => {
    expect(JSON.parse(jsonReport(run))).toEqual(run);
  });

  it("hasHigh detects high severity anywhere (slides or deck)", () => {
    expect(hasHigh(run)).toBe(true);
    expect(hasHigh({ ...run, slides: [run.slides[1]], deck: [] })).toBe(false);
    expect(hasHigh({ ...run, slides: [], deck: [{ ...run.deck[0], severity: "high" }] })).toBe(true);
  });
});
