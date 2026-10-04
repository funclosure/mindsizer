---
name: mindsizer
description: >-
  Quickly build ONE clear web page that explains a concept so it is easy for the brain to take
  in: a map of the whole idea up front, one claim per section, sets shown as cards, figures
  annotated by hand (neat-annotations style), and light interactions (switch a condition off, pick a case, flip between two) that let the reader see
  why. Use whenever the user wants to UNDERSTAND, LEARN, EXPLAIN, TEACH or DIGEST something: a
  concept ("explain how RLHF works"), an article, paper, talk transcript, README or event.
  Casual phrasings count: "help me get this", "make this click", "explain this to me properly",
  "build me an explainer". Output is a single self-contained HTML page, published as an
  Artifact when the session can. Do NOT use it for a short TL;DR, for writing new prose from
  scratch, or when the user asks for a specific format (PowerPoint, PDF, Google Slides).
---

# mindsizer

Turn something hard into **one page that is easy to take in**. The reader should come away able
to say *why* it's true, not just *that* it's true, without ever feeling lost.

**Read `examples/vervaeke.html` ("Why anything matters to you") before your first page.** The
user found it the easiest to take in, and it sets the bar. The other two examples show the
same skill on different material: `channel.html` (an event told as a story) and `weights.html`
(a general concept with no source).

## What makes a page easy to take in

These came from comparing pages with the user. They matter more than any single widget.

1. **Map before territory.** The hero shows the whole idea as a chain of 3–6 steps (chips
   joined by arrows, each linking to its section). The reader knows where they're going before
   they start.
2. **Always know where you are.** Each section's kicker is a path through that map
   (`meaning-in-life/` → `meaning-in-life/mattering/` → `relevance-realization/no-shortcut/`),
   not a number.
3. **One claim per section.** The `h2` is a sentence the reader should believe afterwards. Read
   in order, the headings alone state the argument.
4. **Sets as cards.** When a section introduces 2–5 parallel things (dimensions, candidates,
   options, positions), show them side by side as `.cards`. Every card has the same anatomy: a
   small tag (who or when), the term, a one-line definition. Highlight the one the section is
   about.
5. **Term, definition, example.** Introduce each new term in **bold**, define it in one line,
   then give one concrete example (a pencil, "it's going to be windy tomorrow", a tornado vs a
   paramecium).
6. **Light interactions.** Prefer controls that cost one click and need no setup: switch a
   condition off, pick a case, flip between two. Use a simulator only when a quantity really is
   the point. The interaction should make the reader *see why*, not ask them to interpret a
   chart.
7. **Prose that reads like a good lecture.** Warm, plain paragraphs carry the reasoning
   between figures. Close each section with one bold takeaway line.
8. **Say what the colour means.** One line under the map says what the accent marks on this
   page, and it never marks anything else.
