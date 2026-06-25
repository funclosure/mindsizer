# Build Robustness + Cost Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a hung model call from blocking a build (idle-watchdog timeout → retryable self-heal), and capture per-build token usage with a cache-hit ratio.

**Architecture:** An `AbortController` + idle watchdog wraps each `query()` stream loop; a 180s stall aborts → throws a retryable timeout. The author session's `result.usage` is captured and threaded per-slide into the telemetry, summed for a deck total + summary line.

**Tech Stack:** TypeScript, Bun, Vitest, Claude Agent SDK (`abortController`, `result.usage`).

**Spec:** `docs/superpowers/specs/2026-06-25-robustness-cost-design.md`.

**Two stages:** Tasks 1–3 = timeout (the active bug). Tasks 4–8 = tokens. Task 9 = live.

**Testing convention:** pure logic + fakes → Vitest. The `query.ts` SDK path is verified by running.

---

## File Structure

**Create:** `src/agent/timeout.ts`, `src/agent/usage.ts` (+ their tests).
**Modify:** `src/agent/query.ts`, `src/render/retry.ts`, `src/render/progress.ts`, `src/agent/agentic-author.ts`, `src/render/build-slide.ts`, `src/render/build-deck.ts`, `src/export/build-sink.ts` (+ their tests).

---

## Task 1: Idle watchdog

**Files:**
- Create: `src/agent/timeout.ts`
- Test: `tests/agent/timeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/timeout.test.ts
import { describe, it, expect } from "vitest";
import { startWatchdog } from "../../src/agent/timeout";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startWatchdog", () => {
  it("fires onIdle after ms with no kicks", async () => {
    let n = 0;
    const w = startWatchdog(20, () => n++);
    await wait(50);
    expect(n).toBe(1);
    expect(w.fired).toBe(true);
    w.stop();
  });
  it("does not fire while kicked", async () => {
    let n = 0;
    const w = startWatchdog(40, () => n++);
    for (let i = 0; i < 5; i++) { await wait(15); w.kick(); }
    expect(n).toBe(0);
    expect(w.fired).toBe(false);
    w.stop();
  });
  it("latches — does not fire twice", async () => {
    let n = 0;
    const w = startWatchdog(15, () => n++);
    await wait(60);
    expect(n).toBe(1);
    w.stop();
  });
  it("stop() prevents firing", async () => {
    let n = 0;
    const w = startWatchdog(20, () => n++);
    w.stop();
    await wait(40);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/timeout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/timeout.ts
export const IDLE_TIMEOUT_MS = Number(process.env.MINDSIZER_IDLE_TIMEOUT_MS) || 180_000;

export interface Watchdog {
  kick(): void;            // call on every stream message — resets the idle timer
  stop(): void;            // clear the timer (call when done)
  readonly fired: boolean; // true once onIdle has fired
}

/** Start an idle watchdog: calls onIdle() if kick() isn't called within `ms`. Latches after firing. */
export function startWatchdog(ms: number, onIdle: () => void): Watchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const arm = () => {
    timer = setTimeout(() => { fired = true; onIdle(); }, ms);
  };
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  arm();
  return {
    kick() { if (fired) return; clear(); arm(); },
    stop() { clear(); },
    get fired() { return fired; },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/timeout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/timeout.ts tests/agent/timeout.test.ts
git commit -m "feat(agent): startWatchdog — idle timeout primitive"
```

---

## Task 2: isRetryableError retries timeouts

**Files:**
- Modify: `src/render/retry.ts`
- Test: `tests/render/retry.test.ts`

