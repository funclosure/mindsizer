# Two layers: planning (Fable 5.1) and visual implementation (decoupled)

**Date:** 2026-09-04
**Status:** approved (brainstorm)

## Problem

mindsizer already has two layers — `ingest` (Sonnet tier: digest → angles → outline → art
direction) and `build` (Opus tier: a per-slide agentic author with eyes). But the seam is fuzzy:
the per-slide plan that crosses it is thin (title, prose, layout hint, role sentence, instrument
word), so the author still does the hardest *planning* work — what the comprehension device is,
what the reader operates, what maps to what, what the resting state shows — fused with visual
design inside the expensive render loop.

As models get stronger the planning layer should carry more, on the strongest model, and the
visual layer should be fully decoupled behind a reviewable, hand-editable contract that ANY
implementer can consume: Claude Code (with the artifact-diagramming skill) today, the mindsizer
harness whenever it is plugged back in.

## Decisions (from the brainstorm)

- **Layer 1 (planning) runs on Fable 5.1** and owns the comprehension device per slide.
- **Layer 2 (visual designer + implementation) is Claude Code itself for now**, guided by the
  artifact-diagramming skill and the Field identity. The harness is NOT retired: the plan format
  stays harness-pluggable and the harness fills any slide Layer 2 did not author.
- **Contract = `x.plan.md`**, a superset of `outline.md` (option 1 of three; the sidecar-JSON and
  plan-JSON-first shapes were rejected as not hand-editable).
- **Layer 2 output goes through the existing seal** (`build --resume`), not a free-form page.
- Quantitative mechanisms carry their data/formula in the plan, so Layer 2 draws, never invents.

## Boundary

| Layer 1 decides (per slide) | Layer 2 decides |
| --- | --- |
| **claim** — the one thing the reader believes after this slide | composition, layout, regions |
| **mechanism** — what moves: inputs, relation, output (the thing the picture must show) | typography and hierarchy within the theme |
| **device** — kind; what the reader operates; what visibly changes; resting state that reads alone | how the SVG/figure is drawn, how a control looks |
| **aha** — the moment or contrast the interaction exists to produce | animation and staging details |
| **content** — the words: title, prose, labels, numbers, quotes (ready to place) | rendering fixes: overflow, dead space, console errors |
| **data** — formula or actual numbers when the mechanism is quantitative | |
| **source** — the excerpt this slide is faithful to | |

Deck level, Layer 1 also owns `direction`: conceit, motif, and a one-line argument arc.

## 1. The plan file — `x.plan.md`

Same front-matter and `<!-- slide id=… layout=… -->` markers as today's outline, so the existing
parser reads it. Two additions:

### Front-matter `direction`

```yaml
---
title: …
purpose: teach
theme: field
source: { label: …, url: … }
direction:
  conceit: hand-cranking an engine until it catches
  motif: a crank / flywheel that appears in every instrument
  arc: manual force → why founders resist → the crank catches → when to stop cranking
---
```

This moves art direction out of the sidecar into the file the user edits. The sidecar keeps
`direction` too (unchanged) for the old `ingest` flow; when both exist the plan file wins.

### Per-slide ```plan fence

Each slide block keeps its `# Title` and prose, then ends with a fenced YAML block:

````markdown
<!-- slide id=s_2sv7wjjp layout=bespoke -->
# Startups Don't Start Themselves

(prose as today — this is the CONTENT Layer 2 places, not rewrites)

```plan
claim: A startup has no momentum of its own; founders supply it by hand until it self-sustains.
mechanism: >
  Growth = manual push + self-sustaining momentum. Early on the second term is ~0, so all
  growth is the founders' effort; once it crosses a threshold the second term dominates.
device:
  kind: instrument            # instrument | figure | comparison | sequence | static
  operate: drag a crank / effort slider (0–100%)
  changes: a growth curve splits into "manual" and "self-sustaining" bands; the engine icon
    catches once the self-sustaining band exceeds the manual one
  resting: crank at 40%, engine not yet caught, both bands visible and labelled
aha: releasing the crank BEFORE the catch point drops growth to zero; after it, growth continues.
data: >
  growth(t) = e·k + m(t); m(t) = m(t-1)·(1+r) with r = 0.05·e; catch when m(t) > e·k
source: >
  "The most common unscalable thing founders have to do at the start is to recruit users
  manually. … you have to go out and get them."
```
````

- `kind` is a closed enum: `instrument`, `figure`, `comparison`, `sequence`, `static`.
- `operate`, `changes`, `aha` are required for `instrument`; optional otherwise.
- `data` and `source` are optional strings.
- Old outlines with no fence parse exactly as before; `slide.plan` is `undefined`.
- A malformed fence (bad YAML, missing required field, unknown `kind`) is a **validation issue
  naming the slide** (`validateOutline`), never a parser crash.

### Code

- `src/outline/types.ts` — `SlidePlan` type (+ `PlanKind`), `OutlineSlide.plan?: SlidePlan`,
  `DeckMeta.direction?: { conceit; motif; arc }`.
