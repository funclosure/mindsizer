import type { ZodType } from "zod";

/**
 * Extract the first balanced JSON object/array from model output. Strips a code
 * fence if present, then scans from the first `{`/`[` tracking brace depth while
 * respecting string literals (so braces inside string values don't miscount).
 * Returns the first complete top-level structure; surrounding prose and any
 * trailing blocks are ignored.
 */
export function extractJson(text: string): string {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const start = s.search(/[{[]/);
  if (start === -1) throw new Error("no JSON found in model output");

  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced JSON in model output");
}

/** Parse + Zod-validate model output. Throws on malformed or invalid JSON. */
export function parseValidated<T>(text: string, schema: ZodType<T>): T {
  return schema.parse(JSON.parse(extractJson(text)));
}
