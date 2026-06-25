export interface RetryOpts {
  retries?: number;                       // default 3 (so up to 4 attempts)
  isRetryable?: (e: unknown) => boolean;  // default isOverload
  sleep?: (ms: number) => Promise<void>;  // injected; default real setTimeout
  baseMs?: number;                        // default 2000
  jitter?: () => number;                  // injected; default Math.random; returns [0,1)
  onRetry?: (attempt: number, error: unknown) => void; // 1-based attempt about to be retried
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True for overload / rate-limit errors worth retrying. */
export function isOverload(e: unknown): boolean {
  const s = String((e as { message?: unknown })?.message ?? e).toLowerCase();
  return /\b(429|529)\b/.test(s) || s.includes("overload") || s.includes("rate limit") || s.includes("rate_limit");
}

const USAGE_LIMIT = /(out of\b.*\busage|usage limit|resets \d)/;
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network|content-dud)/;

/** Retry overload + transient network/API errors, but NOT a usage-limit (which won't self-heal). */
export function isRetryableError(e: unknown): boolean {
  const s = String((e as { message?: unknown })?.message ?? e).toLowerCase();
  if (USAGE_LIMIT.test(s)) return false;
  return isOverload(e) || TRANSIENT.test(s);
}

/** Run `fn`, retrying retryable failures with exponential backoff + jitter. `sleep`/`jitter` injected for tests. */
export async function withRetry<R>(fn: () => Promise<R>, opts: RetryOpts = {}): Promise<R> {
  const retries = opts.retries ?? 3;
  const isRetryable = opts.isRetryable ?? isOverload;
  const sleep = opts.sleep ?? defaultSleep;
  const baseMs = opts.baseMs ?? 2000;
  const jitter = opts.jitter ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === retries || !isRetryable(e)) throw e;
      opts.onRetry?.(attempt + 1, e);
      await sleep(Math.round(baseMs * 2 ** attempt + jitter() * baseMs));
    }
  }
  throw lastError; // unreachable (the loop returns or throws), satisfies the type checker
}
