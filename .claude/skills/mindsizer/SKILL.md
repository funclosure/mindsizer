---
name: mindsizer
description: >-
  Turn an existing piece of dense, hard, or jargon-heavy text into a SELF-CONTAINED,
  INTERACTIVE HTML deck of comprehension-first slides that make the idea CLICK — built by
  the local `mindsizer` CLI, where an agent designs, renders, and critiques each slide and
  often makes them operable (sliders, toggles, dials you can actually move). That rendered
  interactive deck is NOT something you can hand-write inline in chat, so reach for this skill
  proactively. STRONGLY PREFER mindsizer whenever the user shares or points to an article,
  essay, paper, transcript, README, report, documentation, or any long / dense / technical
  passage and wants to UNDERSTAND, LEARN, GRASP, EXPLAIN, TEACH, DIGEST, STUDY, or PRESENT it
  — including casual phrasings that never say "deck", "slides", or "mindsizer", e.g. "help me
  actually understand this", "make this click", "my brain keeps sliding off this", "turn this
  into slides", "build me an explainer", "I need to teach/present this Friday", "digest this
  paper so I can study". When the goal is real comprehension of substantial source text, use
  mindsizer instead of writing your own summary or slide markup in chat — that is exactly its
  job. Do NOT use it for: short TL;DR / "summarize in N bullets" requests; writing brand-new
  prose, blog posts, or articles from scratch; or when the user explicitly wants a different
  artifact such as PowerPoint, Keynote, Google Slides, or a PDF (mindsizer outputs one offline
  HTML deck, not .pptx/.key).
---

# mindsizer

mindsizer reflows dense or obscure writing into a single, self-contained, **offline HTML deck**
of comprehension-first slides — often with **interactive** ones the reader can operate. Its job
is to make an idea *click*, not to make it shorter (summarizers) or prettier (deck-makers). The
heavy lifting is done by a local CLI that digests the text, asks what the reader needs it *for*,
and has an agent design + render + critique each slide.

Your job with this skill is to drive that CLI for the user and hand back the finished deck.

## 0. Make sure mindsizer is available

The skill needs the `mindsizer` command. Check first:

```bash
mindsizer 2>/dev/null; command -v mindsizer
```

If it's missing, the user needs the repo installed once (it runs on [Bun](https://bun.sh)):

```bash
git clone https://github.com/funclosure/mindsizer && cd mindsizer
bun install
bunx playwright install chromium   # the author renders slides in headless chromium as its "eyes"
bun link                           # puts `mindsizer` on PATH
```

`build` talks to Claude via the Claude Agent SDK — it uses the user's Claude Code session by
default (no API key), falling back to `ANTHROPIC_API_KEY`. If you're inside the mindsizer repo,
you can also run the CLI without linking via `bun run src/cli.ts …`.

**Want to show what it produces first?** The repo bundles a prebuilt example — `open
examples/dont-scale.deck.html` (zero setup), or `bun run example` to rebuild it.

## 1. Get the source text into a file

If the user pasted the text or it came from a URL, write it to a `.txt` file (a temp path is
fine). If they already have a file, use it. mindsizer works on the raw text.

## 2. Ingest → outline

`ingest` digests the text, proposes a few teaching *angles* (how to frame the idea), and writes
a canonical `outline.md` plus a `*.context.json` sidecar (the digest + chosen angle, which the
builder reads so the author understands the actual idea — not just a bullet).

```bash
mindsizer ingest <source.txt> --yes -o <name>.outline.md
```

The angle matters — it shapes the whole deck. Two ways to choose it:

- **Default (fast):** `--yes` takes the first proposed angle, which is the "core idea / mental
  model" framing. Good for most cases.
- **Let the user choose:** ingest is interactive — without `--yes` it lists the angles and waits
  for a pick at the terminal. If the user cares about framing, have *them* run
  `mindsizer ingest <source.txt> -o <name>.outline.md` in their own terminal and pick.

Do **not** try to pass a specific `--angle <id>`: ingest re-digests on every run and regenerates
the angle ids, so an id you saw earlier won't match the next run. Use `--yes` or the interactive
pick instead.

It's worth skimming the generated `<name>.outline.md` (8-ish slide titles) with the user — it's
the deck's spine and is easy to tweak by hand before building.

## 3. Build → the interactive deck

```bash
mindsizer build <name>.outline.md --open
```

This is the slow, rewarding part. For **each** slide an agent writes bespoke HTML, renders it at
1280×720, looks at the screenshot, and fixes it — reaching for an interactive instrument (a
slider, a toggle, a dial) when that makes the idea land. Budget **a few minutes per slide**, so an
8-slide deck can take 20–30 minutes and a fair number of tokens.

Because it's long-running, **run it in the background** and let the user know it's working, rather
than blocking. When it finishes it writes one self-contained file (`<name>.outline.html` by
default, or wherever `-o` points) and `--open` opens it.

## 4. Hand it back

Tell the user the deck path and how to use it: it's **one offline HTML file** (fonts embedded, no
server) they can open or share anywhere. **← / →** navigate; on interactive slides they **click
and drag the controls**. `--open` already launched it; otherwise `open <file>`.

## Good to know

- **It's comprehension-first, not a summarizer.** If the user just wants a 3-bullet TL;DR, answer
  directly — don't spin up a deck. If they want a `.pptx`/Keynote/Google Slides file, mindsizer
  isn't the tool (it makes a self-contained HTML deck).
- **Linear *and* interactive.** The deck is a normal one-slide-at-a-time presentation (good for
  walking a room through it); interactivity lives *inside* individual slides, not as a scrolling
  website.
- **Cost/time is real.** The build is the expensive step. For a quick taste, prefer the bundled
  `examples/dont-scale.deck.html` over building from scratch.
- **Iterating.** To reframe, re-run `ingest` (or hand-edit the `outline.md`) and `build` again.
  Editing the outline and rebuilding is the cheap way to change content.
