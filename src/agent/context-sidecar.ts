export interface DeckContext {
  sourcePath?: string;
  digest: string[];
  angle: string;
  perSlideExcerpt?: Record<string, string>;
}

/** Serialize a DeckContext to the `*.context.json` sidecar string. */
export function serializeContext(ctx: DeckContext): string {
  return JSON.stringify(ctx, null, 2);
}

/** Parse a sidecar string; null if malformed or missing required fields. */
export function parseContext(raw: string): DeckContext | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.digest) || typeof o.angle !== "string") return null;
  return {
    sourcePath: typeof o.sourcePath === "string" ? o.sourcePath : undefined,
    digest: o.digest.filter((d): d is string => typeof d === "string"),
    angle: o.angle,
    perSlideExcerpt:
      typeof o.perSlideExcerpt === "object" && o.perSlideExcerpt !== null
        ? (o.perSlideExcerpt as Record<string, string>)
        : undefined,
  };
}

/** Conventional sidecar path for an outline file: `<outline>.context.json`. */
export function sidecarPath(outlinePath: string): string {
  return outlinePath.replace(/\.md$/i, "") + ".context.json";
}
