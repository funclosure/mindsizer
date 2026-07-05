import { z } from "zod";

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

const FindingBase = {
  severity: z.enum(SEVERITIES),
  summary: z.string(),
  detail: z.string(),
  suggestion: z.string(),
};

/** One per-slide finding from the visual/interaction/content reviewer. */
export const SlideFindingSchema = z.object({ check: z.enum(["visual", "interaction", "content"]), ...FindingBase });
export type SlideFinding = z.infer<typeof SlideFindingSchema>;
export const SlideFindingsSchema = z.object({ findings: z.array(SlideFindingSchema) });

/** One whole-deck finding from the coherence pass (slideId null = deck-level). */
export const CoherenceFindingSchema = z.object({ slideId: z.string().nullable(), check: z.literal("coherence"), ...FindingBase });
export type CoherenceFinding = z.infer<typeof CoherenceFindingSchema>;
export const CoherenceFindingsSchema = z.object({ findings: z.array(CoherenceFindingSchema) });