9. **Annotate the figure.** Point at the part that matters with a neat-annotations mark: a thin
   hand-drawn curve, an open arrowhead, a short handwritten label saying what to notice ("this
   loop is the need"), not just a name. Give the same phrase the `.ann-text` highlight in the
   prose, so the words and the picture visibly refer to each other. Use 1–3 per figure.

## 1. Find the spine (think before you write)

1. **Source.** If the user gave text, a URL, a file or a transcript, read all of it. Fix
   obvious caption mishearings of names. If they named a concept only, use what you know and
   say so on the page. Ask what it's for only when the purpose really changes the page.
2. **Map and spine.** Write the 3–6 step map of the whole idea first. Then choose 4–8 sections
   (not counting hero and close), each **one claim**, grouped under those steps in the order
   the understanding builds.
3. **Per section, the form.** Decide what carries the claim:
   - **cards**, when it's a set of parallel things;
   - an **interaction** from `references/patterns.md` (switch off, pick, flip, reveal, slide,
     scrub, try, train), when doing something shows why;
   - or **prose plus one figure**, when neither fits.

   Aim for 3–5 interactive sections. If two sections share a mechanism, make one control show
   both.
4. **Facts.** List the numbers, names and quotes you will use, each traceable to the source.
   For an argument, also list each **attribution** ("Filler argues X") and each **link** you
   draw between steps ("A, therefore B"), with the source line it rests on.
   - Anything made up for illustration (toy dynamics, example names) is labelled
     "illustrative".
   - A toy model may show the shape of a claim the source makes. It must not produce a new
     claim.
   - A connective sentence you add to make the story flow is invention, even when it sounds
     right.
   - **With no source:** keep numbers conventional and round, and say the page is an
     explanation, not a sourced report.

Write the map and spine down briefly before coding. They decide the page.

## 2. Write the page in one pass

- Start from `assets/template.html`. It has the tokens, the hero map, `.cards`, controls and
  the scrolly helper. Follow `references/style.md`. Don't invent a new look unless the user
  asks for one.
- **Hero:** a kicker naming the source, the title, a dek that states the whole idea in 2–3
  sentences, the map, and the one-line colour note.
- **Each section:** the path kicker, the claim as `h2`, short paragraphs, then cards, an
  interaction or a figure, then one bold takeaway line.
- **Interaction rules:**
  - It opens in a meaningful state, never an empty shell. Every control says what it does.
  - Next to the control, at body contrast, one line says what to watch and what it means.
  - Its effect is immediate and visible, and it is labelled illustrative if modelled.
  - Axes stay fixed while the reader operates. Every stop or option visibly changes
    something.
  - If removing it loses no understanding, remove it.
- **Annotations:** use `annotate(svg, { to, at, text, side })` from the template. Put labels in a
  gutter beside the drawing (widen the viewBox for it), keep each to ≤ 6 words, and highlight the
  matching phrase in the paragraph with `<span class="ann-text">`. If a control changes the
  figure, re-annotate the new state so the mark always points at what changed.
- **Figures:** cover the prose and ask whether the figure alone shows *why* the state changed.
  If the answer lives only in the paragraph, redraw it (draw the loop, the need, the missing
  link), don't just recolour.
- **Copy:** plain, short, active sentences, with concrete examples over abstractions. No hype,
  no "In this section we will…".
- **Close:** one short final section that ties the threads together (a claim plus a compact
  table, or a quote that lands the point). Then the footer: sources, and a one-line note on
  what is illustrative, simplified or "our reading".

## 3. Quick check (once, then deliver)

1. Run `scripts/check.sh <page.html> [out-dir]` from any directory. It syntax-checks the
   script and takes **full-page** screenshots at 1280px and 400px with `npx playwright`. It
   adds a doctype only if the page has none. If Chromium is missing, run
   `npx -y playwright install chromium` once.
2. Look at both screenshots, especially every figure at 400px: SVG labels must still be
   readable. Fix what you see in one pass. Don't loop. To capture an interacted state, write a
   short Playwright script, and click `.seg` options through their `label[for=…]`.
3. **Fidelity pass:**
   - Every number and quote is in the source, or labelled illustrative.
   - Every "X says" names the person the source names, the same way everywhere.
   - Every "therefore" or mapping follows the source's direction. "Our reading" may extend
     the source, never reverse it.

## 4. Deliver

- Save the page as `<topic>.html`, or the user's filename, in the user's chosen place (else the
  scratchpad). The template has no doctype, because the Artifact tool adds the page skeleton.
  For a page that will only live as a local file, put `<!doctype html><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">` at the very top.
- If the session has the Artifact tool, publish it and give the link. Otherwise give the
  file path, and `open` it if the user is local.
- Reply in a few lines: what the page covers, the interactions, what is illustrative, and
  what you did NOT check.

## Follow-ups

When the user says a part doesn't click, rebuild **that section** with a different form or a
more concrete example, rather than rewriting the page. When they correct a fact or a word, fix
it everywhere it appears (dek, map, cards, labels, notes).
