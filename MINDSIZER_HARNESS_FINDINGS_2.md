# mindsizer harness — findings #2 (build-observability session)

_Date: 2026-06-24. Follow-up to `MINDSIZER_HARNESS_FINDINGS.md`. This run was the first with the
new observability layer (commit `433815a`), which made the time/cost structure **measurable**
instead of inferred. One build: Walter Benjamin, "The Work of Art in the Age of Mechanical
Reproduction" → 8-slide deck, **61m19s**. All numbers below are read straight from
`benjamin.outline.build/progress.jsonl` and the build's own end-of-run summary._

## TL;DR

The observability layer is good — keep it. It immediately surfaced the **single highest-value
optimization**, now quantified: **the per-slide iterate loop spent 15.5 min (≈25% of the whole
61-min build) revising slides that had already hit clean signals** (overflow 0 AND 0 console
errors). Worse, on one slide the extra iteration **regressed a clean result** — slide 8 reached
0px overflow at pass 4 and then *broke it*, sealing at 92px. An early-exit-on-clean rule would
have made this build both **faster and higher quality**.

Two bugs from the prior report were re-tested: the **prose-leak bug is FIXED** (did not recur);
the **missing-`id` bug is only PARTIALLY fixed** (1 of 8 slides still shipped without it).

---

## 1. The observability layer itself (works — keep & extend)

`mindsizer build` now writes `<stem>.outline.build/`:
- `status.json` — live snapshot (current index/total, pass, doneCount, elapsedMs, lastEvent).
- `progress.jsonl` — one `render_pass` event per pass with **`modelMs`, `renderMs`, `overflowPx`,
  `consoleErrors`**; a `slide_done` event per slide carrying full `timing.byCategory`
  (`author`/`revise`/`render`/`finalize`) + the sealed HTML; `slide_start` markers.
- `slides/` — per-slide finalized HTML; plus an incrementally-sealed partial deck at the output
  path that fills in as slides complete.
- End-of-run console summary with by-step % and slowest-slide list.

This was enough to diagnose looping **in real time** and to distinguish *productive* iteration
(fixing a real overflow) from *wasteful* iteration (revising an already-clean slide) — live, while
the build ran. **Suggested addition:** emit a `wastedPasses` / `postFirstCleanMs` counter per
slide (definition below), since that is the number the optimization targets.

---

## 2. Measured cost structure (confirms prior estimates with hard data)

End-of-build summary, verbatim:
```
build complete — 8 slides in 61m19s
  by step:  revise 58% · author 29% · render 2% · finalize 11% · overhead 0%
  slowest:  #8 14m14s (8 passes) · #3 13m14s (6 passes) · #1 9m11s (8 passes)
```
- **Model latency = ~98% of wall-clock** across the whole run (`renderMs` never exceeded ~2%).
  Confirms the prior session's 98.5% estimate with per-pass data.
- **`revise` is the dominant bucket (58%)** — and, per §3, a large share of it is avoidable.
- **Authoring is still sequential** — one slide author at a time, no fan-out. Parallelizing
  remains the biggest *latency* lever (independent, self-scoped slides); the early-exit below is
  the biggest *token/cost* lever and is far cheaper to implement.

---

## 3. THE headline finding — no early-exit when already clean (quantified)

Per-pass `overflowPx`/`consoleErrors`, straight from the log (`pN:overflow/errors`):

| # | pass-by-pass | passes | time | model time spent *after* first clean pass |
|---|---|---|---|---|
| 1 | p1:0/1 p2:**0/0** p3:0/0 p4:0/0 p5:0/0 p6:0/0 p7:0/0 p8:0/0 | 8 | 9.2m | **365s** (p3–p8, all clean — pure waste) |
| 2 | p1:0/1 p2:0/0 p3:0/0 | 3 | 4.2m | 36s |
| 3 | p1:493 p2:499 p3:500 p4:22 p5:500 p6:**0/0** | 6 | 13.2m | 0s (legit — fought a real overflow) |
| 4 | p1:360 p2:0/0 p3:0/0 | 3 | 5.1m | 58s |
| 5 | p1:**0/0** p2:0/0 p3:0/0 | 3 | 4.9m | **130s** (clean from pass 1, ran 3×) |
| 6 | p1:0/0 p2:0/0 | 2 | 5.3m | 60s |
| 7 | p1:358/1 p2:0/0 | 2 | 5.3m | 0s (legit) |
| 8 | p1:419 p2:419 p3:**3200** p4:**0/0** p5:0/0 p6:**216** p7:92 p8:92 | 8 | 14.2m | **281s** (p5–p8 after first clean — and it *regressed*) |

