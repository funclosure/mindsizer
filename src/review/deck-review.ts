// src/review/deck-review.ts
import { runQuery } from "../agent/query";
import { modelFor } from "../agent/models";
import { parseValidated } from "../agent/json";
import { CoherenceFindingsSchema, type CoherenceFinding } from "./findings";

export interface CoherenceSlide { id: string; title: string; text: string }

const SYSTEM = [
  "You review a slide DECK as a whole (text only — visuals are reviewed elsewhere).",
  "Check: narrative order (does each slide build on the last?), duplicated ideas across slides,",
  "and terminology/label consistency (e.g. mixed kicker conventions, one slide numbering itself).",
  "Report findings only; empty findings = coherent. severity: high = broken narrative,",
  "medium = clear duplication/inconsistency, low = polish.",
  'End with EXACTLY: {"findings": [{"slideId": "<id>"|null, "check": "coherence", "severity": "high"|"medium"|"low",',
  '"summary": "...", "detail": "...", "suggestion": "..."}]} — slideId null for whole-deck findings.',
].join("\n");

/** Text-only whole-deck coherence pass. Fail-open: unparseable reply → no findings.
 * When a `direction` is given, the pass also enforces the deck's controlling metaphor — this is the
 * real cross-slide guarantee behind the (advisory) author-time art-direction hints. */
export async function reviewDeckCoherence(
  deckTitle: string,
  angle: string,
  slides: CoherenceSlide[],
  direction?: { conceit: string; motif: string },
): Promise<CoherenceFinding[]> {
  const directionLine = direction
    ? `\n\nThe deck is meant to hold ONE controlling metaphor: "${direction.conceit}" (visual motif: "${direction.motif}"). Flag any slide that breaks, reverses, or contradicts that metaphor, and any two slides that duplicate the same point.`
    : "";
  const user =
    `Deck: ${deckTitle}\nAngle: ${angle}${directionLine}\n\n` +
    slides.map((s, i) => `## Slide ${i + 1} — ${s.title} (${s.id})\n${s.text}`).join("\n\n");
  try {
    return parseValidated(await runQuery(SYSTEM, user, modelFor("review")), CoherenceFindingsSchema).findings;
  } catch (e) {
    // Fail-open so a flaky coherence call never blocks the run — but leave a breadcrumb so a
    // silent failure is distinguishable from a genuinely coherent deck (which returns [] too).
    process.stderr.write(`· coherence pass skipped (${(e as Error).message})\n`);
    return [];
  }
}
