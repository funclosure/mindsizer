// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";
import { NOOP_SINK, ZERO_TIMING, type ProgressSink, type StepCategory } from "./progress";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
  sink?: ProgressSink;
}

/** Author every slide with gathered materials, emitting progress; return sections + warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const sink = deps.sink ?? NOOP_SINK;
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];
  const total = outline.slides.length;
  const deckStart = Date.now();
  const agg: Record<StepCategory, number> = { author: 0, revise: 0, render: 0, finalize: 0 };

  for (let index = 0; index < total; index++) {
    const slide = outline.slides[index];
    sink.emit({ type: "slide_start", at: Date.now(), index, total, id: slide.id, title: slide.title });
    const materials = gatherMaterials(slide, outline, deps.context);
    const onPass = (p: { pass: number; modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }) =>
      sink.emit({ type: "render_pass", at: Date.now(), index, id: slide.id, ...p });
    try {
      const built = await buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer }, onPass);
      sections.set(slide.id, built.html);
      for (const w of built.warnings) warnings.push(`${slide.id}: ${w}`);
      const timing = built.timing ?? ZERO_TIMING;
      (Object.keys(agg) as StepCategory[]).forEach((k) => (agg[k] += timing.byCategory[k]));
      sink.emit({ type: "slide_done", at: Date.now(), index, id: slide.id, html: built.html, timing, warnings: built.warnings });
    } catch (e) {
      sink.emit({ type: "slide_failed", at: Date.now(), index, id: slide.id, reason: (e as Error).message });
    }
  }

  sink.emit({ type: "deck_done", at: Date.now(), slides: total, totalMs: Date.now() - deckStart, byCategory: agg });
  return { sections, warnings };
}
