# Style — calm, readable, one accent

The look exists so the claim and the figure are what the eye finds first. It is already
implemented in `assets/template.html`. This page explains the choices, so you can apply them
to new components.

## Type
- **Body:** Source Serif 4, 19px, line-height 1.6. Reading text, quotes and the dek.
- **Headings and UI:** Schibsted Grotesk.
  - `h1` 48–100px, weight 800, tracking −0.04em.
  - `h2` 30–46px, weight 750.
  - Buttons, labels, notes and stats use the same face at 13–17px.
- **Mono:** JetBrains Mono, ONLY for things that are literally code, paths, commands or data
  identifiers.
- Don't use flashy display faces for headings (the user found Bricolage "too stylish"). Don't
  use letter-spaced uppercase micro-labels. Labels are sentence case.

## Color (tokens in the template; light and dark both defined)
- Neutral ground (near-white / near-black), `--fg`, `--muted`, `--faint`, `--line`, `--surface`.
- **One accent, with one meaning across the whole page.** Decide what it means for this
  topic (the thing being rewarded, the active path, the quantity that matters) and use it
  only for that: bars, lines, highlighted chips, the `path` kicker.
- Pick a meaning broad enough to hold in every figure. "What is acting right now" works for
  many topics: the rewarded behaviour, the changed weights, the live context, the note being
  read. If one figure genuinely needs a second meaning, give that figure a one-line legend
  rather than adding a second accent.
- `--accent` is for fills. Use `--accent-text` for text, because it passes contrast.
- Every text token (`--fg`, `--muted`, `--faint`) must pass 4.5:1 on `--bg` and `--surface` in both
  themes. The template values do. The "illustrative" notes are the page's honesty signal, so
  they must be readable.
- Never put colour on headings for decoration. Use no gradients, unless the gradient itself
  encodes a scale.

## Layout
- Reading column 640px (`.col`). Figures break out to 980px (`.wide`).
- Scrolly section: two columns at ≥980px, with beats on the left and a sticky figure on the
  right. On narrow screens the figure sticks to the top and the beats scroll beneath it.
- A set of 2–5 parallel things (dimensions, candidates, positions) is a `.cards` row: the same
  anatomy in every card (a `.k` tag for who or when, the term, a one-line definition), with
  `.on` on the one the section is about. People take in a set faster as a row than as a
  paragraph.
- Group things with space and alignment, not boxes. Cards and borders are only for things
  that ARE objects in the explanation (a box representing a grader, a pillar).
- Pills are for buttons and segmented controls only.
- The page must read fully at rest, with no content hidden until scroll. Animations start
  from a visible state.
- Phone width (~400px) must work. Rows wrap, and wide listings scroll inside their own box.
- SVG figures shrink with their `viewBox`, so a 960-wide chart shown 360px wide turns 12px
  labels into 4.5px. Keep a figure's viewBox no wider than about twice its phone width (≤ 720),
  make labels ≥ 24 user units, or put labels in HTML beside the drawing. Leave room for the
  longest label inside any shape.

## Annotations (after [neat-annotations](https://github.com/syabro/neat-annotations), MIT)
- What they look like: a thin curve in `--accent` that bows on its way to the point, an open
  arrowhead, and a handwritten label in `--hand` (Shantell Sans, 14px) tilted −4°, in
  `--accent-text`. The template's `annotate()` draws all of it.
- What they're for: the hand says "a person is pointing at this for you". Use them on figures
  for what to notice, the cause, or the surprise, never for decoration or to name every part.
- At most 3 per figure. Labels sit in a gutter outside the drawing, never over marks or text.
- Link words and picture: the phrase an annotation names gets `.ann-text` (an accent wash) in
  the prose.
- The handwriting is for annotations only. Headings, labels and UI stay in the page faces.

## Motion
- Short CSS transitions (0.3–0.6s) on state changes that the reader caused.
- At most one ambient element (e.g. a live feed in the hero), with a Pause button.
- Respect `prefers-reduced-motion`. The template already disables transitions.
