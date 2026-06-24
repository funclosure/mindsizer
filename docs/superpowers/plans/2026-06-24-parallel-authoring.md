# Parallel Slide Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author slides concurrently via a bounded worker pool (default 4, configurable) with per-slide overload retry, collapsing build wall-clock from sum-of-slides toward slowest-slide-×-waves.

**Architecture:** Replace the sequential `for` loop in `buildDeck` with `mapPool(slides, concurrency, slide => withRetry(buildSlide))`. Two new pure modules (`pool.ts`, `retry.ts`) are unit-tested; the renderer's launch race is fixed; the sink/console/summary become interleaving-aware (id-prefixed lines, multi-`inFlight` status, work-vs-wall speedup).

**Tech Stack:** TypeScript, Bun, Vitest, Playwright (chromium), Claude Agent SDK.

**Spec:** `docs/superpowers/specs/2026-06-24-parallel-authoring-design.md`.

**Testing convention:** pure logic (`pool`, `retry`) + orchestration/sink with injected fakes → Vitest. `fit-check.ts` stays out of the Vitest graph (not in the render barrel) and is verified by running.

---

## File Structure

**Create**
- `src/render/pool.ts` — `mapPool`, `PoolResult`. Pure, unit-tested.
- `src/render/retry.ts` — `withRetry`, `isOverload`, `RetryOpts`. Pure, unit-tested.
- `tests/render/pool.test.ts`, `tests/render/retry.test.ts`

**Modify**
- `src/render/fit-check.ts` — memoize the browser **launch promise** (launch-race fix).
- `src/render/progress.ts` — add the `slide_retry` event variant.
- `src/render/build-deck.ts` — parallel orchestration (pool + retry, `concurrency`, `sleep` seam, emit `slide_retry`).
- `src/export/build-sink.ts` — multi-`inFlight` status, id-prefixed console, `formatBreakdown` rework.
- `src/cli.ts` — `--concurrency` flag + `MINDSIZER_CONCURRENCY` env, pass into `buildDeck`.
- `tests/render/build-deck.test.ts`, `tests/export/build-sink.test.ts` — extend/update.

---

## Task 1: Worker pool

**Files:**
- Create: `src/render/pool.ts`
- Test: `tests/render/pool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/pool.test.ts
import { describe, it, expect } from "vitest";
import { mapPool } from "../../src/render/pool";

describe("mapPool", () => {
  it("returns [] for empty input", async () => {
    expect(await mapPool([], 3, async () => 1)).toEqual([]);
  });

  it("maps every item, preserving input order, as ok results", async () => {
    const r = await mapPool([1, 2, 3], 2, async (n) => n * 10);
    expect(r).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it("passes the index to fn", async () => {
    const r = await mapPool(["a", "b"], 2, async (_x, i) => i);
    expect(r).toEqual([{ ok: true, value: 0 }, { ok: true, value: 1 }]);
  });

  it("isolates a throwing task without rejecting the batch", async () => {
    const r = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(r[0]).toEqual({ ok: true, value: 1 });
    expect(r[1].ok).toBe(false);
    expect((r[1] as { ok: false; error: unknown }).error).toBeInstanceOf(Error);
    expect(r[2]).toEqual({ ok: true, value: 3 });
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    });
    expect(peak).toBe(2);
  });

  it("clamps a concurrency below 1 up to 1", async () => {
    let active = 0;
    let peak = 0;
    await mapPool([1, 2, 3], 0, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    });
    expect(peak).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/pool.ts
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Run `fn` over `items` with at most `concurrency` active at a time. Preserves input order in the
 * result array and NEVER rejects: a task that throws becomes `{ok:false, error}` in its slot, so one
 * bad item can't abort the batch. `concurrency` is clamped to ≥ 1.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: PoolResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/pool.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/pool.ts tests/render/pool.test.ts
git commit -m "feat(render): mapPool — bounded-concurrency map with isolated failures"
```

---

