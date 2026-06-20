# Static Render Path — Design

**Status:** Approved design
**Date:** 2026-06-20
**Scope:** PRD §17 build-order step 2 — "Outline → one themed HTML slide (no agent yet). Prove the 'Field' theme survives the density-inversion on a real 16:9 comprehension frame."
**Builds on:** the outline core library (step 1, `src/outline/`) and its injection contract spec (`2026-06-20-outline-schema-injection-design.md`).
**Design references:** `wireframe.html` (the analogy layout + density-inverted slide CSS), `Field__trust.html` (theme tokens).

---

## 1. Purpose & boundaries

Turn an `OutlineSlide` into a themed HTML slide **fragment** (`<section>`), deterministically and without any agent or server, and provide a tiny harness to view it at 16:9 in a browser.

**In scope:**
- Markdown body → block tokens + inline HTML rendering.
- Convention-based mapping of blocks → a layout's named slots (agent-free).
- Two library layouts: **analogy** (the hero) and **plain** (fallback).
- The **Field** theme stylesheet (density-inverted) the fragments reference.
- A preview wrapper that renders a fragment as a full 16:9 page.
- A demo that renders the sample outline's slides to real files for visual inspection.

**Out of scope (later steps):** the agent loop (step 4), per-slide iteration / render-and-inspect (step 5), export-and-seal / font embedding / nav runtime (step 3, §11), the `build-up` and `quote` layouts (a quick later pass), `bespoke` rendering (agent-only), the workspace UI (step 6).

---

## 2. Decisions this rests on (resolved)

- **Slot mapping = convention per layout.** Each library layout defines a deterministic markdown convention, so the renderer needs no agent. Conventions become each layout's documented contract.
- **Step-2 layouts = analogy + plain.** `build-up`/`quote` follow once the framework is proven; `bespoke` is agent-only.
- **Fonts loaded via Google Fonts `<link>`** during authoring/preview; embedding is deferred to export (step 3, §11).
- **Emitted fragments conform to the step-1 seam** (`data-slide-id`, `data-layout`, `data-bind`), so `validateSlideSection` / `readBoundRegions` work on rendered output.

---

## 3. Architecture & data flow

```
OutlineSlide (from src/outline)
   │
   ▼  markdown.ts      blocks(body) → block tokens; inline(md) → inline HTML
   ▼  slots.ts         extractSlots(layout, body) → { slot: htmlString }
   ▼  layouts/*.ts     (slots, slide) → <section data-slide-id data-layout> with .s-* classes + data-bind
   ▼  render-slide.ts  renderSlide(slide) → fragment, dispatching on slide.layout
   │
   ▼  preview.ts       renderPreviewPage(fragment) → full 16:9 HTML page (Field CSS + Google Fonts)
```

Markdown library: **`marked`**. Its lexer yields block tokens (`paragraph`, `blockquote`, `list`, …) used by the convention mapping; `marked.parseInline()` renders slot text (so bold/italic/code survive inside a slot).

Each unit is pure and independently testable; `render-slide.ts` is the only one that knows about `OutlineSlide`, and `preview.ts` is the only one that knows about full-page HTML.

---

## 4. The convention mapping (agent-free slot logic)

`extractSlots(layout, body)` returns a `Record<string, string>` of slot → inline-rendered HTML.

**analogy:**
- The **first `blockquote`** block → the **`analogy`** slot (inline-rendered, preserving a bold source like `**Office gossip**`).
- **All remaining (non-blockquote) blocks** — paragraphs, lists, etc. — rendered block-level (via `marked.parse`) and joined → the **`concept`** slot. (Using "everything except the first blockquote" rather than "paragraphs only" avoids silently dropping a list in the concept.)
- If there is no blockquote, `analogy` is the empty string (documented constraint: an analogy-layout slide should contain a `>` blockquote). The template still renders.

**plain:**
- The **entire body** renders to HTML (block-level, via `marked.parse`) into the single **`body`** slot.

`title` for every layout comes from `slide.title` (not the markdown body).

---

## 5. Layout templates

Each layout is a pure function `(slots, slide) → string` (an HTML fragment), emitting one `<section>` with the step-1 seam attributes and the Field `.s-*` classes.

