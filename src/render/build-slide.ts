import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { FitChecker, FitResult } from "./fit-check";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  fit: Pick<FitChecker, "check">;
  maxPasses?: number;
}

export interface BuiltSlide {
  html: string;
  passes: number;
  fits: boolean;
}

/** author → validate section → fit-check → re-author with the problem (capped). Pure of IO. */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const maxPasses = deps.maxPasses ?? 3;
  let html = "";
  let problem: string | undefined;
  let lastFits = false;

  for (let pass = 1; pass <= maxPasses; pass++) {
    const req: AuthorRequest = problem
      ? { slide, deck, fix: { previousHtml: html, problem } }
      : { slide, deck };
    html = await deps.author.authorSlide(req);

    const sectionIssues = validateSlideSection(html, slide.id);
    if (sectionIssues.length > 0) {
      problem = sectionIssues[0].message;
      lastFits = false;
      continue;
    }

    const fit: FitResult = await deps.fit.check(html);
    lastFits = fit.fits;
    if (fit.fits) return { html, passes: pass, fits: true };
    problem = fit.detail;
  }
  return { html, passes: maxPasses, fits: lastFits };
}
