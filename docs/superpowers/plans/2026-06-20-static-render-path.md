# Static Render Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an `OutlineSlide` into a themed "Field" HTML slide fragment (analogy + plain layouts) deterministically with no agent, plus a preview wrapper to view it at 16:9 — implementing PRD §17 step 2.

**Architecture:** A pure pipeline: markdown body → block tokens (via `marked`) → convention-mapped slots → a Field-themed layout template emitting the step-1 seam attributes (`data-slide-id`, `data-layout`, `data-bind`). A preview wrapper inlines the shared `theme/field.css` and Google Fonts to produce an openable 16:9 page. Each unit is pure and independently testable; the emitted fragments are validated by the step-1 seam (`validateSlideSection`, `readBoundRegions`).

**Tech Stack:** TypeScript, Bun, Vitest, `marked` (markdown lexer + inline/block render). Builds on `src/outline/` (step 1).

**Spec:** `docs/superpowers/specs/2026-06-20-static-render-path-design.md`

---

### Task 1: Markdown wrapper (`marked`)

**Files:**
- Modify: `package.json` (add `marked`)
- Create: `src/render/markdown.ts`
- Test: `tests/render/markdown.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `bun add marked@^12`
Expected: `marked` appears under dependencies in `package.json`, installs without error.

- [ ] **Step 2: Write the failing test**

Create `tests/render/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blocks, inline, block } from "../../src/render/markdown";