- `src/outline/parse.ts` — lift the trailing ```plan fence out of the body into `plan` (YAML via
  gray-matter's bundled js-yaml); parse `direction` from front-matter.
- `src/outline/serialize.ts` — write `direction` and the fence back; round-trips byte-stable.
- `src/outline/validate.ts` — plan schema issues (zod), per slide.

## 2. `mindsizer plan <text> [--yes] [-o x.plan.md] [--source …] [--source-label …]`

Runs the existing ingest pipeline (digest → angles → outline → art direction), then one new step:

- **`planDeck`** — ONE whole-deck model call on the planner tier that sees the full source text,
  digest, angle, direction, and every slide's title + prose, and returns one plan object per slide
  (zod schema; array in slide order, same length). One call, not per-slide, so devices vary and the
  arc holds.
- Unlike art direction, planning failure is **fatal after one retry** — the plan is the product.
- Output: `x.plan.md` with `direction` in front-matter and a fence per slide, plus the usual
  `x.plan.context.json` sidecar (digest, angle, per-slide excerpts, direction) so `build` on the
  plan file keeps its current materials.

### Models

`src/agent/models.ts`: the `ingest` role default becomes **`claude-fable-5-1`, effort `high`** —
digest, angles, outline, direction and planning all run on it. (Verify the exact model id against
the `claude-api` skill during implementation.) Per-role env overrides unchanged; `judge` and
`review` untouched; `author` stays Opus for the harness path.

The existing `ingest` command stays as `plan` minus the planning step (old flow).

### Code

- `src/agent/model-client.ts` — `SlidePlanSchema`, `DeckPlanSchema`, optional
  `planDeck(source, digest, angle, direction, slides)` on `ModelClient` (optional keeps fakes valid;
  `plan` command fails loudly if the client lacks it).
- `src/agent/prompts.ts` — `planPrompt(...)`: the boundary table above as the system prompt; the
  "mechanism, not its name" principle; JSON only.
- `src/agent/anthropic-client.ts` — implement `planDeck` on the ingest tier.
- `src/agent/ingest.ts` — `ingest(text, deps, { plan: true })` runs `planDeck` after direction
  and attaches plans + direction to the outline before serializing.
- `src/cli.ts` — `runPlan` (reuses `runIngest` with `plan: true`).

## 3. Layer 2 in Claude Code — the `mindsizer-author` skill

New repo skill `.claude/skills/mindsizer-author/SKILL.md`. It makes a Claude Code session the
visual designer for a plan file. Steps it prescribes:

1. **Read `x.plan.md`.** Load the `artifact-diagramming` skill (figures: depict the mechanism,
   label the arrows, inline SVG, `currentColor`). Run `mindsizer brief` (new; below) for the
   Field identity and the slide contract — the skill never duplicates the brief text.
2. **Author each slide from its plan** into `x.plan.build/slides/<id>.html` — the exact file shape
   the harness saves: optional id-scoped `<style>`, one `<section data-slide-id=… data-layout=
   "bespoke">`, optional scoped `<script>`. 1280×720, no scrolling, resting state reads alone,
   interactions epistemic, no layout measurement at load (slides load hidden).
3. **Check each slide with `mindsizer fit <slide.html>`** (new; below): overflow px, console
   errors, screenshot path. Look at the screenshot; fix; re-check. Stop when clean.
4. **Seal:** `mindsizer build x.plan.md --resume` reuses every saved slide, hands any *missing*
   slide to the harness, seals with theme + deck runtime, and runs the post-seal verify.
5. **Show it:** publish the sealed HTML as an Artifact (and/or `open` it).

Mixing is free: hand-author three slides, the harness authors the rest in the same resume build.

### New CLI commands

- **`mindsizer brief [--theme <name>]`** — prints `identityBrief(theme.aesthetic)` (the author
  system prompt: genre, format, aesthetic, interactivity rules, output contract). Single source of
  truth for both layers' identity.
- **`mindsizer fit <slide.html> [--shot <png>] [--steps <json>]`** — wraps `src/render/fit-check.ts`
  for one saved section file: reports `overflowPx`, `consoleErrors`, writes the screenshot, exit
  code 1 when not clean. Optional interaction steps so interactive states get checked too.

## 4. Harness pluggability

- `src/render/materials.ts` — `SlideMaterials.plan?: SlidePlan` (from `slide.plan`);
  `direction` falls back to `outline.meta.direction` when the sidecar has none.
- `src/render/design-brief.ts` — when `materials.plan` is present, render a **"Slide plan"**
  block in the USER prompt (claim / mechanism / device / aha / data / source) ahead of the prose,
  with a one-line instruction: *implement this plan; do not re-plan*. The existing art-direction
  lines remain the fallback for plan-less outlines.
- `build`, `seal`, and `review` accept a plan file with no changes (it is a valid outline).

## 5. Error handling

- Plan fence errors → validation issues (slide id + message); `build`/`seal` refuse as today.
- `planDeck` returns wrong length / fails schema → one retry with the schema error in the prompt,
  then fatal with the raw reply saved to `<stem>.plan.raw.json` for inspection.
- `fit` on a file with no `<section>` → exit 2 with a clear message.
- `build --resume` on a plan file with zero saved slides → plain harness build (already true).

## 6. Testing

Unit (fakes, Vitest):
- parse/serialize round trip with `direction` + fences; fence-less outline unchanged; malformed
  fence → validation issue naming the slide; unknown `kind` rejected.
- `ingest` with `plan: true` attaches plans by index; planner failure surfaces after one retry;
  `plan: false` path untouched.
- `gatherMaterials` forwards `plan` and falls back to front-matter `direction`.
- `slideAuthorPrompt` includes the plan block iff present.
- CLI: `plan` writes plan.md + sidecar; `brief` prints the theme brief; `fit` argument handling.

Live (run, not unit): `mindsizer plan examples/dont-scale.txt` on Fable 5.1 → read the plan →
author the deck through the `mindsizer-author` skill → `build --resume` → compare against the
bundled `examples/dont-scale.deck.html`.

## Out of scope

- Retiring or rewriting the agentic-author harness.
- Theme auto-selection; new themes.
- A Layer 2 driver inside the CLI (Layer 2 is a Claude Code skill for now).