## Task 2: Retry with backoff

**Files:**
- Create: `src/render/retry.ts`
- Test: `tests/render/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/retry.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/retry.ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/retry.ts tests/render/retry.test.ts
git commit -m "feat(render): withRetry + isOverload — per-call overload backoff (injectable sleep/jitter)"
```

---

## Task 3: Renderer launch-race fix

**Files:**
- Modify: `src/render/fit-check.ts`
- Verified-by-running (fit-check stays out of the Vitest graph). Gate: `bunx tsc --noEmit` clean + full suite green.

- [ ] **Step 1: Replace the lazy-browser holder in `playwrightRenderer`.**

The function currently has (around lines 52-56):

```ts
  let browser: Browser | null = null;
  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }
```

Replace with (memoize the *launch promise* so concurrent first-renders share one chromium):

```ts
  let browserP: Promise<Browser> | null = null;
  function getBrowser(): Promise<Browser> {
    if (!browserP) browserP = chromium.launch();
    return browserP;
  }
```

- [ ] **Step 2: Update `dispose` to match.**

The function currently ends with (around lines 96-98):

```ts
    async dispose(): Promise<void> {
      if (browser) { await browser.close(); browser = null; }
    },
```

Replace with:

```ts
    async dispose(): Promise<void> {
      if (browserP) { const b = browserP; browserP = null; await (await b).close(); }
    },
```

