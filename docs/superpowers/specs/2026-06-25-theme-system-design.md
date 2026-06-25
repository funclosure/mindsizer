# Design: Theme System (injectable, swappable)

Date: 2026-06-25
Status: Approved (brainstorm) — ready for implementation planning

## 1. Context & motivation

mindsizer's "Field" aesthetic is hardcoded in three places: the stylesheet (`theme/field.css`),
the embedded fonts (`theme/fonts/*.woff2` → `fontFaceCss()` with a hardcoded list), and — crucially
— the **author's aesthetic brief** (the `## Aesthetic — Field` paragraph inside `IDENTITY_BRIEF`).
That third one is why a theme is more than a CSS swap: if the author isn't re-briefed in words, it
keeps designing Field-looking slides against a different stylesheet.

Goal: extract the theme into an injectable, swappable unit so different themes can be provided —
and ship a second theme (**Paper**, light editorial) to prove it.

## 2. Goals / non-goals

Goals:
1. A `Theme = { name, css, fontFaceCss, brief }`, loaded from a directory convention.
2. `themes/<name>/` folders (drop a folder = add a theme); migrate Field in.
3. Theme selection: `--theme` flag → outline `theme:` frontmatter → default `field`.
4. Inject the theme at all three points: the sealed deck (css + fonts), the render fit-check (css +
   fonts), and the author's aesthetic brief.
5. Ship **Paper** (light editorial), reusing the vendored fonts.

Non-goals (YAGNI):
- Per-slide theming; runtime theme switching inside a sealed deck; a theme marketplace.
- New fonts for Paper (it reuses Fraunces/Geist/Geist-Mono; the loader supports per-theme fonts for
  future themes).
- Theming the homepage generator or the deck runtime (scaling stage + nav stay theme-agnostic).

## 3. Directory layout

```
themes/
  fonts/                     ← shared woff2 pool (moved from theme/fonts/)
    fraunces.woff2, fraunces-italic.woff2, geist.woff2, geist-mono.woff2
  field/
    theme.css                ← moved from theme/field.css
    brief.md                 ← the "## Aesthetic — Field" section (extracted from IDENTITY_BRIEF)
    fonts.json               ← [{family,file,style}] (the current 4)
  paper/
    theme.css                ← new (light editorial)
    brief.md                 ← new (Paper aesthetic)
    fonts.json               ← references the same 4 shared files
```
The old `theme/` directory is removed. A theme may optionally include its own `fonts/` subdir for
new fonts; the loader resolves a `fonts.json` `file` from the theme's own `fonts/` first, else the
shared `themes/fonts/`.

## 4. Components & interfaces

### A. Theme loader — `src/theme/load.ts` (NEW, unit-tested)
```ts
export interface Theme { name: string; css: string; fontFaceCss: string; brief: string; }
export function loadTheme(name: string): Theme;   // reads themes/<name>/
export function listThemes(): string[];           // theme dir names (for errors / help)
```
`loadTheme` reads `theme.css`, `brief.md`, and `fonts.json`; builds `fontFaceCss` from the font
specs (base64-embedding each woff2, resolved per-theme-then-shared). Unknown name → throws
`Error("unknown theme '<x>' — available: <list>")`.

### B. Font embedding — `src/export/fonts.ts`
`fontFaceCss(specs: FontSpec[], resolveDir: (file: string) => string): string` — take the specs +
a resolver instead of the hardcoded `FONTS`/`FONTS_DIR`. (`loadTheme` supplies both.) Keeps the
missing-file-degrades behaviour.

### C. Seal — `src/export/seal.ts`
`sealDeck(outline, { sections?, theme }: { sections?: Map; theme: Theme })` — embed
`theme.fontFaceCss + theme.css` (was `fontFaceCss() + readFieldCss()`). Remove `readFieldCss`/
`THEME_DIR`. The deck runtime (`DECK_CSS`, `NAV_JS`) is unchanged. `placeholderSection` unchanged.

### D. Author brief — `src/render/design-brief.ts`
Replace the `IDENTITY_BRIEF` constant with `identityBrief(aesthetic: string): string`: the same
array, but the two hardcoded `## Aesthetic — Field` lines are replaced by the injected `aesthetic`
(a theme's `brief.md`, which carries its own `## Aesthetic — <Name>` header + body). All other
sections (genre, format, interactivity, EYES, output contract) are universal and unchanged.
`slideAuthorPrompt(req, aesthetic)` → `{ system: identityBrief(aesthetic), user }`.

### E. Threading the brief — `src/agent/agentic-author.ts`
`agenticAuthor(renderer, aesthetic)` → passes `aesthetic` to `slideAuthorPrompt(req, aesthetic)`.
The brief is baked into the author at construction, so `buildDeck`/`buildSlide` stay theme-agnostic.

### F. Sink seals with the theme — `src/export/build-sink.ts`
`fileSink(buildDir, outline, outPath, theme)` → passes `theme` to every `sealDeck(...)` (initial,
per-slide reseal, final). One added parameter.

### G. CLI wiring — `src/cli.ts`
- Parse `--theme <name>`.
- Resolve: `const themeName = flagTheme ?? outline.meta.theme ?? "field";` then
  `const theme = loadTheme(themeName);` (a clear `fail()` with the available list on error).
- `runBuild`: renderer `playwrightRenderer(theme.fontFaceCss + "\n" + theme.css)`; author
  `agenticAuthor(renderer, theme.brief)`; `fileSink(buildDir, outline, outPath, theme)`.
- `runSeal` (the no-LLM fast path): also resolve + load the theme and pass it to `sealDeck`.
- Usage strings gain `[--theme <name>]`.

### H. Path-migration consumers
- `src/render/preview.ts:18` — `theme/field.css` → load via `loadTheme` (or `themes/field/theme.css`).
- `site/build-home.ts:9` — `theme/fonts` → `themes/fonts` (homepage stays Field-styled; only the
  font path changes).

### I. The Paper theme — `themes/paper/`
- `theme.css`: light editorial — ground `#faf7f0`, ink `#1a1a1a`, accent `#1d4ed8`, hairlines at
  low opacity on dark ink, generous margins; mirrors Field's class contract (`.deck section`,
  `.s-title`, `.s-body`, mono micro-labels) so authored/placeholder slides render correctly.