**analogy** (mirrors `wireframe.html`'s `.s-cols` / `.s-analogy`):
```html
<section data-slide-id="s_intro" data-layout="analogy">
  <h2 class="s-title" data-bind="title">Eventual consistency</h2>
  <div class="s-cols">
    <div>
      <div class="s-col-label">what it means</div>
      <div class="s-body" data-bind="concept"><!-- concept HTML --></div>
    </div>
    <div class="s-analogy">
      <div class="s-col-label">think of it like</div>
      <div class="s-body" data-bind="analogy"><!-- analogy HTML --></div>
    </div>
  </div>
</section>
```

**plain:**
```html
<section data-slide-id="s_x" data-layout="plain">
  <h2 class="s-title" data-bind="title">Title</h2>
  <div class="s-body" data-bind="body"><!-- body HTML --></div>
</section>
```

`renderSlide(slide)` dispatches on `slide.layout`: `analogy` and `plain` are rendered; any other value (`build-up`, `quote`, `bespoke`, unknown) throws `Error("no static renderer for layout: <layout>")` so callers know it needs a later step / the agent.

The `data-bind` region values come straight from `extractSlots`; `title` is HTML-escaped (it is plain text, not markdown).

---

## 6. The Field theme (`theme/field.css`)

A standalone stylesheet, lifted and adapted from `wireframe.html`'s slide CSS (the already density-inverted version — "one idea per frame, generous air"):

- `:root` tokens: `--s-bg:#0a1a2f` (navy), `--s-fg:#f3efe5` (cream), `--s-cyan:#4DD9E0`, plus muted/dim/line variants.
- `.slide` frame: `aspect-ratio:16/9`, padding, dot-grid `background-image`, flex column.
- `.s-title` (Fraunces, `SOFT`/`opsz` axes), `.s-cols` (two-column grid), `.s-col-label` (Geist Mono uppercase micro-label), `.s-body` (Geist), `.s-analogy` (cyan left-border card, bold source in Fraunces italic cyan).

Fonts referenced by family name; the actual `<link>` to Google Fonts is added by the preview wrapper (§7). The stylesheet is shared/global — the step-1 injection contract's "library layouts use shared CSS" path.

---

## 7. Preview wrapper (`preview.ts`)

`renderPreviewPage(fragment: string): string` returns a complete HTML document:
- `<head>`: charset/viewport, the Google Fonts `<link>` (Fraunces + Geist + Geist Mono), and the `theme/field.css` contents inlined in a `<style>` (read at call time) so the page is openable standalone.
- `<body>`: a centered wrapper that gives the `.slide` a 16:9 box (e.g. `width:min(960px,92vw)`), on a neutral page ground so the slide frame reads as a card.

This is an **authoring/preview** convenience, not the export artifact (export is step 3). It is what makes step 2's "open it in a browser" deliverable real.

---

## 8. Visual proof (`examples/render-demo.ts`)

A runnable script (`bun run examples/render-demo.ts`) that:
1. Parses the eventual-consistency sample outline (analogy + plain slides).
2. Renders each slide via `renderSlide` and writes `slides/<id>.html`.
3. Writes a `preview.html` for each (or a combined page) via `renderPreviewPage`.
4. Prints the file paths to open.

Opening these confirms the Field theme survives the density inversion on a real 16:9 comprehension frame — the explicit goal of PRD §17 step 2.

---

## 9. Testing

- **markdown.ts** — `blocks()` returns typed block tokens for a paragraph + blockquote + list; `inline("**x**")` → `<b>x</b>` (or `<strong>`).
- **slots.ts** — analogy: concept = paragraph HTML, analogy = blockquote inner HTML (bold preserved); no-blockquote → analogy `""`. plain: body = full-body HTML.
- **layouts/analogy.ts, layouts/plain.ts** — emit a `<section>` with correct `data-layout`, `data-bind` slots, `.s-*` classes, and escaped title.
- **render-slide.ts** — dispatches analogy/plain; throws on `bespoke` and unknown layouts.
- **Integration** — `renderSlide` output passes `validateSlideSection(html, slide.id)` (step 1) and `readBoundRegions` returns the expected slot keys, proving renderer ↔ seam fit.
- **preview.ts** — output contains the fragment, an inlined `<style>` with a Field token, the fonts `<link>`, and a viewport meta.

---

## 10. File layout

```
src/render/
├── markdown.ts
├── slots.ts
├── layouts/
│   ├── analogy.ts
│   └── plain.ts
├── render-slide.ts
├── preview.ts
└── index.ts          # barrel: renderSlide, renderPreviewPage, extractSlots
theme/
└── field.css
examples/
└── render-demo.ts
```

`src/index.ts` re-exports `./render/index` alongside the existing `./outline/index`.

---

## 11. Summary

A deterministic `OutlineSlide → <section>` pipeline: markdown blocks → convention-mapped slots → a Field-themed layout template emitting the step-1 seam attributes, plus a preview wrapper to view it at 16:9. Ships analogy + plain; proves the Field theme on a real comprehension frame. No agent, no server, no export — those are later steps.
