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

/** The LLM-backed operations of the ingest pipeline (the seam). */
export interface ModelClient {
  digest(sourceText: string): Promise<DigestResult>;
  proposeDirections(digest: DigestResult): Promise<Direction[]>;
  generateOutline(digest: DigestResult, angle: Direction): Promise<DraftDeck>;
}
