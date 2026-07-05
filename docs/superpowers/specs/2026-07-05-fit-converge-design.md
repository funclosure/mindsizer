# Smarter fit-check + hard convergence (token-burn cut)

**Date:** 2026-07-05
**Status:** approved (design-workflow synthesis, adversarially critiqued)
**Build order:** FIRST (before deck-director) — removes author-tier waste, contained blast radius, verifiable by a pass-count drop.

## Problem

The build's `revise` loop dominates wall time and author-tier tokens. Two structural causes,
both confirmed against the code:

1. **Phantom overflow.** `fit-check.ts` samples the section's overflow metrics *after* the
   interactions loop (`fit-check.ts:74-79`), so an interactive element the model expanded (an
   accordion/toggle left open) inflates `scrollHeight` and reads as real overflow — the model then
   burns revise passes "fixing" a slide that fits at rest (the observed 104px phantom on a toggle).
2. **Polishing past done.** After a clean render the loop only returns a *soft text nudge*
   (`FINALIZE_CLEAN`) the model can ignore, so it keeps calling `render` — each call re-runs
   Playwright and returns fresh screenshots (heavy input tokens) for a slide already sealed.

## What was rejected (critic-refuted, do NOT build)

- **A descendant-clip scan** (flag any child whose `scrollHeight>clientHeight` under `overflow:hidden`).
  Refuted: this is the canonical idiom for rounded-corner cards, gauges/dials, marquees, progress
  bars, and absolute decorative bleeds — all common and *intentional* in the interactive-instrument
  aesthetic. It would false-positive on valid slides, so `isCleanCandidate` never fires and every
  slide runs to `RENDER_PASS_CAP` — strictly *more* revision. Deferred behind its own gating
  (readable-text signal + decorative exclusions) and tests.
- **`ac.abort()` + a `RenderToolResult` stop-flag + `latestUsage` accrual in `query.ts`.** Refuted:
  the pure short-circuit already delivers the cost win; the abort path under-counts usage (it would
  *replace* rather than *sum* per-turn usage) and is timing-fragile. `query.ts` stays UNCHANGED.

## Design

### `src/render/render-helpers.ts` — pure overflow resolution

- `export const OVERFLOW_TOLERANCE_PX = 2` — single source of truth.
- Keep `computeOverflow` as-is; add `horizontalOverflow(m) = max(0, m.sw - m.cw)`.
- Add a pure `resolveOverflow({ resting, expandedHoriz, expandedBeyondFrame })`:
  - `overflowPx = max( computeOverflow(resting), max(expandedHoriz…), max(expandedBeyondFrame…) )`
  - returns `{ overflowPx, axis: 'resting'|'expanded-horizontal'|'expanded-vertical'|'none', detail }`.
  - **No inner-clip term** (scan dropped from v1).

Rationale for the two expanded terms: a *within-frame* transient expansion (an accordion that
opens but stays inside 720px) is ignored — that kills the phantom. But an expanded state that
grows the section **beyond the 720px frame** (`sh - 720 > 0`) is still flagged — that catches a
genuinely broken reveal, closing the false-negative the "ignore all expansion" approach would open.
Horizontal spill in any state is always real overflow.

### `src/render/fit-check.ts` — resting-authoritative measurement

- In `render()`: sample the resting section metrics **before** the interactions loop.
- Keep the interactions loop (the model still needs the screenshots), but per interaction frame
  capture `horizontalOverflow` (sw−cw) and `expandedBeyondFrame = max(0, sh − 720)` into two arrays.
- **Delete** the post-loop metrics block (lines 74-79).
- `o = resolveOverflow({ resting, expandedHoriz, expandedBeyondFrame })`; return
  `fits = o.overflowPx <= OVERFLOW_TOLERANCE_PX`, `overflowPx = o.overflowPx`, `detail = o.detail`.
- `check()` (no interactions) is unaffected — empty arrays → resting-only.

### `src/render/converge.ts` — shared basis

- Import `OVERFLOW_TOLERANCE_PX`; replace the hardcoded `c.overflowPx <= 2` in `isCleanCandidate`
  so `fits` and `isCleanCandidate` share one constant. Keep `FINALIZE_CLEAN` / `finalizeBudget`
  string constants (still asserted by tests). No new finalize builders.

### `src/agent/agentic-author.ts` — pure post-seal short-circuit

- Closure state: `let sealed = false; let postSealRenders = 0;` and a `GRACE` constant (e.g. 3).
- At the **top** of the render callback, before `renderer.render()`:
  ```ts
  if (sealed) {
    postSealRenders++;
    return { text: postSealRenders < GRACE ? FINALIZE_CLEAN : finalizeBudget(RENDER_PASS_CAP) };
  }
  ```
  — short-circuits WITHOUT invoking Playwright and WITHOUT pushing a candidate; bounded by the
  grace counter (the SDK `max_turns` is the ultimate backstop).
- When `isCleanCandidate(cand)` first fires: set `sealed = true` and return `{ text: FINALIZE_CLEAN }`
  (shape unchanged — no stop flag). Sealing still runs `pickBestCandidate(candidates)`, so the first
  clean pass wins.
- **No `ac.abort()`.**

### `src/agent/query.ts` — UNCHANGED

`RenderToolResult` stays `{ images } | { text }`. No stop signal, no abort, no usage accrual.

## Testing

- `render-helpers.test.ts`: `resolveOverflow` unit cases per winning axis (resting-vertical,
  resting-horizontal, expanded-horizontal, expanded-vertical-beyond-frame, none) + the 2px boundary
  + `horizontalOverflow`; assert `OVERFLOW_TOLERANCE_PX === 2`.
- `fit-check.test.ts`: keep existing `check()` tests; **add** interaction-path tests (currently zero
  coverage): a within-frame expand is IGNORED (fits), an expanded-horizontal spill is FLAGGED, an
  expanded-beyond-720 vertical is FLAGGED.
- `converge.test.ts`: assert `isCleanCandidate` uses the imported constant (2→true, 3→false).
- `agentic-author.test.ts`: existing sealing test stays `{ text: FINALIZE_CLEAN }`; **add** a
  short-circuit test — a render spy scripting 3 post-seal render calls asserts `renderer.render` ran
  exactly ONCE, the sealed html is the first clean candidate, and post-seal replies are finalize text.

## Risks (accepted for v1)

- **Partial false-negative:** a broken reveal that clips *within* the frame (a fixed-height child
  with its own `overflow:hidden`) is still missed — that was the dropped clip-scan's job. Beyond-frame
  reveals are caught. Deferred behind the clip-scan's own gating + tests.
- **Post-seal bound** now relies on the grace counter + SDK `max_turns`, not a hard abort — cost-safe
  (no Playwright/screenshots on post-seal calls) but confirm `max_turns` is sane in `query()` options.
- **Reveal-to-read content:** grading the resting frame authoritative could mis-grade a slide whose
  substance appears only post-interaction. `content-gate`'s `MIN_SLIDE_CHARS` on resting text bounds
  this; spot-check no shipped deck depends on post-interaction substance.
- The 55–67% revise figure is motivation, not proof — measure per-slide pass counts on a real build
  before/after to confirm the savings.

## Out of scope

Model right-sizing (Haiku for simple slides) — noted as a follow-up. Content-correctness gate — its
own follow-up (neither feature here closes the clean-not-correct gap).
