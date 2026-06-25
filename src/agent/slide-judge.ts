// src/agent/slide-judge.ts
import { z } from "zod";
import { runQuery } from "./query";
import { parseValidated } from "./json";
import { modelFor } from "./models";
import type { SlideJudge } from "../render/build-slide";

const VerdictSchema = z.object({ isDud: z.boolean(), reason: z.string() });

/** A cheap Haiku referee: is this slide real on-topic teaching content, or a dud? Fail-open. */
export function slideJudge(): SlideJudge {
  const choice = modelFor("judge");
  return async ({ title, angle, html }) => {
    const system =
      "You are a strict slide reviewer. Decide whether a slide is real, on-topic teaching content " +
      "or a DUD (a placeholder, a debug/probe scaffold, near-empty, or off-topic). Return JSON only.";
    const user =
      `Slide title: ${title}\nDeck angle: ${angle}\n\nSlide HTML:\n${html}\n\n` +
      `Return {"isDud": boolean, "reason": "<one line>"}. isDud=true if it does NOT actually teach "${title}".`;
    try {
      return parseValidated(await runQuery(system, user, choice), VerdictSchema);
    } catch {
      return { isDud: false, reason: "judge unavailable (fail-open)" };
    }
  };
}
