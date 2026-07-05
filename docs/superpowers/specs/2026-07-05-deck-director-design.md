# Deck director — whole-deck art direction & coherence

**Date:** 2026-07-05
**Status:** approved (design-workflow synthesis, adversarially critiqued)
**Build order:** SECOND (after fit-converge) — adds author-tier tokens, larger surface.

## Problem

Slides are authored independently in a parallel pool (`build-deck` `mapPool`) with only a shared
theme brief + neighbor titles. Result: individually strong slides, but the *deck* drifts. Observed
on a real build (confirmed by the audit): the controlling metaphor flipped ("pass through" vs
"close/seal") across slides, and two slides duplicated the same three items. There is no "whole-deck
author" holding the piece together — and every deck defaults to the same Field theme. This is the
coherence half of the clean-not-correct gap.

## What was rejected (critic-refuted, do NOT build)

- **Making `directArt` a REQUIRED `ModelClient` method + calling it unguarded.** Refuted: it breaks
  every inline fake in `ingest.test.ts` at runtime (`directArt is not a function`), and a transient
  Sonnet failure would discard an already-validated outline. → `directArt` is **OPTIONAL** and the
  call is **guarded + try/catch**, degrading to no direction. This also keeps the existing fakes and
  the `meta.theme==='field'` assertion working with zero edits.
- **Theme auto-selection by "content mood."** Refuted: only `field` + `paper` exist, so it's a
  coin-flip that swaps a deterministic default for model nondeterminism and forces test churn for
  near-zero range. **Cut from v1** — theme stays the deterministic `'field'` default + existing
  `--theme` override. Revisit once 3–4 real themes exist.
- **Claiming "no two slides duplicate content / repeat an instrument" as a build-time guarantee.**
  Refuted: the `SlideJudge` sees only one slide's `{title, angle, html}`, so it can't hard-fail
  cross-slide duplication. These are honestly labeled **advisory author hints**; the real
  cross-slide enforcement threads into the **review coherence pass** (which sees the whole deck).

## Design

A single cheap ingest-tier model op runs once after the outline is minted, producing an immutable,
slide-id-keyed direction map that the parallel author pool only reads.

### `src/agent/model-client.ts`
- `ArtDirectionSchema = z.object({ conceit: string, motif: string, slides: z.array(z.object({ role: string, instrument: z.enum(INSTRUMENTS) })) })` — **no theme field**.
- `export const INSTRUMENTS` — a fixed palette (e.g. `['slider','toggle','stepper','chart','dial','reveal','none']`).
- `export type DeckDirection`.
- Add `directArt(digest, angle): Promise<...>` as an **OPTIONAL** method on `ModelClient` (optional keeps existing clients/fakes valid).

### `src/agent/prompts.ts`
- `artDirectionPrompt(digest, angle, titles)` — fed digest + angle + slide **titles only** (never
  full slide markdown, to bound this call's own input tokens). System asks for one `conceit`, one
  `motif`, and per-slide `role` + one palette `instrument`; JSON only; `slides` array same length +
  order as `titles`. Reuse `digestText()`.

### `src/agent/anthropic-client.ts`
- Implement `directArt` calling `ask(system, user, ArtDirectionSchema, 'art-direction', choice)` at
  the ingest (Sonnet) tier.

### `src/agent/ingest.ts`
- After the outline is built with minted IDs, call `directArt` **guarded** (`if (deps.model.directArt)`)
  inside **try/catch** → degrade to no direction on any failure.
- Zip role/instrument to slide IDs by index. **Dedup instruments on ANY collision** via deterministic
  round-robin over the palette (not only on a length mismatch — a correct-length reply with duplicate
  instruments must still be deduped, else variety is defeated).
- Leave `theme = 'field'` unchanged (no auto-select). Extend `IngestResult` with optional
  `direction { conceit, motif, roleById, instrumentById }`.

### `src/agent/context-sidecar.ts`
- Add optional `direction?: { conceit, motif, roleById, instrumentById }` to `DeckContext`.
- Round-trip it in `parseContext` defensively (object-guard each field; default the two maps to `{}`;
  `undefined` when absent). Leave the required-field check (`digest[]` + `angle`) unchanged so old
  sidecars still parse.

### `src/cli.ts`
- `runIngest`: serialize `direction` into the sidecar when present (best-effort, unchanged try/catch).
- `runReview`: thread `direction.conceit` / `direction.motif` into `reviewDeckCoherence` — **this is
  the real enforcement seam**: a flipped metaphor or role duplication gets CAUGHT at review time.
- No `listThemes` threading (theme unchanged).

### `src/render/materials.ts`
- Extend `SlideMaterials` with optional `conceit/motif/role/instrument/otherInstruments`.
- `gatherMaterials` reads `ctx.direction` and derives `otherInstruments` = instrument map minus self
  (deterministic, pool-safe, `undefined` when empty).

### `src/render/design-brief.ts`
- `slideAuthorPrompt` adds terse, **presence-guarded** lines to the USER string only (controlling
  metaphor / shared motif / this slide's job / assigned interaction + already-claimed) — labeled as
  advisory art-direction hints. `identityBrief` system prompt stays generic; `AuthorRequest`
  signature unchanged (fields ride on `materials`).

## Testing

- `model-client.test.ts`: `ArtDirectionSchema` cases. `prompts.test.ts`: `artDirectionPrompt` cases.
- `materials.test.ts` + `design-brief.test.ts`: presence/absence tests (survive as-is otherwise).
- `context-sidecar.test.ts`: `direction` round-trip **+ an old-sidecar backward-compat test** (load-bearing).
- `ingest.test.ts`: **one** new test with a fake that DOES implement `directArt` (asserts index-zip,
  collision dedup, degrade-on-throw). Because `directArt` is optional, the 4 existing inline fakes and
  the `meta.theme==='field'` assertion need **no** edits.
- `deck-review`/`cli`: update `reviewDeckCoherence` signature/test for the threaded conceit/motif.

## Risks (accepted for v1)

- **Advisory, not enforced at author time:** role/instrument non-duplication only reaches the author's
  USER prompt; enforcement leans on the review coherence thread + author compliance. Do not claim a
  build-time guarantee.
- **Author-tier token cost:** 4–5 terse lines injected into every author prompt on every render pass
  (mitigated by keeping lines terse and `directArt` titles-only). This is why fit-converge ships first
  — it pays down the loop so these tokens land leaner.
- **`conceit`/`motif` are free-form/unchecked** — only the review thread catches a flipped metaphor,
  and only if that thread ships.
- **Sidecar contract growth** — hand-written outlines (no sidecar) and pre-existing sidecars must keep
  building; covered by the optional field + presence guards; the backward-compat test is load-bearing.

## Out of scope

Theme auto-selection (revisit with more themes). A dedicated content-correctness gate (separate
follow-up — this feature addresses coherence, not per-claim correctness).
