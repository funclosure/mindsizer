import type { Outline } from "../outline/types";
import { buildSlide, type BuildSlideDeps } from "./build-slide";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

/** Author + fit-check every slide; return the sections by id, plus non-fit warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildSlideDeps,
): Promise<BuildDeckResult> {
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];

  for (const slide of outline.slides) {
    const built = await buildSlide(slide, deck, deps);
    sections.set(slide.id, built.html);
    if (!built.fits) {
      warnings.push(`${slide.id} did not fit after ${built.passes} passes`);
    }
  }
  return { sections, warnings };
}
