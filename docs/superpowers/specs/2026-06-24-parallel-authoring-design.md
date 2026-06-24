# Design: Parallel Slide Authoring

Date: 2026-06-24
Status: Approved (brainstorm) — ready for implementation planning
Builds on: the observability layer (`2026-06-24-build-observability-design.md`) and the converge &
seal-best phase (`2026-06-24-converge-seal-best-design.md`). Motivated by
`MINDSIZER_HARNESS_FINDINGS_2.md` §2/§5: model latency is ~98% of wall-clock and authoring is fully
sequential, so concurrency is the open *latency* lever.

## 1. Context & motivation

Telemetry across two builds is unambiguous: **model latency dominates (~98% of wall-clock)** and
**slides are authored one at a time**. The Benjamin build was 8 slides in 61m19s with the slowest
single slide at 14m. Slides are independent — each authoring session is self-scoped (its own
`runAgentic` session, its own render page, no shared state). So authoring N slides concurrently
collapses wall-clock from *sum of slides* toward *slowest slide × waves*.

The prior phase (converge & seal-best) already cut and bounded per-slide cost. This phase attacks
the remaining big number: total wall-clock, by running a **bounded pool** of concurrent authors.

## 2. Goals / non-goals

Goals:
1. **Author slides concurrently via a bounded worker pool** (default 4, configurable). Deck still
   assembles in outline order regardless of completion order.
2. **Survive overload.** A pool of 4 concurrent Opus sessions on the user's Claude session can hit
   rate-limit / `529 overloaded`. Retry per slide with exponential backoff + jitter; a permanent
   failure is isolated (other slides finish) and surfaces loudly via the existing `verifyDeck` gate.
3. **Keep observability legible under interleaving.** An id-prefixed event stream on the console,
   a multi-in-flight `status.json`, and an end-of-run summary that reports wall-clock vs total
   model-work + the effective parallel speedup.

Non-goals (YAGNI / later):
- Dynamic/adaptive concurrency (auto-tuning the pool from observed latency/backpressure).
- Cross-slide token budgeting.
- Streaming finished slides to an open browser tab live (the partial deck on disk already updates).

## 3. Concurrency model

Replace the sequential `for` loop in `buildDeck` (`src/render/build-deck.ts:36`) with:

```
mapPool(outline.slides, concurrency, async (slide, index) =>
  withRetry(() => buildSlide(slide, deck, gatherMaterials(...), {author, renderer}, onPass),
            { retries: 3, isRetryable: isOverload, sleep })
)
```

- **`concurrency`** = `deps.concurrency ?? 4`, clamped `≥ 1`. `1` reproduces today's sequential
  behavior exactly (a clean debugging / fallback path).
- **`mapPool` never rejects**: each task resolves to `{ok:true,value}` or `{ok:false,error}`, so one
  failing slide can't abort the batch. Results preserve input order (irrelevant here — sections are
  keyed by `id` — but it keeps the primitive general and testable).
- **Events fire per task**, interleaved: `slide_start` when a worker picks up a slide,
  `render_pass` via the existing `onPass`, `slide_retry` on each backoff, then `slide_done` or
  `slide_failed`. The structured log stays correct because every event already carries `index`/`id`.
- **Aggregation is order-independent**: the `byCategory` sums and the per-slide timing list are
  accumulated as tasks complete (addition commutes); warnings are sorted by slide index at the end
  for stable output.

Why a fixed pool of 4 (not unbounded): it captures most of the speedup (~2 waves for 8 slides)
while bounding concurrent-session pressure and the token/cost burst. The number is overridable for
users who want to push it.

## 4. The renderer launch race (must-fix)

`playwrightRenderer.getBrowser()` (`src/render/fit-check.ts:53`) is
`if (!browser) browser = await chromium.launch()` — a check-then-await with no mutual exclusion.
Sequential builds never trip it; with concurrent first-renders two slides both observe
`browser === null`, both launch, and one chromium instance leaks (`dispose` closes only the last
assigned). Fix by memoizing the **launch promise**, not the resolved browser:

```ts
let browserP: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserP) browserP = chromium.launch();
  return browserP;
}
// dispose: if (browserP) { (await browserP).close(); browserP = null; }
```

Page-per-`render()` is already concurrency-safe (a fresh `newPage` per call, closed in `finally`),
so no other renderer change is needed.

## 5. Components & interfaces

### A. Worker pool — `src/render/pool.ts` (pure, unit-tested)
```ts
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown };
/** Run fn over items with at most `concurrency` active; preserve input order; never reject. */
export function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]>;
```
Concurrency is clamped to `≥ 1` internally. Implementation: a shared cursor; `min(concurrency,
items.length)` workers each pull the next index until exhausted; each task is wrapped in
try/catch so a throw becomes `{ok:false}` in the right slot.

