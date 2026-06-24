# Design: Converge & Seal-Best

Date: 2026-06-24
Status: Approved (brainstorm) — ready for implementation planning
Builds on: the observability layer (`2026-06-24-build-observability-design.md`) whose telemetry
quantified this work. Companion finding: `MINDSIZER_HARNESS_FINDINGS_2.md`.

## 1. Context & motivation

The first telemetry build (Benjamin, 8 slides, 61m) proved two things with per-pass data:

1. **~25% of the build (15.5 min) was spent revising slides that were already clean**
   (`overflowPx ≤ 2` AND `consoleErrors == 0`). The agentic author keeps iterating past
   convergence — slides hitting identical clean signals exited anywhere from 2 to 8 passes.
2. **Extra iteration can make the artifact worse.** Slide 8 reached `overflow 0` at pass 4, then
   regressed to 216 → 92 and **sealed at 92px**. We currently seal the model's *last* emitted
   HTML, so a post-convergence regression ships.

Plus a verified reliability gap: the author adds `id="<slide-id>"` to the section only
*inconsistently* (7/8 slides this run; slide 3 shipped with only `data-slide-id`, so its 45 scoped
`#id{…}` CSS rules were dead). The `design-brief` template fix from the prior phase is not reliable.

This phase makes the loop **converge** (stop wasting passes once clean) and **seal the best pass**
(never ship a regression or an overflow when an earlier pass was clean), guarantees the section
`id`, and adds a cheap whole-deck safety net. It targets **cost and quality together** and is far
cheaper than parallelization (which remains the separate, later *latency* lever).

## 2. Goals / non-goals

Goals:
1. **Seal the best rendered pass, not the model's last text** — lowest `consoleErrors`, then lowest
   `overflowPx`, first-seen on ties. Quality guarantee: no overflow-at-seal or regression whenever
   any earlier pass was clean.
2. **Converge**: once a render is clean, signal the model to finalize and stop feeding it new
   screenshots; a hard pass cap (4) backstops. Recovers most of the ~25% waste.
3. **Unconditional `id` injection**: every sealed `<section data-slide-id="X">` also carries
   `id="X"`, regardless of what the author emitted.
4. **Whole-deck safety net**: after seal, load the assembled deck once headless and assert
   section-count == outline, 0 console errors, no loose text nodes directly under `.deck`; fail the
   build (non-zero) loudly on a trip, deck preserved.

Non-goals (later / separate):
- Parallelizing slide authoring (the big *latency* lever) — separate phase.
- Per-slide re-author-on-hard-failure / retry (R3) — the best-pass seal + cap already bound the
  damage; full gating is a later reliability pass.
- The robust extractor (R1) — already fixed last phase; the prose-leak did not recur.

## 3. The convergence loop (the core change)

Today `agenticAuthor` lets the model self-iterate via the `render` tool with **no cap** and seals
`extractSlideHtml(model.finalText)`. The new loop has the harness govern the loop and pick the
artifact, while the model still authors:

```
authorSlide(req, onPass):
  candidates: { html, overflowPx, consoleErrors }[]   // one per render call
  passes:     PassTiming[]                             // unchanged (timing)
  CAP = 4

  runAgentic(system, user, { render: async (html, interactions) => {
      // … existing timing capture (modelMs / renderMs) and onPass(…) …
      const r = await renderer.render(html, interactions)
      candidates.push({ html, overflowPx: r.overflowPx, consoleErrors: r.consoleErrors.length })

      const clean = r.fits && r.consoleErrors.length === 0   // r.fits === overflowPx ≤ 2
      if (clean)
        return { text: "✅ This slide is clean — no overflow, no console errors. Output the FINAL HTML now and do NOT call render again." }
      if (candidates.length >= CAP)
        return { text: `Render budget reached (${CAP} passes). Output your BEST version now and do NOT call render again.` }
      return { images: r.shots }   // normal: screenshots to keep iterating
  }})

  const best = pickBestCandidate(candidates)             // see §5A
  const raw  = best ? best.html : modelFinalText          // fallback only if it never rendered
  return { html: ensureSectionId(extractSlideHtml(raw), req.slide.id), timing: … }
```

Key properties:
- **Best-pass sealing makes "what the model does after clean" irrelevant to the output.** Even if the
  model ignores the nudge and keeps going, we seal the best candidate, not its final ramble.
- The clean signal returns **text instead of a screenshot**, denying the model the visual fuel that
  drives clean-looping. The cap is a hard backstop, but with the nudge it rarely binds.
- We seal the html the model **rendered** (a verified candidate), never an unrendered final edit.

## 4. The render-tool result contract change

The author's render function must be able to return *either* screenshots *or* a text signal, so the
`AgenticTools.render` contract (in `src/agent/query.ts`) changes from `Promise<Buffer[]>` to:

```ts
export type RenderToolResult = { images: Buffer[] } | { text: string };
export interface AgenticTools {
  render(html: string, interactions?: Interaction[]): Promise<RenderToolResult>;
}
```

`runAgentic`'s in-process `render` tool maps it: `images` → MCP image content blocks (as today);
`text` → a single text content block. Nothing else about `runAgentic` changes.

## 5. Components & interfaces

