# Effort levels for the mindsizer skill

Date: 2026-10-07. Status: approved design (approach A), not yet implemented.

## Goal

Let a page be built at one of three effort levels, **low**, **medium** and **high**, so a quick
"help me get this" doesn't cost a full build. A lower level is faster and cheaper to build,
and it keeps the reader at the high level: fewer sections, fewer interactions, and less detail.

Today's pages (the Vervaeke example, the mindsizer explainer and its zh-TW version) define
**high**.

## Decisions

- **Three levels:** low, medium, high.
- **Default: medium.** It applies when the request names no level.
- **One recipe (approach A).** SKILL.md keeps a single recipe. A level table near the top says
  what each level changes, and steps that only some levels do are tagged inline, e.g.
  "(medium, high)". No per-level recipe files, so a rule fixed once is fixed at every level.

## How a level is chosen

- **Named:** "low", "medium" or "high", or plain words that map to them: "quick", "rough",
  "just the gist" → low; "deep", "thorough", "full" → high.
- **Unnamed:** medium. The skill doesn't guess from the size of the source. A long paper at
  medium is still a medium page.
- **Going deeper:** when the user asks for more depth ("go deeper", "more detail", "high"),
  rebuild the page one level up and reuse its existing map and spine. Keep the map unless the
  new sections need a step it doesn't have.

## The level table (goes into SKILL.md)

| | **low** | **medium** (default) | **high** |
|---|---|---|---|
| Map steps | 3 | 3–5 | 3–6 |
| Sections (excluding hero and close) | 3, one per map step | 4–5 | 4–8 |
| Interactions | 1, for the central mechanism | 2–3 | 3–5 |
| First read (`states.sh` count) | about 500 words | about 900 | about 1,200; fold more past 1,500 |
| Detail beyond the first read | cut, not folded | folded where a section needs it | folded per section |
| Spine notes | the source line for each heading | + the source line for each "so" line | + the facts list, attributions and links |
| Checks | `check.sh` | + `states.sh` | + figure review sheets and one redraw pass |
| Fidelity pass | numbers, quotes, headings | + quantifiers and hedges | full (incl. side-by-side claims) |
| Close | one line or a landing quote | a quote or a table | a table (one row per map step) or a landing quote |

Section rule at every level: at most one section more than the map has steps, as now.

## Kept at every level

These guard correctness and safety, so no level drops them:

- Read the whole source.
- A map in the hero, and path kickers that use the map's names.
- One claim per section, with the claim as the `h2`.
- Every number and quote traceable to the source; anything made up is labelled
  "illustrative"; a toy model never makes a claim the source doesn't.
- Safety, security and permission points go in the first read.
- Every interaction that is built follows the interaction rules (meaningful opening state,
  a "watch" line, every option visibly changes something, the figure draws the "because").
  A lower level builds fewer interactions; it doesn't build them less carefully.
- Original-language glosses (`<ruby>`) on translated pages.
- The footer: sources, plus what is illustrative.

## What low looks like

A page you can read in about three minutes: a hero (dek and three-step map), one section per
step, one interaction on the section that carries the central mechanism, and a one-line or
quote close. Detail the source offers beyond that is left out, not folded away. The footer
adds one line, in the page's language: "This is the high-level version; ask for medium or
high for more depth."

## Changes by file

- **`skills/mindsizer/SKILL.md`**
  - A short "Effort" section after the intro: the three levels, the default, how a level is
    chosen, going deeper, the level table, and the "kept at every level" list.
  - Inline level tags on steps that only some levels do: the review sheets and redraw pass
    (high); `states.sh` (medium, high); the facts list (high); folds (medium, high).
  - The fixed budgets now in the text ("4–8 sections", "3–5 interactive sections", "about
    1,200 words") point to the table instead of repeating a number.
  - Deliver: the reply names the level it built at and how to go one level up.
- **`skills/mindsizer/references/patterns.md`:** "Aim for 3–5 interactive sections" becomes
  "see the level table".
- **`scripts/states.sh`:** takes an optional `--level low|medium|high` (default medium) and
  uses that level's first-read target when it reports word counts. No other checks change.
- **`README.md`:** one short paragraph on levels, in the "Use" section.
- **`bench/run.py` and `bench/prompts/builder.md`:** a `--level` flag (default **high**, so
  the existing baseline stays comparable) passed into the builder request; the judge prompt
  gets the level so it scores rules against that level's table, not high's. The scorecard
  records the level, and a baseline compares only cards at the same level.

## Success criteria

- A request with no level builds a medium page; "quick …" builds low; "go deep" builds high.
- Bench: `--level high` on the four topics scores within noise of the current baseline (the
  change must not degrade high).
- Bench: low and medium runs report build time and cost for comparison with high. Their
  quiz scores are expected to be lower; judge fidelity at low and medium should still show
  0 confirmed high-severity errors.

## Out of scope

- A level above high (e.g. a second reviewer, repeated builds, multiple styles).
- Inferring the level from the request or the size of the source.
- Changing the styles, the template or the interaction patterns themselves.
