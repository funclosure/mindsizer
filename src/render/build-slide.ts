// src/render/build-slide.ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection, hasUsableSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { SlideRenderer } from "./fit-check";
import type { SlideMaterials } from "./materials";
import type { PassTiming, SlideTiming } from "./progress";
import { heuristicDud, CONTENT_DUD } from "./content-gate";
import type { TokenUsage } from "../agent/usage";

export interface AuthoredSlide {
  html: string;
  timing?: SlideTiming;
  usage?: TokenUsage;
}

export interface SlideAuthor {
  authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide>;
}

export type SlideJudge = (req: { title: string; angle: string; html: string }) => Promise<{ isDud: boolean; reason: string }>;

export interface BuildSlideDeps {
  author: SlideAuthor;
  renderer?: Pick<SlideRenderer, "render">; // optional final fit-check (warn only)
  judge?: SlideJudge;
}

export interface BuiltSlide {
  html: string;
  fits: boolean;
  warnings: string[];
  timing?: SlideTiming;
  usage?: TokenUsage;
}

/**
 * Invoke the (self-iterating) author, validate the section, optionally run a final
 * non-interactive fit-check. The author owns its own render→look→fix loop and reports
 * per-pass timing via onPass; the shell only validates and warns. Pure of process IO.
 */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  materials: SlideMaterials,
  deps: BuildSlideDeps,
  onPass?: (p: PassTiming) => void,
): Promise<BuiltSlide> {
  const authored = await deps.author.authorSlide({ slide, deck, materials }, onPass);
  const html = authored.html;
  if (!hasUsableSection(html, slide.id)) {
    const got = html.slice(0, 140).replace(/\s+/g, " ").trim();
    throw new Error(`slide ${slide.id}: author produced no usable <section> (got: ${got})`);
  }
  const dud = heuristicDud(html);
  if (dud) throw new Error(`${CONTENT_DUD} ${dud}`);
  if (deps.judge) {
    const verdict = await deps.judge({ title: slide.title, angle: materials.angle, html });
    if (verdict.isDud) throw new Error(`${CONTENT_DUD} ${verdict.reason}`);
  }
  const warnings = validateSlideSection(html, slide.id).map((i) => i.message);

  let fits = true;
  if (deps.renderer && warnings.length === 0) {
    const r = await deps.renderer.render(html);
    fits = r.fits;
    if (!r.fits) warnings.push(`overflows the 16:9 frame by ${r.overflowPx}px`);
    for (const e of r.consoleErrors) warnings.push(`console error: ${e}`);
  }
  return { html, fits, warnings, timing: authored.timing, usage: authored.usage };
}
