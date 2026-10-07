# mindsizer

**A Claude Code skill that turns something hard into one clear page you can operate.**

Ask Claude to help you understand a concept, article, paper, transcript or event. mindsizer
builds a single interactive web page where each section makes one claim and you operate the
mechanism behind it: train a toy model, scrub a timeline, flip a condition, type an example.
The aim is for you to see *why* something is true, not just read that it is.

> Summarizers make it shorter. Deck-makers make it prettier. mindsizer makes it click.

## Examples

- [`examples/vervaeke.html`](skills/mindsizer/examples/vervaeke.html), *How anything
  comes to matter*: a 32-minute philosophy talk, from auto-captions, in the `ink` style. **The
  reference for "easy to take in"**: a map up front, sets side by side, one-click interactions,
  short pencilled notes on the figures.
- [`examples/claude-mods.html`](skills/mindsizer/examples/claude-mods.html), *Claude Code
  mods*: a new product feature explained from its docs, with three use cases; built by the
  skill in a fresh session, then revised after an eval.
- [`examples/older-look/`](skills/mindsizer/examples/older-look/): an event told as a
  story and a concept explained with no source, in an earlier, retired look.

## Styles

Every page is built in one of five calm styles, all after
[neat-annotations](https://github.com/syabro/neat-annotations): calm print, and a pencil that
points at what to notice. Name one in your request ("make it in ink"); the default is `ink`.

| `neat` | `graphite` | `ink` | `margins` | `pencil` |
|---|---|---|---|---|
| system sans, a colour per idea | all grey, one yellow highlighter | serif, dot grid, one blue | notes in a wide margin | rounder type, coloured pencils |

## Use

**As a Claude Code plugin** (anyone):

```
/plugin marketplace add funclosure/mindsizer
/plugin install mindsizer@mindsizer
```

**From a clone** (to edit it): inside this repo the skill loads automatically. To use your clone
in every project, link it into your personal skills:

```bash
ln -s "$PWD/skills/mindsizer" ~/.claude/skills/mindsizer
```

**In another agent:** the skill is plain Markdown plus scripts (`skills/mindsizer/`); any agent that
reads `SKILL.md` files, or can follow instructions and run shell commands, can use it.

Then just ask: "help me actually understand how RLHF works", or "make this paper click".

Pages come at three effort levels. **Medium** is the default. Say "quick" (or "low") for a
three-minute, high-level page that is cheaper and faster to build, or "go deep" (or "high") for
the full treatment: more sections and interactions, folded detail and a stricter check. Ask to
"go deeper" on a page to rebuild it one level up.

## How it works

The skill is instructions plus a template. There is no CLI and no build step.

```
.claude-plugin/          plugin.json + marketplace.json (installable as a plugin)
bench/                   the benchmark: topics, frozen quizzes, runner, baseline (see bench/README.md)
skills/mindsizer/
  SKILL.md               spine → one interaction per idea → write in one pass → quick check → deliver
  references/style.md    the five styles, the token contract, colour, type, figures, annotations
  references/patterns.md interaction patterns: train, scrub, flip, reveal, slide, try, switch off
  assets/template.html   page skeleton: hero map, sets, chains, controls, the pencil kit, scrolly
  assets/styles/*.css    one file per style (tokens for light and dark)
  scripts/new-page.sh    start a page: template + chosen style
  scripts/check.sh       syntax check + screenshots at 1280px and 400px (node + npx playwright)
  scripts/states.sh      every interactive state screenshotted; flags look-alike states, tiny phone text, long first reads
  examples/              reference pages
```

The page is one standalone HTML file (HTML, CSS and plain JavaScript; only Google Fonts load
from outside), so it opens in any browser and can be hosted anywhere. In Claude it is also
published as an Artifact when the session has that tool.

Nothing in the skill is tied to Claude Code beyond the `SKILL.md` format: the instructions are
plain Markdown, the scripts need only bash, Python 3, Node and `npx playwright`, so another
agent that can read files and run shell commands can follow it.

## History

Until October 2026 mindsizer was a TypeScript CLI that built 1280×720 interactive slide decks
with a per-slide agentic harness. A side-by-side comparison with a single-author page showed
the page explaining more clearly and faster, so the CLI was retired. It remains in git history
(`main` before the `skill-v2` merge).