- [ ] **Step 1: Write the failing test (append).** In `tests/render/retry.test.ts`, inside the existing `describe("isRetryableError", …)` block, add:
```ts
  it("retries a timed-out call so a hang self-heals", () => {
    expect(isRetryableError(new Error("model-call timed out — idle 180s"))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: FAIL — `timed out` isn't retryable yet.

- [ ] **Step 3: Implement.** In `src/render/retry.ts`, add `timed out|timeout` to the `TRANSIENT` regex. It currently reads:
```ts
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network|content-dud)/;
```
Change it to:
```ts
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network|content-dud|timed out|timeout)/;
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/retry.ts tests/render/retry.test.ts
git commit -m "feat(render): isRetryableError retries timeouts (hang self-heal)"
```

---

## Task 3: Wire the watchdog into query.ts

**Files:**
- Modify: `src/agent/query.ts`
- Verified-by-running. Gate: `bunx tsc --noEmit` + full suite (no behavior change for normal calls; the watchdog only fires on a stall).

- [ ] **Step 1: Add the import.** At the top of `src/agent/query.ts`, after the existing imports, add:
```ts
import { startWatchdog, IDLE_TIMEOUT_MS } from "./timeout";
```

- [ ] **Step 2: Wrap `runQuery`.** Replace the whole `runQuery` function (it currently delegates to `drain`):
```ts
/** One isolated single-shot text turn → full assistant text. */
export async function runQuery(systemPrompt: string, userPrompt: string, choice?: ModelChoice): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt, choice) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}
```
with (inlines the drain loop so the watchdog can `kick()` on each message, and passes `abortController`):
```ts
/** One isolated single-shot text turn → full assistant text. Aborts on a 180s idle stall. */
export async function runQuery(systemPrompt: string, userPrompt: string, choice?: ModelChoice): Promise<string> {
  const ac = new AbortController();
  const q = query({ prompt: userPrompt as any, options: { ...options(systemPrompt, choice), abortController: ac } as any }) as any;
  const w = startWatchdog(IDLE_TIMEOUT_MS, () => ac.abort());
  const timeoutMsg = `model-call timed out — idle ${IDLE_TIMEOUT_MS / 1000}s`;
  let text = "";
  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      w.kick();
      if (
        msg.type === "stream_event" &&
        msg.event?.type === "content_block_delta" &&
        msg.event.delta?.type === "text_delta" &&
        msg.event.delta.text
      ) {
        text += msg.event.delta.text;
      }
      if (msg.type === "result") break;
    }
  } catch (e) {
    if (w.fired) throw new Error(timeoutMsg);
    throw e;
  } finally {
    w.stop();
  }
  if (w.fired) throw new Error(timeoutMsg);
  return text;
}
```
Then DELETE the now-unused `drain` function (the whole `async function drain(...) { … }` block above `runQuery`).

- [ ] **Step 3: Wrap `runAgentic`'s loop.** In `runAgentic`, change the `query({ … })` call to pass an abort controller and wrap the loop. First, just before the `const q = query({` line, add:
```ts
  const ac = new AbortController();
```
and add `abortController: ac,` inside that options object (e.g. right after the `includePartialMessages: true,` line).

Then replace the loop + return at the end of `runAgentic`. It currently reads:
```ts
  let lastTurn = "";
  let lastSlideTurn = "";
  let streamed = "";
  for await (const msg of q as AsyncIterable<any>) {
    if (
      msg.type === "stream_event" &&
      msg.event?.type === "content_block_delta" &&
      msg.event.delta?.type === "text_delta" &&
      msg.event.delta.text
    ) {
      streamed += msg.event.delta.text;
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      const t = msg.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (t) {
        lastTurn = t;
        if (t.includes("<section")) lastSlideTurn = t;
      }
    }
    if (msg.type === "result") break;
  }
  return lastSlideTurn || lastTurn || streamed;
```
Replace with:
```ts
  const w = startWatchdog(IDLE_TIMEOUT_MS, () => ac.abort());
  const timeoutMsg = `model-call timed out — idle ${IDLE_TIMEOUT_MS / 1000}s`;
  let lastTurn = "";
  let lastSlideTurn = "";
  let streamed = "";
  try {
    for await (const msg of q as AsyncIterable<any>) {
      w.kick();
      if (
        msg.type === "stream_event" &&
        msg.event?.type === "content_block_delta" &&
        msg.event.delta?.type === "text_delta" &&
        msg.event.delta.text
      ) {
        streamed += msg.event.delta.text;
      }
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        const t = msg.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (t) {
          lastTurn = t;
          if (t.includes("<section")) lastSlideTurn = t;
        }
      }
      if (msg.type === "result") break;
    }
  } catch (e) {
    if (w.fired) throw new Error(timeoutMsg);
    throw e;
  } finally {
    w.stop();
  }
  if (w.fired) throw new Error(timeoutMsg);
  return lastSlideTurn || lastTurn || streamed;
```

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/query.ts
git commit -m "feat(agent): idle-watchdog timeout on every model call (abort on stall)"
```

---

## Task 4: TokenUsage helpers

**Files:**
- Create: `src/agent/usage.ts`
- Test: `tests/agent/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/usage.test.ts
import { describe, it, expect } from "vitest";
import { addUsage, fromSdkUsage, inputSide, cacheHitRatio, fmtTokens, ZERO_USAGE } from "../../src/agent/usage";

describe("usage", () => {
  it("addUsage sums field-wise", () => {
    expect(addUsage({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, { input: 10, output: 20, cacheRead: 30, cacheCreate: 40 }))
      .toEqual({ input: 11, output: 22, cacheRead: 33, cacheCreate: 44 });
  });
  it("fromSdkUsage maps snake_case keys; missing → 0", () => {
    expect(fromSdkUsage({ input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 9 }))
      .toEqual({ input: 5, output: 7, cacheRead: 9, cacheCreate: 0 });
    expect(fromSdkUsage(undefined)).toEqual(ZERO_USAGE);
  });
  it("inputSide + cacheHitRatio", () => {
    const u = { input: 10, output: 0, cacheRead: 90, cacheCreate: 0 };
    expect(inputSide(u)).toBe(100);
    expect(cacheHitRatio(u)).toBe(0.9);
    expect(cacheHitRatio(ZERO_USAGE)).toBe(0);
  });
  it("fmtTokens", () => {
    expect(fmtTokens(2_100_000)).toBe("2.1M");
    expect(fmtTokens(42_000)).toBe("42k");
    expect(fmtTokens(500)).toBe("500");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/usage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/usage.ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/usage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage.ts tests/agent/usage.test.ts
git commit -m "feat(agent): TokenUsage helpers (add, fromSdkUsage, cacheHitRatio, fmtTokens)"
```

---

## Task 5: usage on the progress events

**Files:**
- Modify: `src/render/progress.ts`

- [ ] **Step 1: Add the import + fields.** In `src/render/progress.ts`, add the import at the top:
```ts
import type { TokenUsage } from "../agent/usage";
```
In the `ProgressEvent` union, add `usage?: TokenUsage` to BOTH the `slide_done` and `deck_done` variants (optional on both, so existing emitters/tests keep compiling). They currently read:
```ts
  | { type: "slide_done"; at: number; index: number; id: string; html: string;
      timing: SlideTiming; warnings: string[] }
```
```ts
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };
```
Change them to:
```ts
  | { type: "slide_done"; at: number; index: number; id: string; html: string;
      timing: SlideTiming; warnings: string[]; usage?: TokenUsage }
```
```ts
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number>; usage?: TokenUsage };
```

- [ ] **Step 2: Typecheck + full suite (stays green — both fields are optional).**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (optional fields don't break existing emitters/tests).

- [ ] **Step 3: Commit**

```bash
git add src/render/progress.ts
git commit -m "feat(render): usage on slide_done/deck_done events"
```

---

## Task 6: Capture + thread author usage

**Files:**
- Modify: `src/agent/query.ts`, `src/agent/agentic-author.ts`, `src/render/build-slide.ts`

- [ ] **Step 1: `runAgentic` captures + returns usage.** In `src/agent/query.ts`:

(a) add imports:
```ts
import { fromSdkUsage, ZERO_USAGE, type TokenUsage } from "./usage";
```
(b) change `runAgentic`'s return type from `Promise<string>` to `Promise<{ text: string; usage: TokenUsage }>`.
(c) in `runAgentic`'s loop, add a `usage` accumulator and capture it at the result. Change the loop's `if (msg.type === "result") break;` to:
```ts
      if (msg.type === "result") { usage = fromSdkUsage((msg as any).usage); break; }
```
and declare `let usage: TokenUsage = ZERO_USAGE;` next to `let lastTurn = "";`. Change the final `return lastSlideTurn || lastTurn || streamed;` to:
```ts
  return { text: lastSlideTurn || lastTurn || streamed, usage };
```

- [ ] **Step 2: `agenticAuthor` threads usage.** In `src/agent/agentic-author.ts`, change the call site:
```ts
      const text = await runAgentic(system, user, {
```
to destructure:
```ts
      const { text, usage } = await runAgentic(system, user, {
```
and change the final `return { html: finalHtml, timing };` to:
```ts
      return { html: finalHtml, timing, usage };
```

- [ ] **Step 3: `AuthoredSlide`/`BuiltSlide` carry usage.** In `src/render/build-slide.ts`:

(a) add the import:
```ts
import type { TokenUsage } from "../agent/usage";
```
(b) add `usage?: TokenUsage;` to the `AuthoredSlide` interface and to the `BuiltSlide` interface.
(c) in `buildSlide`, change the final `return { html, fits, warnings, timing: authored.timing };` to:
```ts
  return { html, fits, warnings, timing: authored.timing, usage: authored.usage };
```

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS. (`runAgentic`'s return change is consumed by its only caller `agenticAuthor` in this same task; `usage` is optional on `AuthoredSlide`/`BuiltSlide` and `deck_done`, so nothing downstream breaks.)

- [ ] **Step 5: Commit**

```bash
git add src/agent/query.ts src/agent/agentic-author.ts src/render/build-slide.ts
git commit -m "feat(agent,render): capture author token usage → AuthoredSlide/BuiltSlide"
```

---

## Task 7: buildDeck aggregates usage

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Write the failing test (append inside `describe("buildDeck", …)`).**

```ts
  it("emits per-slide usage and sums it on deck_done", async () => {
    const author: SlideAuthor = {
      async authorSlide(req) { return { html: section(req.slide.id), usage: { input: 100, output: 10, cacheRead: 900, cacheCreate: 0 } }; },
    };
    const { sink, events } = recordingSink();
    await buildDeck(outline, { author, sink });
    const done = events.find((e) => e.type === "slide_done") as Extract<ProgressEvent, { type: "slide_done" }>;
    expect(done.usage).toEqual({ input: 100, output: 10, cacheRead: 900, cacheCreate: 0 });
    const deckDone = events.find((e) => e.type === "deck_done") as Extract<ProgressEvent, { type: "deck_done" }>;
    expect(deckDone.usage).toEqual({ input: 200, output: 20, cacheRead: 1800, cacheCreate: 0 }); // 2 slides summed
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — `usage` not emitted/aggregated.

- [ ] **Step 3: Implement.** In `src/render/build-deck.ts`:

(a) add the import:
```ts
import { addUsage, ZERO_USAGE, type TokenUsage } from "../agent/usage";
```
(b) add a running total next to `const agg = …`:
```ts
  let usageTotal: TokenUsage = ZERO_USAGE;
```
(c) in the success branch, after the `agg` accumulation line, add:
```ts
      if (built.usage) usageTotal = addUsage(usageTotal, built.usage);
```
(d) add `usage: built.usage` to the `slide_done` emit:
```ts
      sink.emit({ type: "slide_done", at: Date.now(), index, id: slide.id, html: built.html, timing, warnings: built.warnings, usage: built.usage });
```
(e) add `usage: usageTotal` to the `deck_done` emit:
```ts
  sink.emit({ type: "deck_done", at: Date.now(), slides: total, totalMs: Date.now() - deckStart, byCategory: agg, usage: usageTotal });
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS (existing + the new usage test).

- [ ] **Step 5: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): buildDeck aggregates per-slide token usage → deck_done"
```

---

## Task 8: Sink reports tokens (restores green)

**Files:**
- Modify: `src/export/build-sink.ts`
- Test: `tests/export/build-sink.test.ts`

- [ ] **Step 1: Update the `formatBreakdown` test.** In `tests/export/build-sink.test.ts`, the `formatBreakdown` test constructs a `deck_done` inline — add `usage` to it and assert the tokens line. Find its `formatBreakdown({ type: "deck_done", … }, …)` call and add `usage: { input: 1000, output: 100, cacheRead: 9000, cacheCreate: 0 }` to that deck_done object, then add inside that `it`:
```ts
    expect(out).toMatch(/tokens \(author\)/);
    expect(out).toMatch(/90%/); // cacheRead 9000 / (1000+9000) = 90%
```
(The `fileSink` test's `deck_done` needs no change — `usage` is optional.)

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: FAIL — no tokens line yet.

- [ ] **Step 3: Implement.** In `src/export/build-sink.ts`:

(a) add the import:
```ts
import { inputSide, cacheHitRatio, fmtTokens } from "../agent/usage";
```
(b) in `formatBreakdown`, add a tokens line. Just before the final `(slowest ? … : "")` line in the returned string, insert a tokens line built from `done.usage` (guarded — `usage` is optional):
```ts
    (done.usage && inputSide(done.usage)
      ? `  tokens (author):  ${fmtTokens(inputSide(done.usage))} in (${fmtTokens(done.usage.cacheRead)} cached · ${Math.round(cacheHitRatio(done.usage) * 100)}%) · ${fmtTokens(done.usage.output)} out\n`
      : "") +
```
(c) in `fileSink`'s `deck_done` branch, include the usage in the `timing.json` write — change the `timing.json` object to add `usage: e.usage,`.

- [ ] **Step 4: Run to verify pass + full suite + typecheck**

Run: `bunx vitest run tests/export/build-sink.test.ts && bunx tsc --noEmit && bunx vitest run`
Expected: build-sink tests PASS; tsc CLEAN; whole suite PASS (the deck_done usage ripple is now resolved).

- [ ] **Step 5: Commit**

```bash
git add src/export/build-sink.ts tests/export/build-sink.test.ts
git commit -m "feat(export): end-of-build token summary + usage in timing.json"
```

---

## Task 9: Live verification

**Files:** none (manual).

- [ ] **Step 1: Token summary on a real build.** Resume an existing build (cheap — reuses saved slides, but still seals + reports):

```bash
bun run src/cli.ts build marginal.outline.md -o /tmp/rc-demo.html --concurrency 4 --resume
```
Expected: the end-of-run summary now includes a line like
`tokens (author):  2.1M in (1.8M cached · 86%) · 42k out`, and `marginal.outline.build/timing.json` has a `usage` object. (A pure-resume reuses slides so author tokens may be ~0; for a real number, build a tiny fresh outline instead.)

- [ ] **Step 2: Confirm the SDK usage path.** If the tokens line shows all zeros, the `result.usage` path differs. Add a one-line probe in `runAgentic` (`console.error("USAGE", JSON.stringify((msg as any).usage ?? (msg as any).message?.usage))` at the result branch), run one slide, read the shape, and adjust `fromSdkUsage`'s source (e.g. `(msg as any).message?.usage`) — then remove the probe.

- [ ] **Step 3: Timeout abort/retry check.** On a 1–2 slide fresh outline, force aborts:

```bash
rm -rf <stem>.outline.build
MINDSIZER_IDLE_TIMEOUT_MS=1 bun run src/cli.ts build <stem>.outline.md -o /tmp/rc-to.html --concurrency 2
```
Expected: each slide's author call **aborts immediately** (no 42-min hang) → `[#N] ⟳ retry …` (timeout is retryable) → after the cap, `slide_failed` and a loud non-zero deck-check failure. This proves the no-infinite-block guarantee + abort/retry wiring. (Then a normal build with the default 180s behaves as before.)

- [ ] **Step 4: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups (incl. the confirmed usage path).**

```bash
git add -A
git commit -m "chore: robustness-cost live verification (usage path + timeout abort)"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 watchdog → Tasks 1,3; retry contract → Task 2; §4 usage helpers → Task 4; capture → Task 6; events → Task 5; aggregate → Task 7; summary/timing.json → Task 8; §7 testing → unit tasks + Task 9 live (incl. the IDLE=1 abort check and the usage-path confirmation).
- **Type consistency:** `Watchdog`/`startWatchdog`/`IDLE_TIMEOUT_MS` (Task 1) used in Task 3; `TokenUsage`/`addUsage`/`fromSdkUsage`/`ZERO_USAGE`/`inputSide`/`cacheHitRatio`/`fmtTokens` (Task 4) used in Tasks 6,7,8; `runAgentic`'s `{text, usage}` (Task 6) consumed by `agenticAuthor` (Task 6); `AuthoredSlide.usage`/`BuiltSlide.usage` (Task 6) read by build-deck (Task 7); `slide_done.usage?`/`deck_done.usage` (Task 5) emitted in Task 7 and consumed in Task 8.
- **Every task ends green:** `usage` is optional on `slide_done`/`deck_done` and on `AuthoredSlide`/`BuiltSlide`, so adding the fields (Task 5) and the capture (Task 6) don't break existing emitters/tests — no mid-refactor RED. Task 8 guards `done.usage` in `formatBreakdown`.
- **Out of scope:** ingest/judge token totals (summary says "tokens (author)"); fixed overall cap; per-pass token breakdown.
