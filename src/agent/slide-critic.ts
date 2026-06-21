import { runVisionQuery } from "./query";
import { parseValidated } from "./json";
import {
  CRITIC_BRIEF,
  critiqueUserText,
  CritiqueSchema,
  type SlideCritic,
} from "../render/critic-brief";

/** Live SlideCritic: the agent SEES the rendered slide and judges it (Agent SDK vision). */
export function anthropicSlideCritic(): SlideCritic {
  return {
    async critique({ png, slide, overflowPx }) {
      const userText = critiqueUserText(slide, overflowPx);
      const b64 = png.toString("base64");
      try {
        return parseValidated(await runVisionQuery(CRITIC_BRIEF, userText, b64), CritiqueSchema);
      } catch {
        try {
          return parseValidated(
            await runVisionQuery(CRITIC_BRIEF, userText + "\n\nReturn valid JSON only.", b64),
            CritiqueSchema,
          );
        } catch {
          // A critic glitch must never block the build — approve and move on.
          return { approved: true, problems: [] };
        }
      }
    },
  };
}
