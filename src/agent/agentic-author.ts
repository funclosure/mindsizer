// src/agent/agentic-author.ts
import { runAgentic } from "./query";
import { extractSlideHtml } from "./extract-slide";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor, AuthoredSlide } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";
import { computeSlideTiming, type PassTiming } from "../render/progress";

/**
 * Live agentic author: hands the model the materials + identity brief and a bounded
 * `render` tool, lets it self-iterate on its own screenshots, returns the final slide HTML.
 * Times each render pass from the tool-call boundaries and reports them via onPass.
 */
export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide> {
      const { system, user } = slideAuthorPrompt(req);
      const startMs = Date.now();
      let lastBoundary = startMs;
      const passes: PassTiming[] = [];

      const text = await runAgentic(system, user, {
        render: async (html, interactions) => {
          const reqAt = Date.now();
          const modelMs = reqAt - lastBoundary; // author (pass 1) or revise (later)
          const r = await renderer.render(html, interactions);
          const renderMs = Date.now() - reqAt;
          lastBoundary = Date.now();
          const p: PassTiming = {
            pass: passes.length + 1,
            modelMs,
            renderMs,
            overflowPx: r.overflowPx,
            consoleErrors: r.consoleErrors.length,
          };
          passes.push(p);
          onPass?.(p);
          return r.shots;
        },
      });

      const timing = computeSlideTiming(startMs, passes, Date.now());
      return { html: extractSlideHtml(text), timing };
    },
  };
}
