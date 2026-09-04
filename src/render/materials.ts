import type { Outline, OutlineSlide, SlidePlan } from "../outline/types";
import type { DeckContext } from "../agent/context-sidecar";

export interface SlideMaterials {
  digest: string[];
  angle: string;
  sourceExcerpt?: string;
  neighborTitles: string[];
  conceit?: string;         // whole-deck controlling metaphor (art direction)
  motif?: string;           // shared visual motif
  role?: string;            // this slide's job in the deck
  instrument?: string;      // assigned interaction from the palette
  otherInstruments?: string[]; // instruments already claimed by other slides (vary from these)
  plan?: SlidePlan;         // Layer-1 plan (plan.md) — implement it, don't re-plan
}

/** Per-slide context handed to the author: the idea, not just the bullet. */
export function gatherMaterials(
  slide: OutlineSlide,
  outline: Outline,
  ctx?: DeckContext,
): SlideMaterials {
  const idx = outline.slides.findIndex((s) => s.id === slide.id);
  const neighborTitles = outline.slides
    .filter((_, i) => i === idx - 1 || i === idx + 1)
    .map((s) => s.title);
  const dir = ctx?.direction;
  const fm = outline.meta.direction; // plan.md front-matter — fallback when the sidecar has none
  const otherInstruments = dir
    ? Object.entries(dir.instrumentById)
        .filter(([id, v]) => id !== slide.id && v && v !== "none")
        .map(([, v]) => v)
    : undefined;
  return {
    digest: ctx?.digest ?? [],
    angle: ctx?.angle ?? "",
    sourceExcerpt: ctx?.perSlideExcerpt?.[slide.id],
    neighborTitles,
    conceit: dir?.conceit || fm?.conceit,
    motif: dir?.motif || fm?.motif,
    role: dir?.roleById?.[slide.id],
    instrument: dir?.instrumentById?.[slide.id],
    otherInstruments,
    plan: slide.plan,
  };
}
