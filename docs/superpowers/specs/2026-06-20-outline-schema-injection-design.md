# Outline Schema & Injection Contract — Design

**Status:** Approved design (kickoff)
**Date:** 2026-06-20
**Scope:** PRD §17 build-order step 1 — "Define the outline schema and the `outline → HTML` injection contract. This is the spine everything hangs off."
**Related:** PRD §6 (core concepts), §10 (data model), §11 (export), §15 (decisions).

---

## 1. Purpose & boundaries

This spec defines **the seam**: how content is represented canonically, how it becomes HTML slides, and how the two stay in sync without coupling. It is the contract every later component (agent loop, slide iteration, export) binds to.

**In scope:**
- The canonical outline format (`outline.md`).
- The per-slide render files (`slides/<id>.html`).
- The injection contract (content ↔ design separation, the two edit gestures).
- The layout-library vs. bespoke split.
- The export flatten-and-seal contract (as it pertains to the seam).

**Out of scope (other specs):** the agent loop (digest→direction→outline), the render-and-inspect screenshot tool, the workspace UI, image/PNG export, theming internals beyond the seam.

---

## 2. Decisions this rests on (resolved)

- **Outline = Marp-style markdown** (pure text, render-agnostic, human-editable). Chosen over a structured JSON/role-tagged schema because it keeps the canonical asset human-readable and matches the loupe sidecar precedent. The renderer is an **intelligent agent**, not a dumb template, so markdown need not rigidly encode layout slots.
- **Renderer = agent-authored HTML** per slide (PRD §9.3 — full visual freedom), *not* Marp's CSS engine. Marp supplies the *outline format* only.
- **Authoring = per-slide files** (`slides/<id>.html`), previewed via iframe, surgically edited, screenshot-inspected (PRD §6.5, "B" decision).
- **Share = one sealed self-contained HTML** (PRD §11). Export flattens the per-slide files into it. **No zip.** Authoring representation and share format are independent; export bridges them.
- **Injection = hybrid** (PRD §15): library layouts use shared CSS + marked-region binding; bespoke slides are agent-reconciled with id-scoped CSS.

---

## 3. Canonical outline format (`outline.md`)

A single markdown file: **deck frontmatter** + **slides separated by `---`**. Each slide opens with a metadata comment carrying its stable id and optional layout.

```markdown
---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually. A read can lag for a
moment after a write.

> Like office gossip — everyone hears the news eventually, just
> not at the same instant.

---

<!-- slide id=s_tradeoff layout=build-up -->
# The trade-off

- Instant accuracy vs. always-available
- Eventual consistency picks availability
```

**Rules:**
- **Frontmatter** (YAML between the leading `---` fences) → deck `meta`: `title`, `purpose` (v1: always `teach`), `theme` (v1: `field`).
- **`---` on its own line** separates slides. (The frontmatter fence is distinguished by being the very first block.)
- **Slide metadata comment** `<!-- slide id=<id> layout=<layout> -->` precedes each slide. `id` is **stable and permanent**, minted at slide creation (e.g. `s_` + short nanoid). `layout` is **optional**; absent or `bespoke` → freehand render.
- **First `#` heading** = slide title. **Remaining markdown** (paragraphs, bullets, blockquotes) = canonical slide content, read by the agent.
- **Document order = deck order.** The markdown is the single source of truth for both content and ordering — no separate manifest.

**Parsed in-memory representation:**

```ts
interface DeckMeta {
  title: string;
  purpose: "teach";          // v1 fixed; widens with reflow roadmap
  theme: string;             // v1: "field"
}

interface OutlineSlide {
  id: string;                // stable, e.g. "s_intro"
  layout: string;            // "analogy" | "build-up" | "quote" | "plain" | "bespoke"
  title: string;             // from the `#` heading
  markdown: string;          // raw body markdown — canonical content, render-agnostic
}

interface Outline {
  meta: DeckMeta;
  slides: OutlineSlide[];    // order = deck order
}
```

Content is kept as a **markdown string**, not pre-structured into slots — slots are a render concern (§5), so the canonical layer stays render-agnostic (PRD §6.1).

---

## 4. Render files (`slides/<id>.html`)

One file per slide, **named by stable id, never by index** (so reordering slides never renames a file or disturbs an untouched one — PRD §6.5). Each file is a single `<section>`:

```html
<section data-slide-id="s_intro" data-layout="analogy">
  <h3 class="s-title" data-bind="title">Eventual consistency</h3>
  <div class="s-cols">
    <div>
      <div class="s-col-label">what it means</div>
      <p class="s-body" data-bind="concept">Every copy of the data agrees — eventually…</p>
    </div>
    <div class="s-analogy">
      <div class="s-col-label">think of it like</div>
      <p class="s-body" data-bind="analogy"><b>Office gossip</b> — everyone hears eventually…</p>
    </div>
  </div>
