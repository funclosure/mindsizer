---
name: mindsizer
description: >-
  Quickly build ONE clear web page that explains a concept so it is easy for the brain to take
  in: a map of the whole idea up front, one claim per section, sets side by side, figures with
  short pencilled notes, and light interactions (switch a condition off, pick a case, flip
  between two) that let the reader see why. Built in one of five calm styles (neat, graphite,
  ink, margins, pencil); the user can name one. Use whenever the user wants to UNDERSTAND, LEARN, EXPLAIN, TEACH or DIGEST something: a
  concept ("explain how RLHF works"), an article, paper, talk transcript, README or event.
  Casual phrasings count: "help me get this", "make this click", "explain this to me properly",
  "build me an explainer". Output is a single self-contained HTML page, published as an
  Artifact when the session can. Do NOT use it for a short TL;DR, for writing new prose from
  scratch, or when the user asks for a specific format (PowerPoint, PDF, Google Slides).
---

# mindsizer

Turn something hard into **one page that is easy to take in**. The reader should come away able
to say *why* it's true, not just *that* it's true, without ever feeling lost.

**Read `examples/vervaeke.html` ("How anything comes to matter", in the `ink` style) before
your first page.** It is built from the current template and sets the bar for structure and
voice. `examples/older-look/` holds two earlier pages (an event told as a story, a concept with
no source) in a retired look: borrow their structure and interactions, never their styling.

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
4. **Sets side by side.** When a section introduces 2–5 parallel things (dimensions,
   candidates, options, positions), show them as a `.set`. Every item has the same anatomy: a
   small tag (who or when), the term, a one-line definition. Highlight the one the section is
   about. A sequence is different: show it as a numbered `.chain`.
5. **Term, definition, example.** Introduce each new term in **bold**, define it in one line,
   then give one concrete example (a pencil, "it's going to be windy tomorrow", a tornado vs a
   paramecium).
6. **Light interactions.** Prefer controls that cost one click and need no setup: switch a
   condition off, pick a case, flip between two. Use a simulator only when a quantity really is
   the point. The interaction should make the reader *see why*, not ask them to interpret a
   chart.
7. **A concise first read.** Each section's first read is the claim, one or two short
   paragraphs (about 60–110 words in all), the figure, and one bold takeaway line. Read top to
   bottom without opening anything, the page teaches the whole idea. Aim for about 1,200 words
   in the whole first read as `scripts/states.sh` counts it (headings, labels and tables
   included); past 1,500, fold more. Code goes in a fold unless the code itself is the point.
   Everything else the
   source offers (supporting research, asides, extra examples, names and citations) goes in a
   foldable `details.more` at the end of the section, whose summary says what's inside. Keep
   the detail, just fold it. Warm, plain prose, like a good lecture.
8. **Say what the colour means.** Each map step gets an idea colour (`.h1`–`.h4`) that follows
   it through the page. One line under the map says what colour means.
9. **Point at what matters.** A figure gets 1–3 short pencilled notes saying what to notice
   ("this loop is the need"), not just a part's name. The pencil is only ever an aside: anything the reader must
   read exactly (code, a command, a number) stays in print. A key phrase in the prose can carry one
   too. Print carries the argument; the pencil only points.

## 1. Find the spine (think before you write)

1. **Source.** If the user gave text, a URL, a file or a transcript, read all of it. Fix
   obvious caption mishearings of names. If they named a concept only, use what you know and
   say so on the page. Ask what it's for only when the purpose really changes the page.
2. **Map and spine.** Write the 3–6 step map of the whole idea first. Then choose 4–8 sections
   (not counting hero and close), each **one claim**, grouped under those steps in the order
   the understanding builds. Every section sits under a map step, and there is at most one
   section more than the map has steps. A section that isn't on the map gets a step of its own
   or merges into a neighbour, or the reader loses their place.
