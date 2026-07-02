# `mindsizer review` — automated post-build deck review

**Date:** 2026-07-02
**Status:** approved

## Problem

`build` gates on *clean* (fit + console) and *non-dud* (content gate), but nothing checks that a
sealed deck is actually **good**: no eye on dead space or weak hierarchy, no hand on the
interactive controls, no cross-check of slide claims against the source. The understand-ai deck
shipped with a 280px dead-space band, an invisible-feedback button, and three content drifts
(wrong probe languages, genericized example, invented job category) — all found only by a manual
review: screenshot every slide, operate the controls, grep the transcript. This spec automates
that review as a findings-only subcommand.

## Decisions (locked)

- **Findings only** — no auto-fix, no re-seal, no publish integration. A fix loop can consume
  the findings later.
- **Four checks:** visual, interaction, content fidelity, deck coherence.
- **Reviewer model defaults to the author tier** (layout judgment is where the big model earns
  its keep), overridable per-role by env.
- **Architecture: agentic reviewer per slide** reusing the author's render-tool loop (approach A;
  a fixed pre-render pipeline and a single whole-deck session were considered and rejected —
  the former needs new image-input plumbing and blind control-clicking, the latter degrades
  judgment across ~30 screenshots).

## CLI

```
mindsizer review <outline.md> [--deck <deck.html>] [--json] [--concurrency <n>]
```