- `brief.md`: `## Aesthetic — Paper` — "A calm light editorial page: warm off-white paper ground,
  near-black ink, a single restrained ink-blue accent; Fraunces display serif, Geist body, Geist
  Mono micro-labels; hairline rules, generous margins, lots of air. Printed-page calm, NOT a dark
  dashboard. Avoid AI-slop (no Inter/system-ui, no gradients, no rounded-card grids)."
- `fonts.json`: the same 4 families/files/styles as Field (shared pool).

## 5. Data flow
```
cli: themeName = --theme ?? outline.meta.theme ?? "field" → loadTheme → Theme{css,fontFaceCss,brief}
  renderer  = playwrightRenderer(theme.fontFaceCss + theme.css)   # author renders against the theme
  author    = agenticAuthor(renderer, theme.brief)                # author designs to the aesthetic
  sink      = fileSink(buildDir, outline, outPath, theme)         # seals css+fonts into the deck
```

## 6. Error handling
- Unknown theme → `loadTheme` throws → cli `fail()` prints "available: field, paper".
- Missing `brief.md`/`fonts.json`/`theme.css` in a theme dir → throw a clear "theme '<x>' is missing
  <file>" (a malformed theme fails loudly, not silently half-applied).
- Missing woff2 → the font face is skipped (degrade to system fallback), as today.
- `outline.meta.theme` already defaults to `"field"` in the parser, so existing outlines keep working.

## 7. Testing strategy
- **Unit:**
  - `loadTheme("field")` and `loadTheme("paper")` from disk → `css` non-empty, `fontFaceCss` contains
    `@font-face` + base64, `brief` contains `## Aesthetic`. `listThemes()` includes both. Unknown
    name throws with the available list.
  - `fontFaceCss(specs, resolveDir)` → one `@font-face` per resolvable spec; a missing file is
    skipped.
  - `identityBrief(aesthetic)` → contains the injected aesthetic AND the universal parts
    (`landing page`, `1280`, the EYES `clean` line); `slideAuthorPrompt(req, aesthetic).system ===
    identityBrief(aesthetic)`. (Update the existing `design-brief.test.ts` to the new signature.)
  - `sealDeck(outline, { theme })` with a fake minimal `Theme` → the deck embeds the theme's css +
    fontFaceCss (and still the DECK_CSS/NAV_JS).
- **Verified-by-running (the live proof):** build the already-ingested McLuhan deck
  `build medium.outline.md --theme paper` → a **light** editorial deck (paper ground, ink text);
  spot-check a contact sheet; and confirm a `--theme field` build still produces the dark deck. Also
  `mindsizer <outline> --theme paper` (fast path) seals light.

## 8. Build order (for the plan)
Stage 1 — theme module + Field migration:
1. Create `themes/fonts/` (move woff2), `themes/field/{theme.css, brief.md, fonts.json}`.
2. `fonts.ts`: parameterize `fontFaceCss(specs, resolveDir)`.
3. `theme/load.ts`: `Theme`, `loadTheme`, `listThemes` + tests.
4. `seal.ts`: `sealDeck({ sections, theme })`; remove `readFieldCss`.
5. `design-brief.ts`: `identityBrief(aesthetic)` + `slideAuthorPrompt(req, aesthetic)`; update test.
6. `agentic-author.ts`: `agenticAuthor(renderer, aesthetic)`.
7. `build-sink.ts`: `fileSink(…, theme)`; `cli.ts`: `--theme` resolution + wiring (runBuild + runSeal);
   `preview.ts` + `site/build-home.ts` path updates.
Stage 2 — Paper + proof:
8. `themes/paper/{theme.css, brief.md, fonts.json}`.
9. Live: build McLuhan `--theme paper` (light) + a `--theme field` sanity build.

## 9. Success criteria
- `build … --theme paper` produces a light editorial deck; `--theme field` (or default) the dark
  Field deck; the author is demonstrably re-briefed (Paper slides read light, not dark).
- Adding a theme is "drop a `themes/<name>/` folder"; unknown theme fails with the available list.
- `tsc` clean; the loader + brief + seal pure pieces green under unit tests; existing outlines
  (default `field`) unchanged.
