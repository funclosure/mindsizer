import type { SlidePlan, PlanDirection } from "./plan";
export type { SlidePlan, PlanDirection, PlanKind } from "./plan";
export { PLAN_KINDS } from "./plan";

/** Deck-level metadata, parsed from the outline.md frontmatter. */
export interface DeckMeta {
  title: string;
  purpose: "teach"; // v1 fixed; widens with the reflow roadmap
  theme: string; // v1: "field"
  /** Attribution for the source text, rendered as deck chrome. At least one key set when present. */
  source?: { label?: string; url?: string };
  /** Whole-deck direction (plan.md only): controlling conceit, visual motif, argument arc. */
  direction?: PlanDirection;
}

/** One slide's canonical content. `markdown` is render-agnostic. */
export interface OutlineSlide {
  id: string; // stable, permanent, e.g. "s_abc12345"
  layout: string; // "analogy" | "build-up" | "quote" | "plain" | "bespoke"
  title: string; // from the `#` heading
  markdown: string; // raw body markdown — canonical content
  /** Layer-1 plan lifted from the trailing ```plan fence (plan.md only). */
  plan?: SlidePlan;
  /** Set when a ```plan fence was present but not valid YAML; the fence stays in `markdown`. */
  planError?: string;
}

/** The canonical outline: content + order. slides are in deck order. */
export interface Outline {
  meta: DeckMeta;
  slides: OutlineSlide[];
}

/** The set of known library layouts plus the bespoke escape. */
export const KNOWN_LAYOUTS = [
  "analogy",
  "build-up",
  "quote",
  "plain",
  "bespoke",
] as const;
