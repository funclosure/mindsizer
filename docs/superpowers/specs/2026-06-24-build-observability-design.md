# Design: Build Observability & Step-Timing

Date: 2026-06-24
Status: Approved (brainstorm) — ready for implementation planning
Scope: **Phase 1 only** — make the build legible and measured. Reliability fixes (R1–R4 from
`MINDSIZER_HARNESS_FINDINGS.md`) and speed optimizations are explicitly deferred to later phases.

## 1. Context & motivation

`mindsizer build` is currently an ~80-minute black box: it prints `building N slides…`, goes
silent while it authors each slide sequentially, then prints `✓ authored / ✓ sealed`. During that
time there is **no way to see what it's doing** — which slide it's on, whether a slide is looping
unproductively, or where the time goes. Two real 10-slide builds each took ~80–100 min and a large
share of a usage window (`MINDSIZER_HARNESS_FINDINGS.md`).

The owner of this observability is **Claude operating the build**, not a human watching a screen.
The need is a structured, inspectable record I can read *while the build runs* — to identify the
current task, spot an unproductive loop, and above all **see what KIND of step consumes the time**,
so any later optimization is chosen against data rather than guessed.

Per-slide totals are not enough. The agentic author loop decomposes into distinct step types, and
the headline deliverable is a breakdown **by step category** across the whole deck.

## 2. Goals / non-goals

Goals (Phase 1):
1. Emit a **structured progress log** the build writes continuously and Claude can read mid-run.
2. **Step-categorized timing** — attribute every millisecond to a step kind, aggregated across the
   deck, so "what takes the most time" is answered with numbers.
3. **Incremental persistence** — each finished slide is written and the partial deck is re-sealed as
   the build progresses, so a kill keeps finished work and intermediate results exist.
4. Keep the deterministic shell unit-testable; the timing math is a pure, tested function.

Non-goals (deferred):
- The reliability fixes (robust extractor, `id`==`data-slide-id`, gating validation, whole-deck
  check) — Phase 2.
- Any speed optimization (iteration cap, parallelization, cheaper draft model, fast mode) — Phase 3,
  chosen using the timing this phase produces.
- Visual artifacts for human watching (per-pass screenshot galleries): explicitly out — the observer
  is Claude reading structured data, not a person watching.

## 3. The step-timing model (the centerpiece)

The per-slide agentic author loop is `author → (render → revise)* → finalize`. Time is attributed to
four mutually-exclusive categories, measured purely from the render-tool call boundaries plus the
session start/end — no SDK-internal introspection required:

| Category | What it is | How measured |
|---|---|---|
| **author** | model drafting the first HTML | session start → first `render` call |
| **revise** | model reviewing a screenshot and rewriting | each `render` *result* → the next `render` call (summed over passes ≥ 2) |
| **render** | headless chromium load + screenshot | measured directly around each `render` tool execution |
| **finalize** | model emitting the final HTML after the last render | last `render` result → final output |

`author + revise + render + finalize == total slide wall-clock`. If a slide never calls `render`,
all model time is `author`. These boundaries are exactly the moments the Agent SDK hands control to
our render callback and back, so they are captured by timestamping that callback plus the call's
start/end.

Strong prior (to be confirmed by the data): **revise** dominates and **render** is a rounding error —
which would point optimization at the iteration loop, not at rendering. The point of this phase is
to replace that prior with measurement.

## 4. Architecture

Event-driven, with pure emitters and a single IO sink:

```
buildDeck (pure orchestrator)                       [emits ProgressEvents]
  for each slide (index, total):
    emit slide_start
    built = buildSlide(slide, …, onPass)            buildSlide calls the author,
      author.authorSlide(req, onPass)               author times each render pass and
        runAgentic(… render closure …)              calls onPass(PassTiming) live
    emit slide_done {html, timing, warnings}  (or slide_failed)
  emit deck_done {aggregate byCategory}
        │
        ▼
ProgressSink (injected)
  · tests:  a recording fake
  · cli:    fileSink → progress.jsonl + status.json + incremental partial-deck seal + stdout + final breakdown
```

The orchestrator and author only *emit*; all IO (files, sealing, printing) lives in the cli sink.
This keeps `buildDeck`/`buildSlide` unit-testable with a fake sink and keeps Playwright/SDK out of
the unit graph (unchanged from today).

## 5. Components & interfaces

### A. Progress model — `src/render/progress.ts` (pure, unit-tested)