### A. Convergence scoring — `src/render/converge.ts` (pure, unit-tested)
```ts
export interface Candidate { html: string; overflowPx: number; consoleErrors: number; }
export function isCleanCandidate(c: Candidate): boolean;          // overflowPx ≤ 2 && consoleErrors === 0
export function pickBestCandidate(cands: Candidate[]): Candidate | undefined;
// lowest consoleErrors, then lowest overflowPx; first-seen wins ties; undefined if empty
export const RENDER_PASS_CAP = 4;
```

### B. `id` normalization — `src/outline/inject.ts` (pure, unit-tested)
```ts
/** Ensure every <section data-slide-id="X"> also carries id="X" (idempotent). */
export function ensureSectionId(html: string, expectedId: string): string;
```
Uses the existing `node-html-parser`. If the section already has the right `id`, returns the html
unchanged; otherwise injects `id="<expectedId>"`. Applied to the chosen html in `agenticAuthor`
*after* `extractSlideHtml`, so the guarantee holds no matter what the author emitted.

### C. Render-tool result — `src/agent/query.ts` (integration)
`RenderToolResult` + the `render` tool mapping above. Verified-by-running.

### D. Agentic author — `src/agent/agentic-author.ts` (integration)
The loop in §3: capture candidates, signal clean/cap (text), pick best, normalize. Timing capture
(`onPass`, `computeSlideTiming`) is unchanged. Verified-by-running.

### E. Brief update — `src/render/design-brief.ts`
Replace the open-ended "iterate until it is genuinely strong" in the EYES section with convergence
guidance: *"Render to check your work. The moment a render comes back with no overflow and no
console errors, the slide is fit-complete — output the final HTML and stop; the render tool will
tell you when it's clean. Don't keep polishing a clean slide."* Also note the section's `id` is
added automatically, so authors should write `#SLIDE_ID` selectors freely. Unit-tested (the
existing `design-brief.test.ts` asserts on key phrases — update those assertions).

### F. Whole-deck verification — `src/render/fit-check.ts` (integration) + `src/cli.ts`
```ts
export interface DeckCheck { sectionCount: number; consoleErrors: string[]; looseText: string[]; }
export async function verifyDeck(html: string): Promise<DeckCheck>;
```
Launches headless chromium, `setContent(sealedHtml)`, and reports: the count of
`.deck section[data-slide-id]`, any console errors on load, and the text of any non-whitespace text
node that is a **direct child of `.deck`** (the loose-prose signature). cli calls it after the build
seals, compares `sectionCount` to `outline.slides.length`, prints a clear report, and **exits
non-zero** if any check trips (the deck file is left in place for inspection/hand-fix). Kept out of
the render barrel (like the rest of `fit-check`); verified-by-running.

## 6. Data flow

```
build → buildDeck(… author=agenticAuthor …)
          per slide: render*  → candidates → pickBestCandidate → ensureSectionId → section
        → fileSink seals the deck (unchanged)
cli   → verifyDeck(sealedHtml) → assert count/console/loose-text → print + exit code
```

## 7. Error handling
- `pickBestCandidate([])` → `undefined`; the author falls back to the model's final text (slide that
  never rendered — rare). `ensureSectionId` still runs.
- `verifyDeck` chromium failure → treat as a non-fatal warning (don't fail the build on the checker
  itself breaking), but log it.
- A slide that never converges (cap hit, all dirty) seals the least-overflow candidate; the existing
  per-slide overflow warning still fires — expected for genuinely un-fittable content.

## 8. Testing strategy
- **Unit (pure):** `pickBestCandidate` (errors-then-overflow ordering, tie = first-seen, empty →
  undefined), `isCleanCandidate` (boundary at overflow 2), `ensureSectionId` (injects when missing,
  idempotent when present, leaves other attrs intact), `design-brief` phrase assertions updated.
- **Verified-by-running:** the `RenderToolResult` mapping + `agenticAuthor` convergence loop (a real
  short build: confirm via `progress.jsonl` that a clean slide stops at ≤ its first clean pass + 1,
  and that the sealed html equals the best candidate); `verifyDeck` on a known-good and a known-bad
  deck (one with a missing-`id` section / loose text).

## 9. Build order (for the plan)
1. `converge.ts` (`isCleanCandidate`, `pickBestCandidate`, `RENDER_PASS_CAP`) + tests.
2. `ensureSectionId` in `inject.ts` + tests.
3. `RenderToolResult` contract in `query.ts` (+ the tool mapping).
4. `agentic-author.ts` convergence loop (candidates, signals, best-pass, normalize).
5. `design-brief.ts` convergence wording + updated test.
6. `verifyDeck` in `fit-check.ts`.
7. cli: call `verifyDeck` post-seal, report + exit code.
8. Live verification on the bundled example (or a short outline): confirm early-exit in
   `progress.jsonl`, best-pass sealing, `id` on every section, and the deck check.

## 10. Success criteria
- On a live build, a slide that renders clean stops within one pass of going clean (visible in
  `progress.jsonl`), and the sealed section equals the best candidate, not a later regression.
- Every sealed `<section data-slide-id="X">` also has `id="X"`.
- `verifyDeck` passes on a healthy deck and fails the build (non-zero, loud) on a section-count
  mismatch, console error, or loose text under `.deck`.
- Re-running the Benjamin-style case, total post-first-clean model time drops sharply vs the
  baseline (~25% recovered) and no slide seals with overflow when an earlier pass was clean.
- `tsc` clean; deterministic/pure pieces green under unit tests.
