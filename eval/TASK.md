# Task: build mindsizer's eval set and a baseline score on Opus 5.5

_Brief for an unattended cloud session, written 2026-10-04. Branch: `eval-set`._

## Why

mindsizer (see `README.md`) turns dense text into an interactive HTML deck. Until now, harness
changes have been measured on **time and cost** (`MINDSIZER_HARNESS_FINDINGS*.md`, which are
gitignored, so you won't have them) and never on **quality**. Next we plan to change how the
harness decides a slide is done. Today it seals the first render with 0 overflow and 0 console
errors (`src/agent/agentic-author.ts`, `src/render/converge.ts`), often before the model has seen
a screenshot. The plan is to add a separate, skeptical evaluator. Before that change we need a
way to measure whether it helps. **Your job is that measuring stick, plus a baseline of the
current harness.** Do not change the harness itself (`src/agent`, `src/render`), except for the
SDK/model compatibility fixes described in Phase 0.

## Constraints

- **The repo is public. Never commit source texts or transcripts.** Fetch them into
  `eval/.cache/`, and add that path to `.gitignore` first. Generated decks, screenshots, scores
  and reports MAY be committed, because they contain only short quotations.
- **Every model role runs on Opus 5.5:**
  `MINDSIZER_MODEL=claude-opus-5-5`, and set `MINDSIZER_{INGEST,AUTHOR,JUDGE,REVIEW}_MODEL=claude-opus-5-5` too.
  Keep each role's default effort. The eval judges you write also use `claude-opus-5-5`.
- Package manager: **bun** (`bun.lock`). Tests: `bun run test` (bare `bun test` hangs).
  Typecheck: `bunx tsc --noEmit`. Headless browser: `bunx playwright install chromium`.
- Commit in small, meaningful steps on `eval-set`. Push often so progress survives if the session ends.

## Phase 0: can the harness run here? (stop and report if it can't)

1. `bun install`, then install chromium.
2. Auth probe. The harness calls Claude through `@anthropic-ai/claude-agent-sdk` (`src/agent/query.ts`).
   Make one tiny `runQuery` call on `claude-opus-5-5` and confirm it returns text. If it fails,
   try `ANTHROPIC_API_KEY` if one is set. If nothing works, **stop**: write
   `eval/results/BLOCKED.md` with the exact errors, push, and end.
3. Opus 5.5 compatibility. Opus 5.5's thinking is always on, forced `tool_choice` returns a 400,
   and text written between tool calls now arrives as `thinking` blocks, which are empty at the
   default `display`. The SDK is pinned at `^0.2.86`. Check whether `runAgentic`'s drain still
   finds the slide and whether `effort` is passed correctly. Upgrade the SDK if you need to.
   Smoke test: `bun run src/cli.ts build examples/dont-scale.plan.md -o eval/out/smoke.html`
   should complete. Record anything you had to fix in the report.

## Phase 1: sources

`eval/sources.json` lists 11 sources (9 text, 2 YouTube). Write `eval/fetch.ts`. It should:
- Turn each source into clean plain text at `eval/.cache/<id>.txt`. For HTML pages, extract the
  article body. For PDFs, extract the text (`unpdf` is already a devDependency). `fetch_hint`
  notes say where to look.
- For videos, try YouTube auto-captions with `yt-dlp` and `--write-auto-subs`, then strip
  timestamps. Cloud IPs are often blocked: if so, mark the source `unavailable` in
  `eval/.cache/manifest.json` with the reason, and continue.
- If a paywalled source can't be fetched, mark it `unavailable` too. Don't substitute a
  different source silently.

## Phase 2: the rubric and scorer (the main deliverable)

Write `eval/RUBRIC.md` and `eval/score.ts`. The scorer takes `(deck.html, plan.md, source.txt)`
and writes `scores.json`. It uses headless Chromium (reuse `src/render/fit-check.ts` and
`src/review/extract-deck.ts`) and model judges, following these principles from Anthropic's
evals and harness-design writing:

- **One isolated judge call per criterion.** No single call grades everything.
- Each judge sees **rendered screenshots, not just code**. Give each judge an explicit
  `unknown` option, and require evidence: what it saw, quoted. Grade the artifact, not the
  process that made it.
- **Scores run 1–4** (1 = fails, 2 = weak, 3 = good, 4 = exceptional), and each criterion has
  anchored descriptions. A "pass" threshold is ≥ 3.
- Judges must be **skeptical by instruction**: a slide that is merely tidy is a 2, not a 3.

### Per-slide criteria
1. **claim_at_rest** — Show the judge ONLY the resting screenshot. Ask it to write the one
   claim the slide makes. Then a separate call compares that against the plan's `claim`.
   (For an outline-only deck with no plan, compare against the slide title + markdown.)
2. **mechanism_shown** — Is the mechanism *depicted* (a drawn relation, inputs → output), or
   only *named* in text?
3. **device_works** (instrument slides only) — The judge drives the slide: clicking, pressing
   keys, and dragging. The render tool supports click, press and wait. Add drag support to the
   scorer's own driver if a slide needs it. Does doing the plan's `operate` produce its
   `changes`, visibly? Can a viewer reach the `aha`? A control that does nothing scores 1.
4. **fidelity** — Compare against the source text. Any fabricated number, name or claim caps
   the score at 2.
5. **craft** — Combine deterministic checks with a judge.
   - Deterministic, computed in code (record the raw numbers): overflow px, overlapping text
     boxes, text outside the 1280×720 frame, WCAG contrast of text vs background, console errors.
   - The judge covers hierarchy and dead space.
6. **not_generic** — Penalise named defaults, not "AI slop" in general: hero-tagline layouts,
   uniform rounded-card grids, numbered 01/02/03 eyebrow labels, decorative gradients, emoji,
   and filler icons. Extend this list with patterns you actually see in the baseline decks.

### Per-deck criteria
7. **coherence** — Judge a contact sheet of all slides at rest: one authored piece, or a pile
   of good slides? A consistent control and figure kit? Is the motif actually present?
8. **comprehension_quiz** — This is the closest proxy we have for "does it make the idea
   click". The idea is to quiz a reader who sees only the deck.
   - **Call A** sees ONLY the source and writes 8 questions testing the source's core ideas,
     each with a reference answer. Prefer questions about mechanisms and relations over trivia.
   - **Call B** sees ONLY the deck: screenshots at rest, plus at least one interacted state per
     instrument. It answers the questions, or says "not covered".
   - **Call C** grades B's answers against A's reference answers.
   - Score = fraction answered correctly.
   - Cache Call A's questions per source in `eval/questions/<id>.json` and commit them, so
     every later run is graded on the same quiz. They are short questions, not source text.

### Noise and calibration
- Measure judge noise. Score 2 of the decks twice with the full scorer and report the
  per-criterion disagreement. If a criterion's scores flip by ≥ 1 point often, say so plainly;
  that criterion isn't trustworthy yet.
- Build `eval/calibration.html`, a page for human calibration. Show about 20 slides chosen
  across the score range, each with its screenshot, the plan's claim, and blank 1–4 inputs per
  criterion. Use a "copy as JSON" button and no backend. The owner will fill it in, so judge
  prompts can later be tuned against human scores, with few-shot examples taken from that sheet.

## Phase 3: baseline

For every source that fetched, run the **current harness as-is**:
```
bun run src/cli.ts plan eval/.cache/<id>.txt --yes -o eval/out/<id>.plan.md --source <url> --source-label "<author — title>"
bun run src/cli.ts build eval/out/<id>.plan.md -o eval/results/<run>/<id>.deck.html
```
- `<run>` is `2026-10-04-baseline-opus-5-5`, or whatever today's date is.
- Run 2–3 builds concurrently as background processes. Each build already authors 4 slides in parallel.
- Keep each `<stem>.build/progress.jsonl` (copy it next to the deck). It holds per-pass timing and usage.
- Also score the committed `examples/dont-scale.deck.html`, built on Opus 4.8 without a plan,
  as a cross-version reference point.
- If a build fails, retry it once. If it fails again, record the failure and move on.

## Phase 4: report

Write `eval/results/<run>/REPORT.md`:
- **Summary table:** a row per deck with each criterion's mean, the quiz score, slides, wall
  time and API-equivalent cost.
- **Breakdowns:** per-criterion distribution across all slides, and the 5 worst slides with
  screenshots and the judge's evidence.
- **The key question:** how often did slides that passed the harness's mechanical gate
  (0 overflow, 0 errors) score < 3 on claim_at_rest, mechanism_shown or device_works? That
  number is what the evaluator redesign targets.
- **Noise:** the noise results, plus every Phase 0 fix you had to make.
- **Lessons:** anything that surprised you, and recommended rubric changes.

Add `bun run eval:score` and `bun run eval:baseline` scripts. Add a short `eval/README.md` on
how to rerun. Unit-test the deterministic parts (manifest parsing, contrast math, overlap
detection, score aggregation) in `tests/eval/`. Keep `bun run test` and `tsc` green.

Finish by opening a PR from `eval-set` to `main` with `gh pr create`. Put the summary table and
the key-question number in the body.

## Done when
- [ ] Phase 0 passes, or `BLOCKED.md` is pushed
- [ ] the rubric, scorer, quiz cache and calibration page are committed, with unit tests for the deterministic parts
- [ ] the baseline is scored for every fetchable source, plus the Opus 4.8 reference deck
- [ ] REPORT.md is written, the PR is open, and the tests and typecheck are green

A turn that ends in text is a progress report, not completion. Keep going until every box above is checked.
