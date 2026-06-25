export interface TokenUsage { input: number; output: number; cacheRead: number; cacheCreate: number; }
export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreate: a.cacheCreate + b.cacheCreate,
  };
}

/** Map an SDK `result.usage` object (snake_case) to TokenUsage; missing/non-number fields → 0. */
export function fromSdkUsage(u: unknown): TokenUsage {
  const o = (u ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : 0);
  return {
    input: n("input_tokens"),
    output: n("output_tokens"),
    cacheRead: n("cache_read_input_tokens"),
    cacheCreate: n("cache_creation_input_tokens"),
  };
}

/** All input-side tokens (fresh + cached reads + cache writes). */
export function inputSide(u: TokenUsage): number {
  return u.input + u.cacheRead + u.cacheCreate;
}

/** Fraction of input-side tokens served from cache (0 when none). */
export function cacheHitRatio(u: TokenUsage): number {
  const total = inputSide(u);
  return total ? u.cacheRead / total : 0;
}

/** Compact human token count: 2.1M / 42k / 500. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