### B. Retry with backoff — `src/render/retry.ts` (pure, unit-tested)
```ts
export interface RetryOpts {
  retries?: number;                       // default 3 (so up to 4 attempts)
  isRetryable?: (e: unknown) => boolean;  // default isOverload
  sleep?: (ms: number) => Promise<void>;  // injected; default real setTimeout
  baseMs?: number;                        // default 2000
  jitter?: () => number;                  // injected; default Math.random; returns [0,1)
}
export function withRetry<R>(fn: () => Promise<R>, opts?: RetryOpts): Promise<R>;
export function isOverload(e: unknown): boolean; // matches 429, 529, "overload", "rate limit", "rate_limit"
```
Backoff for attempt `n` (0-based retry index): `baseMs * 2^n + jitter() * baseMs`. A non-retryable
error throws immediately; exhausting `retries` rethrows the last error (→ the slide's task records
`{ok:false}` → `slide_failed`). Both `sleep` and `jitter` are injected so tests are deterministic
and never actually wait: a test passes `sleep` that records delays and `jitter: () => 0` to assert
exact `baseMs * 2^n` backoff. (App code may use `Math.random`/`Date.now` freely — the
determinism ban applies only to Workflow sandbox scripts, not `src/`.)

### C. Progress event — `src/render/progress.ts`
Add one variant to `ProgressEvent`:
```ts
| { type: "slide_retry"; at: number; index: number; id: string; attempt: number; reason: string }
```
`deck_done` is unchanged: its `byCategory` already equals the **total model-work** (sum of every
slide's per-category time), and `totalMs` is wall-clock — exactly the two numbers the summary needs.

### D. Orchestration — `src/render/build-deck.ts`
`BuildDeckDeps` gains `concurrency?: number`. The loop becomes the `mapPool` + `withRetry` form in
§3. The retry callback emits `slide_retry`. `slide_start` is emitted inside the task (real pickup
time). Per-slide try/catch is replaced by the pool's result handling: `{ok:true}` → already emitted
`slide_done` inside `buildSlide`'s wrapper; `{ok:false}` → emit `slide_failed`. (Concretely:
`slide_done`/`slide_failed` emission stays in the orchestrator, driven by the task outcome, as
today — only the loop construct changes.)

### E. Sink (observability) — `src/export/build-sink.ts`
- Replace the single `current` slot with `inFlight: Map<number, {index,id,title,pass,lastOverflowPx}>`
  (keyed by slide index): `slide_start` adds, `render_pass` updates, `slide_done`/`slide_failed`
  removes. Track `peakInFlight` (max map size) and `retries` (count of `slide_retry`).
- Separate `failedCount` from `doneCount` (today `slide_failed` increments `doneCount`).
- **Console: id-prefix every line** so interleaved output stays attributable:
  - `slide_start` → `[#2] author… "Title"`
  - `render_pass` → `[#2] pass 1 · ovf 419 · +1m50s model`
  - `slide_retry` → `[#2] ⟳ retry 1 (overloaded)`
  - `slide_done` → `[#2] ✓ done · 5m27s (2 passes)`
  - `slide_failed` → `[#2] ✗ <reason>` (stderr)
- **`status.json`** new shape:
  `{ total, doneCount, failedCount, peakInFlight, retries, elapsedMs, lastEvent, inFlight: [{index,id,title,pass,lastOverflowPx}] }`.
- **`formatBreakdown` rework** (the percentages must become relative to model-work, not wall-clock —
  under parallelism `stepSum > totalMs`, so dividing by `totalMs` would exceed 100%):
  - `stepSum = author + revise + render + finalize` (= total model-work).
  - category `pct(n) = n / stepSum`  (they sum to ~100% of work; drop the wall-clock "overhead" term,
    which is meaningless once work overlaps).
  - `speedup = stepSum / totalMs` (effective parallelism).
  - headline: `build complete — N slides in <wall>  (work <stepSum> · <speedup>× parallel)`.
  - add a line: `peak in-flight: <peakInFlight> · retries: <retries> · failed: <failedCount>`.
  - keep the `slowest:` top-3 line.
  `formatBreakdown` gains `peakInFlight`, `retries`, `failedCount` params (the sink owns those
  counters); `timing.json` also records them.

### F. CLI — `src/cli.ts`
Parse `--concurrency <n>` (and `MINDSIZER_CONCURRENCY` env; flag wins), default 4, clamp `≥ 1`, and
pass `concurrency` into `buildDeck`'s deps. Nothing else in `runBuild` changes — the post-seal
`verifyDeck` gate already catches a permanently-failed slide (section-count mismatch → non-zero
exit, deck preserved).

