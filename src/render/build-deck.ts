// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";
import { NOOP_SINK, ZERO_TIMING, type ProgressSink, type StepCategory } from "./progress";
import { mapPool } from "./pool";
import { withRetry, isRetryableError } from "./retry";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
  sink?: ProgressSink;
  concurrency?: number;                      // default 4; clamped ≥ 1 (1 = sequential)
  sleep?: (ms: number) => Promise<void>;     // retry-backoff seam (default real setTimeout)
  reuse?: Map<string, string>;               // id → saved valid html (from --resume); skips authoring
}

/** Author every slide concurrently (bounded pool) with overload retry, emitting progress. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const sink = deps.sink ?? NOOP_SINK;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: { index: number; text: string }[] = [];
  const total = outline.slides.length;
  const deckStart = Date.now();
  const agg: Record<StepCategory, number> = { author: 0, revise: 0, render: 0, finalize: 0 };

  await mapPool(outline.slides, concurrency, async (slide, index) => {
    const cached = deps.reuse?.get(slide.id);
    if (cached) {
      sections.set(slide.id, cached);
      sink.emit({ type: "slide_reused", at: Date.now(), index, id: slide.id, html: cached });
      return;
    }
    sink.emit({ type: "slide_start", at: Date.now(), index, total, id: slide.id, title: slide.title });
    const materials = gatherMaterials(slide, outline, deps.context);
    const onPass = (p: { pass: number; modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }) =>
      sink.emit({ type: "render_pass", at: Date.now(), index, id: slide.id, ...p });
    try {
      // On an overload retry the whole buildSlide re-runs, so onPass re-fires render_pass from
      // pass 1 — a retried slide's pass counter visibly resets in the log (the slide_retry event
      // emitted between attempts marks the boundary). Expected: we re-author, not resume.
      const built = await withRetry(
        () => buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer }, onPass),
        {
          isRetryable: isRetryableError,
          sleep: deps.sleep,
          onRetry: (attempt, e) =>
            sink.emit({ type: "slide_retry", at: Date.now(), index, id: slide.id, attempt, reason: (e as Error).message }),
        },
      );
      sections.set(slide.id, built.html);
      for (const w of built.warnings) warnings.push({ index, text: `${slide.id}: ${w}` });
      const timing = built.timing ?? ZERO_TIMING;
      (Object.keys(agg) as StepCategory[]).forEach((k) => (agg[k] += timing.byCategory[k]));
      sink.emit({ type: "slide_done", at: Date.now(), index, id: slide.id, html: built.html, timing, warnings: built.warnings });
    } catch (e) {
      sink.emit({ type: "slide_failed", at: Date.now(), index, id: slide.id, reason: (e as Error).message });
    }
  });

  warnings.sort((a, b) => a.index - b.index);
  sink.emit({ type: "deck_done", at: Date.now(), slides: total, totalMs: Date.now() - deckStart, byCategory: agg });
  return { sections, warnings: warnings.map((w) => w.text) };
}
