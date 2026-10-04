# mindsizer

**A Claude Code skill that turns something hard into one clear page you can operate.**

Ask Claude to help you understand a concept, article, paper, transcript or event. mindsizer
builds a single interactive web page where each section makes one claim and you operate the
mechanism behind it: train a toy model, scrub a timeline, flip a condition, type an example.
The aim is for you to see *why* something is true, not just read that it is.

> Summarizers make it shorter. Deck-makers make it prettier. mindsizer makes it click.

## Examples

- [`examples/vervaeke.html`](.claude/skills/mindsizer/examples/vervaeke.html), *Why anything
  matters to you*: a 32-minute philosophy talk, from auto-captions. **The reference for "easy to
  take in"**: a map up front, sets as cards, one-click interactions.
- [`examples/channel.html`](.claude/skills/mindsizer/examples/channel.html), *The Channel
  Nobody Designed*: an event, built from a source.
- [`examples/weights.html`](.claude/skills/mindsizer/examples/weights.html), *Where a model's
  habits live*: a general concept, explained with no source document.

## Use

Inside this repo the skill loads automatically. To use it in every project:

```bash
ln -s "$PWD/.claude/skills/mindsizer" ~/.claude/skills/mindsizer
```

Then just ask: "help me actually understand how RLHF works", or "make this paper click".

## How it works

The skill is instructions plus a template. There is no CLI and no build step.

```
.claude/skills/mindsizer/
  SKILL.md               spine → one interaction per idea → write in one pass → quick check → deliver
  references/style.md    the look: calm type, one accent with one meaning, light and dark
  references/patterns.md interaction patterns: train, scrub, flip, reveal, slide, try, switch off
  assets/template.html   page skeleton with tokens, components and a scrolly helper
  scripts/check.sh       syntax check + screenshots at 1280px and 400px (node + npx playwright)
  examples/              reference pages
```

The page is one HTML file. It is published as a claude.ai Artifact when the session has
the Artifact tool, otherwise saved locally.

## History

Until October 2026 mindsizer was a TypeScript CLI that built 1280×720 interactive slide decks
with a per-slide agentic harness. A side-by-side comparison with a single-author page showed
the page explaining more clearly and faster, so the CLI was retired. It remains in git history
(`main` before the `skill-v2` merge).
