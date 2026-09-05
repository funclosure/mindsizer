import { z } from "zod";

/** The closed set of comprehension devices Layer 1 may assign to a slide. */
export const PLAN_KINDS = ["instrument", "figure", "comparison", "sequence", "static"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

const nonEmpty = z.string().trim().min(1);

/**
 * One slide's plan — what Layer 1 (planning) decides and Layer 2 (visual) implements.
 * `operate`, `changes`, `aha` are mandatory for an instrument, optional otherwise.
 */
export const SlidePlanSchema = z
  .object({
    claim: nonEmpty,
    mechanism: nonEmpty,
    device: z.object({
      kind: z.enum(PLAN_KINDS),
      operate: nonEmpty.optional(),
      changes: nonEmpty.optional(),
      resting: nonEmpty,
    }),
    aha: nonEmpty.optional(),
    data: nonEmpty.optional(),
    source: nonEmpty.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.device.kind !== "instrument") return;
    if (!p.device.operate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["device", "operate"], message: "required for an instrument" });
    if (!p.device.changes) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["device", "changes"], message: "required for an instrument" });
    if (!p.aha) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aha"], message: "required for an instrument" });
  });
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

/** Deck-level direction carried in plan.md front-matter. */
export const PlanDirectionSchema = z.object({ conceit: nonEmpty, motif: nonEmpty, arc: nonEmpty });
export type PlanDirection = z.infer<typeof PlanDirectionSchema>;
