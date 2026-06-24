// src/export/build-sink.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outline } from "../outline/types";
import type { ProgressEvent, ProgressSink, SlideTiming } from "../render/progress";
import { sealDeck, placeholderSection } from "./seal";

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export interface BreakdownStats { peakInFlight: number; retries: number; failedCount: number; reused: number; }

/** End-of-build breakdown: category %s are relative to total model-work; headline shows wall-clock + parallel speedup. */
export function formatBreakdown(
  done: Extract<ProgressEvent, { type: "deck_done" }>,
  slides: { index: number; timing: SlideTiming }[],
  stats: BreakdownStats,
): string {
  const c = done.byCategory;
  const work = c.author + c.revise + c.render + c.finalize; // total model-work across slides
  const denom = work || 1;
  const pct = (n: number) => `${Math.round((n / denom) * 100)}%`;
  const speedup = done.totalMs ? work / done.totalMs : 1;
  const slowest = [...slides]
    .sort((a, b) => b.timing.totalMs - a.timing.totalMs)
    .slice(0, 3)
    .map((x) => `#${x.index + 1} ${fmtMs(x.timing.totalMs)} (${x.timing.passes.length} passes)`)
    .join(" · ");
  return (
    `build complete — ${done.slides} slides in ${fmtMs(done.totalMs)}  (work ${fmtMs(work)} · ${speedup.toFixed(1)}× parallel)\n` +
    `  by step:  revise ${pct(c.revise)} · author ${pct(c.author)} · render ${pct(c.render)} · finalize ${pct(c.finalize)}\n` +
    `  peak in-flight: ${stats.peakInFlight} · retries: ${stats.retries} · reused: ${stats.reused} · failed: ${stats.failedCount}\n` +
    (slowest ? `  slowest:  ${slowest}\n` : "")
  );
}

/**
 * The build's IO sink: structured event log + a multi-in-flight status snapshot, persists each
 * finished slide, re-seals a partial deck (placeholders for pending slides), and prints an
 * id-prefixed event stream + the end-of-build breakdown. Concurrency-aware: many slides in flight.
 */
export function fileSink(buildDir: string, outline: Outline, outPath: string): ProgressSink {
  mkdirSync(join(buildDir, "slides"), { recursive: true });
  const progressPath = join(buildDir, "progress.jsonl");
  const statusPath = join(buildDir, "status.json");
  const start = Date.now();

  const sections = new Map<string, string>();
  for (const s of outline.slides) sections.set(s.id, placeholderSection(s));
  const slides: { index: number; timing: SlideTiming }[] = [];
  const inFlight = new Map<number, { index: number; id: string; title: string; pass: number; lastOverflowPx: number }>();
  const total = outline.slides.length;
  let doneCount = 0;
  let failedCount = 0;
  let retries = 0;
  let peakInFlight = 0;
  let reusedCount = 0;

  const reseal = () => {
    try { writeFileSync(outPath, sealDeck(outline, { sections }), "utf8"); } catch { /* best-effort */ }
  };
  const writeStatus = (lastEvent: string) => {
    try {
      writeFileSync(
        statusPath,
        JSON.stringify(
          { total, doneCount, failedCount, peakInFlight, retries, reused: reusedCount, elapsedMs: Date.now() - start, lastEvent, inFlight: [...inFlight.values()] },
          null,
          2,
        ),
        "utf8",
      );
    } catch { /* best-effort */ }
  };

  reseal(); // initial all-placeholder deck

  return {
    emit(e: ProgressEvent) {
      try { appendFileSync(progressPath, JSON.stringify(e) + "\n"); } catch { /* best-effort */ }

      if (e.type === "slide_start") {
        inFlight.set(e.index, { index: e.index, id: e.id, title: e.title, pass: 0, lastOverflowPx: -1 });
        peakInFlight = Math.max(peakInFlight, inFlight.size);
        process.stdout.write(`[#${e.index + 1}] author… "${e.title}"\n`);
      } else if (e.type === "render_pass") {
        const f = inFlight.get(e.index);
        if (f) { f.pass = e.pass; f.lastOverflowPx = e.overflowPx; }
        process.stdout.write(`[#${e.index + 1}] pass ${e.pass} · ovf ${e.overflowPx} · +${fmtMs(e.modelMs)} model\n`);
      } else if (e.type === "slide_retry") {
        retries++;
        process.stdout.write(`[#${e.index + 1}] ⟳ retry ${e.attempt} (${e.reason})\n`);
      } else if (e.type === "slide_reused") {
        sections.set(e.id, e.html);
        doneCount++;
        reusedCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`[#${e.index + 1}] ↺ reused\n`);
      } else if (e.type === "slide_done") {
        inFlight.delete(e.index);
        sections.set(e.id, e.html);
        slides.push({ index: e.index, timing: e.timing });
        doneCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`[#${e.index + 1}] ✓ done · ${fmtMs(e.timing.totalMs)} (${e.timing.passes.length} passes)\n`);
      } else if (e.type === "slide_failed") {
        inFlight.delete(e.index);
        failedCount++;
        process.stderr.write(`[#${e.index + 1}] ✗ ${e.id}: ${e.reason}\n`);
      } else if (e.type === "deck_done") {
        reseal();
        try {
          writeFileSync(
            join(buildDir, "timing.json"),
            JSON.stringify({ totalMs: e.totalMs, byCategory: e.byCategory, slides, peakInFlight, retries, reusedCount, failedCount }, null, 2),
            "utf8",
          );
        } catch { /* best-effort */ }
        process.stdout.write("\n" + formatBreakdown(e, slides, { peakInFlight, retries, failedCount, reused: reusedCount }));
      }

      writeStatus(e.type);
    },
  };
}
