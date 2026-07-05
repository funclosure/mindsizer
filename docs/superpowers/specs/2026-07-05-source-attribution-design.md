# Source attribution field — design

**Date:** 2026-07-05
**Status:** approved (design validated live: the same chrome was hand-patched onto the three
published gh-pages decks and reviewed by the user before this feature was requested)

## Problem

Sealed decks carry no attribution for the text they teach. The three published decks were
hand-patched with a bottom-left `Source: <link>` chrome element; new decks should get this
from the outline instead of manual HTML surgery.

## Design

One optional deck-level field flows outline front-matter → sealed deck chrome.

### Front-matter (`outline.md`)

```yaml
source:
  label: Paul Graham — “Do Things That Don’t Scale”
  url: https://www.paulgraham.com/ds.html
```

Shorthand: `source: <url>` (plain string) is accepted and treated as `{ url }`.
Either key may be omitted, but an empty/blank `source` parses as absent.

### Model

`DeckMeta.source?: { label?: string; url?: string }` — present only when at least one
key has content. `parseOutline` normalizes (trims, drops blanks); `serializeOutline`
writes the object back with only its defined keys and omits `source` entirely when unset
(round-trip symmetric, like `title`/`theme`).

### Chrome (`sealDeck` + `DECK_CSS`)

- `DECK_CSS` gains `.deck-source` rules unconditionally (inert without the div):
  fixed bottom-left mirror of `.deck-counter` — same mono font/size/tracking,
  `var(--s-dim, …)` ink, hover `var(--s-fg, …)`, link underlined via `border-bottom`.
- `sealDeck` emits `<div class="deck-source">Source: …</div>` before `.deck-counter`
  only when `meta.source` is set. `url` present → escaped `<a target="_blank"
  rel="noopener">` with `label ?? url` as text; label-only → plain text, no anchor.
- Sits outside `.deck`, so review's `extract-deck` slide splitting is unaffected.

### CLI

`mindsizer ingest` gains `--source <url>` and `--source-label <text>`: after the agent
writes the outline, the flags are injected into `meta.source` before the file is saved
(parse → set → serialize; the model never sees them). The build path needs no flag —
it reads front-matter.

## Testing

- `tests/outline/parse.test.ts` — object form, string shorthand, blank → absent.
- `tests/outline/serialize.test.ts` — round-trip with/without source; no stray keys.
- `tests/export/seal.test.ts` — link rendered + escaped; label-only → no anchor; absent → no div.
- `tests/export/deck-runtime.test.ts` — `.deck-source` present in `DECK_CSS`.
- `tests/export/cli.test.ts` — e2e seal of an outline whose front-matter carries `source`.

## Out of scope

Auto-detecting a URL during ingest; per-slide citations; retrofitting already-sealed decks
(done by hand on gh-pages).
