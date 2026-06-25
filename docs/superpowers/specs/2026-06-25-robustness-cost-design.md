# Design: Build Robustness + Cost Observability

Date: 2026-06-25
Status: Approved (brainstorm) — ready for implementation planning
Builds on: resilient builds (`2026-06-24-resilient-builds-design.md`, the retry path) and
build observability. Motivated by a live failure (below).

## 1. Context & motivation

A real 10-slide build **hung**: after slide 7 reached a clean render, the Agent SDK stream
stopped yielding — no error, no result — and `buildSlide` blocked **forever**. `status.json` froze
for 42 minutes; the pool finished the other 9 slides but the build could never complete. We have
retry for *errors* but **no timeout for a silent stall**. Recovery required killing the process and
`--resume` (which worked — it re-authored only slide 7). Two gaps surfaced together:

1. **No timeout on model calls** — a hung `query()` blocks the whole build indefinitely.
2. **No token/cost observability** — the telemetry records time/passes but not tokens, so "how
   many tokens did this build use?" is unanswerable. The SDK's `result` message carries `usage`
   (input / output / cache-read / cache-creation), which we currently read and discard.

The Agent SDK supports both fixes natively: `query()` options accept an `abortController` (cancels
a hung call), and the `result` message carries token `usage`.

## 2. Goals / non-goals

Goals:
1. **Idle-watchdog timeout** on every model call: if no SDK message arrives for `IDLE_TIMEOUT_MS`
   (default 180s), abort the call and throw a **retryable** timeout — so a hang self-heals via the
   existing `withRetry`, and a persistent hang becomes a clean `slide_failed`.
2. **Token capture** for the author session (the dominant cost): per-slide `{input, output,
   cacheRead, cacheCreate}` → a deck total + a summary line with a **cache-hit ratio**.

Non-goals (YAGNI / later):
- A fixed overall per-call cap (the idle watchdog is strictly better — it never kills a
  legitimately long-but-progressing call).
- Capturing ingest + judge tokens into the headline total. They're small (Sonnet one-time + Haiku
  per-slide); v1 reports the **author** tokens (~95%+ of cost) and labels it as such. Extendable.
- Per-render-pass token breakdown (one `query()` session per slide → one result usage; per-slide is
  the natural grain).

## 3. Part A — idle-watchdog timeout

### `src/agent/timeout.ts` (NEW, unit-tested)
```ts
export const IDLE_TIMEOUT_MS = Number(process.env.MINDSIZER_IDLE_TIMEOUT_MS) || 180_000;
export interface Watchdog { kick(): void; stop(): void; readonly fired: boolean; }
/** Start an idle watchdog: calls onIdle() if kick() isn't called within `ms`. */
export function startWatchdog(ms: number, onIdle: () => void): Watchdog;
```
`kick()` resets the timer (call on every SDK message); once it fires it latches (`fired = true`) and
won't fire twice; `stop()` clears it. Implemented with `setTimeout`/`clearTimeout`.

### Wiring in `src/agent/query.ts`
Both `runQuery` and `runAgentic` (their existing stream loops):
```ts
const ac = new AbortController();
const q = query({ prompt, options: { ...optionsObject, abortController: ac } });
const w = startWatchdog(IDLE_TIMEOUT_MS, () => ac.abort());
try {
  for await (const msg of q) {
    w.kick();                       // activity resets the idle timer
    …existing per-message logic…    // (text accumulation / lastSlideTurn / usage capture)
    if (msg.type === "result") break;
  }
} catch (e) {
  if (w.fired) throw new Error(timeoutMsg);   // abort surfaced as an error
  throw e;
} finally { w.stop(); }
if (w.fired) throw new Error(timeoutMsg);      // aborted but loop ended cleanly
return …;
```
where `timeoutMsg = \`model-call timed out — idle ${IDLE_TIMEOUT_MS / 1000}s\``. With
`includePartialMessages: true`, an actively-generating call streams deltas continuously (each
`kick()`s), so only a true stall (no message for 180s) trips it.

### Retry contract — `src/render/retry.ts`
`isRetryableError` adds `timed out` / `timeout` to the retryable `TRANSIENT` set (after the
usage-limit early-return). So a timed-out slide re-authors via `withRetry` (self-heal); a slide that
keeps hanging exhausts the cap → `slide_failed` (loud) — never an infinite block again.

## 4. Part B — token / cost observability

### `src/agent/usage.ts` (NEW, pure, unit-tested)
```ts
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheCreate: number; }
export const ZERO_USAGE: TokenUsage;
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage;       // field-wise sum
export function fromSdkUsage(u: unknown): TokenUsage;                     // map SDK result.usage → TokenUsage (missing → 0)
export function inputSide(u: TokenUsage): number;                        // input + cacheRead + cacheCreate
export function cacheHitRatio(u: TokenUsage): number;                    // cacheRead / inputSide (0 if none)
export function fmtTokens(n: number): string;                           // 2.1M / 42k / 500
```
`fromSdkUsage` reads `input_tokens` / `output_tokens` / `cache_read_input_tokens` /
`cache_creation_input_tokens` (the exact path on the `result` message is confirmed in the
verified-by-running step — likely `msg.usage`).

### Capture — `src/agent/query.ts`
`runAgentic` captures usage at the `result` message and returns it. Its return type changes from
`Promise<string>` to `Promise<{ text: string; usage: TokenUsage }>` (its only caller is
`agenticAuthor`). `runQuery` is left returning `string` (ingest/judge usage is out of scope for v1).

