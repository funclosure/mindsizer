// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
}

/** Author every slide with gathered materials; return sections by id + prefixed warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];

  for (const slide of outline.slides) {
    const materials = gatherMaterials(slide, outline, deps.context);
    const built = await buildSlide(slide, deck, materials, {
      author: deps.author,
      renderer: deps.renderer,
    });
    sections.set(slide.id, built.html);
    for (const w of built.warnings) warnings.push(`${slide.id}: ${w}`);
  }
  return { sections, warnings };
}