- [ ] **Step 3: Typecheck + full unit suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all tests PASS (fit-check isn't imported by the suite; this just confirms no breakage).

- [ ] **Step 4: Commit**

```bash
git add src/render/fit-check.ts
git commit -m "fix(render): memoize the chromium launch promise (concurrency-safe getBrowser)"
```

---

## Task 4: slide_retry progress event

**Files:**
- Modify: `src/render/progress.ts`

- [ ] **Step 1: Add the event variant.** In `src/render/progress.ts`, the `ProgressEvent` union currently ends with the `slide_failed` and `deck_done` variants. Add the `slide_retry` variant to the union (place it right after the `slide_failed` line):

```ts
  | { type: "slide_retry"; at: number; index: number; id: string; attempt: number; reason: string }
```

So the union reads (showing the tail for placement):

```ts
  | { type: "slide_failed"; at: number; index: number; id: string; reason: string }
  | { type: "slide_retry"; at: number; index: number; id: string; attempt: number; reason: string }
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 3: Commit**

```bash
git add src/render/progress.ts
git commit -m "feat(render): add slide_retry progress event"
```

---

## Task 5: Parallel orchestration in buildDeck

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Update the existing failure test to be concurrency-deterministic, and add the new tests.**

In `tests/render/build-deck.test.ts`, REPLACE the existing test (currently lines 66-76):

```ts
  it("emits slide_failed and keeps going when an author throws", async () => {
    let n = 0;
    const author: SlideAuthor = {
      async authorSlide(req) { if (n++ === 0) throw new Error("kaboom"); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink });
    expect(events.some((e) => e.type === "slide_failed")).toBe(true);
    expect(events[events.length - 1].type).toBe("deck_done");
    expect([...r.sections.keys()]).toEqual(["s_b"]); // first failed, second authored
  });
});
```

with these three tests (id-based so they're robust under concurrency) + close the describe:

```ts
  it("isolates a permanently failing slide and finishes the rest", async () => {
    const author: SlideAuthor = {
      async authorSlide(req) { if (req.slide.id === "s_a") throw new Error("boom"); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink, sleep: () => Promise.resolve() });
    expect(events.some((e) => e.type === "slide_failed")).toBe(true);
    expect(events[events.length - 1].type).toBe("deck_done");
    expect([...r.sections.keys()]).toEqual(["s_b"]);
  });

  it("runs at most `concurrency` slides at once", async () => {
    const big: Outline = {
      meta: outline.meta,
      slides: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, layout: "bespoke" as const, title: `T${i}`, markdown: "m" })),
    };
    let active = 0;
    let peak = 0;
    const author: SlideAuthor = {
      async authorSlide(req) {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { html: section(req.slide.id) };
      },
    };
    await buildDeck(big, { author, concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("retries an overloaded slide and recovers", async () => {
    const attempts: Record<string, number> = {};
    const author: SlideAuthor = {
      async authorSlide(req) {
        attempts[req.slide.id] = (attempts[req.slide.id] ?? 0) + 1;
        if (req.slide.id === "s_a" && attempts.s_a < 3) throw new Error("529 overloaded");
        return { html: section(req.slide.id) };
      },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink, sleep: () => Promise.resolve() });
    expect(events.filter((e) => e.type === "slide_retry").length).toBe(2); // s_a failed twice, retried twice
    expect(events.filter((e) => e.type === "slide_done").length).toBe(2);
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — `buildDeck` doesn't accept `concurrency`/`sleep`, doesn't emit `slide_retry`, isn't bounded.

- [ ] **Step 3: Replace the body of `src/render/build-deck.ts`** with the parallel orchestration:

```ts
// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";
import { NOOP_SINK, ZERO_TIMING, type ProgressSink, type StepCategory } from "./progress";
import { mapPool } from "./pool";
import { withRetry, isOverload } from "./retry";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
  sink?: ProgressSink;
  concurrency?: number;                      // default 4; clamped ≥ 1 (1 = sequential)
  sleep?: (ms: number) => Promise<void>;     // retry-backoff seam (default real setTimeout)
}

/** Author every slide concurrently (bounded pool) with overload retry, emitting progress. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const sink = deps.sink ?? NOOP_SINK;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: { index: number; text: string }[] = [];
  const total = outline.slides.length;
  const deckStart = Date.now();
  const agg: Record<StepCategory, number> = { author: 0, revise: 0, render: 0, finalize: 0 };

  await mapPool(outline.slides, concurrency, async (slide, index) => {
    sink.emit({ type: "slide_start", at: Date.now(), index, total, id: slide.id, title: slide.title });
    const materials = gatherMaterials(slide, outline, deps.context);
    const onPass = (p: { pass: number; modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }) =>
      sink.emit({ type: "render_pass", at: Date.now(), index, id: slide.id, ...p });
    try {
      const built = await withRetry(
        () => buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer }, onPass),
        {
          isRetryable: isOverload,
          sleep: deps.sleep,
          onRetry: (attempt, e) =>
            sink.emit({ type: "slide_retry", at: Date.now(), index, id: slide.id, attempt, reason: (e as Error).message }),
        },
      );
      sections.set(slide.id, built.html);
      for (const w of built.warnings) warnings.push({ index, text: `${slide.id}: ${w}` });
      const timing = built.timing ?? ZERO_TIMING;
      (Object.keys(agg) as StepCategory[]).forEach((k) => (agg[k] += timing.byCategory[k]));
      sink.emit({ type: "slide_done", at: Date.now(), index, id: slide.id, html: built.html, timing, warnings: built.warnings });
    } catch (e) {
      sink.emit({ type: "slide_failed", at: Date.now(), index, id: slide.id, reason: (e as Error).message });
    }
  });

  warnings.sort((a, b) => a.index - b.index);
  sink.emit({ type: "deck_done", at: Date.now(), slides: total, totalMs: Date.now() - deckStart, byCategory: agg });
  return { sections, warnings: warnings.map((w) => w.text) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Full suite + typecheck**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): parallel slide authoring — bounded pool + overload retry"
```

---

## Task 6: Interleaving-aware sink

**Files:**
- Modify: `src/export/build-sink.ts`
- Test: `tests/export/build-sink.test.ts`

- [ ] **Step 1: Update the `formatBreakdown` test** (the existing one asserts the old wall-clock `overhead` term). In `tests/export/build-sink.test.ts`, REPLACE the `describe("formatBreakdown", …)` block (currently lines 52-62) with:

```ts
describe("formatBreakdown", () => {
  it("reports categories relative to model-work and a parallel speedup", () => {
    const out = formatBreakdown(
      { type: "deck_done", at: 0, slides: 2, totalMs: 100, byCategory: { author: 120, revise: 60, render: 10, finalize: 10 } },
      [],
      { peakInFlight: 4, retries: 1, failedCount: 0 },
    );
    // work = 200 model-ms, wall = 100 → 2.0× parallel; revise 60/200 = 30%
    expect(out).toMatch(/2\.0×/);
    expect(out).toMatch(/revise 30%/);
    expect(out).toMatch(/peak in-flight: 4/);
    expect(out).toMatch(/retries: 1/);
    expect(out).not.toMatch(/overhead/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: FAIL — `formatBreakdown` takes 2 args / prints `overhead`.

- [ ] **Step 3: Replace the body of `src/export/build-sink.ts`** with the interleaving-aware sink:

```ts
// src/export/build-sink.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outline } from "../outline/types";
import type { ProgressEvent, ProgressSink, SlideTiming } from "../render/progress";
import { sealDeck, placeholderSection } from "./seal";

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export interface BreakdownStats { peakInFlight: number; retries: number; failedCount: number; }

/** End-of-build breakdown: category %s are relative to total model-work; headline shows wall-clock + parallel speedup. */
export function formatBreakdown(
  done: Extract<ProgressEvent, { type: "deck_done" }>,
  slides: { index: number; timing: SlideTiming }[],
  stats: BreakdownStats,
): string {
  const c = done.byCategory;
  const work = c.author + c.revise + c.render + c.finalize; // total model-work across slides
  const denom = work || 1;
  const pct = (n: number) => `${Math.round((n / denom) * 100)}%`;
  const speedup = done.totalMs ? work / done.totalMs : 1;
  const slowest = [...slides]
    .sort((a, b) => b.timing.totalMs - a.timing.totalMs)
    .slice(0, 3)
    .map((x) => `#${x.index + 1} ${fmtMs(x.timing.totalMs)} (${x.timing.passes.length} passes)`)
    .join(" · ");
  return (
    `build complete — ${done.slides} slides in ${fmtMs(done.totalMs)}  (work ${fmtMs(work)} · ${speedup.toFixed(1)}× parallel)\n` +
    `  by step:  revise ${pct(c.revise)} · author ${pct(c.author)} · render ${pct(c.render)} · finalize ${pct(c.finalize)}\n` +
    `  peak in-flight: ${stats.peakInFlight} · retries: ${stats.retries} · failed: ${stats.failedCount}\n` +
    (slowest ? `  slowest:  ${slowest}\n` : "")
  );
}

/**
 * The build's IO sink: structured event log + a multi-in-flight status snapshot, persists each
 * finished slide, re-seals a partial deck (placeholders for pending slides), and prints an
 * id-prefixed event stream + the end-of-build breakdown. Concurrency-aware: many slides in flight.
 */
export function fileSink(buildDir: string, outline: Outline, outPath: string): ProgressSink {
  mkdirSync(join(buildDir, "slides"), { recursive: true });
  const progressPath = join(buildDir, "progress.jsonl");
  const statusPath = join(buildDir, "status.json");
  const start = Date.now();

  const sections = new Map<string, string>();
  for (const s of outline.slides) sections.set(s.id, placeholderSection(s));
  const slides: { index: number; timing: SlideTiming }[] = [];
  const inFlight = new Map<number, { index: number; id: string; title: string; pass: number; lastOverflowPx: number }>();
  const total = outline.slides.length;
  let doneCount = 0;
  let failedCount = 0;
  let retries = 0;
  let peakInFlight = 0;

  const reseal = () => {
    try { writeFileSync(outPath, sealDeck(outline, { sections }), "utf8"); } catch { /* best-effort */ }
  };
  const writeStatus = (lastEvent: string) => {
    try {
      writeFileSync(
        statusPath,
        JSON.stringify(
          { total, doneCount, failedCount, peakInFlight, retries, elapsedMs: Date.now() - start, lastEvent, inFlight: [...inFlight.values()] },
          null,
          2,
        ),
        "utf8",
      );
    } catch { /* best-effort */ }
  };

  reseal(); // initial all-placeholder deck

  return {
    emit(e: ProgressEvent) {
      try { appendFileSync(progressPath, JSON.stringify(e) + "\n"); } catch { /* best-effort */ }

      if (e.type === "slide_start") {
        inFlight.set(e.index, { index: e.index, id: e.id, title: e.title, pass: 0, lastOverflowPx: -1 });
        peakInFlight = Math.max(peakInFlight, inFlight.size);
        process.stdout.write(`[#${e.index + 1}] author… "${e.title}"\n`);
      } else if (e.type === "render_pass") {
        const f = inFlight.get(e.index);
        if (f) { f.pass = e.pass; f.lastOverflowPx = e.overflowPx; }
        process.stdout.write(`[#${e.index + 1}] pass ${e.pass} · ovf ${e.overflowPx} · +${fmtMs(e.modelMs)} model\n`);
      } else if (e.type === "slide_retry") {
        retries++;
        process.stdout.write(`[#${e.index + 1}] ⟳ retry ${e.attempt} (${e.reason})\n`);
      } else if (e.type === "slide_done") {
        inFlight.delete(e.index);
        sections.set(e.id, e.html);
        slides.push({ index: e.index, timing: e.timing });
        doneCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`[#${e.index + 1}] ✓ done · ${fmtMs(e.timing.totalMs)} (${e.timing.passes.length} passes)\n`);
      } else if (e.type === "slide_failed") {
        inFlight.delete(e.index);
        failedCount++;
        process.stderr.write(`[#${e.index + 1}] ✗ ${e.id}: ${e.reason}\n`);
      } else if (e.type === "deck_done") {
        reseal();
        try {
          writeFileSync(
            join(buildDir, "timing.json"),
            JSON.stringify({ totalMs: e.totalMs, byCategory: e.byCategory, slides, peakInFlight, retries, failedCount }, null, 2),
            "utf8",
          );
        } catch { /* best-effort */ }
        process.stdout.write("\n" + formatBreakdown(e, slides, { peakInFlight, retries, failedCount }));
      }

      writeStatus(e.type);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: PASS (the existing `fileSink` test still passes — `status.doneCount` and `timing.json` are unchanged; the updated `formatBreakdown` test passes).

- [ ] **Step 5: Full suite + typecheck**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/export/build-sink.ts tests/export/build-sink.test.ts
git commit -m "feat(export): interleaving-aware sink — id-prefixed stream, multi-inflight status, speedup summary"
```

---

## Task 7: CLI --concurrency flag

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Parse the flag + env in `runBuild`.** In `src/cli.ts`, find the `runBuild` declarations (currently lines 151-153):

```ts
  let input: string | undefined;
  let out: string | undefined;
  let open = false;
```

Replace with (env is the default, the flag overrides):

```ts
  let input: string | undefined;
  let out: string | undefined;
  let open = false;
  const envC = Number(process.env.MINDSIZER_CONCURRENCY);
  let concurrency = Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4;
```

- [ ] **Step 2: Handle the flag in the arg loop.** In the same `runBuild` arg loop, find the `--open` branch (currently lines 160-161):

```ts
    } else if (a === "--open") {
      open = true;
    } else if (a.startsWith("-")) {
```

Insert a `--concurrency` branch before the catch-all `-`:

```ts
    } else if (a === "--open") {
      open = true;
    } else if (a === "--concurrency" || a === "-c") {
      const v = Number(args[++k]);
      if (!Number.isFinite(v) || v < 1) fail("--concurrency requires an integer ≥ 1");
      concurrency = Math.floor(v);
    } else if (a.startsWith("-")) {
```

- [ ] **Step 3: Pass it into `buildDeck`.** Find the `buildDeck` call (currently line 214):

```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink });
```

Replace with:

```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency });
```

- [ ] **Step 4: Update the usage string.** Find (currently line 169):

```ts
  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open]");
