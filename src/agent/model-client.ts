import { z } from "zod";

export const DigestSchema = z.object({
  title: z.string(),
  keyPoints: z.array(z.string()),
  sourceCharacter: z.string(),
});
export type DigestResult = z.infer<typeof DigestSchema>;

export const DirectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});
export const DirectionsSchema = z.array(DirectionSchema);
export type Direction = z.infer<typeof DirectionSchema>;

export const DraftSlideSchema = z.object({
  title: z.string(),
  layout: z.enum(["analogy", "plain"]),
  markdown: z.string(),
});
export const DraftDeckSchema = z.object({
  title: z.string(),
  slides: z.array(DraftSlideSchema),
});
export type DraftSlide = z.infer<typeof DraftSlideSchema>;
export type DraftDeck = z.infer<typeof DraftDeckSchema>;

export const INSTRUMENTS = ["slider", "toggle", "stepper", "chart", "dial", "reveal", "map", "none"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

/** Whole-deck art direction: one controlling conceit + shared motif + per-slide role & interaction. */
export const ArtDirectionSchema = z.object({
  conceit: z.string(),
  motif: z.string(),
  slides: z.array(z.object({ role: z.string(), instrument: z.enum(INSTRUMENTS) })),
});
export type DeckDirection = z.infer<typeof ArtDirectionSchema>;

/** The LLM-backed operations of the ingest pipeline (the seam). */
export interface ModelClient {
  digest(sourceText: string): Promise<DigestResult>;
  proposeDirections(digest: DigestResult): Promise<Direction[]>;
  generateOutline(digest: DigestResult, angle: Direction): Promise<DraftDeck>;
  /** Optional: whole-deck art direction. Optional so existing clients/fakes stay valid; ingest guards it. */
  directArt?(digest: DigestResult, angle: Direction, titles: string[]): Promise<DeckDirection>;
}
