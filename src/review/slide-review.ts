// src/review/slide-review.ts
import { runAgentic, type AgenticTools, type RenderToolResult } from "../agent/query";
import { modelFor } from "../agent/models";
import { parseValidated } from "../agent/json";
import { SlideFindingsSchema, type SlideFinding } from "./findings";
import type { SlideRenderer } from "../render/fit-check";

/** Hard cap on render calls per review session (resting state + interaction states). */
export const REVIEW_RENDER_CAP = 6;

export interface SlideReviewRequest {
  id: string;
  title: string;
  angle: string;
  digest: string[];
  sourceExcerpt?: string;
  fragment: string;
}

const SYSTEM = [
  "You are mindsizer's slide REVIEWER. You are looking at ONE sealed slide from a finished deck.",
  "You do NOT redesign or rewrite — you report findings a fixer can act on. Empty findings = the slide passes.",
  "",
  "## What to check",
  "VISUAL — the slide must fit 1280x720 with no clipped content; no large dead-space bands; clear hierarchy;",
  "on-theme (calm instrument aesthetic, not a landing page). Look at the screenshot, not just the code.",
  "INTERACTION — read the fragment for controls (buttons, sliders, toggles). Exercise the meaningful ones via",
  "the render tool's `interactions` (click a selector, wait). A control must respond VISIBLY; flag dead controls",
  "and feedback so subtle a presenter would miss it.",
  "CONTENT — compare the slide's claims, examples, numbers and names against the source excerpt and digest.",
  "Flag fabricated specifics, drifted details, and claims the source does not support. Analogies and framing",
  "are the deck's own voice — only flag them when they distort the source's meaning.",
  "",
  "## Severity",
  "high = wrong, broken, or unreadable (content contradicts source; control dead; text clipped).",
  "medium = clearly worth fixing (dead-space band; drifted example; invisible feedback).",
  "low = polish (inconsistent labels, minor crowding).",
  "",
  "## Tools & output",
  "Call `render` FIRST with no arguments to see the slide at rest (the harness already has the slide's html —",
  "never send `html` or `edits`). Then, if the slide has controls, call render again passing only `interactions`.",
  `You have at most ${REVIEW_RENDER_CAP} render calls.`,
  'End with EXACTLY this JSON and nothing else: {"findings": [{"check": "visual"|"interaction"|"content",',
  '"severity": "high"|"medium"|"low", "summary": "<one sentence>", "detail": "<what/where>", "suggestion": "<concrete fix>"}]}',
].join("\n");

function userPrompt(req: SlideReviewRequest): string {
  return (
    `Slide id: ${req.id}\nSlide title: ${req.title}\nDeck angle: ${req.angle}\n\n` +
    `Deck digest:\n${req.digest.map((d) => `- ${d}`).join("\n") || "(none)"}\n\n` +
    (req.sourceExcerpt ? `Source (for content fidelity):\n${req.sourceExcerpt}\n\n` : "No source available — SKIP content-fidelity checks.\n\n") +
    `Sealed slide fragment:\n${req.fragment}`
  );
}

/** Review one sealed slide: look, poke the controls, cross-check content. Findings only. */
export function slideReviewer(renderer: Pick<SlideRenderer, "render">): (req: SlideReviewRequest) => Promise<SlideFinding[]> {
  const choice = modelFor("review");
  return async (req) => {
    const runOnce = async (): Promise<SlideFinding[]> => {
      let renders = 0;
      const tools: AgenticTools = {
        // Always render the SEALED fragment — never whatever html the model may pass. The brief tells
        // it to send no html, but this makes "review the shipped slide, not a rewrite" a guarantee, not a hope.
        render: async (_html, interactions): Promise<RenderToolResult> => {
          if (renders >= REVIEW_RENDER_CAP) {
            return { text: `Render budget reached (${REVIEW_RENDER_CAP}) — write your findings JSON now and do NOT call render again.` };
          }
          renders++;
          const r = await renderer.render(req.fragment, interactions);
          return { images: r.shots };
        },
      };
      const { text } = await runAgentic(SYSTEM, userPrompt(req), tools, choice, { initialHtml: req.fragment });
      return parseValidated(text, SlideFindingsSchema).findings;
    };
    try {
      return await runOnce();
    } catch (e1) {
      try {
        return await runOnce(); // one full retry on parse/transport failure
      } catch (e2) {
        throw new Error(`slide review failed twice — first: ${(e1 as Error).message}; second: ${(e2 as Error).message}`);
      }
    }
  };
}
