# Outline Core Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical outline core library — parse/serialize `outline.md`, mint stable slide ids, read/update `data-bind` regions in slide HTML, manage per-slide render files, and validate the whole — implementing PRD §17 step 1 (the seam).

**Architecture:** A pure TypeScript library, no agent and no browser. `outline.md` (Marp-style markdown) is the canonical content + order; `slides/<id>.html` are render fragments keyed by stable id; `data-bind` attributes are the seam that keeps them in sync without coupling content to design. Each module has one responsibility and is independently testable.

**Tech Stack:** TypeScript, Bun (runtime/install), Vitest (tests — run via `bunx vitest`), `gray-matter` (frontmatter), `nanoid` (ids), `node-html-parser` (data-bind regions). Conventions mirror the sibling `loupe` project (Bun + Vitest, "use Vitest NOT bun test").

**Spec:** `docs/superpowers/specs/2026-06-20-outline-schema-injection-design.md`

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/outline/smoke.ts`, `tests/outline/smoke.test.ts`

- [ ] **Step 1: Verify prerequisites (do NOT run `bun init`)**

Git is already initialized and `.gitignore` already exists. **Do not run `git init` or `bun init`** — `bun init` would clobber the configured `.gitignore` and `package.json`. From the project root (`/Users/victor/Documents/Workspace/Projects/mindsizer`):

```bash
git rev-parse --is-inside-work-tree && test -f .gitignore && echo "prerequisites ok"
```
Expected: `true` then `prerequisites ok`.

- [ ] **Step 3: Write `package.json`**

Overwrite `package.json` with:

```json
{
  "name": "mindsizer",
  "module": "src/index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "nanoid": "^5.0.7",
    "node-html-parser": "^6.1.13"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true,
    "lib": ["ESNext"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Install dependencies**

Run: `bun install`
Expected: dependencies resolve, `node_modules/` created, no errors.

- [ ] **Step 7: Write a smoke test**

Create `src/outline/smoke.ts`:

```ts
export const OUTLINE_LIB_READY = true;
```

Create `tests/outline/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OUTLINE_LIB_READY } from "../../src/outline/smoke";

describe("scaffold", () => {
  it("loads the outline module", () => {
    expect(OUTLINE_LIB_READY).toBe(true);
  });
});
```

- [ ] **Step 8: Run the smoke test**

Run: `bunx vitest run tests/outline/smoke.test.ts`
Expected: PASS, 1 test passing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold mindsizer outline library (Bun + Vitest + TS)"
```

---

### Task 1: Core types

**Files:**
- Create: `src/outline/types.ts`
- Test: `tests/outline/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Outline, OutlineSlide, DeckMeta } from "../../src/outline/types";

describe("types", () => {
  it("constructs a well-formed Outline value", () => {
    const meta: DeckMeta = { title: "Demo", purpose: "teach", theme: "field" };
    const slide: OutlineSlide = {
      id: "s_abc12345",
      layout: "analogy",
      title: "A title",
      markdown: "Some body.",
    };
    const outline: Outline = { meta, slides: [slide] };
    expect(outline.slides[0].id).toBe("s_abc12345");
    expect(outline.meta.purpose).toBe("teach");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/types.test.ts`
Expected: FAIL — cannot find module `../../src/outline/types`.

- [ ] **Step 3: Write the types**

Create `src/outline/types.ts`:

```ts
/** Deck-level metadata, parsed from the outline.md frontmatter. */
export interface DeckMeta {
  title: string;
  purpose: "teach"; // v1 fixed; widens with the reflow roadmap
  theme: string; // v1: "field"
}

/** One slide's canonical content. `markdown` is render-agnostic. */
export interface OutlineSlide {
  id: string; // stable, permanent, e.g. "s_abc12345"
  layout: string; // "analogy" | "build-up" | "quote" | "plain" | "bespoke"
  title: string; // from the `#` heading
  markdown: string; // raw body markdown — canonical content
}

/** The canonical outline: content + order. slides are in deck order. */
export interface Outline {
  meta: DeckMeta;
  slides: OutlineSlide[];
}

/** The set of known library layouts plus the bespoke escape. */
export const KNOWN_LAYOUTS = [
  "analogy",
  "build-up",
  "quote",
  "plain",
  "bespoke",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/outline/types.ts tests/outline/types.test.ts
git commit -m "feat: outline core types (DeckMeta, OutlineSlide, Outline)"
```

---

### Task 2: Stable slide id minting

**Files:**
- Create: `src/outline/id.ts`
- Test: `tests/outline/id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mintSlideId } from "../../src/outline/id";

describe("mintSlideId", () => {
  it("matches the s_<8 lowercase alnum> shape", () => {
    expect(mintSlideId()).toMatch(/^s_[0-9a-z]{8}$/);
  });

  it("produces unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => mintSlideId()));
    expect(ids.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/id.test.ts`
Expected: FAIL — cannot find module `../../src/outline/id`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/id.ts`:

```ts
import { customAlphabet } from "nanoid";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

/** Mint a stable, permanent slide id, e.g. "s_abc12345". */
export function mintSlideId(): string {
  return `s_${nano()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/id.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/outline/id.ts tests/outline/id.test.ts
git commit -m "feat: stable slide id minting"
```

---

### Task 3: Outline parser (`outline.md` → `Outline`)

**Files:**
- Create: `src/outline/parse.ts`
- Test: `tests/outline/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseOutline } from "../../src/outline/parse";

const SAMPLE = `---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually.

> Like office gossip — everyone hears eventually.

---

<!-- slide id=s_tradeoff layout=build-up -->
# The trade-off

- Instant accuracy vs. always-available
- Eventual consistency picks availability
`;

describe("parseOutline", () => {
  it("parses deck frontmatter into meta", () => {
    const o = parseOutline(SAMPLE);
    expect(o.meta).toEqual({
      title: "Eventual Consistency Explained",
      purpose: "teach",
      theme: "field",
    });
  });

  it("parses each slide's id, layout, and title", () => {
    const o = parseOutline(SAMPLE);
    expect(o.slides.map((s) => s.id)).toEqual(["s_intro", "s_tradeoff"]);
    expect(o.slides.map((s) => s.layout)).toEqual(["analogy", "build-up"]);
    expect(o.slides.map((s) => s.title)).toEqual([
      "Eventual consistency",
      "The trade-off",
    ]);
  });

  it("captures the body markdown without the meta comment or heading", () => {
    const o = parseOutline(SAMPLE);
    expect(o.slides[0].markdown).toContain("Every copy of the data agrees");
    expect(o.slides[0].markdown).toContain("> Like office gossip");
    expect(o.slides[0].markdown).not.toContain("<!-- slide");
    expect(o.slides[0].markdown).not.toContain("# Eventual consistency");
  });

  it("defaults a missing layout to bespoke", () => {
    const o = parseOutline(
      `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_x -->\n# Heading\n\nBody.\n`,
    );
    expect(o.slides[0].layout).toBe("bespoke");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/parse.test.ts`
Expected: FAIL — cannot find module `../../src/outline/parse`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/parse.ts`:

```ts
import matter from "gray-matter";
import type { DeckMeta, Outline, OutlineSlide } from "./types";

const SLIDE_META_RE = /<!--\s*slide\s+([^>]*?)\s*-->/;
const HEADING_RE = /^#\s+(.+?)\s*$/m;

/** Parse `key=value` / `key="quoted value"` attribute pairs. */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)=("([^"]*)"|(\S+))/g)) {
    out[m[1]] = m[3] ?? m[4];
  }
  return out;
}

/** Parse a Marp-style outline.md into the canonical Outline model. */
export function parseOutline(md: string): Outline {
  const { data, content } = matter(md);
  const meta: DeckMeta = {
    title: String(data.title ?? ""),
    purpose: "teach",
    theme: String(data.theme ?? "field"),
  };

  // gray-matter has stripped the leading frontmatter, so remaining
  // `---` lines are slide separators.
  const blocks = content
    .split(/^\s*---\s*$/m)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const slides: OutlineSlide[] = blocks.map((block) => {
    const metaMatch = block.match(SLIDE_META_RE);
    const attrs = metaMatch ? parseAttrs(metaMatch[1]) : {};
    const id = attrs.id ?? "";
    const layout = attrs.layout ?? "bespoke";

    const afterMeta = metaMatch
      ? block.slice(metaMatch.index! + metaMatch[0].length)
      : block;

    const headingMatch = afterMeta.match(HEADING_RE);
    const title = headingMatch ? headingMatch[1].trim() : "";
    const body = headingMatch
      ? afterMeta.slice(headingMatch.index! + headingMatch[0].length)
      : afterMeta;

    return { id, layout, title, markdown: body.trim() };
  });

  return { meta, slides };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/parse.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/outline/parse.ts tests/outline/parse.test.ts
git commit -m "feat: outline.md parser"
```

---

### Task 4: Outline serializer + round-trip

**Files:**
- Create: `src/outline/serialize.ts`
- Test: `tests/outline/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/serialize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeOutline } from "../../src/outline/serialize";
import { parseOutline } from "../../src/outline/parse";
import type { Outline } from "../../src/outline/types";

const OUTLINE: Outline = {
  meta: { title: "Demo Deck", purpose: "teach", theme: "field" },
  slides: [
    {
      id: "s_intro",
      layout: "analogy",
      title: "Eventual consistency",
      markdown: "Every copy agrees — eventually.\n\n> Like office gossip.",
    },
    {
      id: "s_tradeoff",
      layout: "build-up",
      title: "The trade-off",
      markdown: "- A\n- B",
    },
  ],
};

describe("serializeOutline", () => {
  it("emits frontmatter and per-slide meta comments", () => {
    const md = serializeOutline(OUTLINE);
    expect(md).toContain("title: Demo Deck");
    expect(md).toContain("<!-- slide id=s_intro layout=analogy -->");
    expect(md).toContain("# Eventual consistency");
  });

  it("round-trips: parse(serialize(outline)) equals the model", () => {
    const md = serializeOutline(OUTLINE);
    const back = parseOutline(md);
    expect(back).toEqual(OUTLINE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/serialize.test.ts`
Expected: FAIL — cannot find module `../../src/outline/serialize`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/serialize.ts`:

```ts
import type { Outline } from "./types";

/** Serialize the canonical Outline model back to Marp-style outline.md. */
export function serializeOutline(o: Outline): string {
  const frontmatter = [
    "---",
    `title: ${o.meta.title}`,
    `purpose: ${o.meta.purpose}`,
    `theme: ${o.meta.theme}`,
    "---",
  ].join("\n");

  const body = o.slides
    .map((s) => {
      const layoutAttr = s.layout ? ` layout=${s.layout}` : "";
      const head = `<!-- slide id=${s.id}${layoutAttr} -->`;
      const parts = [head, `# ${s.title}`];
      if (s.markdown.trim().length > 0) {
        parts.push("", s.markdown.trim());
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `${frontmatter}\n\n${body}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/serialize.test.ts`
Expected: PASS, 2 tests (including round-trip).

- [ ] **Step 5: Commit**

```bash
git add src/outline/serialize.ts tests/outline/serialize.test.ts
git commit -m "feat: outline serializer with parse round-trip"
```

---

### Task 5: Validation (outline + cross-validation)

**Files:**
- Create: `src/outline/validate.ts`
- Test: `tests/outline/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateOutline, crossValidate } from "../../src/outline/validate";
import type { Outline } from "../../src/outline/types";

function deck(slides: Outline["slides"]): Outline {
  return { meta: { title: "T", purpose: "teach", theme: "field" }, slides };
}

describe("validateOutline", () => {
  it("returns no issues for a valid outline", () => {
    const o = deck([
      { id: "s_a", layout: "analogy", title: "A", markdown: "x" },
    ]);
    expect(validateOutline(o)).toEqual([]);
  });

  it("flags a missing id, duplicate id, missing title, and unknown layout", () => {
    const o = deck([
      { id: "", layout: "analogy", title: "A", markdown: "" },
      { id: "s_dup", layout: "plain", title: "", markdown: "" },
      { id: "s_dup", layout: "wat", title: "C", markdown: "" },
    ]);
    const msgs = validateOutline(o).map((i) => i.message);
    expect(msgs).toContain("slide missing id");
    expect(msgs).toContain("slide missing title (#) heading");
    expect(msgs).toContain("duplicate slide id");
    expect(msgs).toContain("unknown layout: wat");
  });

  it("flags an empty deck title", () => {
    const o: Outline = {
      meta: { title: "", purpose: "teach", theme: "field" },
      slides: [],
    };
    expect(validateOutline(o).map((i) => i.message)).toContain(
      "deck title is empty",
    );
  });
});

describe("crossValidate", () => {
  it("flags missing render files and orphan render files", () => {
    const o = deck([
      { id: "s_a", layout: "plain", title: "A", markdown: "" },
      { id: "s_b", layout: "plain", title: "B", markdown: "" },
    ]);
    const issues = crossValidate(o, ["s_a", "s_orphan"]);
    const byId = issues.map((i) => `${i.slideId}:${i.message}`);
    expect(byId).toContain("s_b:missing render file");
    expect(byId).toContain("s_orphan:orphan render file (id not in outline)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/validate.test.ts`
Expected: FAIL — cannot find module `../../src/outline/validate`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/validate.ts`:

```ts
import type { Outline } from "./types";
import { KNOWN_LAYOUTS } from "./types";

export interface ValidationIssue {
  slideId?: string;
  message: string;
}

const KNOWN = new Set<string>(KNOWN_LAYOUTS);

/** Structural validation of the outline itself (§9 of the design spec). */
export function validateOutline(o: Outline): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!o.meta.title) issues.push({ message: "deck title is empty" });

  const seen = new Set<string>();
  for (const s of o.slides) {
    if (!s.id) {
      issues.push({ message: "slide missing id" });
    } else if (seen.has(s.id)) {
      issues.push({ slideId: s.id, message: "duplicate slide id" });
    } else {
      seen.add(s.id);
    }
    if (!s.title) {
      issues.push({ slideId: s.id, message: "slide missing title (#) heading" });
    }
    if (s.layout && !KNOWN.has(s.layout)) {
      issues.push({ slideId: s.id, message: `unknown layout: ${s.layout}` });
    }
  }
  return issues;
}

/** Cross-check the outline against the render files present on disk. */
export function crossValidate(o: Outline, renderIds: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const outlineIds = new Set(o.slides.map((s) => s.id));
  const renderSet = new Set(renderIds);

  for (const s of o.slides) {
    if (!renderSet.has(s.id)) {
      issues.push({ slideId: s.id, message: "missing render file" });
    }
  }
  for (const r of renderIds) {
    if (!outlineIds.has(r)) {
      issues.push({
        slideId: r,
        message: "orphan render file (id not in outline)",
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/validate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/outline/validate.ts tests/outline/validate.test.ts
git commit -m "feat: outline + cross validation"
```

---

### Task 6: Bound-region read/update + slide-section validation

**Files:**
- Create: `src/outline/inject.ts`
- Test: `tests/outline/inject.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/inject.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
} from "../../src/outline/inject";

const SLIDE = `<section data-slide-id="s_intro" data-layout="analogy">
  <h3 class="s-title" data-bind="title">Eventual consistency</h3>
  <p class="s-body" data-bind="concept">Every copy agrees eventually.</p>
  <p class="s-analogy" data-bind="analogy"><b>Office gossip</b> spreads.</p>
  <div class="s-label">think of it like</div>
</section>`;

describe("readBoundRegions", () => {
  it("extracts each data-bind slot's inner HTML", () => {
    const regions = readBoundRegions(SLIDE);
    expect(regions.title).toBe("Eventual consistency");
    expect(regions.concept).toBe("Every copy agrees eventually.");
    expect(regions.analogy).toContain("<b>Office gossip</b>");
  });
});

describe("updateBoundRegions", () => {
  it("updates only the named slots and leaves design untouched", () => {
    const out = updateBoundRegions(SLIDE, { title: "Strong consistency" });
    expect(out).toContain("Strong consistency");
    expect(out).not.toContain("Eventual consistency");
    // unrelated bound content preserved
    expect(out).toContain("Every copy agrees eventually.");
    // design (non-bound) preserved
    expect(out).toContain('class="s-label">think of it like');
    expect(out).toContain('data-layout="analogy"');
  });

  it("ignores slots not present in the slide", () => {
    const out = updateBoundRegions(SLIDE, { nonexistent: "x" });
    expect(out).toContain("Eventual consistency");
  });
});

describe("validateSlideSection", () => {
  it("passes when there is one section with the expected id", () => {
    expect(validateSlideSection(SLIDE, "s_intro")).toEqual([]);
  });

  it("flags an id mismatch", () => {
    const issues = validateSlideSection(SLIDE, "s_other");
    expect(issues.map((i) => i.message)).toContain(
      'data-slide-id "s_intro" != expected "s_other"',
    );
  });

  it("flags when there is not exactly one section", () => {
    const issues = validateSlideSection("<div>no section</div>", "s_x");
    expect(issues[0].message).toContain("expected exactly one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: FAIL — cannot find module `../../src/outline/inject`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/inject.ts`:

```ts
import { parse as parseHtml } from "node-html-parser";

/** Read every data-bind region's inner HTML, keyed by slot name. */
export function readBoundRegions(html: string): Record<string, string> {
  const root = parseHtml(html);
  const out: Record<string, string> = {};
  for (const el of root.querySelectorAll("[data-bind]")) {
    const slot = el.getAttribute("data-bind");
    if (slot) out[slot] = el.innerHTML;
  }
  return out;
}

/**
 * Replace the inner content of named data-bind regions only.
 * Slots absent from `bindings` are left untouched; non-bound design
 * (classes, structure, other elements) is preserved.
 */
export function updateBoundRegions(
  html: string,
  bindings: Record<string, string>,
): string {
  const root = parseHtml(html);
  for (const el of root.querySelectorAll("[data-bind]")) {
    const slot = el.getAttribute("data-bind");
    if (slot && slot in bindings) {
      el.set_content(bindings[slot]);
    }
  }
  return root.toString();
}

export interface SlideSectionIssue {
  message: string;
}

/** Validate a slide render fragment: exactly one section with the expected id. */
export function validateSlideSection(
  html: string,
  expectedId: string,
): SlideSectionIssue[] {
  const root = parseHtml(html);
  const sections = root.querySelectorAll("section[data-slide-id]");
  if (sections.length !== 1) {
    return [
      {
        message: `expected exactly one <section data-slide-id>, found ${sections.length}`,
      },
    ];
  }
  const id = sections[0].getAttribute("data-slide-id");
  if (id !== expectedId) {
    return [{ message: `data-slide-id "${id}" != expected "${expectedId}"` }];
  }
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/outline/inject.ts tests/outline/inject.test.ts
git commit -m "feat: data-bind region read/update + slide-section validation"
```

---

### Task 7: Render-file store

**Files:**
- Create: `src/outline/render-store.ts`
- Test: `tests/outline/render-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/render-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeSlide,
  readSlide,
  listSlideIds,
  gcOrphans,
} from "../../src/outline/render-store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mindsizer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("render-store", () => {
  it("writes and reads a slide render by id", async () => {
    await writeSlide(dir, "s_a", "<section data-slide-id=\"s_a\"></section>");
    expect(await readSlide(dir, "s_a")).toContain('data-slide-id="s_a"');
  });

  it("lists slide ids from .html filenames, sorted", async () => {
    await writeSlide(dir, "s_b", "<section></section>");
    await writeSlide(dir, "s_a", "<section></section>");
    expect(await listSlideIds(dir)).toEqual(["s_a", "s_b"]);
  });

  it("returns an empty list for a nonexistent directory", async () => {
    expect(await listSlideIds(join(dir, "nope"))).toEqual([]);
  });

  it("garbage-collects render files whose id is not kept", async () => {
    await writeSlide(dir, "s_keep", "<section></section>");
    await writeSlide(dir, "s_drop", "<section></section>");
    const removed = await gcOrphans(dir, ["s_keep"]);
    expect(removed).toEqual(["s_drop"]);
    expect(await listSlideIds(dir)).toEqual(["s_keep"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/render-store.test.ts`
Expected: FAIL — cannot find module `../../src/outline/render-store`.

- [ ] **Step 3: Write the implementation**

Create `src/outline/render-store.ts`:

```ts
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Write a slide render fragment to `<dir>/<id>.html`. */
export async function writeSlide(
  dir: string,
  id: string,
  html: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.html`), html, "utf8");
}

/** Read a slide render fragment by id. */
export async function readSlide(dir: string, id: string): Promise<string> {
  return readFile(join(dir, `${id}.html`), "utf8");
}

/** List slide ids present as `<id>.html` files, sorted. Missing dir → []. */
export async function listSlideIds(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();
}

/** Delete render files whose id is not in `keepIds`. Returns removed ids. */
export async function gcOrphans(
  dir: string,
  keepIds: string[],
): Promise<string[]> {
  const keep = new Set(keepIds);
  const removed: string[] = [];
  for (const id of await listSlideIds(dir)) {
    if (!keep.has(id)) {
      await rm(join(dir, `${id}.html`));
      removed.push(id);
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/render-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/outline/render-store.ts tests/outline/render-store.test.ts
git commit -m "feat: per-slide render-file store"
```

---

### Task 8: Public barrel + end-to-end integration test

**Files:**
- Create: `src/outline/index.ts`
- Create: `src/index.ts`
- Test: `tests/outline/integration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/outline/integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOutline,
  serializeOutline,
  validateOutline,
  crossValidate,
  readBoundRegions,
  writeSlide,
  listSlideIds,
} from "../../src/outline/index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mindsizer-int-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy agrees eventually.
`;

describe("outline library end-to-end", () => {
  it("parses, validates, persists a render, and reconciles", async () => {
    const outline = parseOutline(MD);
    expect(validateOutline(outline)).toEqual([]);

    // serialize round-trips
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);

    // author a render for the one slide, keyed by stable id
    const slide = outline.slides[0];
    await writeSlide(
      dir,
      slide.id,
      `<section data-slide-id="${slide.id}" data-layout="${slide.layout}">` +
        `<h3 data-bind="title">${slide.title}</h3></section>`,
    );

    // cross-validation now passes
    const ids = await listSlideIds(dir);
    expect(crossValidate(outline, ids)).toEqual([]);

    // the render's bound title traces to the outline
    const regions = readBoundRegions(await import("node:fs/promises").then((fs) =>
      fs.readFile(join(dir, `${slide.id}.html`), "utf8"),
    ));
    expect(regions.title).toBe(slide.title);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/outline/integration.test.ts`
Expected: FAIL — cannot find module `../../src/outline/index`.

- [ ] **Step 3: Write the barrel exports**

Create `src/outline/index.ts`:

```ts
export type { DeckMeta, OutlineSlide, Outline } from "./types";
export { KNOWN_LAYOUTS } from "./types";
export { mintSlideId } from "./id";
export { parseOutline } from "./parse";
export { serializeOutline } from "./serialize";
export {
  validateOutline,
  crossValidate,
  type ValidationIssue,
} from "./validate";
export {
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
  type SlideSectionIssue,
} from "./inject";
export {
  writeSlide,
  readSlide,
  listSlideIds,
  gcOrphans,
} from "./render-store";
```

Create `src/index.ts`:

```ts
export * from "./outline/index";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/outline/integration.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the full suite**

Run: `bunx vitest run`
Expected: PASS — all tests across all tasks green.

- [ ] **Step 6: Commit**

```bash
git add src/outline/index.ts src/index.ts tests/outline/integration.test.ts
git commit -m "feat: public barrel exports + end-to-end integration test"
```

---

## Self-Review

**Spec coverage:**
- §3 outline format → Task 3 (parse) + Task 4 (serialize). ✓
- §4 render files keyed by id → Task 7 (render-store). ✓
- §5 injection contract (`data-bind` read/update) → Task 6. ✓
- §6 layout library vs bespoke (`KNOWN_LAYOUTS`, default bespoke) → Task 1 + Task 3 + Task 5. ✓
- §8 file layout (`outline.md` + `slides/<id>.html`) → Task 7. ✓
- §9 validation rules → Task 5 (outline + cross) + Task 6 (`validateSlideSection`). ✓
- §7 export flatten → **deferred to a later plan** (needs themed render output; PRD §17 step 3). Noted in plan scope, not a gap.
- §2 / §10 deferred items (other purposes/themes, mechanical agent-free injection) → correctly out of scope.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows expected output. ✓

**Type consistency:** `Outline`/`OutlineSlide`/`DeckMeta` defined in Task 1 and used identically in Tasks 3–8. `ValidationIssue` (Task 5) and `SlideSectionIssue` (Task 6) names match their barrel re-exports (Task 8). Function names (`parseOutline`, `serializeOutline`, `mintSlideId`, `validateOutline`, `crossValidate`, `readBoundRegions`, `updateBoundRegions`, `validateSlideSection`, `writeSlide`, `readSlide`, `listSlideIds`, `gcOrphans`) are consistent across definitions, tests, and the barrel. ✓
