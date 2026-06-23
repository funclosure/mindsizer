# mindsizer

**Paste dense text → get an interactive deck that makes the idea _click_.**

▶ **[Try the live example](https://funclosure.github.io/mindsizer/dont-scale/)** — an interactive deck built from Paul Graham's _Do Things that Don't Scale_. Use **← / →** to navigate; click and drag the controls on each slide.

mindsizer is a local-first tool that digests hard or dense writing, asks what you need it _for_, and rebuilds it into a self-contained deck of comprehension-first slides — including genuinely **interactive** ones you can operate. Everything ships as **one offline HTML file** you can open anywhere.

> Summarizers make it _shorter_. Deck-makers make it _prettier_. **mindsizer makes it _click_** — rebuilding hard information into the shape your purpose demands.

The mental model is _responsive design for cognition_: a responsive layout reflows a page to fit a viewport; mindsizer reflows information to fit the reader's working memory, aimed by what they intend to do with it.

---

## What makes a mindsizer slide different

A slide is treated as an **explorable instrument**, not a bullet dump and not a marketing page. When it helps the idea land, the slide is **operable** — you tune a control and watch the concept respond. For example, from Paul Graham's _Do Things that Don't Scale_:

- a **crank** dial you turn (manual force → self-sustaining growth),
- a **compound-growth** chart with a live weekly-rate slider and linear/log toggle,
- a **contained-fire** instrument where you split fixed effort across 1–8 markets and watch each "front" rise or fall below the ignition line.

Decks stay **linear and presentable** (one frame at a time, arrow-key navigation) so they're usable as material for discussion — interactivity lives _inside_ each slide, not as a free-scrolling website.

---

## Quick start

Requires [Bun](https://bun.sh).

```bash
bun install
bunx playwright install chromium   # the author uses headless chromium as its "eyes"
bun link                            # registers the `mindsizer` command globally
```

Authentication: the agent talks to Claude via the [Claude Agent SDK](https://docs.claude.com). It uses your Claude Code session by default (no API key needed), and falls back to `ANTHROPIC_API_KEY` if set.

### Turn an article into a deck

```bash
# 1. Digest the text and choose a teaching angle (how to frame it).
mindsizer ingest article.txt -o article.outline.md
#    → writes article.outline.md  + article.outline.context.json (the digest + angle)

# 2. Build the rich, interactive deck (the agent authors each slide and checks its own render).
mindsizer build article.outline.md --open
#    → writes article.outline.html — one self-contained, offline, interactive deck
```

`ingest` is interactive (it proposes a few angles and asks you to pick). To run unattended, use `--yes` to take the first angle:

```bash
mindsizer ingest article.txt --yes -o article.outline.md
```

### View a deck

The deck is a single self-contained HTML file (fonts embedded, no network, no server):

```bash
open article.outline.html
```

Navigate with **→ / ← / Space**. On interactive slides, click or drag the controls.

---

## Commands

| Command | What it does |
| --- | --- |
| `mindsizer ingest <text-file> [--angle <id>] [--yes] [-o out.md]` | Digest text → propose teaching angles → write a canonical `outline.md` + a `*.context.json` sidecar (digest + chosen angle). |
| `mindsizer build <outline.md> [-o out.html] [--open]` | The rich path: an agentic author writes a bespoke (often interactive) slide per outline entry, renders + critiques its own work, then seals everything into one offline deck. |
| `mindsizer <outline.md> [-o out.html] [--open]` | The fast, no-LLM path: mechanically render + seal the outline (for `analogy` / `plain` layouts). |

`MINDSIZER_MODEL` overrides the model (default `claude-opus-4-8`).

---

## How it works

```
text ──▶ ingest ──▶ outline.md  +  *.context.json
                         │  (digest + chosen angle)
mindsizer build ─────────┘
   orchestrator (deterministic, unit-tested):
     for each slide:
       gather materials (the idea: source + digest + angle + neighbours)
         └▶ agentic author  [bounded "render" tool — no fs/Bash/network]
              think → write HTML → render at 1280×720 → LOOK → fix   (self-iterating)
         ◀ returns a slide: <style>? <section> <script>?
       validate → (optional fit-check, warn)
   seal ──▶ ONE self-contained, offline, LINEAR, interactive deck.html
```

Key ideas:

- **Hybrid author.** A free agentic author (an Agent-SDK session with a single, bounded `render` tool) iterates on its _own_ screenshots — the way a designer would — wrapped in a deterministic shell that gathers context, validates, and seals. The shell is unit-tested with fakes; the agent and browser are verified by running.
- **The agent gets the idea, not a bullet.** `ingest` persists the digest and chosen angle in a `*.context.json` sidecar so the author understands the argument, not just a one-line label.
- **Interactive slides.** A slide may carry a scoped per-slide `<script>`; it's sealed into the offline deck. The deck renders every slide on a fixed **1280×720 stage scaled to fit**, so all slides are uniform and exactly match what the author saw while building.
- **Identity over rulebook.** Authoring is steered by a short "instrument, not landing page" brief in the [Field](#design-language) aesthetic, rather than a long list of rules.

---

## Design language

**Field** — a calm, instrument-panel aesthetic: dark navy ground, cream text, a single cyan accent; Fraunces (display serif), Geist (body), Geist Mono (micro-labels and numerals); hairline rules and a faint dot-grid. Fonts are vendored under `theme/fonts/` and embedded into every sealed deck. The target genre is the _explorable explanation / instrument_ — never marketing-landing-page gloss.

---

## Project layout

```
src/
  outline/   canonical outline model — parse/serialize/validate, ids, the data-bind seam
  agent/     ingest pipeline (digest → angles → outline), the agentic author + bounded render tool,
             the Claude Agent SDK adapter, the context sidecar
  render/    the build orchestrator (buildDeck/buildSlide), per-slide materials, the identity brief,
             the headless-chromium renderer ("eyes"), static layouts
  export/    seal an outline + authored sections into one self-contained offline HTML deck
  cli.ts     the `mindsizer` command (ingest / build / seal)
theme/       the Field stylesheet + vendored woff2 fonts
docs/        product spec + design/implementation docs
prd.md       the product requirements document
```

---

## Development

```bash
bun test            # run the unit suite (Vitest)
bun run test:watch  # watch mode
bunx tsc --noEmit   # typecheck
```

The deterministic core (outline, orchestrator, contract, seal, sidecar, materials) is unit-tested with fakes. The browser renderer (`src/render/fit-check.ts`) and the live agentic author are kept out of the unit graph and verified by running. See `docs/` for the design specs and implementation plans.

---

## Status

Early, local-first, and private. The v1 flow — `ingest` → pick an angle → `build` → an offline interactive deck — works end to end. The slide-authoring harness is the active surface; output ambition (and the workspace UI) is still growing.
