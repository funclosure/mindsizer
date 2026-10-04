# mindsizer eval rubric

This is the measuring stick for **deck quality**: whether a deck makes a dense idea click. Until now,
harness changes were measured on time and cost. The rubric exists so the planned *skeptical
evaluator* change, and anything after it, can be measured on quality before and after.

The judge prompts implementing this rubric live in [`lib/criteria.ts`](lib/criteria.ts). The
scorer is [`score.ts`](score.ts). How to run it: [README.md](README.md).

## Principles

These follow Anthropic's evals and harness-design writing:

- **One isolated judge call per criterion.** Every criterion gets a fresh model session with no
  shared context. No call grades everything.
- **Judges grade the rendered artifact, not the process.** Every slide is split out of the sealed
  deck (`src/review/extract-deck.ts`) and rendered standalone in Chromium at 1280×720, in the same
  page shell the author's render tool uses (`src/render/fit-check.ts`). Judges see screenshots. They
  see code-derived text only where exact wording matters (fidelity).
- **Evidence or it didn't happen.** Every verdict quotes what the judge saw. Every judge can answer
  `"unknown"`, which is stored as `null` and excluded from means.
- **Skeptical by instruction.** "A slide that is merely clean and tidy is a 2, not a 3. A 3 must
  earn it; a 4 is rare."
- **Scores are 1–4**: 1 = fails, 2 = weak, 3 = good, 4 = exceptional. **Pass is ≥ 3.** The 1–4
  scale has no neutral midpoint, so a judge must commit to one side of the pass line.
- **Deterministic checks where code can see.** Overflow, overlapping text, cut-off text, text
  outside the frame, WCAG contrast and console errors are computed in code and stored raw. They
  *cap* the craft score; the judge never gets to override them.
- Judge model: `claude-opus-5-5`, effort `medium` (`EVAL_JUDGE_MODEL` / `EVAL_JUDGE_EFFORT`).

## Per-slide criteria

| # | criterion | what the judge sees | question |
|---|---|---|---|
| 1 | `claim_at_rest` | **only** the resting screenshot (call 1); then text only (call 2) | Call 1 writes the one claim the slide makes. Call 2 compares it with the plan's `claim`. Outline-only decks compare against title + markdown. |
| 2 | `mechanism_shown` | rest + up to 3 interacted shots + the plan's `mechanism` | Is the mechanism *depicted* (a drawn relation: inputs → relation → output) or only *named* in text? |
| 3 | `device_works` | rest + control inventory + plan `operate`/`changes`/`aha`; **drives the slide** through a `drive` tool | Does doing `operate` visibly produce `changes`? Can a viewer reach the `aha`? Instrument slides only (outline-only decks: slides with detected controls). |
| 4 | `fidelity` | full source text + the slide's extracted on-screen text + screenshots | Does every number, name, quote and claim trace to the source? |
| 5 | `craft` | rest + deterministic check results | Hierarchy and dead space. Final = min(judge, deterministic cap). |
| 6 | `not_generic` | rest + the named-defaults list + the theme brief | Which named defaults are present? Is the form specific to this idea? |

### Anchors

**claim_at_rest**
- 4: The claim read from the resting slide states the intended claim's full assertion, including its causal or relational part. Nothing important is missing or added.
- 3: Same core assertion as intended. A secondary nuance or qualifier is lost.
- 2: Right topic, wrong or missing point. The reader names the subject but not the assertion, or reads a weaker or different claim.
- 1: No claim, a contradictory claim, or the slide is unreadable at rest.

**mechanism_shown**
- 4: The mechanism is DRAWN. A viewer can trace inputs → relation → output in the figure itself, without needing the sentences.
- 3: The mechanism is depicted with real visual structure (axes, arrows, flows, linked states). One link is only stated in text.
- 2: Mostly text. Any figure is decorative, or just lays out labelled boxes without showing how one drives the other. **Tidy boxes-with-words are a 2.**
- 1: The mechanism is absent, or only named in a sentence.

**device_works**
- 4: Doing the planned operation produces the planned change immediately and legibly. The control is discoverable at rest, and a first-time viewer can reach the "aha".
- 3: Works: the planned change happens and is visible. Minor issues: a weak affordance, a small or subtle change, or only part of the planned range.
- 2: Something responds, but not the planned change. The effect is cosmetic (a highlight, a label swap) or hard to see, or the "aha" is not reachable.
- 1: No control, a control that does nothing, or a control that breaks the slide.

The judge's `drive` tool replays from rest on a fresh page every call and returns a screenshot
after each step. Supported steps: `click` (selector), `clickAt` (x,y), `press` (key), `drag`
(from → to, with intermediate mouse moves), `hold` (press-and-hold, captured before release),
`hover`, `type` and `wait`. The judge also gets an inventory of detected controls: buttons, inputs,
ARIA roles, `tabindex`, and elements with pointer/grab/resize cursors, each with a selector and a
box. The last screenshot of each drive is kept and fed to mechanism, fidelity and the quiz as that
slide's "interacted states".

**fidelity**
- 4: Every number, name, quote and claim on the slide traces to the source. The framing is faithful and nothing is distorted.
- 3: Faithful. Minor simplification or paraphrase the source's author would accept. Any illustrative values are clearly marked as illustrative.
- 2: At least one fabricated number, name, quote or claim, OR a material distortion.
- 1: The core claim contradicts the source, or there are multiple fabrications.

