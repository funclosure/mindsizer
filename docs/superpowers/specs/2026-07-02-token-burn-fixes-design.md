# Token-burn fixes: seeded dud retry + output-token cuts

**Date:** 2026-07-02
**Status:** approved

## Problem

A 9-slide build (author = Fable 5) consumed ~688k input + 116k output tokens (~$23.72
API-equivalent, ~80% of a 5h usage window). Three structural causes, measured from the build's
`progress.jsonl` and usage summary:

1. **Content-dud retries re-author from scratch with zero feedback.** The content gate
   (`build-slide.ts`) runs after the authoring session has ended and throws `content-dud:`;
   `withRetry` in `build-deck.ts` re-runs the identical prompt. One slide tripped the gate 3
   times with near-identical duds — 4 full sessions and 11 of 26 render passes for one slide.
2. **The finalize message demands full HTML that is discarded.** `agentic-author.ts` seals
   `best.html` from the render-pass candidates; the model's closing full-HTML emission is only
   used if it never rendered — yet the finalize messages say "Output the FINAL HTML now".
   ~5k wasted output tokens × 13 sessions.
3. **Every revision pass resends the entire slide HTML** as the `render` tool's `html`
   argument (~5k output tokens), even when the revision is a two-line CSS tweak.

Output tokens are the most expensive and most heavily window-weighted kind; fixes B and C
roughly halve them. Fix A removes redundant full sessions (each also costs ~23k cache-creation
tokens).

## Fix A — seeded retry on content duds

Files: `src/render/content-gate.ts`, `src/render/build-slide.ts`, `src/render/build-deck.ts`,
`src/render/design-brief.ts`.

- New `ContentDudError extends Error` in `content-gate.ts` carrying `{ reason, html }`. Its
  `message` remains `content-dud: <reason>` so `isRetryableError` (`retry.ts`) and progress-log
  output are unchanged.
- `buildSlide` throws `ContentDudError` from both gates (heuristic and judge).
- In `build-deck.ts`, the per-slide retry closure holds a mutable `repair` slot. `onRetry` sets
  it when the error is a `ContentDudError`; overload/network retries leave it untouched, so a
  dud seed survives an interleaved 429/529 retry. The closure passes `repair` into `buildSlide`,
  which forwards it on the `AuthorRequest`.
- `AuthorRequest` (`design-brief.ts`) gains optional `repair?: { html: string; reason: string }`.
  When present, `slideAuthorPrompt` appends a user-prompt section: the previous attempt was
  rejected by the content gate for `<reason>`; its HTML follows; keep the working layout and
  styling where useful, but replace the placeholder/probe content with real teaching content
  for this slide.

## Fix B — finalize replies "DONE" instead of full HTML

Files: `src/agent/agentic-author.ts`, `src/render/design-brief.ts`.

- Both finalize messages returned by the render-tool callback (clean, and pass-cap reached)
  change to instruct: reply with the single word `DONE` — the harness has already captured this
  render as the final slide; do not output the HTML again.
- Safe because finalize messages only occur after at least one render, and once a candidate
  exists the sealed slide is always `pickBestCandidate(...).html`. The never-rendered fallback
  (model's final text) is preserved.
- The brief's output contract is reworded: emitting the full slide HTML as the final text
  applies only if `render` was never called.

## Fix C — edit-ops on the render tool

Files: `src/agent/query.ts`, new `src/agent/edit-ops.ts`, `src/render/design-brief.ts`.

- Render tool schema: `html` becomes optional; new optional
  `edits: Array<{ old: string; new: string }>`.
- New pure module `edit-ops.ts`: `applyEdits(base, edits)` → `{ html }` or `{ error }`. Edits
  apply sequentially; each `old` must appear **exactly once** in the current text (Edit-tool
  semantics). On failure the error names the failing edit index and whether it was not-found or
  not-unique.
- Session state lives in `runAgentic`'s tool wrapper: a `lastHtml` variable. Resolution per
  call: `html` given → use and store; else `edits` given and `lastHtml` set → apply, store on
  success, return the error as tool text on failure (model corrects or falls back to full
  HTML); neither given, or `edits` before any `html` → error text.
- `tools.render()` (the `AgenticTools` seam) and `Candidate.html` continue to receive the
  resolved **full** HTML — `agentic-author.ts` and `converge.ts` are untouched.
- The render tool description and the brief tell the model: after the first render, prefer
  `edits` over resending full `html`; send full HTML only for restructures.

## Testing

TDD against the existing `tests/` suites (bun test):

- `edit-ops`: single match, sequential edits, old-not-found, old-not-unique, empty edits,
  edits referencing text created by an earlier edit.
- `design-brief`: repair section present when `repair` is set, absent otherwise; contract
  wording change.
- `build-deck`: after a `ContentDudError`, attempt 2's `AuthorRequest` carries the seed; after
  an overload error it does not; seed survives dud-then-overload sequences.
- `build-slide`: gates throw `ContentDudError` with `html` attached.
- `query`/`agentic-author` via existing fake-tools seams: edits resolve against `lastHtml`;
  finalize messages contain the DONE instruction; sealed output still `best.html`.

Success: full `bun test` green; a subsequent real build shows materially lower output tokens
and dud retries that converge on the first seeded attempt.

## Out of scope

- Overflow-prone first drafts (brief height-budget tuning).
- A Fable entry in `pricing.ts` (cost readout falls back to Opus rates — cosmetic).
- Converge scoring, `RENDER_PASS_CAP`, or an in-session content gate (considered; user chose
  seeded retry).
