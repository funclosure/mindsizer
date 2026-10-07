# Interaction patterns — pick the verb that IS the mechanism

Prefer the light ones (switch off, pick, flip, reveal): one click, nothing to set up, and the
reader sees *why*. Reach for a simulator (train) or a dense chart only when a quantity is the
point. Every pattern needs one line next to the control saying what to watch.

## Showing why: worked examples from evals

The judge's weakest score across every eval is "mechanism shown": figures that relabel, recolour
or light things up instead of drawing the cause. Each pair below is a real failure and the fix.

- **Switch off a condition.** *Fails:* unticking "clear boundaries" turns the boundary ring
  dashed, and every other switch shrinks the pasture by the same step. *Shows why:* each switch
  breaks the outcome in its own way: no boundary → outsiders' herds walk in; no rules → herds grow
  unchecked; no community → nobody notices. The reader sees four different failures, not one.
- **Light up what matters.** *Fails:* "realizing what's relevant" lights three items in a room,
  with no reason given. *Shows why:* each lit item is tied by a line to the goal that makes it
  relevant ("the slide → following the talk"), and changing the goal moves the lines.
- **A process carried by a set.** *Fails:* "everybody worships something" as four parallel
  items, each tagged "worship". *Shows why:* the drift itself: a default that pulls you toward
  one of them a step at a time unless you choose, drawn as the path you slide along.
- **The defining move, described but not drawn.** *Fails:* a page that says "only a mod can
  draw in the interface", then never draws a pane. *Shows why:* a sketch of the screen where the
  reader adds the pane, and the part Claude Code draws stays put.
- **A toy model that invents a law.** *Fails:* a herd simulation where every setting ends in
  collapse ("none removes it"), when the source says the tragedy is "by no means inevitable".
  *Shows why:* the same model reaches both outcomes, and the reader finds the settings where
  the commons holds.
- **Recolour.** *Fails:* the young fish's view and the older fish's view differ only in whether
  the water lines are solid or dashed. *Shows why:* something the water does becomes visible in
  one view (it carries them, it touches everything), so the change has content, not just ink.

## pick: choose a case, watch what changes
**When:** the same input means different things depending on the case (what is relevant
depends on your plan; which rule applies depends on who you're talking to).
**Needs:** a row of chips or a segmented control for 3–6 cases, and one output that re-sorts
or re-highlights. In the reference, the implications of "it's going to be windy tomorrow" light
up differently for sailing, skydiving or a picnic. Include one case where nothing applies,
because the contrast teaches. The facts stay fixed; only their relevance moves.
**Trap:** cases that differ only in wording. Each pick must visibly change the output.
**Trap:** a label swap. If every case redraws the same shapes with new words in them, the
figure isn't showing anything; draw each case's own structure, or use a `.set` instead of a
pick. `scripts/states.sh` flags cases that draw or light the same thing.

Each pattern lists when to use it, the minimum it needs, and the trap to avoid. The live
versions are in `examples/older-look/channel.html` (section id in brackets).

## train / run: a simulator
**When:** an outcome emerges from repeated steps (learning, growth, selection, compounding).
**Needs:** 1–2 conditions the reader sets, plus "step" and "step ×10" buttons and a reset.
Show the state as bars, and history as a line chart. Start pre-run (e.g. 20 steps in) so the
first view already shows the effect.
**Trap:** fake precision. Label the model "illustrative" and keep its rule simple enough to
state in one sentence. Also, axes that rescale as the reader moves the control. Fix the axes at
the control's full range (use a log axis for compounding), so the change the control exists to
show is the change the eye sees. A toy model may show the shape of a claim from the source; it
must not produce a new one. [#score]

```js
// multiplicative-weights update: whatever beats the average grows
share = share.map((p, i) => Math.max(0.02, p * Math.exp(lr * (pay[i] - avg))));
const s = share.reduce((a, b) => a + b); share = share.map(p => p / s);
```

## scrub: a scrolly timeline or a staged process
**When:** the idea is a sequence of states (an incident, an algorithm's steps, a life cycle).
**Needs:** 5–10 beats, each with a date or step label, a one-line heading and 1–3 sentences.
A sticky figure re-renders a STATE object per beat (nodes on/off/dead/dormant, counts, layers).
Use the template's `scrolly(setState)` helper. The example page wires its own
IntersectionObserver, which does the same thing; prefer the helper.
**Trap:** a figure that only changes its label. Every beat must visibly change the figure. [#timeline]

## flip: a two-condition toggle
**When:** the same thing behaves differently under two conditions (reward visible or not,
before/after, with/without).
**Needs:** a segmented control, and one figure whose content swaps. Keep everything else fixed
so the difference is the only change. Draw the *cause* of the difference, not only the
result: if one side has a loop, a need or a missing link, that is what appears or disappears.
**Trap:** recolouring. If the only change is which items turn orange, the reader learns *that* it
differs, which the prose already said, not *why*. [#reproduction]

## reveal: belief vs reality
**When:** people (or agents) act on a wrong model of something.
**Needs:** the believed version drawn big, plus a button that reveals the real one, which is
usually small. The contrast in size IS the point. [#checker]

## slide: a position on a spectrum
**When:** interpretations, trade-offs or settings sit along one axis.
**Needs:** a range input with labelled ends (label every stop when there are 6 or fewer), an output that updates (quote, value, picture),
and optionally chips that light up for what that position relies on. Say whose placement it
is ("our reading").
**Trap:** dead range. Every stop must visibly change the output; if two look the same, change
the scale or drop a stop. [#readings]

## try: the reader makes an instance
**When:** the concept is a rule that turns input into output (encoding, a protocol, a parser,
a prompt).
**Needs:** a text input with a filled placeholder. On submit, show the transformed result in
context, plus the system's response. Make it work with an empty submit too, using a
default. [#board]

## switch off: necessary conditions
**When:** an outcome depends on several things holding at once.
**Needs:** one switch per condition, an artefact that degrades visibly per switch (blur,
scramble, fade), and a verdict line for each combination. [#legible]
**Trap:** dashing the condition you switched off and leaving the outcome untouched. The reader
learns nothing from seeing a missing part drawn dashed; they need to see what the outcome
loses (the resource shrinks, the link breaks, the message garbles). `scripts/states.sh` won't
catch this, because the drawing does change: check it by eye.

## static, on purpose
When the claim is a definition, a quote, or a single striking number, use a big number, a
quote, or a simple labelled figure. Not every section needs a control. A page with the
level's number of interactions (see the Effort table in SKILL.md) and some quiet sections reads
better than eight widgets.