## 6. Data flow

```
build → buildDeck(outline, { author, renderer, sink, concurrency })
          mapPool(slides, concurrency, slide =>
            withRetry(buildSlide(...), {isOverload})  // emits slide_start/render_pass/slide_retry
          )                                            // → slide_done | slide_failed per outcome
        → sink: id-prefixed console, multi-inflight status.json, partial-deck reseal (unchanged)
        → deck_done(byCategory=model-work, totalMs=wall) → formatBreakdown(work, wall, speedup, peak, retries)
cli   → verifyDeck(sealedHtml) → count/console/loose-text gate → exit code (unchanged)
```

## 7. Error handling
- Overload (`429`/`529`/"overloaded"/"rate limit") → `withRetry` re-runs the whole slide author
  (the converge cap bounds each attempt), up to 3 retries with backoff; each retry emits
  `slide_retry`.
- Non-retryable error or retries exhausted → `slide_failed`; the pool isolates it and the other
  slides finish. The partial deck keeps that slide's placeholder; `verifyDeck` then trips
  (section-count mismatch) → loud non-zero exit, deck preserved. No silent gaps.
- `mapPool` itself never throws; the orchestrator always reaches `deck_done`.
- Sink writes remain best-effort (wrapped in try/catch as today); emits are synchronous single
  appends on the one JS thread, so concurrent "slides" never interleave a half-line.

## 8. Testing strategy
- **Unit (pure):**
  - `mapPool`: never exceeds `concurrency` simultaneously active (a counter probe with deferred
    promises), preserves input order, isolates a throwing task (`{ok:false}` in its slot while
    others are `{ok:true}`), `concurrency` clamped `≥ 1`, empty input → `[]`.
  - `withRetry`: succeeds first try (no sleep), retries then succeeds, exhausts after `retries` and
    rethrows, does NOT retry a non-retryable error, calls injected `sleep` with growing delays;
    `isOverload` matches 429/529/"overloaded"/"rate limit" and rejects unrelated errors.
- **Unit (orchestration, fakes — no SDK):** extend `build-deck.test.ts` with a fake author that
  records max concurrent invocations → assert the pool bound holds and all slides emit `slide_done`;
  a fake author that throws overload twice then succeeds → asserts `slide_retry`×2 then `slide_done`;
  a fake author that always throws → `slide_failed`, other slides still complete.
- **Unit (sink):** extend `build-sink.test.ts` — interleaved events from two slides produce
  id-prefixed lines and a multi-entry `inFlight`; `formatBreakdown` divides by `stepSum` (percentages
  sum to ~100% even when `stepSum > totalMs`) and reports a `>1×` speedup.
- **Verified-by-running:** a real ≥4-slide build — confirm wall-clock ≪ model-work in the summary,
  the id-prefixed console is legible, `status.json` shows multiple `inFlight`, no chromium leak, and
  the deck assembles in correct order and passes `verifyDeck`.

## 9. Build order (for the plan)
1. `src/render/pool.ts` (`mapPool`, `PoolResult`) + tests.
2. `src/render/retry.ts` (`withRetry`, `isOverload`) + tests.
3. `src/render/fit-check.ts` launch-promise memoization (verified-by-running).
4. `src/render/progress.ts` add `slide_retry` event.
5. `src/render/build-deck.ts` parallel orchestration (pool + retry, `concurrency`, emit
   `slide_retry`) + extended `build-deck.test.ts`.
6. `src/export/build-sink.ts` multi-inflight status, id-prefixed console, `formatBreakdown` rework
   (work-relative %, speedup, peak/retries/failed) + extended `build-sink.test.ts`.
7. `src/cli.ts` `--concurrency` flag + `MINDSIZER_CONCURRENCY` env, pass into `buildDeck`.
8. Live verification on a ≥4-slide outline.

## 10. Success criteria
- A ≥4-slide build runs up to `concurrency` slides at once (visible as multiple `inFlight` in
  `status.json` and interleaved id-prefixed console lines), and wall-clock is materially below the
  sum of per-slide times — the summary reports a `>1×` parallel speedup.
- The deck assembles in correct outline order and passes `verifyDeck`.
- An overload on one slide triggers `slide_retry` and recovers without failing the build; a
  permanent failure is isolated (others finish) and trips the deck-check gate loudly.
- No chromium process leak under concurrency.
- `tsc` clean; the pure pieces (`mapPool`, `withRetry`, `isOverload`) and the orchestration/sink
  fakes are green under unit tests.
