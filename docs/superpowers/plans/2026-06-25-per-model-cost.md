# Per-Model Cost (USD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report a per-model API-equivalent USD cost for `build` and `ingest`, capturing author/judge/ingest token usage by model.

**Architecture:** A module-level usage meter keyed by model id (every `query()` call records its usage) + a per-family price table (env-overridable). The CLI resets the meter per command and prints a per-model + total cost line.

**Tech Stack:** TypeScript, Bun, Vitest, Claude Agent SDK.

**Spec:** `docs/superpowers/specs/2026-06-25-per-model-cost-design.md`.

**Testing convention:** pure logic → Vitest. `query.ts`/`cli.ts` verified by running.

---

## File Structure

**Create:** `src/agent/usage-meter.ts`, `src/agent/pricing.ts` (+ tests).
**Modify:** `src/agent/query.ts` (record usage), `src/cli.ts` (reset + print).

---

## Task 1: Usage meter

**Files:**
- Create: `src/agent/usage-meter.ts`
- Test: `tests/agent/usage-meter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/usage-meter.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { recordUsage, snapshotUsage, resetUsage } from "../../src/agent/usage-meter";

const u = (input: number, output: number, cacheRead = 0, cacheCreate = 0) => ({ input, output, cacheRead, cacheCreate });

describe("usage-meter", () => {
  beforeEach(() => resetUsage());
  it("accumulates per model across calls", () => {
    recordUsage("opus", u(10, 1));
    recordUsage("opus", u(20, 2));
    recordUsage("haiku", u(5, 1));
    expect(snapshotUsage()).toEqual({ opus: u(30, 3), haiku: u(5, 1) });
  });
  it("resetUsage clears the meter", () => {
    recordUsage("opus", u(10, 1));
    resetUsage();
    expect(snapshotUsage()).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/usage-meter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/usage-meter.ts
import { ZERO_USAGE, addUsage, type TokenUsage } from "./usage";

const meter = new Map<string, TokenUsage>();

/** Accumulate token usage under a model id (called after every model call). */
export function recordUsage(model: string, u: TokenUsage): void {
  meter.set(model, addUsage(meter.get(model) ?? ZERO_USAGE, u));
}

/** Per-model summed usage since the last reset. */
export function snapshotUsage(): Record<string, TokenUsage> {
  return Object.fromEntries(meter);
}

/** Clear the meter (call at the start of each command). */
export function resetUsage(): void {
  meter.clear();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/usage-meter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/usage-meter.ts tests/agent/usage-meter.test.ts
git commit -m "feat(agent): usage-meter — accumulate token usage by model"
```

---

## Task 2: Pricing

