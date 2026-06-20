# `mindsizer` CLI + Export-and-Seal — Design

**Status:** Approved design
**Date:** 2026-06-20
**Scope:** PRD §17 build-order step 3 (export-and-seal), delivered as the `mindsizer` command. Turns a Marp-style `outline.md` into one self-contained, offline `deck.html`.
**Builds on:** the outline core library (step 1, `src/outline/`) and the static render path (step 2, `src/render/`, `theme/field.css`).
**Resolves:** PRD §11 (export model) and §15.2 (fonts → subset+embed; here: full-embed now, subset later).

---

## 1. Purpose & boundaries

Make mindsizer usable from the shell today: `mindsizer <outline.md>` → one self-contained `deck.html` that opens by double-click, works offline indefinitely, with the Field theme, embedded fonts, and a keyboard-navigable slide runtime.

**In scope:**
- The `mindsizer` CLI entry point (installed via `bun link`).
- `sealDeck(outline)` — the reusable export-and-seal core (pure).
- Font embedding (base64 `@font-face`, truly offline).
- The deck viewer runtime (one slide at a time, arrow-key nav, counter, progress).

**Out of scope (later steps):** the agent loop / ingesting raw text → outline (step 4), the workspace server + UI (step 6), per-slide PNG export (step 7), glyph-subsetting of fonts (optimization), the `build-up`/`quote`/`bespoke` layouts (the deck errors clearly if an outline uses them).

---

## 2. Decisions this rests on (resolved)

- **`mindsizer <outline.md>` produces ONE sealed `deck.html`** — the carry-anywhere artifact (PRD §11). This is step 3 delivered as the CLI; "make it usable" and the next build-order step are the same work.
- **Fonts embedded** as base64 `@font-face` (truly offline, PRD §11; full woff2 now, glyph-subset later per §15.2).
- **`sealDeck` is the reusable export core** — the CLI is its first caller; the future workspace export button calls the same function.
- **Input must use static-renderable layouts** (analogy/plain); other layouts error clearly until later steps.

---

## 3. The command (`src/cli.ts`)