```

Replace with:

```ts
  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open] [--concurrency <n>]");
```

- [ ] **Step 5: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): --concurrency flag + MINDSIZER_CONCURRENCY env (default 4)"
```

---

## Task 8: Live verification

**Files:** none (manual).

- [ ] **Step 1: Build a ≥4-slide outline with concurrency and watch interleaving.**

Use the bundled example (8 slides) or any ≥4-slide outline:

```bash
bun run src/cli.ts build examples/dont-scale.outline.md -o /tmp/par-demo.html --concurrency 4 &
# while running: multiple slides should be in flight at once
cat examples/dont-scale.outline.build/status.json   # expect inFlight.length up to 4
```

Expected: the console shows **interleaved `[#N]` lines from different slides**; `status.json` `inFlight` has multiple entries; `peakInFlight` reaches up to 4.

- [ ] **Step 2: Confirm the speedup + a correct deck.**

Expected end-of-run summary line: `build complete — N slides in <wall>  (work <bigger> · <>1.0>× parallel)` — wall-clock materially below `work`. Then `✓ deck check passed (N slides, 0 console errors)` from the existing post-seal gate. Open `/tmp/par-demo.html` and confirm all slides present, in order.

- [ ] **Step 3: Confirm no chromium leak.**

```bash
pgrep -fl "Chromium|chrome_crashpad|playwright" | wc -l   # after the build exits, expect 0 lingering
```