- `<outline.md>` anchors everything, mirroring `build`: slide ids/titles, theme (for the
  renderer's theme CSS), and the `*.context.json` sidecar (digest, angle, `sourcePath`).
- `--deck` overrides the deck path; default is `build`'s output convention
  (`<outline-dir>/<stem>.html`).
- Source text for the fidelity check: read `sidecar.sourcePath`, capped at 12,000 characters
  (head-truncated with a marker if longer). Degradation ladder: no source → digest-only
  fidelity; no sidecar → visual + interaction + coherence only (fidelity findings omitted, and
  the report says so).
- `--concurrency` as in `build` (default 4, `MINDSIZER_CONCURRENCY` respected).
- Exit code 1 if any **high**-severity finding survives; 0 otherwise. Failure to review a slide
  (model error after retry) is itself reported as a high finding rather than aborting the run.

## Modules

### `src/review/extract-deck.ts` — sealed-deck splitter (pure)

`extractSlides(deckHtml): { id, fragment }[]` — parses the **sealed deck** (node-html-parser,
already a dependency) and returns, per `<section data-slide-id>`, the slide's full fragment:
its id-scoped `<style>` block(s), the `<section>`, and its trailing `<script>` block(s), in
document order. Works on any deck — including hand-edited or downloaded ones where the build
dir is stale or absent (the understand-ai case). Also exported: `deckSlideIds(deckHtml)`.
Mismatches vs the outline (missing/extra sections) are reported as high findings, not errors.

### `src/agent/models.ts` — new role

`review` joins `author|ingest|judge`. Default: the author role's default model, effort
`medium`. Env: `MINDSIZER_REVIEW_MODEL` / `MINDSIZER_REVIEW_EFFORT` (legacy `MINDSIZER_MODEL`
applies as today).

### `src/review/slide-review.ts` — per-slide agentic reviewer

One `runAgentic` session per slide, with the existing render-tool contract pointed at the
*fixed* sealed fragment:

- **Tools:** `render` — first call renders the slide fragment at 1280×720; the model passes
  only `interactions`, never new html. Two small generalizations of existing plumbing enable
  this (both useful beyond review):
  - `runAgentic` gains an optional `opts.initialHtml` that pre-seeds the session's `lastHtml`.
  - `resolveRenderInput` gains a fourth rule: neither `html` nor `edits` given but `lastHtml`
    set → resolve to `lastHtml` (re-render as-is, e.g. to inspect interaction states). The
    "provide `html` or `edits`" error now fires only when there is no `lastHtml` at all.
  Screenshots, overflow px, and console errors come back exactly as in authoring. The model
  exercises whichever controls it judges epistemic (it can read the fragment for selectors) —
  resting state first, then interaction states. `edits` calls in a review session are refused
  by the review brief (and ignored structurally: findings, not fixes).
- **Prompt:** reviewer brief (system) — what good looks like per the Field genre: fit, dead
  space, hierarchy, off-theme styling; controls must respond visibly; content must trace to
  the source; severity rubric (high = wrong/broken/unreadable, medium = clearly worth fixing,
  low = polish). User turn: slide title, angle, digest, source excerpt, the fragment.
- **Output** (final text, zod-validated via `parseValidated`, retry-once on parse failure):

```ts
{ findings: Array<{
    check: "visual" | "interaction" | "content";
    severity: "high" | "medium" | "low";
    summary: string;      // one sentence
    detail: string;       // what/where, e.g. "401px band below the grids"
    suggestion: string;   // concrete fix direction
  }> }
```

Empty `findings` = slide passes. Render budget: hard cap of 6 render calls per slide (resting
+ interactions); the tool returns a "budget reached — write your findings" message at the cap.

### `src/review/deck-review.ts` — coherence pass (text-only)

One `runQuery` call on the review model: input is every slide's title, kicker, and visible
text (`slideText` from content-gate). Checks narrative order, duplicated ideas across slides,
terminology/style consistency (e.g. mixed kicker conventions). Same findings schema with
`check: "coherence"` and a `slideId: string | null` field (null = whole-deck finding).

### `src/review/report.ts` — findings → outputs (pure)

- Terminal: per-slide blocks, severity-sorted, `✗ high` / `⚠ medium` / `· low` markers; final
  tally line (`N high · M medium · K low across S slides`).
- `<deck-stem>.review.md` next to the deck: the same content in markdown, plus run metadata
  (deck path, source path, model, date).
- `--json`: `<deck-stem>.review.json` — `{ meta, slides: [{ id, title, findings }], deck:
  [coherence findings] }`.

### `src/cli.ts` — `runReview`

Arg parsing per house style; loads outline/theme/sidecar/deck; `playwrightRenderer(fitTheme)`
shared across the pool and disposed in `finally`; slides reviewed via `mapPool` (concurrency
4); coherence pass runs concurrently with the slide pool (it needs no renders); `printCost()`
at the end (usage meter labels gain a role-agnostic family fallback so review usage doesn't
mislabel as "author/Opus" — cosmetic rename to `Opus`/`Sonnet`/`Haiku` family labels).

## Error handling

- Deck unreadable / zero sections → hard fail (`fail(...)`), nothing to review.
- Sidecar or source missing → degrade per the CLI ladder above, stated in the report header.
- A slide session that throws after `withRetry` (overload-only retries; there is no content
  gate here) → synthesize a high finding `review failed: <message>` for that slide and
  continue.
- Renderer death mid-run → surfaced by the failing sessions as synthesized findings; the
  report still writes.

## Testing

- `extract-deck`: round-trip against a `sealDeck`-produced deck (multi-slide, style+script
  slides, style-less slides); hand-edited deck (extra whitespace/comments); missing section.
- `slide-review`: mocked `runAgentic` (the `tests/agent/agentic-author.test.ts` module-mock
  pattern): findings parsed and returned; empty findings; parse-failure retry; render-budget
  message at cap; interactions forwarded to the renderer.
- `deck-review`: mocked `runQuery`; coherence findings with null/id slideIds.
- `report`: golden-ish assertions on terminal text, markdown, and json shapes; exit-code
  logic (high → 1).
- `cli`: arg parsing (`--deck`, `--json`, bad flags), degradation ladder selection.
- `models`: `review` role resolution and env overrides.

## Out of scope

- Auto-fix / re-seal (future: a fix loop consuming `review.json` through the seeded-repair path).
- Publish/gh-pages integration.
- Reviewing decks with no outline (a `--deck`-only mode can come later; it would lose titles,
  theme, and fidelity context).
- PDF/video artifacts of the review.