```ts
export type StepCategory = "author" | "revise" | "render" | "finalize";

export interface PassTiming {
  pass: number;          // 1-based render pass
  modelMs: number;       // model time before this render (author for pass 1, revise after)
  renderMs: number;      // chromium render + screenshot
  overflowPx: number;    // from the render result (visibility into convergence)
  consoleErrors: number;
}

export interface SlideTiming {
  totalMs: number;
  passes: PassTiming[];
  byCategory: Record<StepCategory, number>;  // sums to totalMs
}

export type ProgressEvent =
  | { type: "slide_start";  at: number; index: number; total: number; id: string; title: string }
  | { type: "render_pass";  at: number; index: number; id: string; pass: number;
      modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }
  | { type: "slide_done";   at: number; index: number; id: string; html: string;
      timing: SlideTiming; warnings: string[] }
  | { type: "slide_failed"; at: number; index: number; id: string; reason: string }
  | { type: "deck_done";    at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };

export interface ProgressSink { emit(e: ProgressEvent): void; }
export const NOOP_SINK: ProgressSink = { emit() {} };

/** Pure: derive the category breakdown from the render-call boundaries. */
export function computeSlideTiming(startMs: number, passes: PassTiming[], endMs: number): SlideTiming;
```

`computeSlideTiming`: `render = Σ renderMs`; `author = passes[0]?.modelMs ?? (endMs-startMs)`;
`revise = Σ_{i≥2} modelMs`; `finalize = (endMs-startMs) - author - revise - render`. (`at` timestamps
are wall-clock epoch ms, passed in by callers; see §9 on `Date.now`.)

### B. Author seam gains timing — `src/render/build-slide.ts`

```ts
export interface AuthoredSlide { html: string; timing?: SlideTiming; }

export interface SlideAuthor {
  authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide>;
}
```

`buildSlide` gains the orchestration context it needs to attribute events, but stays pure:

```ts
export interface BuiltSlide { html: string; fits: boolean; warnings: string[]; timing?: SlideTiming; }
// buildSlide(slide, deck, materials, deps, onPass?) — unchanged logic, now returns timing and
// threads onPass to the author. (deps still: { author, renderer? })
```

### C. Agentic author instrumentation — `src/agent/agentic-author.ts`

Wrap the render closure to time each pass and report it; compute the slide timing from the boundaries:

```ts
async authorSlide(req, onPass) {
  const { system, user } = slideAuthorPrompt(req);
  const startMs = Date.now();
  let lastBoundary = startMs;
  const passes: PassTiming[] = [];
  const text = await runAgentic(system, user, {
    render: async (html, interactions) => {
      const reqAt = Date.now();
      const modelMs = reqAt - lastBoundary;          // author (pass 1) or revise (later)
      const r = await renderer.render(html, interactions);
      const renderMs = Date.now() - reqAt;
      lastBoundary = Date.now();
      const p = { pass: passes.length + 1, modelMs, renderMs,
                  overflowPx: r.overflowPx, consoleErrors: r.consoleErrors.length };
      passes.push(p);
      onPass?.(p);                                   // live render_pass event
      return r.shots;
    },
  });
  const timing = computeSlideTiming(startMs, passes, Date.now());
  return { html: extractSlideHtml(text), timing };
}
```

No change to `runAgentic` itself — the boundaries are visible from the render callback. (`runAgentic`
stays as-is; the unbounded iteration it allows is now *measured*, and capping it is a Phase-3 lever.)

### D. Orchestrator emits events — `src/render/build-deck.ts`

`buildDeck(outline, deps)` gains `deps.sink?: ProgressSink` (default `NOOP_SINK`). Per slide it emits
`slide_start`, threads an `onPass` that wraps `PassTiming` into a `render_pass` event (adding
`index`/`id`), then emits `slide_done` (with the authored html, timing, warnings) — or `slide_failed`
if `buildSlide` throws. After the loop it emits `deck_done` with the summed `byCategory`. The returned
`{ sections, warnings }` is unchanged so the existing seal path keeps working.

### E. The cli file sink — `src/cli.ts` (`runBuild`)

A `fileSink(buildDir, outline, outPath)` that turns events into IO. It is the only new IO:

- Ensures `<outPath-base>.build/` with `slides/` inside.
- **progress.jsonl**: append one JSON line per event.
- **status.json**: overwrite a snapshot on every event — `{ current: {index,total,id,title,pass},
  elapsedMs, lastEvent, doneCount }` — so a single read shows the live state.
- **stdout**: print a concise line per meaningful event, e.g.
  `▶ 3/10 "The Math" · pass 2 · render 0.4s · overflow 0 · 3m40s` and `✓ 3/10 done · 4m05s`.