Expected: no lingering chromium processes after the build completes.

- [ ] **Step 4: Sequential fallback still works.**

```bash
bun run src/cli.ts build examples/dont-scale.outline.md -o /tmp/seq-demo.html --concurrency 1 &
```

Expected: one slide in flight at a time (`peakInFlight: 1` in the summary); behaves like the pre-parallel build.

- [ ] **Step 5: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 6: Commit any fixups.**

```bash
git add -A
git commit -m "chore: parallel-authoring live-verification fixups"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 pool/orchestration → Tasks 1,5; §4 launch race → Task 3; §5A `mapPool` → Task 1; §5B `withRetry`/`isOverload` → Task 2; §5C `slide_retry` → Task 4; §5D build-deck → Task 5; §5E sink (status/console/breakdown) → Task 6; §5F cli flag/env → Task 7; §7 error handling → Tasks 2,5 (retry + isolation) + the existing `verifyDeck` gate (unchanged); §8 testing → unit tasks + Task 8 live; §9 build order → task order; §10 success criteria → Task 8 checks.
- **Refinement vs spec:** `RetryOpts` gained `onRetry` (so `build-deck` can emit `slide_retry` from inside `withRetry`) — additive, doesn't change the spec's other fields. `BuildDeckDeps` gained `sleep` purely as a test seam for retry backoff (defaults to real timers in prod).
- **Type consistency:** `PoolResult`/`mapPool` (Task 1) used in Task 5; `withRetry`/`isOverload`/`RetryOpts.onRetry` (Task 2) used in Task 5; `slide_retry` event (Task 4) emitted in Task 5 and consumed in Task 6; `BreakdownStats` + 3-arg `formatBreakdown` (Task 6) match its single caller (the sink) and the updated test; `concurrency`/`sleep` on `BuildDeckDeps` (Task 5) supplied by the cli (Task 7) and tests.
- **Existing tests preserved:** the `fileSink` test (Task 6) is unchanged-compatible (`doneCount`, `timing.json` intact); only `formatBreakdown`'s test changes (signature + work-relative %). The build-deck failure test is rewritten id-based to stay deterministic under concurrency.
- **Out of scope (later):** adaptive concurrency, token budgeting, live browser streaming.
