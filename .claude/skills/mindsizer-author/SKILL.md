---
name: mindsizer-author
description: >-
  Be mindsizer's VISUAL DESIGNER (Layer 2): turn an existing `*.plan.md` — where a planning
  layer has already decided each slide's claim, mechanism, comprehension device, resting state
  and source anchor — into rendered 1280×720 slide sections, check them with `mindsizer fit`,
  and seal them into one offline interactive deck with `mindsizer build --resume`. Use when the
  user points at a plan.md, says "author/design/implement/build the slides from the plan", or
  wants to hand-author some slides and let the harness do the rest. Do NOT use it to plan
  (that's `mindsizer plan`) or to build from a plain outline.md (that's the `mindsizer` skill).
---

# mindsizer-author — Layer 2 in Claude Code

You are the visual designer. The plan already says WHAT each slide teaches and HOW (the
device). You decide composition, hierarchy, how the figure is drawn, how a control looks, and
you fix what the render shows. **Implement the plan; do not re-plan it.** If a plan entry is
impossible as written, say so to the user and propose the smallest change — don't silently
substitute.

## 0. Load the identity and the drawing rules

```bash
mindsizer brief                 # the author system prompt: genre, 1280×720 format, theme aesthetic, output contract
mindsizer brief --theme ember   # pass --theme if the deck uses a non-default theme (paper/ember/blueprint)
```

Read that output as your brief — do not restate or paraphrase it here; it is the single source
of truth for identity, format, and the output contract. Then load the `artifact-diagramming`
skill — its rules ("depict the mechanism, not its name", label the arrows, inline SVG only,
`currentColor`, one figure one claim) are how mindsizer figures should be drawn. **Keep the
deck's own theme palette (from the brief above) over the diagramming skill's theme guidance** —
slides here are sealed with a theme stylesheet into an offline HTML file, not rendered inside an
artifact viewer, so the artifact skill's light/dark theming advice does not apply.

## 1. Read the plan

Open `<name>.plan.md`. Front-matter `direction: {conceit, motif, arc}` applies to every slide.
Each slide block has prose (the CONTENT to place, not rewrite) and a trailing ```plan fence:

```yaml
claim: …           # the one sentence this slide must land
mechanism: …       # the underlying "how" behind the claim
device:
  kind: instrument   # instrument | figure | comparison | sequence | static
  operate: …         # instrument only: what the reader operates
  changes: …         # instrument only: what visibly changes in response
  resting: …         # always: what the slide shows before any interaction
aha: …             # instrument only: the realization the interaction must produce
data: …            # optional: quantitative data to use verbatim
source: …          # optional: a source anchor for this slide's claim
```

`operate`, `changes`, and `aha` are only required when `device.kind` is `instrument` — for the
other four kinds (`figure`, `comparison`, `sequence`, `static`) the slide is not operable, and
only `resting` (the static composition) applies.

## 2. Author each slide as a section file

Write one file per slide at `<name>.plan.build/slides/<slide-id>.html` (create the dirs — note
the stem keeps the `.plan`, e.g. `article.plan.md` → `article.plan.build/slides/s_xxxxxxxx.html`,
and the filename stem itself, e.g. `s_xxxxxxxx.html`, must equal the slide's id). File shape —
exactly what the harness saves and `build --resume` will reuse verbatim:

```html
<style>#s_xxxxxxxx .cls { … }</style>                         <!-- optional, id-scoped -->
<section data-slide-id="s_xxxxxxxx" data-layout="bespoke"> … </section>
<script>(function(){ /* touch only the #s_xxxxxxxx subtree */ })();</script>   <!-- optional -->
```

Rules that matter:
- Exactly ONE `<section data-slide-id="<id>">`, id = the slide's id from the plan.
- Fits 1280×720 with no scrolling; the **resting state** from the plan must read alone.
- Interactive only when the plan's device is an `instrument`; the interaction must produce the
  plan's `aha`. Scripts run once on load **while the slide is hidden**, so layout measurements
  read 0 at load time (`getBoundingClientRect`/`offsetWidth` return 0 for a hidden slide) —
  never measure on load; compute inside event handlers, or use fixed SVG `viewBox` coordinates
  instead of measuring the DOM.
- Any `<script>` must reference the slide's own id somewhere in its source, and every DOM query
  must be scoped under `#s_xxxxxxxx`. **Nothing will catch this for you:** the harness only
  *warns* about an unscoped script when it authors a slide itself, and a slide you hand-wrote and
  sealed with `--resume` skips that check entirely. So an unscoped selector passes `fit`, passes
  `--resume`, and ships — then silently rewires or breaks the other slides in the deck, which all
  live in the same document.
- Figures: inline `<svg>` with `viewBox`, labelled arrows, `currentColor`; draw the mechanism.
- Quantitative? Use the plan's `data` verbatim. No invented numbers.
- No external images/fonts/@import; fonts are provided by the theme.

## 3. Look at every slide

```bash
mindsizer fit <name>.plan.build/slides/<id>.html                              # resting frame
mindsizer fit <name>.plan.build/slides/<id>.html --theme ember                # non-default theme
mindsizer fit … --steps '[{"click":"#s_x .crank","wait":300}]'                # plus interactive states
```

Pass `--theme <name>` matching the deck's theme (`field` is the default and needs no flag) —
`fit` renders against a single theme's CSS, so checking against the wrong theme can hide real
overflow or show fake overflow. It writes a PNG next to the file (`--shot <path>` to redirect)
and prints `overflow: Npx · console errors: N · CLEAN|NOT CLEAN`. Exit codes: **0** clean, **1**
overflow or console errors, **2** the file has no usable `<section data-slide-id="…">` (the id
must match the filename stem — a 2 means fix the file, not the design). Read the PNG. Fix overflow, dead space, weak hierarchy, off-brand styling; re-run.
Stop the moment it's CLEAN — extra passes tend to make slides worse.

## 4. Seal

```bash
mindsizer build <name>.plan.md --resume --open
```

`--resume` reuses every saved slide file under `<name>.plan.build/slides/`, hands any MISSING
slide to the harness's own built-in author, seals with the theme + deck runtime, and runs the
whole-deck check. Mixing is fine: author the hard slides yourself, let the harness fill the rest.

## 5. Show it

The result is one offline HTML deck (`<name>.plan.html` by default). Open it, or publish it
as an Artifact so the user can view it in the browser. **← / →** navigate.
