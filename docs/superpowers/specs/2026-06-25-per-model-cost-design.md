# Design: Per-Model Cost (USD)

Date: 2026-06-25
Status: Approved (brainstorm) — ready for implementation planning
Builds on: token observability (`2026-06-25-robustness-cost-design.md`).

## 1. Context & motivation

We now capture token usage, but only for the **author** (Opus), and we report tokens — not dollars.
The user wants a **per-model** USD estimate, because the rates differ ~19× across tiers (a Haiku
judge token vs an Opus author token), so one flat rate would be badly wrong. Two gaps:

1. **Missing data:** ingest (Sonnet, 3 calls) and judge (Haiku, per-slide) usage is discarded —
   `runQuery` returns only text. We can't price what we don't measure.
2. **No pricing:** no rate table, no USD computation.

This phase adds a **central usage meter keyed by model** (capturing all three roles' usage) plus a
configurable per-model price table, and prints a per-model cost line. Because the user is on a
Claude subscription, the figure is an **API-equivalent estimate**, not their actual bill.

## 2. Goals / non-goals

Goals:
1. Capture token usage **by model** for every model call (author/ingest/judge), centrally.
2. A per-model price table (`$/M` for input/output/cacheRead/cacheCreate), env-overridable.
3. Print a per-model + total cost line after `build` and after `ingest`, labelled "API-equiv · est".

Non-goals (YAGNI):
- A live running cost; currencies other than USD; cross-command totals (each command reports its
  own — `ingest` shows Sonnet, `build` shows Opus + Haiku).
- Persisting cost to disk beyond what's already in `timing.json`.
- Removing the sink's existing `tokens (author)` line — it stays (it carries the cache-hit ratio);
  the new cost line **complements** it (refinement of the brainstorm note, which said "supersede" —
  keeping both is more informative and avoids churn in the sink + its tests).

## 3. Components & interfaces

### A. Usage meter — `src/agent/usage-meter.ts` (NEW, unit-tested)
```ts
import { type TokenUsage } from "./usage";
export function recordUsage(model: string, u: TokenUsage): void;   // accumulate under a model id
export function snapshotUsage(): Record<string, TokenUsage>;       // model id → summed usage
export function resetUsage(): void;                                // clear (per command)
```
A module-level `Map<string, TokenUsage>` summed via `addUsage`. `recordUsage` is synchronous (no
await), so concurrent slide authors / judge calls in the pool can't race it. One build per process,
so the singleton is safe; `resetUsage()` makes it per-command.

### B. Capture — `src/agent/query.ts`
- `runAgentic` already captures `usage` at the result; add `recordUsage(choice?.model ?? MODEL, usage)`.
- `runQuery` currently discards the result usage; capture it (`fromSdkUsage((msg as any).usage)`) and
  add the same `recordUsage(choice?.model ?? MODEL, usage)`. (`runQuery`'s return type stays
  `string` — the meter is a side-effect; no caller ripples.)
This automatically records author (Opus, per slide), judge (Haiku, per slide + retries), and ingest
(Sonnet, 3 calls), each under its own model id.

### C. Pricing — `src/agent/pricing.ts` (NEW, pure, unit-tested)
```ts
export interface Rate { input: number; output: number; cacheRead: number; cacheCreate: number; } // $/M
export function costUsd(u: TokenUsage, model: string, env?): number;  // dollars
export function fmtUsd(n: number): string;                            // $31.39 / $0.180
```
Defaults by model family (substring match on the model id, robust to version bumps):
| family | input | output | cacheRead | cacheCreate |
|---|---|---|---|---|
| opus (default) | 15 | 75 | 1.50 | 18.75 |
| sonnet | 3 | 15 | 0.30 | 3.75 |
| haiku | 0.80 | 4 | 0.08 | 1.00 |

`family(model)`: contains `haiku` → haiku; `sonnet` → sonnet; else → opus. Env override per family:
`MINDSIZER_PRICE_<FAMILY>` = `"in,out,cacheRead,cacheCreate"` (4 finite numbers; ignored if
malformed). `costUsd = (u.input*r.input + u.output*r.output + u.cacheRead*r.cacheRead +
u.cacheCreate*r.cacheCreate) / 1e6`. `fmtUsd`: `$N.NN` when ≥ $1, else `$N.NNN`.

### D. Display — `src/cli.ts`
- `resetUsage()` at the start of `runBuild` and `runIngest` (before any model call).
- A small local helper that reads `snapshotUsage()` and prints a per-model line:
```
  cost (API-equiv · est):  ~$31.4 — author/Opus $31.20 · judge/Haiku $0.18
```
Label each model by role-family (`opus → author/Opus`, `sonnet → ingest/Sonnet`,
`haiku → judge/Haiku`); total = sum of each model's `costUsd`. After `runBuild` (post deck-check)
and after `runIngest` (post sidecar write). If the snapshot is empty (no model calls — e.g. a pure
`--resume` that reused every slide), print nothing.

## 4. Data flow
```
runBuild/runIngest → resetUsage()
  every runAgentic/runQuery → recordUsage(model, fromSdkUsage(result.usage))
  end of command → snapshotUsage() → per-model costUsd → printed cost line
```

## 5. Error handling
- Unknown/unmatched model id → opus-family rates (a safe, visible upper bound rather than silently $0).
- Malformed `MINDSIZER_PRICE_*` override → ignored, falls back to the family default.
- Missing/zero usage → `costUsd` returns 0; an empty snapshot prints no line.
- The figure is explicitly labelled "API-equiv · est" (subscription, approximate rates).

## 6. Testing strategy
- **Unit (pure):**
  - `usage-meter`: `recordUsage` accumulates per model across calls; `snapshotUsage` returns the
    summed map; `resetUsage` clears. (Reset between tests to avoid cross-test bleed.)
  - `pricing`: `costUsd` reproduces the known example (opus: input 98, output 261889, cacheRead
    1139843, cacheCreate 535128 → ≈ $31.39); sonnet + haiku rates; family matching
    (`claude-opus-4-8`→opus, `…haiku-4-5…`→haiku, `…sonnet-4-6…`→sonnet, unknown→opus); a
    `MINDSIZER_PRICE_OPUS="1,2,3,4"` override; malformed override ignored; `fmtUsd` boundaries.
- **Verified-by-running:** a real `build` prints `cost (API-equiv · est): ~$.. — author/Opus $.. ·
  judge/Haiku $..`; an `ingest` prints an `ingest/Sonnet $..` line; the numbers are plausible and
  Opus dominates.

## 7. Build order (for the plan)
1. `usage-meter.ts` + tests.
2. `pricing.ts` + tests.
3. `query.ts`: `recordUsage` in `runAgentic` + capture-and-`recordUsage` in `runQuery`.
4. `cli.ts`: `resetUsage()` + the per-model cost line in `runBuild` and `runIngest`.
5. Live: cost line on a real build + ingest.

## 8. Success criteria
- `build` prints a per-model USD line (author/Opus + judge/Haiku) + total, and `ingest` prints its
  Sonnet cost; both labelled "API-equiv · est"; rates env-overridable.
- The known build reproduces ≈ $31 author cost; Haiku judge is a small addition.
- `tsc` clean; `usage-meter` + `pricing` green under unit tests.