3. **Per section, the form.** Decide what carries the claim:
   - **a set** (`.set`), when it's parallel things; a **chain** (`.chain`) when order is the point;
   - an **interaction** from `references/patterns.md` (switch off, pick, flip, reveal, slide,
     scrub, try, train), when doing something shows why;
   - or **prose plus one figure**, when neither fits.

   Choose the interaction from the content, not from a habit: a sequence of states that one
   drawing can show (a history, a process, an algorithm) is a sticky **scrolly**; a quantity
   that explodes or trades off is a **slider**; a case that changes the answer is a **pick**;
   a condition that matters is a **switch off**. Aim for 3–5 interactive sections. If two
   sections share a mechanism, make one control show both.
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
   - **Safety goes up front.** If the topic has a safety, security or permission side (what
     it can reach, what it can approve on your behalf, how to turn it off), say it in the
     first read, never only in a fold.
5. **Examples the user asked for.** When the request asks for N use cases or examples, each
   one shows a different capability, none repeats a demo from earlier on the page, and each
   says in one line why a simpler tool wouldn't do. A `.set` is usually the right form.

Write the map and spine down briefly before coding. They decide the page.

## 2. Write the page in one pass

- **Pick the style.** Use the one the user names (`neat`, `graphite`, `ink`, `margins`,
  `pencil`); with none named, use `ink`. `references/style.md` says what each is good for.
- Start the file with `scripts/new-page.sh <style> <out.html>`. It copies
  `assets/template.html` (hero map, path, `.set`, `.chain`, controls, the pencil kit, scrolly)
  and fills in the style. Follow `references/style.md`. Never restyle the page by hand; a new
  look is a new style file.
- **Hero:** a kicker naming the source, the title, a dek that states the whole idea in 2–3
  sentences, the map, and the one-line colour note.
- **Each section:** the path kicker, the claim as `h2`, one or two short paragraphs, then a
  set, an interaction or a figure, then one bold takeaway line, then (if there's more) a
  `details.more` with the rest. Before writing a paragraph in the first read, ask whether the
  claim needs it; if it only supports or decorates, it goes in the fold.
- **Interaction rules:**
  - It opens in a meaningful state, never an empty shell. Every control says what it does.
  - Next to the control, at body contrast, one line says what to watch and what it means.
  - Its effect is immediate and visible, and it is labelled illustrative if modelled.
  - Axes stay fixed while the reader operates. Every stop or option visibly changes
    something.
  - If removing it loses no understanding, remove it.
- **Figures:** one function per figure builds the items for the current state with the pencil
  kit (`ring`, `line`, `head`, `blob`, `ann`) and calls `draw(svg, items)`; call it on every
  control change. New strokes draw themselves in, so the change is visible.
- **Annotations:** `ann(key, { to, at, text, side })`, labels in a gutter, ≤ 6 words. Put the label
  above or beside its target, never below it: the stroke leaves from under the label, so a
  label below its target gets crossed by its own stroke. Write a note
  for every reachable state, never one note reused across states. When something is removed,
  draw its ghost (`ln dash`) and point at that. A note never contradicts the drawing. In prose,
  `<span class="ann h2" data-note="…">phrase</span>` at the end of a paragraph with
  `.room-below`.
- **Figure test:** cover the prose and ask whether the figure alone shows *why* the state changed.
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
2. Run `scripts/states.sh <page.html> [out-dir]`. It clicks every option and checkbox and scrolls
   every scrolly beat, saves a screenshot of each state at 1280 and 400 wide, and reports:
   - **states that look the same**: two options that draw or light the same thing. Every
     option must change what the reader sees; fix the figure, not the verdict text;
   - **SVG text under 12px at 400 wide**: enlarge it or move it into HTML;
   - **first-read words**, and sections whose prose runs over 110 words;
   - **handwriting problems**: code or exact values set in the pencil voice, and set tags too
     long for one line;
   - script errors.
3. Look at the screenshots, especially every figure at 400px. Fix what you see in one pass.
   Don't loop.
4. **Fidelity pass:**
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
it everywhere it appears (dek, map, sets, labels, notes).