The judge must list `fabrications`. **Code** caps the score at 2 whenever that list is non-empty,
whatever score the judge gave.

**craft**
- 4: A clear single entry point and deliberate hierarchy. Space is used on purpose; nothing is cramped, tiny or stranded. It would hold up printed as a poster.
- 3: Clear hierarchy and a balanced layout, with at most one minor issue.
- 2: Tidy but flat (everything the same weight), or large dead zones, cramped clusters, small or low-contrast text, awkward alignment.
- 1: Broken: overlapping or cut-off text, illegible, chaotic.

Deterministic checks (`lib/craft.ts`, raw numbers in `scores.json → craftMetrics`):

| check | how | cap |
|---|---|---|
| overflow px | fit-check's own resting-frame measure (same as the harness gate) | > 2px → max 2 |
| console errors | page `console.error` + uncaught errors | any → max 2 |
| text outside 1280×720 | per-line text rects vs the frame | any → max 2 |
| overlapping text | per-line rects of different, non-nested text runs; ≥ 15% of the smaller run and ≥ 40px² | any → max 3 |
| cut-off text | share of a text run hidden by an inner `overflow` container, 5–95% (100% = intentionally hidden) | any → max 3 |
| WCAG AA contrast | text color (alpha × opacity chain) vs the background **sampled from a text-hidden screenshot** (handles gradients and images); 4.5:1, or 3:1 for large text | ≥ 3 failures → max 3 |

Overlap is computed on per-line rects. A wrapped inline run's bounding box swallows its inline
sibling on the same line, and the first draft flagged exactly that false positive. Text-vs-graphic
collisions (a label crossing a gauge arc) are not detected in code; the judge covers them.

**not_generic** penalises *named* defaults, not "AI slop" in general:
- 4: No named defaults. The visual form is specific to this idea.
- 3: At most one minor default that does not define the layout.
- 2: The layout is defined by a default, or 2+ named defaults are present.
- 1: A template slide: 3+ defaults, content interchangeable.

The named defaults are:
1. hero-tagline layout
2. uniform rounded-card grid
3. numbered eyebrow labels (01/02/03) used as decoration
4. decorative gradients, glows or blobs
5. emoji
6. filler icons

Added after reviewing the baseline decks:

7. the default explainer split: a prose column left and a figure panel right, regardless of the idea's shape
8. a body-copy paragraph that restates what the figure shows
9. a row of small segmented/pill buttons detached from the thing being manipulated
10. a "readout" line that restates the control's value in words
11. stat tiles not tied to the mechanism

**Theme-prescribed styling is not a default.** The first rubric draft also listed mono uppercase
kicker labels, a dot-grid background and italic-serif accents. All three are prescribed by the
`field` theme's brief (`themes/field/brief.md`), so every slide scored 2 on `not_generic`
regardless of its form. The judge now receives the theme brief and is told to grade only what the
slide author chose on top of it. The pilot scores are kept in
`results/2026-10-04-baseline-opus-5-5/pilot-rubric-v0/`.

## Per-deck criteria

**coherence**. The judge sees a 3-column contact sheet of every slide at rest, plus the plan's
`direction` (conceit, motif, arc).
- 4: Reads as one authored piece. There is a shared visual grammar and control/figure kit, and the stated motif is visibly present and develops across most slides.
- 3: A consistent kit. The motif is present on several slides, with one or two outliers.
- 2: A consistent palette (supplied by the theme) but each slide speaks its own idiom. The motif is rare or only verbal.
- 1: A pile of unrelated slides with clashing idioms.

**comprehension_quiz** is the closest proxy for "does it make the idea click". It uses three
isolated calls:
- **A** sees ONLY the source. It writes 8 questions with reference answers, preferring mechanisms
  and relations over trivia. A is cached per source in `questions/<id>.json`, so every later run
  is graded on the same quiz.
- **B** sees ONLY the deck: every slide at rest, plus the first and last interacted state of every
  driven slide. It answers from the deck alone, or says "not covered".
- **C** grades B against A's references: correct / partial / incorrect.

Score = correct / 8. The `lenient` field counts a partial as ½.

## Aggregation and the key question

- Per-deck means per criterion ignore `unknown` and n/a. `passRate` = share of judged slides ≥ 3.
- **The key question** (`lib/aggregate.ts → keyQuestion`): of the slides that passed the
  harness's mechanical gate (0 overflow, 0 console errors), how many scored < 3 on
  `claim_at_rest`, `mechanism_shown` or `device_works`? That rate is what the evaluator redesign
  targets.

## Noise

The same deck is scored twice with independent judge sessions (`scores/` vs `scores-r2/`). The
noise script (`noise.ts`) reports the following per criterion:
- exact agreement
- ±1 flips
- ±2+ flips
- pass-line crossings
- mean |Δ|

A criterion is called **trustworthy** only if fewer than a third of its slides flip by ≥ 1 point
and none flip by ≥ 2. Untrustworthy criteria should be read as directional only until the judge
prompts are calibrated against human scores ([`calibration.html`](calibration.html)).
