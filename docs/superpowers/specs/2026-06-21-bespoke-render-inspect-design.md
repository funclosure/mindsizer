# Bespoke Slide Authoring + Render-and-Inspect — Design

**Status:** Approved design
**Date:** 2026-06-21
**Scope:** PRD §17 build-order step 5 — per-slide iteration with agent-authored bespoke HTML and a render-and-inspect self-check. Lifts decks from "clean but plain" to comprehension visuals that make the idea *click* (§6.5, §9.3, §15).
**Builds on:** outline core (step 1), static render + theme (step 2), export-and-seal (step 3), the agent loop + Agent SDK adapter (step 4).

---

## 1. Purpose & boundaries

A new **build phase** turns an `outline.md` into a *rich* deck: the agent authors bespoke HTML (incl. inline SVG diagrams, stat readouts, staged build-ups) per slide, and a headless render-and-inspect loop guarantees each slide fits its 16:9 frame.

```
mindsizer ingest text.txt    → outline.md      (content — step 4)
mindsizer build  outline.md  → rich deck.html  (NEW — authors visuals + self-checks + seals)
```

**In scope:** the design brief; the per-slide HTML author (LLM seam); the Playwright fit-check; the build loop (author → validate → fit-check → fix); the build orchestrator + per-slide files; seal integration; the `build` CLI command.

**Out of scope (later):** vision-based aesthetic critique (this step checks *fit/breakage*, not beauty); the workspace UI (step 6); interactive per-slide steering / the two-gesture content-vs-design edits (needs the UI — `build` regenerates all slides); image/PNG export (step 7). The existing mechanical `mindsizer <outline.md>` seal stays as the no-LLM fast path.

---

## 2. Decisions this rests on (resolved)

- **Generation:** the agent **authors bespoke per-slide HTML** (full visual freedom, like the approved datacenter-SVG mockup) — not fixed templates. Implements the deferred per-slide-file model (`slides/<id>.html`).
- **Verification:** **programmatic fit-check** via Playwright headless — render the `<section>` at 16:9, measure overflow, feed problems back to the agent (no vision). De-risked: chromium installs; the measurement is exact (fitting → 0px, overflowing → 1674px in a probe).
- **Surface:** a new `mindsizer build <outline.md>` command; outline stays the canonical content checkpoint.
- **SDK:** the live author uses the same Claude Agent SDK `query()` adapter as step 4 (tools disabled; auth via Claude Code session). The `runQuery` helper is extracted to `src/agent/query.ts` and shared.

---

## 3. The design brief (`src/render/design-brief.ts`) — the richness engine

A `DESIGN_BRIEF` system-prompt string + a pure `slideAuthorPrompt(req)` builder. The brief encodes, with mini-examples:

- **The Field language:** navy `#0a1a2f` / cream `#f3efe5` / cyan `#4DD9E0`; Fraunces (display, italic cyan accents), Geist (body), Geist Mono (uppercase micro-labels, stat readouts); dot-grid substrate; hairline rules. Use the shared theme classes (`.s-title`, `.s-body`, `.s-col-label`, `.s-analogy`) and add **id-scoped** CSS (`#<slide-id> .x{…}`) for bespoke bits.
- **Comprehension-first:** one idea per frame; **prefer a visual/diagram/metaphor when it makes the idea click** (inline SVG is encouraged); density-inverted but **fill the 16:9 frame** — no empty lower half; explicitly **avoid generic AI-slop aesthetics** (no Inter/Roboto, no purple gradients, no cookie-cutter card grids).
- **Pattern menu (guidance, not rigid templates):** analogy two-column · stat-readout (Fraunces numbers + mono labels) · staged build-up · inline-SVG diagram/metaphor (e.g. the datacenter-of-minds) · pull-quote.
- **Output contract:** return exactly one `<section data-slide-id="<id>" data-layout="bespoke"> … </section>`, optionally preceded by a `<style>` of id-scoped rules; self-contained (no external resources — theme fonts are embedded at seal); must fit a 1280×720 (16:9) frame.
- **Fix mode:** when revising, the prompt includes the previous HTML and the concrete problem (e.g. "overflows the frame by 180px — tighten copy / shrink the visual / drop a row").

`slideAuthorPrompt(req)` composes `{ system: DESIGN_BRIEF, user: <slide content + deck context + optional fix> }`.

---

## 4. The slide author (LLM seam)

```ts
interface AuthorRequest {
  slide: OutlineSlide;                 // canonical content (title, layout hint, markdown)
  deck: { title: string; slideTitles: string[] };  // for cross-slide coherence
  fix?: { previousHtml: string; problem: string }; // present on a revision pass
}
interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>; // a <section …> fragment
}
```

- Real impl `anthropicSlideAuthor()` in `src/agent/slide-author.ts` — calls the shared `runQuery` (Agent SDK) with `slideAuthorPrompt(req)`. Strips any stray code fences from the result (reuse the fence logic), returns the `<section>` HTML.
- Injected into the build loop → the loop is unit-tested with a fake `SlideAuthor`.

---

## 5. The fit-check (`src/render/fit-check.ts`)

```ts
interface FitResult { fits: boolean; overflowPx: number; detail: string; }
interface FitChecker { check(sectionHtml: string): Promise<FitResult>; }
```

`playwrightFitChecker(themeCss: string): FitChecker` (validated approach):
- Launch headless chromium; `setContent` a page whose `.stage` forces the `<section>` to **exactly 1280×720** (override `aspect-ratio`), with `themeCss` + the section's own `<style>` applied.
- Measure `scrollHeight/scrollWidth` vs `clientHeight/clientWidth`; `overflowPx = max(0, sh-ch, sw-cw)`; `fits = overflowPx <= 2` (tolerance).
- `detail` = e.g. `"content overflows the 16:9 frame by 180px"`.
- Reuses one browser instance across `check` calls where practical; closes on disposal.

