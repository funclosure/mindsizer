// eval/lib/sources.ts — eval/sources.json + eval/.cache/manifest.json parsing (pure, unit-tested).
import { readFileSync } from "node:fs";
import { z } from "zod";

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  author: z.string().min(1),
  kind: z.enum(["text", "video"]),
  url: z.string().url(),
  local: z.string().optional(),
  person: z.string().optional(),
  fetch_hint: z.string().optional(),
  genre: z.string().optional(),
  stress: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const SourcesFileSchema = z
  .object({ _note: z.string().optional(), sources: z.array(SourceSchema).min(1) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.sources.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", i, "id"], message: `duplicate id ${s.id}` });
      seen.add(s.id);
    });
  });

export function parseSources(json: string): { sources: Source[] } {
  return SourcesFileSchema.parse(JSON.parse(json));
}

export function loadSources(path: string): { sources: Source[] } {
  return parseSources(readFileSync(path, "utf8"));
}

export type ManifestEntry =
  | { status: "ok"; from: string; chars: number; words: number; fetchedAt: string }
  | { status: "unavailable"; reason: string; fetchedAt: string };
export interface Manifest { sources: Record<string, ManifestEntry> }

const EntrySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), from: z.string(), chars: z.number(), words: z.number(), fetchedAt: z.string() }),
  z.object({ status: z.literal("unavailable"), reason: z.string(), fetchedAt: z.string() }),
]);
const ManifestSchema = z.object({ sources: z.record(EntrySchema) });

export function parseManifest(json: string): Manifest {
  return ManifestSchema.parse(JSON.parse(json)) as Manifest;
}

/** Sources whose text fetched, in sources.json order. */
export function fetchableSources(sources: Source[], manifest: Manifest): Source[] {
  return sources.filter((s) => manifest.sources[s.id]?.status === "ok");
}

/** `Author — Title` label passed to `mindsizer plan --source-label`. */
export function sourceLabel(s: Source): string {
  return `${s.author} — ${s.title}`;
}
