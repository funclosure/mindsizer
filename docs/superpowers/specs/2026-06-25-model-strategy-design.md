# Design: Model Strategy (tier · effort · content-gate)

Date: 2026-06-25
Status: Approved (brainstorm) — ready for implementation planning
Builds on: resilient builds (`2026-06-24-resilient-builds-design.md`) — reuses its guard/retry path.
Closes: the recurring clean-but-wrong-content gap ([[mindsizer-clean-not-correct-gap]]).

## 1. Context & motivation

mindsizer touches a model in exactly two places today, and **both default to Opus 4.8**:
- `runQuery` (via `anthropicClient.ask` in `src/agent/anthropic-client.ts`) — **ingest**: digest,
  propose-directions (angles), generate-outline.
- `runAgentic` (`src/agent/agentic-author.ts`) — **author**: per-slide design + render loop.

We also **set no reasoning effort** (`query.ts` passes no `effort`/`thinking` to the SDK, so every
call runs at the SDK default). The Agent SDK `query()` options DO expose `effort?:
'low'|'medium'|'high'|'xhigh'|'max'` (silently downgraded on models that don't support a level).

Two problems this phase addresses:
1. **Wrong tier everywhere.** Extraction/ingest runs on Opus for no reason; a binary "is this slide
   real content?" check doesn't need Opus either. The author is the only call that needs Opus.
2. **The clean-but-wrong-content gap, hit 3×** (dont-scale probe, Chiang slide-2 empty, Chiang
   slide-4 `PROBE · JS RAN ✓`). Each dud passed `verifyDeck` (structurally valid) and had to be
   caught by eye + fixed with a manual `--resume`. A cheap content-gate would self-heal these.

Principle: **match model strength + effort to the depth of judgment.** Opus authors, Haiku
referees, Sonnet preps. And a content-gate (cheap heuristic + Haiku judge) closes the dud hole by
routing duds into the retry path we already built.

## 2. Goals / non-goals

Goals:
1. **Per-call (model, effort) config** — a `modelFor(role)` resolver with judgment-matched defaults,
   overridable by per-role env; thread `model` + `effort` into the SDK calls.
2. **Content-gate** — a free heuristic (min text length + probe-marker regex) backed by a Haiku
   judge, run in-build so a dud **throws → retries (self-heals)**; a heuristic-only **backstop** in
   `verifyDeck` fails the build loudly if a dud ever seals.
3. **Author-effort A/B** — measure (via the existing telemetry) whether higher author effort yields
   fewer render passes, and set the default from data.

Non-goals (YAGNI / later):
- Per-slide adaptive model/effort selection (e.g. choosing tier by slide complexity).
- A Haiku judge in the post-seal gate (the backstop is heuristic-only by design — "Haiku runs in
  the retry loop", not on every sealed deck).
- Cross-slide caching / token budgeting ([[mindsizer-caching-followup]]).

## 3. Model + effort config

### `src/agent/models.ts` (NEW, pure, unit-tested)
```ts
export type Role = "author" | "ingest" | "judge";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelChoice { model: string; effort: EffortLevel; }
export function modelFor(role: Role, env?: Record<string, string | undefined>): ModelChoice;
```
Defaults:
| role | model | effort |
|---|---|---|
| `author` | `claude-opus-4-8` | `medium` |
| `ingest` | `claude-sonnet-4-6` | `medium` |
| `judge`  | `claude-haiku-4-5-20251001` | `low` |

Resolution (per role): `MINDSIZER_<ROLE>_MODEL` / `MINDSIZER_<ROLE>_EFFORT` override the role
default (e.g. `MINDSIZER_AUTHOR_EFFORT=high`); the legacy `MINDSIZER_MODEL`, if set, overrides the
*model* for every role (back-compat). An effort value not in the allowed set falls back to the role
default. `env` defaults to `process.env` and is injectable for tests.

### Threading — `src/agent/query.ts`
`runQuery(system, user, choice?: ModelChoice)` and
`runAgentic(system, user, tools, choice?: ModelChoice)` set `model: choice.model` and
`effort: choice.effort` in the `query()` options (today they set neither beyond a default model).
When `choice` is omitted, behaviour is unchanged (default model, no effort) — so existing callers
and tests keep working until updated.

### Wiring
- `anthropicClient(choice = modelFor("ingest"))` — `ask` passes `choice` to `runQuery`, so digest /
  directions / outline all run on the ingest tier.
- `agenticAuthor` passes `modelFor("author")` to `runAgentic`.

## 4. Content-gate

### `src/render/content-gate.ts` (NEW, pure, unit-tested)
```ts
export const MIN_SLIDE_CHARS = 60;
export const PROBE_MARKERS = /\bPROBE\b|JS RAN|if this box|FLEX \d|LEFT\s+RIGHT|lorem ipsum/i;
export const CONTENT_DUD = "content-dud:";          // error-message marker (retry contract)
export function slideText(html: string): string;     // the section's visible text (parse, strip tags)
export function heuristicDud(html: string): string | null; // reason if obvious dud, else null
```
`heuristicDud`: `slideText(html).length < MIN_SLIDE_CHARS` → `"only N chars of content"`; else
`PROBE_MARKERS.test(text)` → `"looks like a debug/probe scaffold"`; else `null`.

### Haiku judge — `src/agent/slide-judge.ts` (NEW, model call, verified-by-running)
```ts
export type SlideJudge = (req: { title: string; angle: string; html: string }) => Promise<{ isDud: boolean; reason: string }>;
export function slideJudge(): SlideJudge;            // calls runQuery(modelFor("judge")) + parseValidated(zod {isDud, reason})
```
Prompt (system+user): *"You are a strict reviewer. Does this slide actually teach the idea
'{title}' (deck angle: {angle})? Return isDud=true if it is a placeholder, a debug/probe scaffold,
near-empty, or off-topic; isDud=false if it is real, on-topic teaching content. One-line reason."*
Plus the slide HTML. Uses the same `parseValidated` + one-retry pattern as `ask`.

### Self-heal — `src/render/build-slide.ts`
`BuildSlideDeps` gains `judge?: SlideJudge`. In `buildSlide`, immediately AFTER the existing
`hasUsableSection` guard:
```ts
const dud = heuristicDud(html);
if (dud) throw new Error(`${CONTENT_DUD} ${dud}`);
if (deps.judge) {
  const v = await deps.judge({ title: slide.title, angle: materials.angle, html });
  if (v.isDud) throw new Error(`${CONTENT_DUD} ${v.reason}`);
}
```
The heuristic rejects free; the Haiku judge runs only when the heuristic is uncertain. Both throw
the `content-dud:` marker.

### Retry contract — `src/render/retry.ts`
`isRetryableError` returns `true` for messages containing `content-dud` (added to the retryable set,
still after the usage-limit early-return). So a dud throw → `withRetry` re-authors the slide
(self-heals, exactly like a transient error); a dud that persists past the retry cap → `slide_failed`
(loud, named). The judge therefore runs only inside the build/retry loop.

### Backstop — `src/render/fit-check.ts` `verifyDeck` + `src/cli.ts`
`verifyDeck`'s existing `page.evaluate` gains a per-section heuristic check (NO model): for each
`.deck section[data-slide-id]`, if its `innerText.trim().length < MIN_SLIDE_CHARS` or
`PROBE_MARKERS.test(innerText)`, push `"<id>: <reason>"` to a new `DeckCheck.duds: string[]`.
`MIN_SLIDE_CHARS` and `PROBE_MARKERS.source` are passed into `evaluate` from `content-gate` so there
is one source of truth. The CLI adds `duds` to the post-seal gate report and sets
`process.exitCode = 1` on any dud (deck preserved), alongside the existing count/console/loose-text
checks.

### Wiring — `src/render/build-deck.ts` + `src/cli.ts`
`BuildDeckDeps` gains `judge?: SlideJudge`, threaded into the `buildSlide` deps. The CLI constructs
`slideJudge()` and passes it into `buildDeck` (so judging is on for real builds; unit tests inject a
fake judge or omit it).

## 5. Data flow

```
ingest  → anthropicClient(modelFor("ingest")=Sonnet) → digest/angle/outline
build   → buildDeck(… judge=slideJudge(), …)
            per slide: author(Opus) → buildSlide:
              hasUsableSection guard → heuristicDud → (if uncertain) Haiku judge
                dud → throw "content-dud:" → withRetry re-authors → or slide_failed
seal    → verifyDeck → count/console/loose-text + heuristic duds → cli gate (exit 1 on trip)
```

## 6. Error handling
- Heuristic dud or judge `isDud` → `content-dud:` throw → retryable → re-author; persistent →
  `slide_failed` → `verifyDeck` section-count trips (loud).
- Judge model call fails/unparseable → after the one-retry `parseValidated`, treat as **not a dud**
  (fail-open: never block a real slide because the referee errored); log nothing fatal.
- `verifyDeck` heuristic backstop catches any dud that sealed (e.g. judge omitted, or a dud that
  slipped the in-build heuristic) → build fails non-zero, deck preserved for `--resume`.
- SDK silently downgrades an unsupported effort level — no error path needed.

## 7. Testing strategy
- **Unit (pure):**
  - `models.ts`: defaults per role; per-role env override; legacy `MINDSIZER_MODEL` overrides model
    for all roles; invalid effort → default; injected `env`.
  - `content-gate.ts`: `slideText` strips tags; `heuristicDud` flags <60 chars, flags probe markers
    (`PROBE`/`JS RAN`/`LEFT…RIGHT`/`FLEX 1`), returns null for a real ~200-char slide.
  - `retry.ts`: `isRetryableError("content-dud: only 12 chars")` → true; still false for unknown.
- **Unit (shell/orchestration with fakes):**
  - `build-slide.ts`: a fake author returning a 12-char section → `buildSlide` throws `content-dud`
    (heuristic, judge NOT called); a valid section + a fake judge returning `{isDud:true}` → throws
    `content-dud`; a valid section + judge `{isDud:false}` → returns normally; no judge dep → only
    the heuristic runs.
  - `build-deck.ts`: a `judge` dep is threaded to `buildSlide`; a fake author that returns a probe
    on attempt 1 then real content on attempt 2 → `slide_retry` then `slide_done` (self-heal via the
    `content-dud` retry path).
- **Verified-by-running:**
  - `slideJudge` (Haiku) on a known good slide (isDud false) and a known probe (isDud true).
  - `verifyDeck` heuristic backstop on a healthy deck (no duds) and a deck with a 10-char section
    (one dud).
  - A real `build` of an outline: confirm ingest ran on Sonnet / author on Opus / judge on Haiku
    (per `progress`/logs), and that an induced probe self-heals.
  - **Author-effort A/B:** build one outline at `MINDSIZER_AUTHOR_EFFORT=medium` vs `=high`; compare
    `timing.json` (pass-count, total model-time, retries/duds); set the shipped default from the data.

## 8. Build order (for the plan)
Stage 1 — tiering (shippable checkpoint):
1. `models.ts` (`modelFor`, defaults, env) + tests.
2. Thread `ModelChoice` into `runQuery`/`runAgentic` (`query.ts`).
3. Wire `anthropicClient` (ingest=Sonnet) + `agenticAuthor` (author=Opus).

Stage 2 — content-gate:
4. `content-gate.ts` (`slideText`, `heuristicDud`, markers, `CONTENT_DUD`) + tests.
5. `isRetryableError` retries `content-dud` + test.
6. `build-slide.ts` gate (heuristic + injected judge) + tests.
7. `slide-judge.ts` (Haiku) — verified by running.
8. `build-deck.ts` thread `judge` + self-heal test.
9. `verifyDeck` heuristic backstop (`DeckCheck.duds`) + `cli` report/exit + wiring `slideJudge`.
10. Live: real build (tiers + self-heal) + the author-effort A/B.

## 9. Success criteria
- Ingest runs on Sonnet, the author on Opus, the judge on Haiku — each overridable via
  `MINDSIZER_<ROLE>_MODEL`/`_EFFORT`; `tsc` clean.
- An induced probe/empty slide **self-heals** (a `slide_retry` then real content) without manual
  `--resume`; a persistent dud fails loudly.
- `verifyDeck` reports content duds and fails the build (exit 1) when one seals.
- The author-effort A/B produces a data-backed default (pass-count / model-time comparison from
  `timing.json`).
- Pure pieces (`modelFor`, `content-gate`, the `content-dud` retry) and the fakes-based
  shell/orchestration behaviours are green under unit tests.
