// src/agent/agentic-author.ts
import { runAgentic, type RenderToolResult } from "./query";
import { extractSlideHtml } from "./extract-slide";
import { ensureSectionId, substituteSlideId } from "../outline/inject";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor, AuthoredSlide } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";
import { computeSlideTiming, type PassTiming } from "../render/progress";
import { isCleanCandidate, pickBestCandidate, RENDER_PASS_CAP, FINALIZE_CLEAN, finalizeBudget, type Candidate } from "../render/converge";
import { modelFor } from "./models";

/** Cheap no-op finalize replies allowed after a slide seals, before switching to the budget message. */
const POST_SEAL_GRACE = 3;

/**
 * Live agentic author. The harness governs the render loop: every pass is scored and kept as a
 * candidate; once a render is clean (or the cap is hit) the render tool returns a text "finalize
 * now" signal instead of screenshots; afterward we seal the BEST candidate (not the model's last
 * text), normalized with the section id guaranteed. Times each pass via onPass (unchanged).
 */
export function agenticAuthor(renderer: SlideRenderer, aesthetic?: string): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide> {
      const { system, user } = slideAuthorPrompt(req, aesthetic);
      const startMs = Date.now();
      let lastBoundary = startMs;
      const passes: PassTiming[] = [];
      const candidates: Candidate[] = [];
      let sealed = false;
      let postSealRenders = 0;

      const { text, usage } = await runAgentic(system, user, {
        render: async (html, interactions): Promise<RenderToolResult> => {
          if (sealed) {
            // The slide is already sealed to its best candidate — never re-render (no Playwright,
            // no screenshots, no new candidate). Bounded by the grace counter; SDK max_turns backstops.
            postSealRenders++;
            return { text: postSealRenders < POST_SEAL_GRACE ? FINALIZE_CLEAN : finalizeBudget(RENDER_PASS_CAP) };
          }
          const reqAt = Date.now();
          const modelMs = reqAt - lastBoundary;
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
          const cand: Candidate = { html, overflowPx: r.overflowPx, consoleErrors: r.consoleErrors.length };
          candidates.push(cand);

          if (isCleanCandidate(cand)) {
            sealed = true;
            return { text: FINALIZE_CLEAN };
          }
          if (candidates.length >= RENDER_PASS_CAP) {
            return { text: finalizeBudget(RENDER_PASS_CAP) };
          }
          return { images: r.shots };
        },
      }, modelFor("author"));

      const best = pickBestCandidate(candidates);
      const raw = best ? best.html : text; // fall back to model's final text only if it never rendered
      const finalHtml = ensureSectionId(substituteSlideId(extractSlideHtml(raw), req.slide.id), req.slide.id);
      const timing = computeSlideTiming(startMs, passes, Date.now());
      return { html: finalHtml, timing, usage };
    },
  };
}
