import type { Outline, OutlineSlide } from "../outline/types";
import type { DeckContext } from "../agent/context-sidecar";

export interface SlideMaterials {
  digest: string[];
  angle: string;
  sourceExcerpt?: string;
  neighborTitles: string[];
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
  return {
    digest: ctx?.digest ?? [],
    angle: ctx?.angle ?? "",
    sourceExcerpt: ctx?.perSlideExcerpt?.[slide.id],
    neighborTitles,
  };
}
