# mindsizer benchmark

A fixed set of topics, each with a frozen comprehension quiz, so every change to the skill can be
checked against all of them, and a fix for one topic can't quietly break another.

## Run it

```bash
python3 bench/fetch.py                       # once: fetch the sources into bench/.cache/ (git-ignored)
python3 bench/run.py commons                 # quick check: one topic
python3 bench/run.py --all                   # full check: every topic
python3 bench/run.py --all --save-baseline   # make this run the baseline the next runs compare against
python3 bench/run.py commons --reuse bench/runs/<run>   # re-evaluate an earlier run's page, no rebuild
```

Each run writes `bench/runs/<timestamp>/` (git-ignored): per topic the sources, the page, every
role's output and log, and a `scorecard.md` / `scorecard.json` for the whole run. Topics run two at
a time (`--jobs`). A topic takes roughly 15-20 minutes and several dollars of model usage; the
scorecard reports the cost.

Needs the `claude` CLI (logged in), Python 3, Node, and for fetching `gh` and `yt-dlp`.
`states.sh` installs Playwright into `~/.cache/mindsizer` on first use.

## What happens per topic

Every role is a separate headless `claude -p` session that sees only what it needs:

| role | sees | produces |
|---|---|---|
| builder | the skill, the sources, the request | the page, plus a report (map, spine, interactions, what was folded) |
| `states.sh` | the page | look-alike states, SVG text under 12px on phones, code in handwriting, duplicate draw keys, first-read words |
| answerer | the page only | answers to the frozen quiz, and where on the page each came from |
| grader | the quiz and the answers | correct / partial / wrong / not covered |
| judge | the page and the sources | fidelity errors by severity, a rubric, whether each skill rule held, the top 5 problems |
| newcomer | the page only | a five-sentence explain-back, what confused them, confidence 1-5 |

The quiz was written from the sources by an agent that never saw a page, so it measures what a
reader should take from the source, not what any one page chose to say.

## Reading the scorecard

- **quiz**: correct ✓, partial ~, wrong ✗. Score = correct + ½ partial.
- **high / med / low**: the judge's fidelity errors. High = misstates the source or takes a side it
  doesn't. Any high error is worth reading.
- **rubric**: the judge's mean over sections (1-4); **mechanism** = does the figure show *why*.
- **states problems**: anything `states.sh` flagged. Should be 0.
- **Flags** compare with `bench/baseline.json`: the quiz falling by a point or more, more
  high-severity errors, the rubric falling by 0.3 or more, or a skill rule judged "failed".

**Noise, measured** (2026-10-06: three builds each of `commons` and `this-is-water` on the same
skill): one build's page can differ a lot from the next.

| metric | spread over 3 builds of one topic |
|---|---|
| high-severity errors | 0 in all six builds |
| quiz score (of 8) | ±0.25 to ±0.7 (range up to 1.5) |
| medium errors | ±0.5 to ±1 |
| rubric overall | ±0.1 (range up to 0.33) |
| mechanism shown | ±0.3 to ±0.4 (range up to 1.0) |
| first-read words | ±20 to ±50 |

So a single build can't show a change smaller than these ranges. To test a skill change, run
`--repeat 3` on the topics it targets and compare averages: a mechanism change under about 0.5,
or a rubric change under about 0.2, is noise. The flags compare single cards with the baseline,
so read them as "look at this", not as a verdict.

## Topics

| id | source | style | what it stresses |
|---|---|---|---|
| `claude-mods` | Claude Code mods docs, launch post, design thread | default (ink) | product docs, requested use cases, safety |
| `this-is-water` | David Foster Wallace's 2005 Kenyon speech | pencil | a moral argument, sensitive content |
| `commons` | Wikipedia, "Tragedy of the commons" | graphite | rival positions, balance |
| `vervaeke` | John Vervaeke, "The Metaphysics of Mattering" | margins | a long talk from captions, a sequence |

`vervaeke` is **confounded**: the skill's lead example is a page about the same talk, so its scores
are a ceiling, not evidence that the skill generalises.

To add a topic: an entry in `topics.json` (request, style, sources, notes) and a quiz in
`quizzes/<id>.json` written from the sources alone, with a reference answer and 2-3 key points per
question. Never commit the sources themselves.
