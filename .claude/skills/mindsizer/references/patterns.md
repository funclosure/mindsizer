# Interaction patterns — pick the verb that IS the mechanism

Each pattern lists when to use it, the minimum it needs, and the trap to avoid. The live
versions are in `examples/channel.html` (section id in brackets).

## train / run: a simulator
**When:** an outcome emerges from repeated steps (learning, growth, selection, compounding).
**Needs:** 1–2 conditions the reader sets, plus "step" and "step ×10" buttons and a reset.
Show the state as bars, and history as a line chart. Start pre-run (e.g. 20 steps in) so the
first view already shows the effect.
**Trap:** fake precision. Label the model "illustrative" and keep its rule simple enough to
state in one sentence. [#score]

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
so the difference is the only change. [#reproduction]

## reveal: belief vs reality
**When:** people (or agents) act on a wrong model of something.
**Needs:** the believed version drawn big, plus a button that reveals the real one, which is
usually small. The contrast in size IS the point. [#checker]

## slide: a position on a spectrum
**When:** interpretations, trade-offs or settings sit along one axis.
**Needs:** a range input with labelled ends, an output that updates (quote, value, picture),
and optionally chips that light up for what that position relies on. Say whose placement it
is ("our reading"). [#readings]

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

## static, on purpose
When the claim is a definition, a quote, or a single striking number, use a big number, a
quote, or a simple labelled figure. Not every section needs a control. A page with 3–5
interactions and some quiet sections reads better than eight widgets.