**Files:**
- Create: `src/agent/pricing.ts`
- Test: `tests/agent/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/pricing.test.ts
import { describe, it, expect } from "vitest";
import { costUsd, fmtUsd } from "../../src/agent/pricing";

const M = 1_000_000;

describe("costUsd", () => {
  it("reproduces the known Opus build cost (~$31.39)", () => {
    const u = { input: 98, output: 261889, cacheRead: 1139843, cacheCreate: 535128 };
    expect(costUsd(u, "claude-opus-4-8", {})).toBeCloseTo(31.39, 1);
  });
  it("prices each family by 1M input tokens", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-opus-4-8", {})).toBeCloseTo(15, 5);
    expect(costUsd(u, "claude-sonnet-4-6", {})).toBeCloseTo(3, 5);
    expect(costUsd(u, "claude-haiku-4-5-20251001", {})).toBeCloseTo(0.8, 5);
  });
  it("unknown model → opus rates", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "mystery-model", {})).toBeCloseTo(15, 5);
  });
  it("honours a MINDSIZER_PRICE_<FAMILY> override", () => {
    const u = { input: M, output: M, cacheRead: M, cacheCreate: M };
    expect(costUsd(u, "claude-opus-4-8", { MINDSIZER_PRICE_OPUS: "1,2,3,4" })).toBeCloseTo(10, 5);
  });
  it("ignores a malformed override (falls back to default)", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-opus-4-8", { MINDSIZER_PRICE_OPUS: "bad" })).toBeCloseTo(15, 5);
  });
});

describe("fmtUsd", () => {
  it("formats by magnitude", () => {
    expect(fmtUsd(31.39)).toBe("$31.39");
    expect(fmtUsd(0.18)).toBe("$0.180");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/pricing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/pricing.ts
import type { TokenUsage } from "./usage";

export interface Rate { input: number; output: number; cacheRead: number; cacheCreate: number; } // $/M tokens

const DEFAULTS: Record<"opus" | "sonnet" | "haiku", Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1.0 },
};

type Family = keyof typeof DEFAULTS;
function family(model: string): Family {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
  return "opus";
}

function rateFor(model: string, env: Record<string, string | undefined>): Rate {
  const f = family(model);
  const o = env[`MINDSIZER_PRICE_${f.toUpperCase()}`];
  if (o) {
    const p = o.split(",").map(Number);
    if (p.length === 4 && p.every((x) => Number.isFinite(x))) {
      return { input: p[0], output: p[1], cacheRead: p[2], cacheCreate: p[3] };
    }
  }
  return DEFAULTS[f];
}

/** API-equivalent USD cost of a usage at a model's rates ($/M, env-overridable). */
export function costUsd(u: TokenUsage, model: string, env: Record<string, string | undefined> = process.env): number {
  const r = rateFor(model, env);
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheCreate * r.cacheCreate) / 1_000_000;
}

/** "$31.39" when ≥ $1, else "$0.180". */
export function fmtUsd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/pricing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/pricing.ts tests/agent/pricing.test.ts
git commit -m "feat(agent): pricing — per-family USD rates (env-overridable) + costUsd"
```

---

## Task 3: Record usage in query.ts

**Files:**
- Modify: `src/agent/query.ts`
- Gate: `bunx tsc --noEmit` + full suite (record is a side-effect; no behavior change to outputs).

- [ ] **Step 1: Add the import.** In `src/agent/query.ts`, after the existing imports (it already imports `fromSdkUsage, ZERO_USAGE, type TokenUsage` from `./usage`), add:
```ts
import { recordUsage } from "./usage-meter";
```

- [ ] **Step 2: Record in `runAgentic`.** `runAgentic` already captures `usage` and ends with `return { text: lastSlideTurn || lastTurn || streamed, usage };`. Add a `recordUsage` line immediately BEFORE that return:
```ts
  recordUsage(choice?.model ?? (process.env.MINDSIZER_MODEL || "claude-opus-4-8"), usage);
  return { text: lastSlideTurn || lastTurn || streamed, usage };
```

- [ ] **Step 3: Capture + record in `runQuery`.** `runQuery` currently doesn't read usage. In its loop, declare a usage accumulator next to `let text = "";`:
```ts
  let usage: TokenUsage = ZERO_USAGE;
```
change its `if (msg.type === "result") break;` to:
```ts
      if (msg.type === "result") { usage = fromSdkUsage((msg as any).usage); break; }
```
and just before `return text;` (the FINAL return, after the post-loop `if (w.fired) throw …`), add:
```ts
  recordUsage(choice?.model ?? MODEL, usage);
  return text;
```
(`MODEL` is the module-level default already defined at the top of the file.)

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (nothing reads the meter in the unit suite; this is a side-effect record).

- [ ] **Step 5: Commit**

```bash
git add src/agent/query.ts
git commit -m "feat(agent): record per-model token usage on every model call"
```

---

## Task 4: CLI prints per-model cost

**Files:**
- Modify: `src/cli.ts`
- Verified-by-running.

- [ ] **Step 1: Add imports.** Near the other imports in `src/cli.ts`:
```ts
import { resetUsage, snapshotUsage } from "./agent/usage-meter";
import { costUsd, fmtUsd } from "./agent/pricing";
```