Injected into the loop → the loop is tested with a **fake** `FitChecker` (no browser); `playwrightFitChecker` gets its own integration test (fitting vs overflowing section) gated on chromium being available.

---

## 6. The build loop (`src/render/build-slide.ts`)

```ts
interface BuildDeps { author: SlideAuthor; fit: FitChecker; maxPasses?: number; }
async function buildSlide(slide, deck, deps): Promise<{ html: string; passes: number; fits: boolean }>;
```

1. `author.authorSlide({ slide, deck })` → html.
2. `validateSlideSection(html, slide.id)` (step 1) — if malformed, treat as a problem to fix.
3. `fit.check(html)` → if `fits`, return.
4. Else re-author with `fix: { previousHtml, problem }`; re-validate + re-check. Cap at `maxPasses` (default 3); on exhaustion return the last attempt with `fits:false` (the deck still builds; the slide is flagged).

Pure of IO/SDK/browser — everything via injected `deps` → fully unit-testable with fakes.

---

## 7. Build orchestrator + per-slide files (`src/render/build-deck.ts`)

`buildDeck(outline, deps): Promise<{ sections: Map<string,string>; warnings: string[] }>` — runs `buildSlide` for each slide in order, collects the authored `<section>`s by id, records warnings for any slide that didn't fit within `maxPasses`. The CLI then **writes each to `slides/<id>.html`** (step-1 `render-store`, the per-slide-file model) and seals.

---

## 8. Seal integration (`src/export/seal.ts`)

`sealDeck(outline, opts?: { sections?: Map<string,string> })`:
- When `sections` is provided, inline the **authored** `<section>`s (with their id-scoped `<style>`) in outline order, instead of mechanical `renderSlide`. Any id missing from the map falls back to `renderSlide` (graceful).
- Everything else unchanged: validate, embed fonts, inline `field.css` + `DECK_CSS`, append `NAV_JS`. The authored sections already carry `data-slide-id`, so the nav runtime + deck CSS work as-is.

---

## 9. The `build` command (`src/cli.ts`)

```
mindsizer build <outline.md> [-o <out.html>] [--open]
```
- Read + `parseOutline`; print `building N slides…`.
- `buildDeck(outline, { author: anthropicSlideAuthor(), fit: playwrightFitChecker(fieldCss), maxPasses: 3 })`.
- Write `slides/<id>.html` for each; print per-slide progress (`✓ s_x (fit, 1 pass)` / `⚠ s_y (overflow after 3)`).
- `sealDeck(outline, { sections })` → write `<basename>.html`; `--open` opens it.
- Errors (exit 1): unreadable file; invalid outline; no Claude auth (surfaced by the SDK); chromium missing (clear message: run `bunx playwright install chromium`).

---

## 10. File structure

```
src/render/
├── design-brief.ts     # DESIGN_BRIEF + slideAuthorPrompt (pure)
├── fit-check.ts        # FitChecker + playwrightFitChecker (Playwright)
├── build-slide.ts      # SlideAuthor iface + buildSlide loop (pure, injected deps)
└── build-deck.ts       # buildDeck orchestrator
src/agent/
├── query.ts            # extracted shared runQuery(system,user) (Agent SDK)
├── anthropic-client.ts # refactored to import runQuery
└── slide-author.ts     # anthropicSlideAuthor() (live; typecheck-only)
src/export/seal.ts      # + sections-inlining path
src/cli.ts              # + `build` subcommand
package.json            # + playwright (dev), chromium cached
```

---

## 11. Testing (honest)

- **design-brief.ts** — `slideAuthorPrompt` includes the slide content, deck title, the `data-slide-id`/16:9/id-scoped contract, and fix info when present; `DESIGN_BRIEF` contains the Field tokens + "avoid generic" guidance.
- **build-slide.ts** — fake `SlideAuthor` (returns overflowing section then a fixed one) + fake `FitChecker` (overflow→fits): asserts it authors, detects overflow, re-authors with the problem, returns the fitting html, respects `maxPasses`, and flags `fits:false` on exhaustion; a malformed section triggers a fix.
- **build-deck.ts** — fakes over a 2-slide outline → a `sections` map keyed by id, with warnings for non-fitting slides.
- **seal.ts** — `sealDeck(outline, { sections })` inlines the authored sections (not the mechanical render) and still embeds fonts + nav; a missing id falls back to `renderSlide`.
- **fit-check.ts** — integration test with real chromium: a fitting section → `fits:true, overflowPx 0`; a tall section → `fits:false, overflowPx>0`. Gated on chromium availability (cached); if unavailable, skipped + verified by running.
- **query.ts refactor** — existing step-4 agent tests stay green (no behavior change).
- **CLI `build`** — pre-LLM error paths (missing file, invalid outline) tested via subprocess.
- **Not unit-tested (documented):** `slide-author.ts` (live LLM, typecheck-only) and the full `build` happy path (needs live Claude + browser) — verified by the user running `mindsizer build`.

---

## 12. Summary

`mindsizer build` makes the agent author bespoke comprehension HTML per slide — guided by a strong Field design brief — and a headless render-and-inspect loop guarantees every slide fits its 16:9 frame, re-authoring overflowing slides up to 3×. The authored sections are written as per-slide files and sealed into the same offline single-file deck. This is the step that turns "clean but plain" into slides that make the idea click — with the self-check that makes ambitious visuals reliable.
