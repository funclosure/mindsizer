# Style: calm print, a pencil that points

Every mindsizer page is built in one of five styles. All five share one direction, after
[neat-annotations](https://github.com/syabro/neat-annotations) (MIT): the text is calm print,
and a pencil (thin, slightly curved strokes, soft marker tints, a little handwriting) points at
what to notice. The styles differ in type, colour and texture, never in structure, so the same
page can be rebuilt in another style without touching its content.

## The five styles (`assets/styles/*.css`)

| Style | Look | Colour | Good for |
|---|---|---|---|
| `neat` | The library as it is: system sans, white paper | one colour per idea (`.h1`–`.h4`) | arguments with 3–4 distinct ideas |
| `graphite` | Everything in pencil grey | a yellow highlighter, only for the point | dense or technical material where colour would distract |
| `ink` | Serif reading face, a faint dot grid, hatched fills | one fountain-pen blue | the default; long reading: talks, essays, docs |
| `margins` | Notes move into a wide right margin on big screens | one red-orange | text-heavy pages with many asides |
| `pencil` | Rounder type, softer doubled strokes | a few coloured pencils, one per idea | friendly introductions, beginners |

Use the style the user names. With none named, use `ink`. Start the page with
`scripts/new-page.sh <style> <out.html>`, which fills the style into the template.

## What a style controls (the token contract)
Each style file defines the same tokens in light and both dark blocks, so the base CSS in the
template never changes:
- paper and text: `--bg`, `--surface`, `--ink`, `--ink-2`, `--rule`, `--paper` (a background
  texture or `none`);
- idea colours: `--h1-c/t/m` … `--h4-c/t/m` (stroke, text, marker tint) and `--gray-c/t/m`.
  Single-colour styles give all four the same values;
- faces: `--body`, `--head`, `--ui` (controls, notes, labels), `--fig` (figure labels);
- pencil behaviour: `--radius`, `--pencil-passes` (2 = doubled strokes), `--fill-mode`
  (`tint` or `hatch`), `--margin-notes` (1 = notes move to the margin on wide screens).

A new style is a new file with these tokens. Every text token passes 4.5:1 on `--bg` in both
themes; `--h*-t` is the text version of a colour, `--h*-c` is for strokes only.

## Colour
- Give each map step an idea colour, `.h1`–`.h4`, and use it everywhere that idea appears: the
  map chip, the path, the marker on its term, its figure (`<div class="fig h2">`), the `.on`
  item in a set. In single-colour styles the classes still go on; they just render alike.
- The legend under the map says what colour means. Multi-colour styles name each colour's
  idea. Single-colour styles say what the one colour marks ("Blue marks what the page is
  pointing at…").
- Colour never decorates headings. No gradients.

## Type
- Print voice: `--body` for reading, `--head` for headings (weight 600, never a display face),
  `--ui` for controls, notes and labels. Sentence case; no letter-spaced capitals.
- Pencil voice: Shantell Sans (`--hand`) only for what the author says on the side: figure
  annotations, inline notes, set tags, the "so" before a takeaway, "try:" and "watch:", quote
  attributions, the chain numbers. Never for headings, body text or anything the reader must
  read to follow the argument.
- Never put code, identifiers, commands, numbers or anything the reader must read exactly in
  the pencil voice. A set tag that names code is `<span class="tag code">`: print, monospace,
  untilted. Pencil tags are short asides ("Markdown", "an outside process").
- A tag fits on one line (about three words); the CSS cuts off anything longer, and
  `scripts/states.sh` reports it, so every item's heading lines up.
- Mono only for literal code, paths and data (`.listing`).
- Original-language glosses (`<ruby>term<rt>original</rt></ruby>`, see SKILL.md) are small
  `--ui` text centred above the term. The template overlays them, so a long gloss never
  widens its term or opens a gap in the line. It needs the extra line height of body prose:
  in tight text (chain steps, `.note`) it lands on the line above, so it stays out of those.

## Layout
- Reading column 660px (`.col`). Figures sit in the column; their SVG is at most 600 wide.
- A set of 2–5 parallel things is a `.set`: columns, no boxes, the same anatomy each (a
  pencilled `.tag`, the term, a one-line definition), `.on` + idea class on the one the section
  is about.
- A sequence is a `.chain`: numbered, top to bottom, with a pencilled arrow between steps. Never
  show a sequence as a set.
- Detail beyond the first read folds into `details.more` at the end of its section: a
  pencilled "+ more: …" summary that names what's inside, opening to an indented column with a
  thin rule. The first read never depends on it.
- A sequence of states that one drawing can show is a `.scrolly`: beats on the left, the
  drawing sticky on the right (on top on phones), redrawn with `draw()` per beat.
- No cards, borders or shadows around content. Group with space and alignment.
- Controls are words: `.opts` options get the marker when picked; `.checks` are drawn boxes with
  a pencilled tick; buttons are `.textbtn` (underlined handwriting).
- The page reads fully at rest. Phone width (~400px) works: an SVG 600 units wide shows at
  about 0.6×, so figure labels and sub-labels stay at 20 user units (`.fl`, `.fs`) and
  annotations at 21 (`.al`). `scripts/states.sh` lists any SVG text under 12px at phone width.

## Figures (the pencil kit in the template)
- Draw with `ring()` (a circle in one uneven stroke), `line()` (a gently bowed stroke),
  `head()` (an open arrowhead), `blob()` (a marker swash behind a shape, class `fillmk`) and
  `smooth()` (a curve through points). Shapes are seeded by key, so they look identical on
  every redraw.
- Render each state with `draw(svg, items)`. Items that are new since the last state are
  pencilled in; the rest stay put. That motion is the only animation a figure needs.
- Classes: `ln` (ink stroke), `ln hue` (the idea colour), `ln soft` (grey, for what doesn't
  matter), `ln dash` (a ghost: something removed), `ln bold` (the cause), `fl` / `fs` (label,
  sub-label), `al` (annotation text). Never style SVG text with a bare `svg text` rule.

## Annotations
- In figures: `ann(key, { to, at, text, side })` returns draw items: a bowed stroke from a label
  in the gutter to the point that matters. At most 3 per state, ≤ 6 words, saying what to
  notice or the cause, never just a part's name. Put the label above or beside its target, never
  below it, or its own stroke crosses it.
- Write a note for every reachable state. With several switches, give each missing part its own
  note, shown together. When a condition is switched off, draw what that does to the outcome
  and point at the consequence; a ghost (`ln dash`) of the removed part may stay as a reminder,
  but it is never the whole change, and a note never points at blank space. A note never
  contradicts the drawing.
- In prose: `<span class="ann h3" data-note="what to notice">phrase</span>`, on the last line of
  its paragraph, with `.room-below` on that paragraph (`ann-nw` when the phrase sits near the
  right edge). At most 2–3 on a page. In `margins`, these move into the margin by themselves.

## Motion
- State changes the reader caused: strokes draw in (0.6s), labels fade in. Nothing moves on its
  own. `prefers-reduced-motion` turns it all off.
