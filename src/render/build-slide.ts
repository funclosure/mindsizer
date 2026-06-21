import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { FitChecker, FitResult } from "./fit-check";
import type { SlideCritic } from "./critic-brief";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  fit: Pick<FitChecker, "check">;
  critic?: SlideCritic;
  maxPasses?: number;
}

export interface BuiltSlide {
  html: string;
  passes: number;
  fits: boolean; // overflow within tolerance
  approved: boolean; // overflow OK AND (critic approved, or no critic)
}

/** author → validate → fit-check + (optional) vision critique → re-author with problems (capped). Pure of IO. */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const maxPasses = deps.maxPasses ?? 3;
  let html = "";
  let problem: string | undefined;
  let lastFit: FitResult = { fits: false, overflowPx: 0, detail: "" };

  for (let pass = 1; pass <= maxPasses; pass++) {
    const req: AuthorRequest = problem
      ? { slide, deck, fix: { previousHtml: html, problem } }
      : { slide, deck };
    html = await deps.author.authorSlide(req);

    const sectionIssues = validateSlideSection(html, slide.id);
    if (sectionIssues.length > 0) {
      problem = sectionIssues[0].message;
      lastFit = { fits: false, overflowPx: 0, detail: problem };
      continue;
    }

    lastFit = await deps.fit.check(html);
    const problems: string[] = [];
    if (!lastFit.fits) problems.push(lastFit.detail);
    if (deps.critic && lastFit.png) {
      const verdict = await deps.critic.critique({
        png: lastFit.png,
        slide,
        overflowPx: lastFit.overflowPx,
      });
      if (!verdict.approved) problems.push(...verdict.problems);
    }

    if (problems.length === 0) {
      return { html, passes: pass, fits: true, approved: true };
    }
    problem = problems.join("; ");
  }
  return { html, passes: maxPasses, fits: lastFit.fits, approved: false };
}