- On `slide_done`: write `slides/<id>.html`; update the in-memory sections map; **re-seal the partial
  deck** to `outPath` using completed sections + a placeholder for pending slides (see §6).
- On `deck_done`: final seal + print the **step breakdown** (see §7); write `timing.json`.

### F. Partial deck + placeholder — `src/export/seal.ts`

Add `placeholderSection(slide): string` → a minimal valid `<section data-slide-id="…"
data-layout="bespoke">` showing "building…". `sealDeck` already accepts a `sections` map; the sink
fills not-yet-built ids with placeholders so the partial deck always has the full slide count and
opens cleanly mid-build. (Phase 1 only needs the placeholder + reuse of `sealDeck`; no seal changes
beyond the helper.)

## 6. Progress file formats (what Claude reads)

`progress.jsonl` — append-only, one event per line (the §5A `ProgressEvent` shapes verbatim).
`status.json` — overwritten snapshot:

```json
{ "current": { "index": 7, "total": 10, "id": "s_x", "title": "The Math", "pass": 6 },
  "elapsedMs": 4920000, "doneCount": 6, "lastEvent": "render_pass" }
```

This is what makes mid-run inspection a single `Read`: *which slide, which pass, how long, how many
done* — and a slide stuck at a high `pass` with non-decreasing `overflowPx` is a visible "looping
unproductively" signal.

## 7. End-of-build breakdown (the answer to "what takes the most time")

Printed at `deck_done` and saved to `timing.json`:

```
build complete — 10 slides in 82m
  by step:   revise 54%  ·  author 28%  ·  render 7%  ·  finalize 9%  ·  (overhead 2%)
  slowest:   #7 "The Math" 14m (7 passes) · #3 11m (6 passes) · #9 9m (5 passes)
  passes:    median 4 · max 7
```

The four step categories sum to each slide's wall-clock; `overhead` is the deck-level remainder
(`deck wall-clock − Σ slide step-time`) — orchestration, validation, and the incremental seals that
happen between slides and aren't attributed to any single slide. It's computed at print time as
`deck_done.totalMs − Σ byCategory`, so the percentages always sum to 100.

## 8. Operating pattern (how Claude uses this)

Run `mindsizer build … &` (background); periodically `Read` `status.json` / `tail` `progress.jsonl`
to report state, spot an unproductive loop (high pass count, flat overflow), and decide whether to
intervene (kill — finished slides are already persisted — adjust, and re-run). The structured log is
what turns the black box into something I can reason about.

## 9. Error handling & resilience
- A slide whose author throws → `buildDeck` emits `slide_failed` and continues; the sink seals a
  placeholder for it so the partial deck stays well-formed. (Hard gating/retry is Phase 2; Phase 1
  just makes the failure *visible* and non-fatal to the run.)
- The sink's IO is best-effort: a failed status write must never crash the build.
- `Date.now()` is used for wall-clock timing — these run as ordinary Bun code (the no-`Date.now`
  restriction applies only inside Workflow tool scripts, which this is not).

## 10. Testing strategy
- **Unit (pure):** `computeSlideTiming` (boundaries → byCategory, incl. the no-passes case and the
  sum-equals-total invariant); `buildSlide`/`buildDeck` emit the expected event sequence to a
  recording fake sink, with a fake author that returns `{html, timing}` and invokes `onPass`;
  `placeholderSection` produces a valid single section; partial `sealDeck` with a placeholders map
  yields the full slide count.
- **Verified-by-running:** `agenticAuthor`'s real boundary capture and the cli `fileSink` (live
  build) — confirm `progress.jsonl`/`status.json` update during a run and the breakdown is sane.

## 11. Build order (for the plan)
1. `src/render/progress.ts` + `computeSlideTiming` (+ tests).
2. `placeholderSection` in `seal.ts` + partial-seal test.
3. Author seam → `AuthoredSlide` + `onPass`; reshape `build-slide.ts` (+ tests).
4. `build-deck.ts` event emission with a `sink` (+ tests with a fake sink).
5. `agentic-author.ts` boundary timing (+ verified-by-running).
6. cli `fileSink`: progress.jsonl + status.json + incremental partial seal + stdout + breakdown.
7. Live verification on the bundled example (or a short outline).

## 12. Success criteria
- During a live `mindsizer build`, `Read`ing `status.json` shows the current slide + pass + elapsed,
  and `progress.jsonl` grows with per-pass timing.
- Killing mid-run leaves a sealed partial deck with every finished slide intact.
- The end-of-build breakdown reports time **by step category** and names the slowest slides — i.e.
  it concretely answers "what kind of step takes the most time."
- `tsc` clean; the deterministic shell stays green under unit tests with fakes.