### Thread to telemetry
- `agentic-author.ts`: `const { text, usage } = await runAgentic(...)`; return `usage` on
  `AuthoredSlide`.
- `build-slide.ts`: `AuthoredSlide.usage` → `BuiltSlide.usage`.
- `progress.ts`: `slide_done` gains `usage?: TokenUsage`; `deck_done` gains `usage: TokenUsage`
  (deck total).
- `build-deck.ts`: accumulate per-slide usage into a running total (like `agg`); put it on each
  `slide_done` and the final `deck_done`.
- `build-sink.ts`: track the total; add a summary line and record it in `timing.json`:
  `tokens (author):  <inputSide> in (<cacheRead> cached · NN%) · <output> out`
  using `fmtTokens` + `cacheHitRatio`. Per-slide usage is available in `timing.json` for the heaviest-slide view.

## 5. Data flow

```
runAgentic(author) → result.usage → {text, usage}
  agenticAuthor → AuthoredSlide.usage → buildSlide → BuiltSlide.usage
  buildDeck: sum usage → slide_done.usage + deck_done.usage(total)
  sink: timing.json per-slide + total; summary "tokens (author): … cached NN% …"
every query() (author + ingest + judge): idle watchdog → abort on 180s stall → retryable timeout
```

## 6. Error handling
- Idle stall → `ac.abort()` → loop ends/throws → we throw the timeout error → `isRetryableError`
  true → `withRetry` re-authors → persistent → `slide_failed`. No more infinite block.
- A real abort (e.g., user Ctrl-C) also surfaces through the same path; `w.fired` distinguishes our
  timeout from an external abort (only our watchdog sets `fired`).
- Missing/!partial SDK `usage` fields → `fromSdkUsage` defaults each to 0 (a build with no usage
  data simply reports 0 tokens, never crashes).
- `runQuery` (ingest/judge) gets the timeout but not usage capture — unchanged return type.

## 7. Testing strategy
- **Unit (pure):**
  - `timeout.ts`: `startWatchdog` fires `onIdle` after `ms` with no kicks; does NOT fire while
    kicked repeatedly; latches `fired` and doesn't double-fire; `stop()` prevents firing. (Small
    real timers ~20–60ms.)
  - `usage.ts`: `addUsage` field-wise sum; `fromSdkUsage` maps the 4 SDK keys + defaults missing to
    0; `inputSide`/`cacheHitRatio` math; `fmtTokens` (2.1M / 42k / 500).
  - `retry.ts`: `isRetryableError(new Error("model-call timed out — idle 180s"))` → true.
- **Unit (orchestration with fakes):**
  - `build-deck.ts`: a fake author returning `usage` on its `AuthoredSlide` → `slide_done.usage` is
    emitted and `deck_done.usage` equals the field-wise sum across slides.
  - `build-sink.ts`: a `deck_done` with a known `usage` → `timing.json` records it and the summary
    contains the `tokens (author):` line with the right cache %.
- **Verified-by-running:**
  - A real `build`: confirm the end-of-run `tokens (author):` line appears with a plausible
    cache-hit ratio; confirm the SDK `result.usage` path used by `fromSdkUsage` is correct (log it
    once).
  - Timeout integration: set `MINDSIZER_IDLE_TIMEOUT_MS=1` on a tiny build and confirm the call
    **aborts** (no 42-minute block), emits `slide_retry` from the retryable timeout, and after the
    cap ends as a loud `slide_failed` — proving the no-infinite-block guarantee + the abort/retry
    wiring. (Every attempt aborts at 1ms, so it fails rather than self-heals; a normal threshold lets
    a one-off stall self-heal. The watchdog primitive's timing is covered by the unit test.)

## 8. Build order (for the plan)
Stage A — timeout (the active bug):
1. `timeout.ts` (`startWatchdog`, `IDLE_TIMEOUT_MS`) + tests.
2. `isRetryableError` retries `timed out` + test.
3. `query.ts`: abortController + watchdog on `runQuery` and `runAgentic` (verified-by-running).

Stage B — tokens:
4. `usage.ts` (`TokenUsage`, `addUsage`, `fromSdkUsage`, `inputSide`, `cacheHitRatio`, `fmtTokens`) + tests.
5. `query.ts`: `runAgentic` captures `result.usage` → returns `{text, usage}`.
6. `progress.ts`: `slide_done.usage?` + `deck_done.usage`.
7. `agentic-author.ts` + `build-slide.ts`: thread `usage`.
8. `build-deck.ts`: accumulate usage → `slide_done`/`deck_done`.
9. `build-sink.ts`: total + summary `tokens (author):` line + `timing.json` + tests.
10. Live: token summary + cache ratio on a real build; the `IDLE_TIMEOUT_MS=1` timeout-retry check.

## 9. Success criteria
- A stalled model call aborts within `IDLE_TIMEOUT_MS` and **retries** (self-heals); it can no
  longer block a build indefinitely. (`MINDSIZER_IDLE_TIMEOUT_MS` configurable.)
- The end-of-build summary reports author token usage with a cache-hit ratio; `timing.json` carries
  per-slide + total usage.
- `tsc` clean; pure pieces (`startWatchdog`, the `usage` helpers, the timeout retry) and the
  fakes-based orchestration/sink behaviours green under unit tests.
