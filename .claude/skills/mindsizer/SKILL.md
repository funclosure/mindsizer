---
name: mindsizer
description: >-
  Quickly build ONE clear, interactive web page that explains a concept, so the reader
  understands it by operating it: training a toy model, scrubbing a timeline, flipping a
  condition, typing an example. Use whenever the user wants to UNDERSTAND, LEARN, EXPLAIN,
  TEACH or DIGEST something: a concept ("explain how RLHF works"), an article, paper,
  transcript, README or event. Casual phrasings count: "help me get this", "make this click",
  "explain this to me properly", "build me an explainer". Output is a single self-contained
  HTML page, published as an Artifact when the session can. Do NOT use it for a short TL;DR,
  for writing new prose from scratch, or when the user asks for a specific format (PowerPoint,
  PDF, Google Slides).
---

# mindsizer

Turn something hard into **one page the reader can operate**. The reader should come away able
to say *why* it's true, not just *that* it's true.

Two reference pages show the bar for structure, interaction, tone and style. Read the closer one
before your first page:
- `examples/channel.html` ("The Channel Nobody Designed"), built from a source: an event
  told as a story.
- `examples/weights.html` ("Where a model's habits live"), built with no source: a general
  concept explained.

## 1. Find the spine (think before you write)

1. **Source.** If the user gave text, a URL or a file, read all of it. If they named a concept
   only, use what you know and say so on the page. Ask what it's for only when the purpose
   really changes the page, e.g. "for an exam" vs "to decide whether to adopt it". Otherwise
   assume they want to understand it.
2. **Spine.** Choose 4–8 sections, in the order the understanding builds. Each section is
   **one claim**: a sentence the reader should believe afterwards, not a topic label.
3. **Mechanism + verb.** For each claim, write down the mechanism (what causes what) and **the
   one thing the reader does** to see it. Pick the verb from `references/patterns.md`: train,
   scrub, flip, reveal, slide, try, switch off. If nothing is worth operating, the section is
   prose plus one static figure. That is fine; aim for 3–5 interactive sections per page.
   If two sections share a mechanism, make one control show both. For example, one
   simulator can run a pretraining phase and then an RL phase, instead of two widgets.
4. **Facts.** List the numbers, names and quotes you will use, each traceable to the source.
   Anything made up for illustration (toy dynamics, example names) is labelled
   "illustrative" on the page. **With no source** (a general concept), keep numbers
   conventional and round, prefer orders of magnitude ("billions of weights"), state the page
   is an explanation rather than a sourced report, and name your simplifications in the footer.

Write the spine down briefly for yourself before coding: claim · mechanism · verb, per
section. It decides the page.

## 2. Write the page in one pass

- Start from `assets/template.html`. It has the tokens, components and the scrolly helper.
  Follow `references/style.md`. Don't invent a new look unless the user asks for one.
- **Hero:** the title, a two-sentence dek stating the whole idea, and, where it fits, one
  live or concrete element that shows the subject at a glance.
- **Each section:** a small path/kicker, the claim as the `h2`, 1–3 short paragraphs, then
  the figure or interaction, then (optionally) one bold takeaway line.
- **Interaction rules:**
  - The control IS the mechanism. If removing it loses no understanding, remove it.
  - It opens in a meaningful state, already showing something, never an empty shell.
  - Every control says what it does ("Train 10", "Look inside the grader").
  - Its effect is immediate and visible, and it is labelled illustrative if modelled.
- **Copy:** plain, short, active sentences. Prefer concrete numbers and examples to
  abstractions. No hype, no filler, no "In this section we will…".
- **Close** with one short final section that pulls the threads together: a claim plus a
  compact summary (a small table, or three lines), or a quote that lands the point. Then the
  footer: sources (links) and a one-line note on what is illustrative or simplified.

## 3. Quick check (once, then deliver)

1. Run `scripts/check.sh <page.html> [out-dir]` from any directory. It syntax-checks the
   script, adds a doctype for a standards-mode render, and screenshots the page at 1280px and
   400px with `npx playwright`. If Chromium is missing, run
   `npx -y playwright install chromium` once.
2. Look at the two screenshots: hero, one interactive section, and phone width. Fix what you
   see in one pass. Don't loop. To screenshot an interacted state, write a short Playwright
   script. Click a `.seg` option through its `label[for=…]`, because the radio input itself
   is covered by the label.
3. Fidelity pass: every number and quote on the page appears in the source, or is
   labelled illustrative.

## 4. Deliver

- Save the page as `<topic>.html` (in the user's chosen place, else the scratchpad). The
  template has no `<!doctype>`/`<head>`, because the Artifact tool adds that skeleton. For a
  page that will only live as a local file, put `<!doctype html><meta charset="utf-8"><meta
  name="viewport" content="width=device-width, initial-scale=1">` at the very top.
- If the session has the Artifact tool, publish it and give the link. Otherwise give the
  file path, and `open` it if the user is local.
- Reply in a few lines: what the page covers, the interactions, what is illustrative, and
  what you did NOT check.

## Follow-ups

When the user says a part doesn't click, rebuild **that section** with a different verb or a
more concrete example instead of rewriting the page. When they correct a fact or a word, fix
it everywhere it appears (dek, beats, labels, notes).
