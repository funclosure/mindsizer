import type { Outline, OutlineSlide, SlidePlan } from "../outline/types";
import type { DeckContext } from "../agent/context-sidecar";

export interface SlideMaterials {
  digest: string[];
  angle: string;
  sourceExcerpt?: string;
  neighborTitles: string[];
  conceit?: string;         // whole-deck controlling metaphor (plan front-matter wins, art direction falls back)
  motif?: string;           // shared visual motif (same precedence)
  arc?: string;             // deck-level argument arc (plan front-matter only — art direction has no equivalent)
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
  // Precedence: plan.md front-matter WINS over the sidecar's art direction for conceit/motif —
  // the planning call runs later and sees more, and plan.md is the hand-editable contract, so an
  // edited `direction:` must take effect. `role`/`instrument` have no front-matter equivalent and
  // always come from the sidecar.
  const fm = outline.meta.direction;
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
    conceit: fm?.conceit || dir?.conceit,
    motif: fm?.motif || dir?.motif,
    arc: fm?.arc || undefined,
    role: dir?.roleById?.[slide.id],
    instrument: dir?.instrumentById?.[slide.id],
    otherInstruments,
    plan: slide.plan,
  };
}
