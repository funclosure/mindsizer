import { z } from "zod";
import type { OutlineSlide } from "../outline/types";

export const CritiqueSchema = z.object({
  approved: z.boolean(),
  problems: z.array(z.string()),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export interface CritiqueRequest {
  png: Buffer;
  slide: OutlineSlide;
  overflowPx: number;
}

export interface SlideCritic {
  critique(req: CritiqueRequest): Promise<Critique>;
}

export const CRITIC_BRIEF = [
  "You are a demanding design critic reviewing ONE rendered comprehension slide (1280x720, 16:9). The slide image is attached. Judge it honestly and concretely.",
  "",
  "Approve ONLY if it is genuinely strong on ALL of these:",
  "- FIT: nothing clipped or cut off at any edge; the content sits inside the frame.",
  "- COMPOSITION: fills the frame edge-to-edge — not sparse with an empty half, not cramped/crowded. Balanced.",
  "- HIERARCHY: a clear large title and an obvious focal point; not everything one size; a hero number/visual reads first.",
  "- CLARITY: the ONE idea is SHOWN (a diagram, chart, comparison, stat, or metaphor) — not dumped as a paragraph or a plain bullet list.",
  "- BRAND (Field): dark navy ground, cream text, a single cyan accent; calm instrument-panel feel; NO generic AI-slop (no Inter/Roboto, no purple gradients, no clip-art).",
  "",
  "DEFAULT TO APPROVE. A clear, on-brand slide with a real visual and readable hierarchy passes — do NOT nitpick polish, wording, or minor spacing. Reject ONLY for a problem a viewer would actually notice: content clipped at an edge, a glaringly empty half of the frame, the key point buried as small text with no visual, or off-brand styling (AI-slop). When you do reject, make each problem specific and actionable (e.g. 'the stat 1-2 is small inline text — make it the hero', 'the lower third is empty — enlarge the visual to fill it', 'the caption is clipped at the bottom edge').",
  "",
  'Return JSON ONLY — no prose, no code fence: {"approved": boolean, "problems": string[]}. When approved, problems may be empty.',
].join("\n");

export function critiqueUserText(slide: OutlineSlide, overflowPx: number): string {
  return (
    `Slide title: ${slide.title}\n` +
    `Measured overflow: ${overflowPx}px (0 = fits the 1280x720 frame exactly; >0 means content is clipped).\n` +
    `The rendered slide image is attached. Critique it and return the JSON verdict.`
  );
}