- [ ] **Step 2: Add a `printCost` helper.** Add this module-level function in `src/cli.ts` (e.g. just above `runBuild`):
```ts
/** Print a per-model API-equivalent USD cost line from the usage meter (nothing if empty). */
function printCost(): void {
  const entries = Object.entries(snapshotUsage());
  if (!entries.length) return;
  const label = (m: string) => (m.includes("haiku") ? "judge/Haiku" : m.includes("sonnet") ? "ingest/Sonnet" : "author/Opus");
  const parts = entries.map(([m, u]) => `${label(m)} ${fmtUsd(costUsd(u, m))}`);
  const total = entries.reduce((s, [m, u]) => s + costUsd(u, m), 0);
  process.stdout.write(`  cost (API-equiv · est):  ~${fmtUsd(total)} — ${parts.join(" · ")}\n`);
}
```

- [ ] **Step 3: Wire into `runBuild`.** In `runBuild`:
- add `resetUsage();` immediately after the `process.stdout.write(\`building ${outline.slides.length} slides…\n\`);` line (before any model call);
- add `printCost();` at the END of `runBuild`, right AFTER the whole-deck-check `try { … } catch { … }` block (and before any `--open` handling, so the cost prints to the terminal before the browser opens).

- [ ] **Step 4: Wire into `runIngest`.** Read the `runIngest` function. Add `resetUsage();` just before the first model call (i.e. before the digest/ingest pipeline runs — right after the input is read and validated, before `anthropicClient`/the ingest call), and add `printCost();` at the very END of `runIngest` (after the sidecar `✓ wrote` block).

- [ ] **Step 5: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (cli isn't in the unit graph).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): per-model API-equivalent cost line on build + ingest"
```

---

## Task 5: Live verification

**Files:** none (manual).

- [ ] **Step 1: Cost line on a real build.** Build a tiny fresh outline (create a 1–2 slide one, or reuse a small existing outline; a full rebuild — NOT `--resume` — so the author actually runs):

```bash
bun run src/cli.ts build <small>.outline.md -o /tmp/cost-demo.html --concurrency 2
```
Expected: the end-of-run output includes a line like
`cost (API-equiv · est):  ~$X.XX — author/Opus $X.XX · judge/Haiku $0.0XX`
with Opus dominating and a small non-zero Haiku figure (the judge ran per slide). The existing
`tokens (author):` line is still present above it.

- [ ] **Step 2: Cost line on ingest.** Re-ingest a text file:

```bash
bun run src/cli.ts ingest marginal-thinking.txt --yes -o /tmp/cost.outline.md
```
Expected: the ingest output ends with `cost (API-equiv · est):  ~$0.0XX — ingest/Sonnet $0.0XX`.

- [ ] **Step 3: Confirm the override works.**

```bash
MINDSIZER_PRICE_OPUS="30,150,3,37.5" bun run src/cli.ts ingest marginal-thinking.txt --yes -o /tmp/cost2.outline.md
```
(Ingest is Sonnet, so the OPUS override won't change its number — this just confirms the flag parses without error. To truly see an override move a number, set `MINDSIZER_PRICE_SONNET` and compare the ingest cost.)

- [ ] **Step 4: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups.**

```bash
git add -A
git commit -m "chore: per-model-cost live verification"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3A meter → Task 1; §3C pricing → Task 2; §3B capture/record → Task 3; §3D reset + display → Task 4; §6 testing → unit Tasks 1–2 + Task 5 live; §8 success → Task 5.
- **Type consistency:** `recordUsage`/`snapshotUsage`/`resetUsage` (Task 1) used in Tasks 3,4; `costUsd`/`fmtUsd` (Task 2) used in Task 4; both consume `TokenUsage` from `usage.ts` (existing). `runQuery` keeps returning `string` (record is a side-effect); `runAgentic` keeps `{text,usage}`.
- **Side-effect record keeps tests green:** nothing in the unit suite reads the meter, so adding `recordUsage` doesn't change any asserted output; the cli print is verified by running.
- **Kept the sink `tokens (author)` line** (per the spec) — no `build-sink` changes; the cost line is additive in the cli.
- **Out of scope:** live running cost, non-USD, cross-command totals, removing the sink token line.