**Total model time spent after slides had already hit clean signals: 930s = 15.5 min ≈ 25% of the
61-min build.**

Two distinct failure modes, both visible in the data:

- **(a) Clean-looping (waste).** Slides 1 and 5 were measurably clean early (slide 5 from pass 1!)
  and kept revising to the cap / to 3 passes anyway. ~495s combined, zero measurable gain.
- **(b) Thrashing (waste *and* quality loss).** Overflow fixing is **unstable** — it can make
  things worse. Slide 3 went 22 → **500** → 0; slide 8 went **0 → 216 → 92** *after* already
  hitting 0 at pass 4. Slide 8 therefore **sealed at 92px overflow despite having been clean four
  passes earlier.** More iteration produced a *worse* artifact.

**The early-exit is inconsistent author judgment, not a rule:** slides reaching identical clean
signals exited anywhere from **2 to 8 passes**.

### Recommended fixes (data-backed, in priority order)

1. **Early-exit after the first pass with `overflowPx==0 && consoleErrors==0`** (optionally require
   2 consecutive clean passes for safety). On THIS build that saves ~15.5 min (~25%) **and** would
   have sealed slide 8 at 0px instead of 92px. Highest value, smallest change.
2. **Seal the best pass, not the last.** Track the lowest-(overflow, errors) rendering seen and
   finalize *that*, since revision can regress (slides 3 & 8). This makes overflow-at-seal
   impossible whenever any earlier pass was clean.
3. **Hard cap is fine as a backstop, but it's currently the *primary* exit for ~25% of slides** —
   it shouldn't be. Combine #1 + #2 and the cap rarely binds.

---

## 4. Bug status vs. the prior report

- ✅ **Prose-leak bug — FIXED.** No agent commentary / stray `<style>` tokens leaked into the
  sealed HTML this time (the Linear-session failure did not recur). Grep for `Here is the final` /
  `I avoided` / `API Error` etc. = 0.
- ⚠️ **Missing-`id` bug — PARTIALLY fixed (still present).** 7 of 8 sections shipped with
  `id="<slide-id>"`, but **slide 3 (`s_nl7xepsc`) shipped with only `data-slide-id`**, so its **45
  scoped `#s_nl7xepsc{…}` CSS rules silently did not apply** (unstyled button, loose/mispositioned
  text). The injection is **inconsistent**, not absent — so the fix needs to run for *every*
  section unconditionally at seal. (I hand-patched it post-build; backup at
  `benjamin.outline.raw.bak.html`.)
- ⚠️ **Seal-despite-overflow-warning — still present.** Slide 8 sealed with the build printing
  `⚠ s_i79i4bv9: overflows … by 92px`, exit 0. Harmless here (the clipped ~68–92px was trailing
  padding below a fully-visible footer), but it's the same advisory-not-gating behavior flagged
  before. Fix #2 above (seal the best pass) resolves it for free.

---

## 5. What carried over / didn't change

- Model latency dominates (~98%); authoring still sequential → **parallel authoring** is still the
  open big-ticket latency item from report #1.
- `revise` is still the largest step — but we can now see ~quarter of it is avoidable, which report
  #1 could only guess at.
- Per-slide quality was otherwise good: 8/8 slides have real content (530–953 chars), interactive
  instruments where useful (trace-the-chain, run-the-reproduction, trace-a-path), 0 real console
  errors, 0 external refs, fonts embedded.

## 6. Pointers

- Observability output: `benjamin.outline.build/{status.json,progress.jsonl,slides/}`.
- The iterate loop + exit decision to change: `src/agent/agentic-author.ts`,
  `src/render/design-brief.ts` (the "iterate until genuinely strong" instruction), `src/render/fit-check.ts`.
- Seal / `id`-injection: `src/cli.ts` seal path, `src/agent/extract-slide.ts`, section templates
  in `src/render/layouts/*.ts`.
- Artifacts: `benjamin.outline.html` (final, hand-patched slide 3) +
  `benjamin.outline.raw.bak.html` (raw build) + `benjamin.outline.build/` (full telemetry).

> Scope note: one build, 8 slides. But the early-exit waste (§3) is computed directly from
> per-pass telemetry, not estimated — and it reproduces the report-#1 pattern (slide 1 looped clean
> to the cap in BOTH the mitchell and Benjamin builds). The regression-on-extra-iteration (slide 8)
> is new and is the strongest single argument for sealing the best pass rather than the last.
