import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSink, formatBreakdown } from "../../src/export/build-sink";
import type { Outline } from "../../src/outline/types";
import type { SlideTiming } from "../../src/render/progress";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const timing: SlideTiming = { totalMs: 100, passes: [], byCategory: { author: 60, revise: 30, render: 5, finalize: 5 } };

describe("fileSink", () => {
  it("writes progress.jsonl, status.json, slide files, and a partial deck as events arrive", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-sink-"));
    const buildDir = join(dir, "out.build");
    const outPath = join(dir, "out.html");
    const sink = fileSink(buildDir, outline, outPath);

    // initial partial deck exists (all placeholders)
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("building");

    sink.emit({ type: "slide_start", at: 1, index: 0, total: 2, id: "s_a", title: "A" });
    sink.emit({ type: "render_pass", at: 2, index: 0, id: "s_a", pass: 1, modelMs: 60, renderMs: 5, overflowPx: 0, consoleErrors: 0 });
    sink.emit({ type: "slide_done", at: 3, index: 0, id: "s_a", html: '<section data-slide-id="s_a" data-layout="bespoke">REAL_A</section>', timing, warnings: [] });

    // status reflects progress
    const status = JSON.parse(readFileSync(join(buildDir, "status.json"), "utf8"));
    expect(status.doneCount).toBe(1);
    // the slide file was written
    expect(readFileSync(join(buildDir, "slides", "s_a.html"), "utf8")).toContain("REAL_A");
    // partial deck now has the real slide A and a placeholder B
    const deck = readFileSync(outPath, "utf8");
    expect(deck).toContain("REAL_A");
    expect(deck).toContain("building");
    // progress log grew
    const lines = readFileSync(join(buildDir, "progress.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).type).toBe("slide_start");

    sink.emit({ type: "deck_done", at: 4, slides: 2, totalMs: 200, byCategory: { author: 120, revise: 60, render: 10, finalize: 5 } });
    expect(existsSync(join(buildDir, "timing.json"))).toBe(true);
  });
});

describe("formatBreakdown", () => {
  it("reports each category as a percentage that includes an overhead remainder", () => {
    const out = formatBreakdown(
      { type: "deck_done", at: 0, slides: 2, totalMs: 200, byCategory: { author: 120, revise: 60, render: 10, finalize: 5 } },
      [],
    );
    expect(out).toMatch(/author/);
    expect(out).toMatch(/revise/);
    expect(out).toMatch(/overhead/); // 200 - 195 = 5 → ~2%
  });
});
