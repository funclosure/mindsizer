import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outline } from "../outline/types";
import type { ProgressEvent, ProgressSink, SlideTiming } from "../render/progress";
import { sealDeck, placeholderSection } from "./seal";

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Render the end-of-build step breakdown (printed + a sane fallback if totals are zero). */
export function formatBreakdown(
  done: Extract<ProgressEvent, { type: "deck_done" }>,
  slides: { index: number; timing: SlideTiming }[],
): string {
  const c = done.byCategory;
  const stepSum = c.author + c.revise + c.render + c.finalize;
  const overhead = Math.max(0, done.totalMs - stepSum);
  const denom = done.totalMs || 1;
  const pct = (n: number) => `${Math.round((n / denom) * 100)}%`;
  const slowest = [...slides]
    .sort((a, b) => b.timing.totalMs - a.timing.totalMs)
    .slice(0, 3)
    .map((x) => `#${x.index + 1} ${fmtMs(x.timing.totalMs)} (${x.timing.passes.length} passes)`)
    .join(" · ");
  return (
    `build complete — ${done.slides} slides in ${fmtMs(done.totalMs)}\n` +
    `  by step:  revise ${pct(c.revise)} · author ${pct(c.author)} · render ${pct(c.render)} · finalize ${pct(c.finalize)} · overhead ${pct(overhead)}\n` +
    (slowest ? `  slowest:  ${slowest}\n` : "")
  );
}

/**
 * The build's IO sink: writes a structured event log + status snapshot, persists each finished
 * slide, re-seals a partial deck (placeholders for pending slides) so it's openable mid-build,
 * and prints/saves the step breakdown at the end.
 */
export function fileSink(buildDir: string, outline: Outline, outPath: string): ProgressSink {
  mkdirSync(join(buildDir, "slides"), { recursive: true });
  const progressPath = join(buildDir, "progress.jsonl");
  const statusPath = join(buildDir, "status.json");
  const start = Date.now();

  // every slide starts as a placeholder so the partial deck always has the full count
  const sections = new Map<string, string>();
  for (const s of outline.slides) sections.set(s.id, placeholderSection(s));
  const slides: { index: number; timing: SlideTiming }[] = [];
  let doneCount = 0;
  let current: { index: number; total: number; id: string; title: string; pass: number } | null = null;

  const reseal = () => {
    try { writeFileSync(outPath, sealDeck(outline, { sections }), "utf8"); } catch { /* best-effort */ }
  };
  const writeStatus = (lastEvent: string) => {
    try {
      writeFileSync(
        statusPath,
        JSON.stringify({ current, elapsedMs: Date.now() - start, doneCount, lastEvent }, null, 2),
        "utf8",
      );
    } catch { /* best-effort */ }
  };

  reseal(); // initial all-placeholder deck

  return {
    emit(e: ProgressEvent) {
      try { appendFileSync(progressPath, JSON.stringify(e) + "\n"); } catch { /* best-effort */ }

      if (e.type === "slide_start") {
        current = { index: e.index, total: e.total, id: e.id, title: e.title, pass: 0 };
        process.stdout.write(`▶ ${e.index + 1}/${e.total} "${e.title}"\n`);
      } else if (e.type === "render_pass") {
        if (current) current.pass = e.pass;
        process.stdout.write(`   pass ${e.pass} · render ${fmtMs(e.renderMs)} · overflow ${e.overflowPx} · +${fmtMs(e.modelMs)} model\n`);
      } else if (e.type === "slide_done") {
        sections.set(e.id, e.html);
        slides.push({ index: e.index, timing: e.timing });
        doneCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`✓ ${e.index + 1}/${current?.total ?? "?"} done · ${fmtMs(e.timing.totalMs)}\n`);
      } else if (e.type === "slide_failed") {
        doneCount++;
        process.stderr.write(`✗ ${e.index + 1} ${e.id}: ${e.reason}\n`);
      } else if (e.type === "deck_done") {
        reseal();
        try {
          writeFileSync(
            join(buildDir, "timing.json"),
            JSON.stringify({ totalMs: e.totalMs, byCategory: e.byCategory, slides }, null, 2),
            "utf8",
          );
        } catch { /* best-effort */ }
        process.stdout.write("\n" + formatBreakdown(e, slides));
      }

      writeStatus(e.type);
    },
  };
}