A Bun script with `#!/usr/bin/env bun`, registered as a `bin` named `mindsizer` in `package.json`, installed globally with `bun link` (the sibling loupe project's pattern).

```
mindsizer <outline.md> [-o <out.html>] [--open]
```

- Reads `<outline.md>`. Default output: `<outline-basename>.html` beside the input (e.g. `deck.md` → `deck.html`). `-o`/`--out` overrides. `--open` opens the result in the default browser after writing.
- **Progress** to stdout: `✓ parsed N slides`, `✓ rendered + validated`, `✓ sealed → <path>`.
- **Errors** (stderr, non-zero exit):
  - input file missing → `error: cannot read <path>`.
  - invalid outline → `error: invalid outline:` then the `validateOutline` issues.
  - a slide using a layout with no static renderer → `error: slide <id> uses layout '<layout>' — no static renderer yet`.
- The CLI is a thin shell: arg parsing + file IO + calling `sealDeck`. No business logic of its own.

---

## 4. The seal pipeline (`src/export/seal.ts`)

`sealDeck(outline: Outline): string` — pure (no IO of its own beyond reading bundled theme assets), fully testable:

1. `validateOutline(outline)` → if issues, throw an `Error` whose message lists them.
2. For each slide in **document order**: `renderSlide(slide)` (step 2) → fragment. `renderSlide` already throws for unsupported layouts; `sealDeck` lets that propagate (the CLI formats it).
3. Assemble one HTML document:
   - `<head>`: `<meta charset/viewport>`, then a single `<style>` containing **(a)** the `@font-face` rules from `fontFaceCss()`, **(b)** the contents of `theme/field.css` inlined once, **(c)** the `DECK_CSS` viewer chrome.
   - `<body>`: a `<div class="deck">` containing all `<section>` fragments in order, the nav chrome (`<div class="deck-counter">`, `<div class="deck-progress">`), and a single inlined `<script>` with `NAV_JS`.

Theme assets (`theme/field.css`, `theme/fonts/*`) are resolved **relative to the module file** (via `import.meta.url` → `fileURLToPath`), so `mindsizer` works regardless of the caller's working directory. (This avoids the cwd-coupling that the preview helper has; preview is unchanged here.)

---

## 5. Font embedding (`src/export/fonts.ts`)

- `theme/fonts/` holds the open-licensed woff2 files: **Fraunces** (roman + italic — italic is used for the analogy source and is core to the look), **Geist**, **Geist Mono**. Obtained once via Fontsource (`@fontsource*` packages ship OFL woff2); the chosen woff2 are copied into `theme/fonts/` and committed so the sealer needs no network and no `node_modules` at runtime.
- `fontFaceCss(): string` reads each present woff2, base64-encodes it, and returns `@font-face` rules:
  - `@font-face { font-family:"Fraunces"; src:url(data:font/woff2;base64,…) format("woff2"); font-weight:100 900; font-style:normal; }` (and a second rule with `font-style:italic` for the italic file).
  - `Geist` (weight range), `Geist Mono`.
- Variable-font axes (`SOFT`/`opsz`) used by `field.css` via `font-variation-settings` work against the embedded variable woff2.
- Missing font files are skipped (the function emits rules only for files present), so the build degrades to system fallback rather than crashing — but the committed set is the expected path.

---

## 6. The deck viewer runtime (`src/export/deck-runtime.ts`)

Two exported string constants, inlined by `sealDeck`:

- **`DECK_CSS`** — viewer chrome: page ground, `.deck` centers the active slide; every `section[data-slide-id]` is hidden except `.is-active`; the active slide is sized to fit the viewport at 16:9 (`width:min(96vw, calc(96vh * 16/9))`); a fixed slide counter and a bottom progress bar styled in the Field palette.
- **`NAV_JS`** — vanilla inline JS, no dependencies: tracks a current index over the `section[data-slide-id]` elements; `ArrowRight`/`Space`/`ArrowDown` → next, `ArrowLeft`/`ArrowUp` → previous (clamped at the ends); updates the active class, the `NN / NN` counter, and the progress bar width. Runs on `DOMContentLoaded`. This is the small runtime the deck "carries its own" (§11) since there is no server at view time.

---

## 7. File structure

```
src/
├── cli.ts                  # #!/usr/bin/env bun — args, IO, calls sealDeck
└── export/
    ├── seal.ts             # sealDeck(outline) → one self-contained HTML (pure)
    ├── fonts.ts            # fontFaceCss() → base64 @font-face rules
    ├── deck-runtime.ts     # DECK_CSS + NAV_JS string constants
    └── index.ts            # barrel: sealDeck, fontFaceCss
theme/
└── fonts/                  # Fraunces (roman+italic), Geist, Geist Mono woff2 (committed)
package.json                # + "bin": { "mindsizer": "src/cli.ts" }
```

`src/index.ts` also re-exports `./export/index`.

---

## 8. Testing

- **fonts.ts** — `fontFaceCss()` returns `@font-face` rules containing `data:font/woff2;base64,` for each committed family, and family names `Fraunces`/`Geist`/`Geist Mono`.
- **deck-runtime.ts** — `DECK_CSS` contains the `.is-active` selector and `section[data-slide-id]`; `NAV_JS` contains the key handler (`ArrowRight`) and references the counter/progress.
- **seal.ts** —
  - `sealDeck` over a 2-slide sample returns one `<!DOCTYPE html>` document containing both slide ids, the inlined Field token (`--s-cyan`), base64 font data, and the nav script.
  - throws (message lists issues) for an invalid outline (e.g. missing title).
  - throws naming the slide + layout for an unsupported layout (e.g. `bespoke`).
- **CLI smoke (integration)** — run `bun run src/cli.ts <sample>.md -o <tmp>/deck.html` in a temp dir; assert exit 0, the file exists, and it contains both slide ids + `data:font/woff2`. A missing input file exits non-zero.
- **Visual** — open the sealed deck in a headless browser, screenshot the first slide, press `ArrowRight`, screenshot the second — confirm rendering + navigation.

---

## 9. Error handling summary

| Condition | Behavior |
|-----------|----------|
| input file unreadable | stderr `error: cannot read <path>`, exit 1 |
| outline invalid (`validateOutline`) | stderr lists issues, exit 1 |
| slide layout has no static renderer | stderr names slide + layout, exit 1 |
| success | progress to stdout, write file, exit 0 |

---

## 10. Summary

`mindsizer <outline.md>` parses + validates the outline, renders each slide (step 2), and seals everything — Field theme, base64-embedded fonts, and a small keyboard-nav runtime — into one self-contained `deck.html` that opens by double-click and works offline indefinitely. `sealDeck` is the reusable export core (CLI now, workspace later). No agent, no server — the outline→deck sealer.
