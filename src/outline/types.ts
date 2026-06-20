/** Deck-level metadata, parsed from the outline.md frontmatter. */
export interface DeckMeta {
  title: string;
  purpose: "teach"; // v1 fixed; widens with the reflow roadmap
  theme: string; // v1: "field"
}

/** One slide's canonical content. `markdown` is render-agnostic. */
export interface OutlineSlide {
  id: string; // stable, permanent, e.g. "s_abc12345"
  layout: string; // "analogy" | "build-up" | "quote" | "plain" | "bespoke"
  title: string; // from the `#` heading
  markdown: string; // raw body markdown — canonical content
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
