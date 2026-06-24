import { describe, it, expect } from "vitest";
import { withRetry, isOverload } from "../../src/render/retry";

const noWait = () => Promise.resolve();

describe("isOverload", () => {
  it("matches overload / rate-limit signatures", () => {
    expect(isOverload(new Error("529 overloaded"))).toBe(true);
    expect(isOverload(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isOverload(new Error("Overloaded"))).toBe(true);
    expect(isOverload(new Error("rate limit exceeded"))).toBe(true);
    expect(isOverload("rate_limit")).toBe(true);
  });
  it("rejects unrelated errors", () => {
    expect(isOverload(new Error("syntax error"))).toBe(false);
    expect(isOverload(new Error("ENOENT"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    let slept = 0;
    const r = await withRetry(async () => 42, { sleep: async () => { slept++; } });
    expect(r).toBe(42);
    expect(slept).toBe(0);
  });

  it("retries a retryable error then succeeds, with exponential backoff", async () => {
    const delays: number[] = [];
    const retried: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => { if (n++ < 2) throw new Error("529 overloaded"); return "ok"; },
      {
        sleep: async (ms) => { delays.push(ms); },
        jitter: () => 0,
        baseMs: 100,
        onRetry: (attempt) => retried.push(attempt),
      },
    );
    expect(r).toBe("ok");
    expect(delays).toEqual([100, 200]); // baseMs*2^0, baseMs*2^1, jitter 0
    expect(retried).toEqual([1, 2]);
  });

  it("gives up after `retries` and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => { calls++; throw new Error("overloaded"); }, { retries: 2, sleep: noWait, jitter: () => 0 }),
    ).rejects.toThrow("overloaded");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    let slept = 0;
    await expect(
      withRetry(async () => { calls++; throw new Error("boom"); }, { sleep: async () => { slept++; } }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
    expect(slept).toBe(0);
  });
});
