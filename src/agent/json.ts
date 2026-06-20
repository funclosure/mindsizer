import type { ZodType } from "zod";

/**
 * Extract a JSON object/array from model output: strip code fences, then take
 * the span from the first `{`/`[` to the last `}`/`]` (robust to surrounding
 * prose and to braces inside string values).
 */
export function extractJson(text: string): string {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const start = s.search(/[{[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON found in model output");
  }
  return s.slice(start, end + 1);
}

/** Parse + Zod-validate model output. Throws on malformed or invalid JSON. */
export function parseValidated<T>(text: string, schema: ZodType<T>): T {
  return schema.parse(JSON.parse(extractJson(text)));
}