</section>
```

- `data-slide-id` ties the render back to its outline block; `data-layout` records which path produced it.
- The file is a fragment (one `<section>`), not a full document — the theme stylesheet and runtime are supplied by the workspace shell during authoring and inlined at export.

---

## 5. Injection contract (the load-bearing part)

Content/design separation is made **structural**, not merely conventional.

- **`data-bind="<slot>"`** marks every content-bearing region. Text inside a `data-bind` region traces to the outline; **everything else is design** (structure, classes, labels like "what it means", CSS).
- **Content edit gesture** → the agent rewrites the affected outline block in `outline.md`, then updates **only the matching `data-bind` regions** in that slide's HTML file. Design is untouched. This makes PRD §6.3's templating-engine analogy literal: re-injecting data cannot wipe a design tweak, because they live in different layers.
- **Design edit gesture** → the agent touches **only that one slide file** — never `outline.md`, never sibling slides (PRD §6.4, §6.5).
- **The agent is the single writer** and does the markdown→slot mapping by intent. The markdown therefore never has to rigidly encode slots; the `data-bind` attributes record *where the agent placed* each piece of content so future content edits are localizable.
- **Invariant:** content flows one way only, `outline.md → slides/<id>.html` (PRD §6.3). Nothing ever parses a slide's HTML to reconstruct its meaning; the outline is always the content spec.

---

## 6. Layout library vs. bespoke escape (PRD §15 hybrid)

`data-layout` is the switch the agent reads to choose a render path:

- **Library layout** (`analogy`, `build-up`, `quote`, `plain`): uses **shared global CSS classes** (`.s-title`, `.s-analogy`, `.s-cols`…) from the Field theme stylesheet, with `data-bind` slots. Consistent, QA-able, bounded.
- **Bespoke** (`layout=bespoke` or absent): the agent hand-authors the section for a comprehension visual no template can express. Any custom CSS is **id-scoped** (`#s_intro .myviz { … }`) so it cannot leak onto sibling slides (the isolation a per-file-but-shared-export model otherwise loses). Bespoke slides still mark content regions with `data-bind` so they remain reconcilable on content edits.

The library starts with **`analogy`** (the two-column "what it means / think of it like" layout from `wireframe.html`) as entry #1; others (`build-up`, `quote`, `plain`) follow the same shared-CSS + `data-bind` shape.

---

## 7. Export flatten-and-seal contract

Export turns the kitchen (many files) into the box (one file), PRD §6.6 / §11:

1. Walk `outline.md` in document order to get the slide id sequence.
2. For each id, pull `slides/<id>.html` and collect its `<section>`.
3. Concatenate the `<section>`s into one document, in order.
4. Inline the shared Field theme CSS **once**; append each bespoke slide's id-scoped CSS.
5. Inline fonts (subset + base64) and images (data URIs).
6. Append the navigation runtime (keyboard arrows, slide counter, progress) as inline `<script>`.
7. Emit **one sealed, dependency-free `.html`** — opens by double-click, offline, indefinitely.

The export reads the outline only for **order**; it never re-derives content (content already lives in the rendered sections). This keeps export a pure mechanical seal.

---

## 8. File layout on disk

```
<project or workspace dir>/
├── outline.md              # canonical content + order
└── slides/
    ├── s_intro.html        # render, keyed by stable id
    ├── s_tradeoff.html
    └── …
```

(Mirrors the loupe pattern: a markdown canonical artifact + server-managed render files. Storage is local files, per PRD §16.)

---

## 9. Validation rules

- Every slide block MUST have a `<!-- slide id=… -->` comment with a non-empty, unique `id`.
- Every slide MUST have exactly one `#` heading (the title).
- `layout`, if present, MUST be a known library value or `bespoke`.
- Every `slides/<id>.html` MUST correspond to an `id` present in `outline.md`; orphan render files (id not in outline) are dead and may be garbage-collected.
- Every `data-bind` slot in a slide SHOULD trace to content present in its outline block (so content stays canonical).
- `data-slide-id` in the HTML MUST equal the filename id.

---

## 10. Deferred / out of scope

- **Other purposes** (`decide`, `build`, `pass`) and their render shapes — v1 is `teach → slides` only (PRD §13). `purpose` is fixed to `teach`.
- **Multiple themes** — v1 is `field` only.
- **Mechanical (agent-free) re-injection** — v1 keeps the agent in the loop as the single writer; `data-bind` is the structure that *would* enable a future mechanical injector but we don't build one now.
- **Nested/multi-level content hierarchy beyond what markdown bullets express** — markdown's native nesting is sufficient for v1.

---

## 11. Summary

`outline.md` is the canonical content + order (Marp-style markdown). `slides/<id>.html` are agent-authored renders keyed by stable id. `data-bind` is the seam that keeps them in sync without coupling content to design. Library layouts share CSS and bind cleanly; bespoke slides escape to id-scoped freehand. Export walks the outline order and seals the render files into one self-contained HTML.
