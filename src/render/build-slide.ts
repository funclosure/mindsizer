// src/render/build-slide.ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { SlideRenderer } from "./fit-check";
import type { SlideMaterials } from "./materials";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  renderer?: Pick<SlideRenderer, "render">; // optional final fit-check (warn only)
}

export interface BuiltSlide {
  html: string;
  fits: boolean;     // true unless the final fit-check found overflow
  warnings: string[];
}

/**
 * Invoke the (self-iterating) author, validate the section, optionally run a final
 * non-interactive fit-check. The author owns its own render→look→fix loop; the shell
 * only validates and warns. Pure of process IO.
 */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  materials: SlideMaterials,
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const html = await deps.author.authorSlide({ slide, deck, materials });
  const warnings = validateSlideSection(html, slide.id).map((i) => i.message);

  let fits = true;
  if (deps.renderer && warnings.length === 0) {
    const r = await deps.renderer.render(html);
    fits = r.fits;
    if (!r.fits) warnings.push(`overflows the 16:9 frame by ${r.overflowPx}px`);
    for (const e of r.consoleErrors) warnings.push(`console error: ${e}`);
  }
  return { html, fits, warnings };
}