describe("markdown wrapper", () => {
  it("splits a body into typed block tokens", () => {
    const toks = blocks("para one\n\n> a quote\n\n- a\n- b");
    const types = toks.map((t) => t.type);
    expect(types).toContain("paragraph");
    expect(types).toContain("blockquote");
    expect(types).toContain("list");
  });

  it("renders inline markdown (bold)", () => {
    expect(inline("**x**")).toContain("<strong>x</strong>");
  });

  it("renders block markdown (list items)", () => {
    expect(block("- a\n- b")).toContain("<li>a</li>");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/render/markdown.test.ts`
Expected: FAIL — cannot find module `../../src/render/markdown`.

- [ ] **Step 4: Write the implementation**

Create `src/render/markdown.ts`:

```ts
import { marked, type Token } from "marked";

/** Lex a markdown body into block-level tokens (paragraph, blockquote, list, …). */
export function blocks(markdown: string): Token[] {
  return marked.lexer(markdown);
}

/** Render inline markdown (bold/italic/code) to HTML, without a block wrapper. */
export function inline(markdown: string): string {
  return marked.parseInline(markdown) as string;
}

/** Render block-level markdown to HTML (paragraphs, lists, …). */
export function block(markdown: string): string {
  return marked.parse(markdown) as string;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/render/markdown.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/render/markdown.ts tests/render/markdown.test.ts
git commit -m "feat: markdown wrapper (marked lexer + inline/block render)"
```

---

### Task 2: Convention-based slot extraction

**Files:**
- Create: `src/render/slots.ts`
- Test: `tests/render/slots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/slots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractSlots } from "../../src/render/slots";

describe("extractSlots", () => {
  it("analogy: first blockquote → analogy (bold preserved), rest → concept", () => {
    const s = extractSlots(
      "analogy",
      "Every copy agrees eventually.\n\n> Like **office gossip**.",
    );
    expect(s.concept).toContain("Every copy agrees eventually");
    expect(s.analogy).toContain("<strong>office gossip</strong>");
    expect(s.analogy).not.toContain("Every copy"); // separation holds
  });

  it("analogy: a list in the concept is not dropped", () => {
    const s = extractSlots("analogy", "- one\n- two\n\n> the analogy");
    expect(s.concept).toContain("<li>one</li>");
    expect(s.analogy).toContain("the analogy");
  });

  it("analogy: no blockquote → empty analogy slot", () => {
    const s = extractSlots("analogy", "Just a concept paragraph.");
    expect(s.analogy).toBe("");
    expect(s.concept).toContain("Just a concept");
  });

  it("plain: whole body → body slot", () => {
    const s = extractSlots("plain", "- a\n- b");
    expect(s.body).toContain("<li>a</li>");
  });

  it("throws for a layout with no slot mapping", () => {
    expect(() => extractSlots("quote", "x")).toThrow(/no slot mapping/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/slots.test.ts`
Expected: FAIL — cannot find module `../../src/render/slots`.

- [ ] **Step 3: Write the implementation**

Create `src/render/slots.ts`:

```ts
import type { Tokens } from "marked";
import { blocks, inline, block } from "./markdown";

/** Map a slide's markdown body into a layout's named slots (agent-free). */
export function extractSlots(layout: string, body: string): Record<string, string> {
  if (layout === "analogy") return analogySlots(body);
  if (layout === "plain") return plainSlots(body);
  throw new Error(`no slot mapping for layout: ${layout}`);
}

function analogySlots(body: string): Record<string, string> {
  const toks = blocks(body);
  const firstBq = toks.find((t) => t.type === "blockquote") as
    | Tokens.Blockquote
    | undefined;

  const analogy = firstBq ? inline(firstBq.text).trim() : "";
  const concept = toks
    .filter((t) => t !== firstBq && t.type !== "space")
    .map((t) => block(t.raw).trim())
    .join("\n");

  return { concept, analogy };
}

function plainSlots(body: string): Record<string, string> {
  return { body: block(body).trim() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/slots.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/slots.ts tests/render/slots.test.ts
git commit -m "feat: convention-based slot extraction (analogy, plain)"
```

---

### Task 3: HTML-escape util + layout templates

**Files:**
- Create: `src/render/html.ts`
- Create: `src/render/layouts/analogy.ts`
- Create: `src/render/layouts/plain.ts`
- Test: `tests/render/layouts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/layouts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderAnalogy } from "../../src/render/layouts/analogy";
import { renderPlain } from "../../src/render/layouts/plain";
import type { OutlineSlide } from "../../src/outline/types";

const slide = (over: Partial<OutlineSlide> = {}): OutlineSlide => ({
  id: "s_x",
  layout: "analogy",
  title: "A & B",
  markdown: "",
  ...over,
});

describe("renderAnalogy", () => {
  it("emits a section with seam attributes, slots, and escaped title", () => {
    const html = renderAnalogy(
      { concept: "<p>c</p>", analogy: "<strong>g</strong>" },
      slide(),
    );
    expect(html).toContain('data-slide-id="s_x"');
    expect(html).toContain('data-layout="analogy"');
    expect(html).toContain('data-bind="title"');
    expect(html).toContain('data-bind="concept"');
    expect(html).toContain('data-bind="analogy"');
    expect(html).toContain("A &amp; B"); // title escaped
    expect(html).toContain("<p>c</p>");
    expect(html).toContain("<strong>g</strong>");
    expect(html).toContain("think of it like");
  });
});

describe("renderPlain", () => {
  it("emits a section with title and a single body slot", () => {
    const html = renderPlain(
      { body: "<ul><li>a</li></ul>" },
      slide({ layout: "plain", title: "P" }),
    );
    expect(html).toContain('data-layout="plain"');
    expect(html).toContain('data-bind="body"');
    expect(html).toContain("<li>a</li>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/layouts.test.ts`
Expected: FAIL — cannot find module `../../src/render/layouts/analogy`.

- [ ] **Step 3: Write the escape util**

Create `src/render/html.ts`:

```ts
/** Escape a plain-text string for safe insertion into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: Write the analogy template**

Create `src/render/layouts/analogy.ts`:

```ts
import type { OutlineSlide } from "../../outline/types";
import { escapeHtml } from "../html";

/** The hero comprehension layout: two columns, concept + analogy. */
export function renderAnalogy(
  slots: Record<string, string>,
  slide: OutlineSlide,
): string {
  return `<section data-slide-id="${slide.id}" data-layout="analogy">
  <h2 class="s-title" data-bind="title">${escapeHtml(slide.title)}</h2>
  <div class="s-cols">
    <div>
      <div class="s-col-label">what it means</div>
      <div class="s-body" data-bind="concept">${slots.concept ?? ""}</div>
    </div>
    <div class="s-analogy">
      <div class="s-col-label">think of it like</div>
      <div class="s-body" data-bind="analogy">${slots.analogy ?? ""}</div>
    </div>
  </div>
</section>`;
}
```

- [ ] **Step 5: Write the plain template**

Create `src/render/layouts/plain.ts`:

```ts
import type { OutlineSlide } from "../../outline/types";
import { escapeHtml } from "../html";

/** The fallback layout: title + a single body region. */
export function renderPlain(
  slots: Record<string, string>,
  slide: OutlineSlide,
): string {
  return `<section data-slide-id="${slide.id}" data-layout="plain">
  <h2 class="s-title" data-bind="title">${escapeHtml(slide.title)}</h2>
  <div class="s-body" data-bind="body">${slots.body ?? ""}</div>
</section>`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bunx vitest run tests/render/layouts.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/render/html.ts src/render/layouts/analogy.ts src/render/layouts/plain.ts tests/render/layouts.test.ts
git commit -m "feat: Field layout templates (analogy, plain) + html escape"
```

---

### Task 4: Slide renderer (dispatch + step-1 seam integration)

**Files:**
- Create: `src/render/render-slide.ts`
- Test: `tests/render/render-slide.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/render-slide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderSlide } from "../../src/render/render-slide";
import { validateSlideSection, readBoundRegions } from "../../src/outline/index";
import type { OutlineSlide } from "../../src/outline/types";

const intro: OutlineSlide = {
  id: "s_intro",
  layout: "analogy",
  title: "Eventual consistency",
  markdown: "Every copy agrees eventually.\n\n> Like **office gossip**.",
};

describe("renderSlide", () => {
  it("renders analogy and fits the step-1 seam", () => {
    const html = renderSlide(intro);
    // conforms to the seam from step 1
    expect(validateSlideSection(html, "s_intro")).toEqual([]);
    const regions = readBoundRegions(html);
    expect(Object.keys(regions).sort()).toEqual(["analogy", "concept", "title"]);
    expect(regions.analogy).toContain("<strong>office gossip</strong>");
  });

  it("renders plain with a body region", () => {
    const html = renderSlide({
      id: "s_p",
      layout: "plain",
      title: "P",
      markdown: "- a\n- b",
    });
    expect(html).toContain('data-layout="plain"');
    expect(readBoundRegions(html).body).toContain("<li>a</li>");
  });

  it("throws for a layout with no static renderer (bespoke)", () => {
    expect(() =>
      renderSlide({ id: "s_b", layout: "bespoke", title: "x", markdown: "" }),
    ).toThrow(/no static renderer/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/render-slide.test.ts`
Expected: FAIL — cannot find module `../../src/render/render-slide`.

- [ ] **Step 3: Write the implementation**

Create `src/render/render-slide.ts`:

```ts
import type { OutlineSlide } from "../outline/types";
import { extractSlots } from "./slots";
import { renderAnalogy } from "./layouts/analogy";
import { renderPlain } from "./layouts/plain";

/** Render one OutlineSlide into a themed HTML <section> fragment. */
export function renderSlide(slide: OutlineSlide): string {
  switch (slide.layout) {
    case "analogy":
      return renderAnalogy(extractSlots("analogy", slide.markdown), slide);
    case "plain":
      return renderPlain(extractSlots("plain", slide.markdown), slide);
    default:
      throw new Error(`no static renderer for layout: ${slide.layout}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/render-slide.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/render-slide.ts tests/render/render-slide.test.ts
git commit -m "feat: renderSlide dispatch + step-1 seam integration"
```

---

### Task 5: The Field theme stylesheet

**Files:**
- Create: `theme/field.css`
- Test: `tests/render/field-css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/field-css.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("theme/field.css", () => {
  it("defines the Field tokens and the slide frame + analogy classes", () => {
    const css = readFileSync(
      join(process.cwd(), "theme", "field.css"),
      "utf8",
    );
    expect(css).toContain("--s-cyan");
    expect(css).toContain("#4DD9E0"); // the cyan accent
    expect(css).toContain("section[data-slide-id]"); // the frame selector
    expect(css).toContain("aspect-ratio"); // 16:9 frame
    expect(css).toContain(".s-analogy");
    expect(css).toContain("Fraunces");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/field-css.test.ts`
Expected: FAIL — ENOENT, `theme/field.css` does not exist.

- [ ] **Step 3: Write the stylesheet**

Create `theme/field.css`:

```css
/* Field theme — density-inverted comprehension slides (PRD §12).
   Frame is selected by section[data-slide-id] so any rendered slide
   gets the 16:9 frame; inner content uses .s-* classes. */
:root {
  --s-bg: #0a1a2f;
  --s-fg: #f3efe5;
  --s-muted: rgba(243, 239, 229, 0.58);
  --s-dim: rgba(243, 239, 229, 0.34);
  --s-line: rgba(243, 239, 229, 0.16);
  --s-cyan: #4DD9E0;
}

section[data-slide-id] {
  aspect-ratio: 16 / 9;
  box-sizing: border-box;
  background: var(--s-bg);
  color: var(--s-fg);
  border-radius: 8px;
  padding: 44px 52px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  font-family: "Geist", sans-serif;
  -webkit-font-smoothing: antialiased;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(243, 239, 229, 0.05) 1px,
    transparent 0
  );
  background-size: 22px 22px;
}

.s-title {
  font-family: "Fraunces", serif;
  font-variation-settings: "SOFT" 90, "opsz" 90;
  font-weight: 600;
  font-size: 40px;
  line-height: 1.02;
  letter-spacing: -0.02em;
  margin: 0 0 28px;
}

.s-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  flex: 1;
  align-content: start;
}

.s-col-label {
  font-family: "Geist Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--s-dim);
  margin-bottom: 10px;
}

.s-body {
  font-size: 16px;
  line-height: 1.55;
  color: var(--s-muted);
  margin: 0;
}
.s-body p {
  margin: 0 0 0.6em;
}
.s-body p:last-child {
  margin-bottom: 0;
}

.s-analogy {
  border: 1px solid var(--s-line);
  border-left: 2px solid var(--s-cyan);
  border-radius: 0 8px 8px 0;
  padding: 16px 18px;
}
.s-analogy .s-col-label {
  color: var(--s-cyan);
}
.s-analogy .s-body {
  color: var(--s-fg);
}
.s-analogy .s-body strong {
  font-family: "Fraunces", serif;
  font-style: italic;
  font-weight: 500;
  font-variation-settings: "SOFT" 100;
  color: var(--s-cyan);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/field-css.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add theme/field.css tests/render/field-css.test.ts
git commit -m "feat: Field theme stylesheet (density-inverted 16:9 frame)"
```

---

### Task 6: Preview wrapper

**Files:**
- Create: `src/render/preview.ts`
- Test: `tests/render/preview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/preview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderPreviewPage } from "../../src/render/preview";

describe("renderPreviewPage", () => {
  it("wraps a fragment into a full 16:9 page with theme + fonts inlined", () => {
    const page = renderPreviewPage('<section data-slide-id="s_x"></section>');
    expect(page).toContain("<!DOCTYPE html>");
    expect(page).toContain('data-slide-id="s_x"'); // the fragment
    expect(page).toContain("fonts.googleapis.com"); // fonts linked
    expect(page).toContain("--s-cyan"); // theme css inlined
    expect(page).toContain('name="viewport"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/preview.test.ts`
Expected: FAIL — cannot find module `../../src/render/preview`.

- [ ] **Step 3: Write the implementation**

Create `src/render/preview.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONTS_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..900,0..100;1,9..144,400..900,0..100&family=Geist:wght@300..600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">';

/**
 * Wrap a slide fragment in a complete, openable HTML page that centers the
 * slide at 16:9 with the Field theme + fonts. Authoring/preview only — not
 * the export artifact (that is step 3).
 */
export function renderPreviewPage(
  fragment: string,
  opts: { cssPath?: string } = {},
): string {
  const cssPath = opts.cssPath ?? join(process.cwd(), "theme", "field.css");
  const css = readFileSync(cssPath, "utf8");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FONTS_LINK}
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #070d16;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .stage { width: min(960px, 92vw); }
${css}
</style>
</head>
<body>
<div class="stage">${fragment}</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/preview.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/render/preview.ts tests/render/preview.test.ts
git commit -m "feat: preview wrapper (fragment → openable 16:9 page)"
```

---

### Task 7: Barrel exports + visual demo

**Files:**
- Create: `src/render/index.ts`
- Modify: `src/index.ts`
- Create: `examples/render-demo.ts`
- Modify: `.gitignore` (ignore demo output)
- Test: `tests/render/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderSlide, renderPreviewPage, extractSlots } from "../../src/render/index";

describe("render barrel", () => {
  it("re-exports the public render API", () => {
    expect(typeof renderSlide).toBe("function");
    expect(typeof renderPreviewPage).toBe("function");
    expect(typeof extractSlots).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/index.test.ts`
Expected: FAIL — cannot find module `../../src/render/index`.

- [ ] **Step 3: Write the barrel**

Create `src/render/index.ts`:

```ts
export { renderSlide } from "./render-slide";
export { renderPreviewPage } from "./preview";
export { extractSlots } from "./slots";
export { blocks, inline, block } from "./markdown";
export { escapeHtml } from "./html";
```

Modify `src/index.ts` so it reads exactly:

```ts
export * from "./outline/index";
export * from "./render/index";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/index.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Add demo output to .gitignore**

Append to `.gitignore`:

```gitignore

# Render demo output
examples/out/
```

- [ ] **Step 6: Write the visual demo**

Create `examples/render-demo.ts`:

```ts
/**
 * Visual proof for the static render path (PRD §17 step 2).
 * Run: `bun run examples/render-demo.ts` then open the printed preview files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOutline } from "../src/outline/index";
import { renderSlide, renderPreviewPage } from "../src/render/index";

const OUTLINE_MD = `---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually. A read can lag for a
moment right after a write.

> Like **office gossip** — everyone hears the news eventually, just
> not at the same instant.

---

<!-- slide id=s_tradeoff layout=plain -->
# The trade-off: availability over instant accuracy

- A distributed store can't be both instantly-consistent and always-available
- Eventual consistency deliberately picks availability
- Staleness is bounded: it converges once writes stop
`;

const outDir = join(process.cwd(), "examples", "out");
mkdirSync(outDir, { recursive: true });

const outline = parseOutline(OUTLINE_MD);
const written: string[] = [];

for (const slide of outline.slides) {
  const fragment = renderSlide(slide);
  const page = renderPreviewPage(fragment);
  const file = join(outDir, `${slide.id}.html`);
  writeFileSync(file, page, "utf8");
  written.push(file);
}

console.log("Rendered preview pages — open these in a browser:");
for (const f of written) console.log("  " + f);
```

- [ ] **Step 7: Run the demo and the full suite**

Run: `bun run examples/render-demo.ts`
Expected: prints two file paths under `examples/out/` (`s_intro.html`, `s_tradeoff.html`), no errors.

Run: `bunx vitest run`
Expected: ALL tests green (the new render tests + the existing outline tests).

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/render/index.ts src/index.ts examples/render-demo.ts .gitignore tests/render/index.test.ts
git commit -m "feat: render barrel exports + visual demo"
```

---

## Self-Review

**Spec coverage:**
- §3 architecture / data flow → Tasks 1–7 implement each pipeline stage. ✓
- §4 convention mapping (analogy blockquote→analogy, non-blockquote→concept; plain whole body; no-blockquote→empty) → Task 2 + its tests. ✓
- §5 layout templates (seam attrs, data-bind slots, escaped title) + dispatch + throw on unsupported → Tasks 3 & 4. ✓
- §6 Field theme (`section[data-slide-id]` frame, tokens, `.s-*`, strong styling) → Task 5. ✓
- §7 preview wrapper (inlined theme + fonts + 16:9) → Task 6. ✓
- §8 visual demo → Task 7. ✓
- §9 testing incl. step-1 seam integration (`validateSlideSection`, `readBoundRegions`) → Task 4. ✓
- §10 file layout + `src/index.ts` re-export → Tasks 1–7 + Task 7 barrel. ✓
- Out-of-scope (build-up/quote/bespoke, export, agent, UI) → correctly absent; `renderSlide` throws for bespoke. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states expected output. ✓

**Type consistency:** `OutlineSlide` imported from `../outline/types` / `../../outline/types` consistently. Functions match across tasks and barrel: `blocks`/`inline`/`block` (Task 1), `extractSlots` (Task 2), `escapeHtml` (Task 3), `renderAnalogy`/`renderPlain` (Task 3), `renderSlide` (Task 4), `renderPreviewPage` (Task 6). Slot keys are consistent: analogy → `concept`/`analogy`, plain → `body`, matching the templates' `data-bind` attributes and the slot extractors. ✓
