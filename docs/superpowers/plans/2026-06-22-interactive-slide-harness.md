# Interactive-Slide Authoring Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild mindsizer's slide-authoring core so a free agentic author (with its own render→look→fix eyes) produces comprehension-grade, optionally **interactive** slides, sealed into one self-contained offline **linear** deck — wrapped in a deterministic, unit-tested shell.

**Architecture:** Hybrid. A deterministic orchestrator (`buildDeck`/`buildSlide`) gathers per-slide materials (source digest + angle + neighbours), invokes a `SlideAuthor` seam, validates, optionally fit-checks, and seals. The live `SlideAuthor` is an Agent-SDK session with a **bounded render tool** that self-iterates on screenshots. Slides may carry a scoped per-slide `<script>`; the seal inlines it into the offline deck.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright (chromium), `@anthropic-ai/claude-agent-sdk`, `node-html-parser`.

**Reference bar:** the hand-built `adolescence.deck.html` in the repo root (linear deck, one live interactive slide).

**Spec:** `docs/superpowers/specs/2026-06-22-interactive-slide-harness-design.md`.

**Testing convention (existing, follow it):** pure logic → Vitest unit tests with fakes. Browser code (`fit-check`) and live-LLM code (`slide-author`) are **verified-by-running**, kept OUT of the Vitest suite (Playwright must not load into unit tests). Integration tasks below use explicit `Run:` / `Expected:` steps instead of Vitest.

---

## File Structure

**Create**
- `src/render/render-helpers.ts` — pure: `computeOverflow(metrics)`. Unit-tested.
- `src/render/materials.ts` — `SlideMaterials`, `DeckContext`, `gatherMaterials()`. Unit-tested.
- `src/agent/context-sidecar.ts` — `serializeContext()` / `parseContext()` for the `*.context.json` sidecar. Unit-tested.
- `src/agent/agentic-author.ts` — live `SlideAuthor` using the SDK + render tool. Verified-by-running.
- `tests/render/render-helpers.test.ts`, `tests/render/materials.test.ts`, `tests/agent/context-sidecar.test.ts`

**Modify**
- `src/render/fit-check.ts` — add `Interaction`, `RenderResult`, `SlideRenderer`; new `playwrightRenderer()` with `render(html, interactions?)` (multi-shot + console errors); keep `check()` delegating to it. Verified-by-running.
- `src/outline/inject.ts` — extend `validateSlideSection` to accept an optional trailing `<script>` and warn on un-scoped scripts. Unit-tested.
- `src/render/design-brief.ts` — reshape `AuthorRequest` (carry `materials`, drop `fix`); replace `DESIGN_BRIEF` with `IDENTITY_BRIEF`; `slideAuthorPrompt` emits materials. Unit-tested.
- `src/render/build-slide.ts` — materials-fed, self-iterating shell (no fix loop); `BuildSlideDeps`/`BuiltSlide` change. Unit-tested.
- `src/render/build-deck.ts` — gather materials per slide; `BuildDeckDeps` gains `renderer?`, `context?`. Unit-tested.
- `src/export/seal.ts` / `src/export/deck-runtime.ts` — ensure per-slide `<script>` survives into the offline deck. Unit-tested.
- `src/agent/ingest.ts` — return the digest key-points so the caller can persist them.
- `src/cli.ts` — `ingest` writes the sidecar; `build` reads it + wires `agenticAuthor`.
- `src/render/index.ts`, `src/agent/index.ts` — barrels.
- `src/agent/query.ts` — add `runAgentic()` (bounded tool session). Verified-by-running.

---

## Task 1: Pure overflow helper

**Files:**
- Create: `src/render/render-helpers.ts`
- Test: `tests/render/render-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/render-helpers.test.ts
import { describe, it, expect } from "vitest";
import { computeOverflow } from "../../src/render/render-helpers";

describe("computeOverflow", () => {
  it("is 0 when content fits", () => {
    expect(computeOverflow({ sh: 720, ch: 720, sw: 1280, cw: 1280 })).toBe(0);
  });
  it("reports the largest of vertical/horizontal overflow", () => {
    expect(computeOverflow({ sh: 800, ch: 720, sw: 1300, cw: 1280 })).toBe(80);
    expect(computeOverflow({ sh: 730, ch: 720, sw: 1400, cw: 1280 })).toBe(120);
  });
  it("never goes negative", () => {
    expect(computeOverflow({ sh: 700, ch: 720, sw: 1200, cw: 1280 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/render-helpers.test.ts`
Expected: FAIL — `Cannot find module '.../render-helpers'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/render-helpers.ts
export interface FrameMetrics {
  sh: number; // scrollHeight
  ch: number; // clientHeight
  sw: number; // scrollWidth
  cw: number; // clientWidth
}

/** Largest overflow (px) past the 16:9 frame; 0 if content fits. */
export function computeOverflow(m: FrameMetrics): number {
  return Math.max(0, m.sh - m.ch, m.sw - m.cw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/render-helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/render-helpers.ts tests/render/render-helpers.test.ts
git commit -m "feat(render): pure computeOverflow helper"
```

---

## Task 2: Generalize the renderer — interactions, multi-shot, console errors

**Files:**
- Modify: `src/render/fit-check.ts`
- Verified-by-running (Playwright — not a Vitest test).

- [ ] **Step 1: Replace the body of `src/render/fit-check.ts`**

```ts
// src/render/fit-check.ts
import { chromium, type Browser } from "playwright";
import { computeOverflow } from "./render-helpers";

// `document` exists only inside page.evaluate() (browser context).
declare const document: { querySelector(selector: string): null | Record<string, number> };

export interface FitResult {
  fits: boolean;
  overflowPx: number;
  detail: string;
  png?: Buffer;
}

/** One scripted interaction the agent can request between screenshots. */
export interface Interaction {
  click?: string; // CSS selector to click
  press?: string; // keyboard key to press
  wait?: number;  // ms to wait
}

export interface RenderResult {
  shots: Buffer[];        // resting frame first, then one PNG after each interaction
  overflowPx: number;
  fits: boolean;
  consoleErrors: string[];
}

export interface SlideRenderer {
  render(html: string, interactions?: Interaction[]): Promise<RenderResult>;
  check(sectionHtml: string): Promise<FitResult>; // resting-frame fit-check (shell uses this)
  dispose(): Promise<void>;
}

// Back-compat alias for the resting-frame interface used by older call sites.
export type FitChecker = SlideRenderer;

const W = 1280;
const H = 720;

function pageHtml(themeCss: string, sectionHtml: string): string {
  return `<!DOCTYPE html><html><head><style>
    html,body{margin:0;}
    .stage{width:${W}px;height:${H}px;}
    .stage > section[data-slide-id]{width:${W}px;height:${H}px;aspect-ratio:auto;}
    ${themeCss}
  </style></head><body><div class="stage">${sectionHtml}</div></body></html>`;
}

/** Headless-chromium renderer: 16:9 frame, optional scripted interactions, overflow + console capture. */
export function playwrightRenderer(themeCss: string): SlideRenderer {
  let browser: Browser | null = null;
  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }

  async function render(html: string, interactions: Interaction[] = []): Promise<RenderResult> {
    const b = await getBrowser();
    const page = await b.newPage({ viewport: { width: W, height: H } });
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    try {
      await page.setContent(pageHtml(themeCss, html), { waitUntil: "networkidle" });
      const shots: Buffer[] = [await page.screenshot({ type: "png" })];
      for (const step of interactions) {
        if (step.click) await page.click(step.click, { timeout: 2000 }).catch(() => {});
        if (step.press) await page.keyboard.press(step.press).catch(() => {});
        if (step.wait) await page.waitForTimeout(step.wait);
        shots.push(await page.screenshot({ type: "png" }));
      }
      const m = await page.evaluate(() => {
        const s = document.querySelector("section[data-slide-id]");
        if (!s) return null;
        return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
      });
      const overflowPx = m ? computeOverflow(m) : 0;
      return { shots, overflowPx, fits: overflowPx <= 2, consoleErrors };
    } finally {
      await page.close();
    }
  }

  return {
    render,
    async check(sectionHtml: string): Promise<FitResult> {
      const r = await render(sectionHtml);
      return {
        fits: r.fits,
        overflowPx: r.overflowPx,
        detail: r.fits ? "fits the 16:9 frame" : `content overflows the 16:9 frame by ${r.overflowPx}px`,
        png: r.shots[0],
      };
    },
    async dispose(): Promise<void> {
      if (browser) { await browser.close(); browser = null; }
    },
  };
}

/** @deprecated use playwrightRenderer */
export const playwrightFitChecker = playwrightRenderer;
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN (note: `src/cli.ts` still imports `playwrightFitChecker` — the alias keeps it compiling until Task 11).

- [ ] **Step 3: Verify-by-running (a throwaway script)**

Create `verify-render.tmp.ts`:

```ts
import { playwrightRenderer } from "./src/render/fit-check";
import { readFieldCss, fontFaceCss } from "./src/export/index";
const r = playwrightRenderer(fontFaceCss() + "\n" + readFieldCss());
const tall = `<section data-slide-id="x" data-layout="bespoke"><div style="height:1400px">tall</div></section>`;
const res = await r.render(tall, [{ wait: 50 }]);
console.log({ fits: res.fits, overflowPx: res.overflowPx, shots: res.shots.length, consoleErrors: res.consoleErrors });
await r.dispose();
```

Run: `bun run verify-render.tmp.ts`
Expected: `{ fits: false, overflowPx: >600, shots: 2, consoleErrors: [] }` (2 shots = resting + after the one interaction).

- [ ] **Step 4: Clean up + commit**

```bash
rm verify-render.tmp.ts
git add src/render/fit-check.ts
git commit -m "feat(render): playwrightRenderer with interactions, multi-shot, console capture"
```

---

## Task 3: Slide contract — allow + scope-check a per-slide `<script>`

**Files:**
- Modify: `src/outline/inject.ts`
- Test: `tests/outline/inject.test.ts` (append; file already exists)

- [ ] **Step 1: Write the failing tests (append to the existing describe or add a new one)**

```ts
// tests/outline/inject.test.ts  (add these cases)
import { describe, it, expect } from "vitest";
import { validateSlideSection } from "../../src/outline/inject";

describe("validateSlideSection — interactive slides", () => {
  const ok = `<section data-slide-id="s_x" data-layout="bespoke">hi</section>`;

  it("accepts a section followed by a scoped IIFE script", () => {
    const html = ok + `<script>(function(){document.querySelector('#s_x .k');})();</script>`;
    expect(validateSlideSection(html, "s_x")).toEqual([]);
  });

  it("still accepts a leading style + section (no script)", () => {
    const html = `<style>#s_x .k{color:red}</style>` + ok;
    expect(validateSlideSection(html, "s_x")).toEqual([]);
  });

  it("warns when a script never references the slide id", () => {
    const html = ok + `<script>(function(){document.body.innerHTML='';})();</script>`;
    const issues = validateSlideSection(html, "s_x");
    expect(issues.some((i) => /scope/i.test(i.message))).toBe(true);
  });

  it("still rejects the wrong section id", () => {
    expect(validateSlideSection(`<section data-slide-id="nope">x</section>`, "s_x"))
      .toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: FAIL — the "warns when a script never references the slide id" case returns `[]`.

- [ ] **Step 3: Extend `validateSlideSection` in `src/outline/inject.ts`**

Replace the existing `validateSlideSection` with:

```ts
/** Validate a slide fragment: exactly one section with the expected id; optional scoped <script>. */
export function validateSlideSection(
  html: string,
  expectedId: string,
): SlideSectionIssue[] {
  const root = parseHtml(html);
  const sections = root.querySelectorAll("section[data-slide-id]");
  if (sections.length !== 1) {
    return [{ message: `expected exactly one <section data-slide-id>, found ${sections.length}` }];
  }
  const id = sections[0].getAttribute("data-slide-id");
  if (id !== expectedId) {
    return [{ message: `data-slide-id "${id}" != expected "${expectedId}"` }];
  }
  const issues: SlideSectionIssue[] = [];
  for (const script of root.querySelectorAll("script")) {
    const src = script.innerHTML;
    if (src.trim() && !src.includes(expectedId)) {
      issues.push({
        message: `slide ${expectedId}: <script> does not reference the slide id — scope DOM queries under #${expectedId}`,
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/outline/inject.ts tests/outline/inject.test.ts
git commit -m "feat(outline): validateSlideSection allows + scope-checks per-slide script"
```

---

## Task 4: Seal carries per-slide JS into the offline deck

**Files:**
- Test: `tests/export/seal.test.ts` (append)
- (No code change expected — `sealDeck` concatenates section strings verbatim, and inline `<script>` in a freshly-loaded file executes. This task PROVES that and guards it.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/export/seal.test.ts  (add)
import { describe, it, expect } from "vitest";
import { sealDeck } from "../../src/export/seal";
import type { Outline } from "../../src/outline/types";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [{ id: "s_a", layout: "bespoke", title: "A", markdown: "a" }],
};

describe("sealDeck — interactive sections", () => {
  it("inlines a section's scoped <script> into the deck document", () => {
    const section =
      `<section data-slide-id="s_a" data-layout="bespoke">x</section>` +
      `<script>(function(){window.__s_a=1;})();</script>`;
    const html = sealDeck(outline, { sections: new Map([["s_a", section]]) });
    expect(html).toContain("window.__s_a=1");
    // the slide script sits inside the deck container, before the nav runtime
    expect(html.indexOf("window.__s_a=1")).toBeLessThan(html.lastIndexOf("</script>"));
    expect(html).not.toContain("http://"); // still self-contained, no external refs
  });
});
```

- [ ] **Step 2: Run**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: PASS immediately (sealDeck already passes section strings through verbatim). If it FAILS because the section is HTML-escaped or stripped, fix `sealDeck` to concatenate `opts.sections` values verbatim (they already are at `src/export/seal.ts:38-39`).

- [ ] **Step 3: Commit**

```bash
git add tests/export/seal.test.ts
git commit -m "test(export): guard per-slide script survives sealing"
```

---

## Task 5: Deck context sidecar (read/write)

**Files:**
- Create: `src/agent/context-sidecar.ts`
- Test: `tests/agent/context-sidecar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/context-sidecar.test.ts
import { describe, it, expect } from "vitest";
import { serializeContext, parseContext, type DeckContext } from "../../src/agent/context-sidecar";

const ctx: DeckContext = {
  sourcePath: "adolescence.txt",
  digest: ["point one", "point two"],
  angle: "How to think about it",
  perSlideExcerpt: { s_a: "excerpt for a" },
};

describe("context sidecar", () => {
  it("round-trips a DeckContext through JSON", () => {
    expect(parseContext(serializeContext(ctx))).toEqual(ctx);
  });
  it("parseContext returns null on malformed JSON", () => {
    expect(parseContext("{not json")).toBeNull();
  });
  it("parseContext returns null when required fields are missing", () => {
    expect(parseContext(JSON.stringify({ digest: ["x"] }))).toBeNull(); // no angle
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/context-sidecar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/context-sidecar.ts
export interface DeckContext {
  sourcePath?: string;
  digest: string[];
  angle: string;
  perSlideExcerpt?: Record<string, string>;
}

/** Serialize a DeckContext to the `*.context.json` sidecar string. */
export function serializeContext(ctx: DeckContext): string {
  return JSON.stringify(ctx, null, 2);
}

/** Parse a sidecar string; null if malformed or missing required fields. */
export function parseContext(raw: string): DeckContext | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.digest) || typeof o.angle !== "string") return null;
  return {
    sourcePath: typeof o.sourcePath === "string" ? o.sourcePath : undefined,
    digest: o.digest.filter((d): d is string => typeof d === "string"),
    angle: o.angle,
    perSlideExcerpt:
      typeof o.perSlideExcerpt === "object" && o.perSlideExcerpt !== null
        ? (o.perSlideExcerpt as Record<string, string>)
        : undefined,
  };
}

/** Conventional sidecar path for an outline file: `<outline>.context.json`. */
export function sidecarPath(outlinePath: string): string {
  return outlinePath.replace(/\.md$/i, "") + ".context.json";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/context-sidecar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/context-sidecar.ts tests/agent/context-sidecar.test.ts
git commit -m "feat(agent): deck-context sidecar serialize/parse"
```

---

## Task 6: gatherMaterials

**Files:**
- Create: `src/render/materials.ts`
- Test: `tests/render/materials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/materials.test.ts
import { describe, it, expect } from "vitest";
import { gatherMaterials } from "../../src/render/materials";
import type { Outline } from "../../src/outline/types";
import type { DeckContext } from "../../src/agent/context-sidecar";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "plain", title: "A", markdown: "abody" },
    { id: "s_b", layout: "plain", title: "B", markdown: "bbody" },
    { id: "s_c", layout: "plain", title: "C", markdown: "cbody" },
  ],
};

describe("gatherMaterials", () => {
  it("includes digest, angle, source excerpt, and neighbour titles", () => {
    const ctx: DeckContext = { digest: ["p1"], angle: "lens", perSlideExcerpt: { s_b: "exB" } };
    const m = gatherMaterials(outline.slides[1], outline, ctx);
    expect(m.digest).toEqual(["p1"]);
    expect(m.angle).toBe("lens");
    expect(m.sourceExcerpt).toBe("exB");
    expect(m.neighborTitles).toEqual(["A", "C"]);
  });

  it("degrades gracefully with no context", () => {
    const m = gatherMaterials(outline.slides[0], outline, undefined);
    expect(m.digest).toEqual([]);
    expect(m.angle).toBe("");
    expect(m.sourceExcerpt).toBeUndefined();
    expect(m.neighborTitles).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/materials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/materials.ts
import type { Outline, OutlineSlide } from "../outline/types";
import type { DeckContext } from "../agent/context-sidecar";

export interface SlideMaterials {
  digest: string[];
  angle: string;
  sourceExcerpt?: string;
  neighborTitles: string[];
}

/** Per-slide context handed to the author: the idea, not just the bullet. */
export function gatherMaterials(
  slide: OutlineSlide,
  outline: Outline,
  ctx?: DeckContext,
): SlideMaterials {
  const idx = outline.slides.findIndex((s) => s.id === slide.id);
  const neighborTitles = outline.slides
    .filter((_, i) => i === idx - 1 || i === idx + 1)
    .map((s) => s.title);
  return {
    digest: ctx?.digest ?? [],
    angle: ctx?.angle ?? "",
    sourceExcerpt: ctx?.perSlideExcerpt?.[slide.id],
    neighborTitles,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/materials.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/materials.ts tests/render/materials.test.ts
git commit -m "feat(render): gatherMaterials assembles per-slide context"
```

---

## Task 7: Reshape AuthorRequest + the identity brief

**Files:**
- Modify: `src/render/design-brief.ts`
- Test: `tests/render/design-brief.test.ts` (replace contents — the old `fix`-based tests no longer apply)

- [ ] **Step 1: Write the failing test (replace the file)**

```ts
// tests/render/design-brief.test.ts
import { describe, it, expect } from "vitest";
import { slideAuthorPrompt, IDENTITY_BRIEF, type AuthorRequest } from "../../src/render/design-brief";

const req: AuthorRequest = {
  slide: { id: "s_x", layout: "bespoke", title: "The lens", markdown: "- a\n- b" },
  deck: { title: "Deck", slideTitles: ["intro", "The lens", "end"] },
  materials: {
    digest: ["point one", "point two"],
    angle: "How to think about it",
    sourceExcerpt: "the relevant source span",
    neighborTitles: ["intro", "end"],
  },
};

describe("IDENTITY_BRIEF", () => {
  it("states the instrument-not-landing-page identity and 16:9 linear constraint", () => {
    expect(IDENTITY_BRIEF).toMatch(/landing page/i);
    expect(IDENTITY_BRIEF).toMatch(/1280|16:9/);
    expect(IDENTITY_BRIEF).toMatch(/render/i); // tells the agent it has eyes
  });
});

describe("slideAuthorPrompt", () => {
  it("uses IDENTITY_BRIEF as the system prompt", () => {
    expect(slideAuthorPrompt(req).system).toBe(IDENTITY_BRIEF);
  });
  it("feeds the author the idea: title, slide id, angle, digest, source excerpt, neighbours", () => {
    const u = slideAuthorPrompt(req).user;
    expect(u).toContain("s_x");
    expect(u).toContain("The lens");
    expect(u).toContain("How to think about it");
    expect(u).toContain("point one");
    expect(u).toContain("the relevant source span");
    expect(u).toContain("intro");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL — `IDENTITY_BRIEF` not exported / `materials` not on `AuthorRequest`.

- [ ] **Step 3: Replace `src/render/design-brief.ts`**

```ts
// src/render/design-brief.ts
import type { OutlineSlide } from "../outline/types";
import type { SlideMaterials } from "./materials";

export interface AuthorRequest {
  slide: OutlineSlide;
  deck: { title: string; slideTitles: string[] };
  materials: SlideMaterials;
}

export interface AuthorPrompt {
  system: string;
  user: string;
}

export const IDENTITY_BRIEF = [
  "You are mindsizer's slide designer. Turn ONE outline slide into ONE comprehension-first slide that makes the idea CLICK — not a summary, not a bullet dump, not decoration.",
  "",
  "## Genre — an explorable INSTRUMENT, never a landing page",
  "Think Bret Victor explorable / Distill figure / instrument panel. NOT a marketing landing page: no hero tagline, no “scroll” cue, no emoji, no gradient theater, no persuasion funnel. Calm, precise, information-rich with clear hierarchy.",
  "",
  "## Format — ONE slide in a LINEAR deck",
  "Output ONE slide that fits a 1280x720 (16:9) frame with NO scrolling inside the slide. It is one frame in an arrow-advanced deck a presenter walks through — so it must read on its own at rest.",
  "",
  "## Aesthetic — Field",
  "Dark navy ground (#0a1a2f), cream foreground (#f3efe5), a single cyan accent (#4DD9E0); monochrome otherwise. Fraunces (display serif, italic cyan accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels + numerals). Hairline rules (~16% opacity), faint dot-grid. Fonts are already provided — do NOT @import. Avoid AI-slop (no Inter/Roboto/system-ui, no purple gradients, no rounded-card grids, no clip-art).",
  "",
  "## Interactivity — when it makes the idea land",
  "You MAY add an optional scoped <script> so the viewer can OPERATE the idea (tune a control, stage a reveal, show cause→effect). Keep it presenter-friendly: a resting state that reads alone PLUS a demonstrable interaction. Interaction must be epistemic (changes understanding), never decorative.",
  "",
  "## You have EYES — use them",
  "You have a `render` tool that returns screenshots of your slide at 1280x720. Render your work and LOOK. If interactive, pass interaction steps (e.g. click a control, wait) and inspect those states too. Fix overflow, dead space, weak hierarchy, off-brand styling. Iterate until it is genuinely strong, then return the final HTML.",
  "",
  "## Output contract",
  "Return EXACTLY, with no markdown fences and no commentary:",
  '  <style>#SLIDE_ID .x{ ... }</style>            (optional, id-scoped)',
  '  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>',
  '  <script>(function(){ /* only touch the #SLIDE_ID subtree */ })();</script>   (optional)',
  "Use the given SLIDE_ID for data-slide-id AND every CSS/JS selector so nothing leaks to other slides. Inline <svg> only; no external images/links/@import.",
].join("\n");

export function slideAuthorPrompt(req: AuthorRequest): AuthorPrompt {
  const { slide, deck, materials } = req;
  const digest = materials.digest.length
    ? materials.digest.map((d) => `- ${d}`).join("\n")
    : "(none provided)";
  const user =
    `Deck: ${deck.title}\n` +
    `Teaching angle: ${materials.angle || "(none)"}\n` +
    `All slide titles (for coherence — don't duplicate neighbours): ${deck.slideTitles.join(" · ")}\n` +
    `Adjacent slides: ${materials.neighborTitles.join(" · ") || "(none)"}\n\n` +
    `SLIDE_ID: ${slide.id}\n` +
    `Slide title: ${slide.title}\n` +
    `Suggested layout: ${slide.layout}\n` +
    `Slide content (markdown):\n${slide.markdown}\n\n` +
    `Deck digest (the whole argument, for context):\n${digest}\n\n` +
    (materials.sourceExcerpt
      ? `Relevant source excerpt for THIS slide:\n${materials.sourceExcerpt}\n`
      : "");
  return { system: IDENTITY_BRIEF, user };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat(render): materials-fed AuthorRequest + identity brief (drop heavy DESIGN_BRIEF)"
```

---

## Task 8: Reshape the orchestrator (buildSlide / buildDeck)

**Files:**
- Modify: `src/render/build-slide.ts`
- Modify: `src/render/build-deck.ts`
- Test: replace `tests/render/build-slide.test.ts` and `tests/render/build-deck.test.ts`

- [ ] **Step 1: Replace `tests/render/build-slide.test.ts`**

```ts
// tests/render/build-slide.test.ts
import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { AuthorRequest } from "../../src/render/design-brief";
import type { RenderResult } from "../../src/render/fit-check";
import type { SlideMaterials } from "../../src/render/materials";

const slide = { id: "s_x", layout: "bespoke" as const, title: "T", markdown: "b" };
const deck = { title: "D", slideTitles: ["T"] };
const materials: SlideMaterials = { digest: ["p"], angle: "a", neighborTitles: [] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function fakeAuthor(html: string) {
  const reqs: AuthorRequest[] = [];
  const author: SlideAuthor = { async authorSlide(req) { reqs.push(req); return html; } };
  return { author, reqs };
}

describe("buildSlide", () => {
  it("returns the authored html and passes materials through", async () => {
    const a = fakeAuthor(ok);
    const r = await buildSlide(slide, deck, materials, { author: a.author });
    expect(r.html).toBe(ok);
    expect(r.warnings).toEqual([]);
    expect(a.reqs[0].materials).toEqual(materials);
  });

  it("warns on a malformed section but still returns it", async () => {
    const bad = `<div>not a section</div>`;
    const a = fakeAuthor(bad);
    const r = await buildSlide(slide, deck, materials, { author: a.author });
    expect(r.html).toBe(bad);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("runs a final fit-check when a renderer is given and warns on overflow", async () => {
    const a = fakeAuthor(ok);
    const renderer = {
      render: async (): Promise<RenderResult> =>
        ({ shots: [Buffer.from("p")], overflowPx: 80, fits: false, consoleErrors: [] }),
    };
    const r = await buildSlide(slide, deck, materials, { author: a.author, renderer });
    expect(r.fits).toBe(false);
    expect(r.warnings.some((w) => /80px/.test(w))).toBe(true);
  });

  it("surfaces console errors from the fit-check", async () => {
    const a = fakeAuthor(ok);
    const renderer = {
      render: async (): Promise<RenderResult> =>
        ({ shots: [Buffer.from("p")], overflowPx: 0, fits: true, consoleErrors: ["boom"] }),
    };
    const r = await buildSlide(slide, deck, materials, { author: a.author, renderer });
    expect(r.warnings.some((w) => /boom/.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — `buildSlide` signature mismatch / `BuiltSlide` shape changed.

- [ ] **Step 3: Replace `src/render/build-slide.ts`**

```ts
// src/render/build-slide.ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { SlideRenderer } from "./fit-check";
import type { SlideMaterials } from "./materials";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  renderer?: Pick<SlideRenderer, "render">; // optional final fit-check (warn only)
}

export interface BuiltSlide {
  html: string;
  fits: boolean;     // true unless the final fit-check found overflow
  warnings: string[];
}

/**
 * Invoke the (self-iterating) author, validate the section, optionally run a final
 * non-interactive fit-check. The author owns its own render→look→fix loop; the shell
 * only validates and warns. Pure of process IO.
 */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  materials: SlideMaterials,
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const html = await deps.author.authorSlide({ slide, deck, materials });
  const warnings = validateSlideSection(html, slide.id).map((i) => i.message);

  let fits = true;
  if (deps.renderer && warnings.length === 0) {
    const r = await deps.renderer.render(html);
    fits = r.fits;
    if (!r.fits) warnings.push(`overflows the 16:9 frame by ${r.overflowPx}px`);
    for (const e of r.consoleErrors) warnings.push(`console error: ${e}`);
  }
  return { html, fits, warnings };
}
```

- [ ] **Step 4: Replace `tests/render/build-deck.test.ts`**

```ts
// tests/render/build-deck.test.ts
import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { Outline } from "../../src/outline/types";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;

describe("buildDeck", () => {
  it("authors every slide and keys sections by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const r = await buildDeck(outline, { author });
    expect([...r.sections.keys()]).toEqual(["s_a", "s_b"]);
    expect(r.warnings).toEqual([]);
  });

  it("collects per-slide warnings with the slide id prefix", async () => {
    const author: SlideAuthor = { async authorSlide() { return `<div>bad</div>`; } };
    const r = await buildDeck(outline, { author });
    expect(r.warnings.every((w) => /^s_[ab]:/.test(w))).toBe(true);
    expect(r.warnings.length).toBe(2);
  });

  it("passes deck-context-derived materials to the author", async () => {
    let seenAngle = "";
    const author: SlideAuthor = {
      async authorSlide(req) { seenAngle = req.materials.angle; return section(req.slide.id); },
    };
    await buildDeck(outline, { author, context: { digest: ["p"], angle: "lens" } });
    expect(seenAngle).toBe("lens");
  });
});
```

- [ ] **Step 5: Replace `src/render/build-deck.ts`**

```ts
// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
}

/** Author every slide with gathered materials; return sections by id + prefixed warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];

  for (const slide of outline.slides) {
    const materials = gatherMaterials(slide, outline, deps.context);
    const built = await buildSlide(slide, deck, materials, {
      author: deps.author,
      renderer: deps.renderer,
    });
    sections.set(slide.id, built.html);
    for (const w of built.warnings) warnings.push(`${slide.id}: ${w}`);
  }
  return { sections, warnings };
}
```

- [ ] **Step 6: Run both suites to verify pass**

Run: `bunx vitest run tests/render/build-slide.test.ts tests/render/build-deck.test.ts`
Expected: PASS.

- [ ] **Step 7: Delete the obsolete critic seam tests/files if now unused**

The vision critic (`src/render/critic-brief.ts`, `src/agent/slide-critic.ts`) is no longer wired by the shell (the agent self-critiques). Leave the files in place for now but remove their import from the build path. Confirm nothing else imports them in the shell:

Run: `grep -rn "critic" src/render src/cli.ts`
Expected: no references in `build-slide.ts`/`build-deck.ts`/`cli.ts` (cli is updated in Task 11). If `tests/render/critic-brief.test.ts` still passes standalone, keep it; it tests an unused-but-valid module.

- [ ] **Step 8: Commit**

```bash
git add src/render/build-slide.ts src/render/build-deck.ts tests/render/build-slide.test.ts tests/render/build-deck.test.ts
git commit -m "feat(render): materials-fed, self-iterating orchestrator (shell validates + warns)"
```

---

## Task 9: Update barrels

**Files:**
- Modify: `src/render/index.ts`
- Modify: `src/agent/index.ts`

- [ ] **Step 1: Ensure new modules are exported**

In `src/render/index.ts` add (keep existing lines; do NOT export `./fit-check`, which must stay out of the unit-test graph):

```ts
export * from "./materials";
export * from "./render-helpers";
```

In `src/agent/index.ts` add:

```ts
export * from "./context-sidecar";
export { agenticAuthor } from "./agentic-author"; // added in Task 11
```

(If `agentic-author` does not exist yet, add this export line in Task 11 instead to keep tsc green.)

- [ ] **Step 2: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS. (cli.ts still uses the deprecated alias + old buildDeck deps — see note; if tsc complains about `buildDeck` deps shape in cli.ts, that is fixed in Task 11. To keep this task green, you may temporarily leave cli.ts untouched only if it still compiles; otherwise proceed to Task 11 before the final tsc.)

- [ ] **Step 3: Commit**

```bash
git add src/render/index.ts src/agent/index.ts
git commit -m "chore: export materials, render-helpers, context-sidecar"
```

---

## Task 10: Bounded tool session in the SDK (`runAgentic`) — SPIKE + verify

**Files:**
- Modify: `src/agent/query.ts`
- Verified-by-running (live SDK; not a Vitest test).

> **Spike note:** this is the one integration unknown (spec §12). The code below uses the
> Agent SDK's in-process MCP tool helpers (`createSdkMcpServer`, `tool`). If the installed
> SDK version exposes a different API, adjust here — the *contract* (`runAgentic` drives a
> tool-using session that returns final text; the `render` tool returns screenshots the model
> can see) is what matters. Confirm the exact exports first:
>
> Run: `bun -e "import * as s from '@anthropic-ai/claude-agent-sdk'; console.log(Object.keys(s))"`
> Expected: includes `query`, and tool helpers (e.g. `tool`, `createSdkMcpServer`). Adapt names to what prints.

- [ ] **Step 1: Add `runAgentic` to `src/agent/query.ts`**

```ts
// src/agent/query.ts  (add below the existing exports)
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface AgenticTools {
  // render the current slide HTML; returns PNG screenshots (base64) the model can view
  render(html: string, interactions?: { click?: string; press?: string; wait?: number }[]): Promise<Buffer[]>;
}

/**
 * Run a tool-using authoring session: the model may call `render` to SEE its slide,
 * iterate, and must finish by emitting the final slide HTML as its last text.
 * Bounded: the ONLY tool is `render` (no fs, no Bash, no network).
 */
export async function runAgentic(
  systemPrompt: string,
  userPrompt: string,
  tools: AgenticTools,
): Promise<string> {
  const renderTool = tool(
    "render",
    "Render the given slide HTML at 1280x720 and return screenshots. Optionally pass interaction steps to inspect interactive states.",
    {
      html: z.string(),
      interactions: z
        .array(z.object({ click: z.string().optional(), press: z.string().optional(), wait: z.number().optional() }))
        .optional(),
    },
    async (args: { html: string; interactions?: { click?: string; press?: string; wait?: number }[] }) => {
      const shots = await tools.render(args.html, args.interactions);
      return {
        content: shots.map((png) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: "image/png" as const, data: png.toString("base64") },
        })),
      };
    },
  );

  const server = createSdkMcpServer({ name: "mindsizer", version: "1.0.0", tools: [renderTool] });

  const q = query({
    prompt: userPrompt as any,
    options: {
      systemPrompt,
      model: process.env.MINDSIZER_MODEL || "claude-opus-4-8",
      permissionMode: "bypassPermissions",
      mcpServers: { mindsizer: server },
      allowedTools: ["mcp__mindsizer__render"],
      // everything else stays disabled — bounded posture (spec §8)
      disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit", "Agent"],
      includePartialMessages: true,
    } as any,
  }) as any;

  // drain to the final assistant text
  let text = "";
  for await (const msg of q as AsyncIterable<any>) {
    if (
      msg.type === "stream_event" &&
      msg.event?.type === "content_block_delta" &&
      msg.event.delta?.type === "text_delta" &&
      msg.event.delta.text
    ) {
      text += msg.event.delta.text;
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      const t = msg.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (t) text = t; // keep the latest full assistant text block as the answer
    }
    if (msg.type === "result") break;
  }
  return text;
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN. If the SDK lacks `tool`/`createSdkMcpServer`, fall back to the alternative in the spike note (e.g. an MCP stdio server) and keep the `runAgentic` signature identical.

- [ ] **Step 3: Verify-by-running (live — needs Claude Code session auth)**

Create `verify-agentic.tmp.ts`:

```ts
import { runAgentic } from "./src/agent/query";
import { playwrightRenderer } from "./src/render/fit-check";
import { readFieldCss, fontFaceCss } from "./src/export/index";
const r = playwrightRenderer(fontFaceCss() + "\n" + readFieldCss());
const out = await runAgentic(
  "You are testing a render tool. Author a trivial slide <section data-slide-id=\"t\" data-layout=\"bespoke\">hi</section>, call render once to see it, then output ONLY the final HTML.",
  "SLIDE_ID: t. Make a one-word slide.",
  { render: async (html, ix) => (await r.render(html, ix)).shots },
);
console.log("FINAL:", out.slice(0, 200));
await r.dispose();
```

Run: `bun run verify-agentic.tmp.ts`
Expected: prints `FINAL: <section data-slide-id="t" ...>` — i.e. the model called `render` (no crash) and returned slide HTML. Console shows no tool-permission errors.

- [ ] **Step 4: Clean up + commit**

```bash
rm verify-agentic.tmp.ts
git add src/agent/query.ts
git commit -m "feat(agent): runAgentic — bounded render-tool session for the agentic author"
```

---

## Task 11: agenticAuthor + wire `mindsizer build`

**Files:**
- Create: `src/agent/agentic-author.ts`
- Modify: `src/agent/index.ts` (export), `src/cli.ts`
- Verified-by-running.

- [ ] **Step 1: Implement `src/agent/agentic-author.ts`**

```ts
// src/agent/agentic-author.ts
import { runAgentic } from "./query";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";

/** Strip accidental markdown fences the model may add. */
function stripFences(s: string): string {
  return s.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

/**
 * Live agentic author: hands the model the materials + identity brief and a bounded
 * `render` tool, lets it self-iterate on its own screenshots, returns the final slide HTML.
 */
export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest): Promise<string> {
      const { system, user } = slideAuthorPrompt(req);
      const text = await runAgentic(system, user, {
        render: async (html, interactions) => (await renderer.render(html, interactions)).shots,
      });
      return stripFences(text);
    },
  };
}
```

- [ ] **Step 2: Export it (edit `src/agent/index.ts`)**

Ensure: `export { agenticAuthor } from "./agentic-author";`

- [ ] **Step 3: Rewire `src/cli.ts` `runBuild`**

Update imports:

```ts
import { ingest, anthropicClient, fixedPrompter, terminalPrompter, agenticAuthor, parseContext, sidecarPath } from "./agent/index";
import { buildDeck } from "./render/index";
import { playwrightRenderer } from "./render/fit-check";
```

Replace the build block (`src/cli.ts:177-193`) with:

```ts
  const fitTheme = fontFaceCss() + "\n" + readFieldCss();
  const renderer = playwrightRenderer(fitTheme);

  // load the optional context sidecar written by ingest
  let context;
  try {
    const raw = readFileSync(sidecarPath(resolve(input)), "utf8");
    context = parseContext(raw) ?? undefined;
    if (context) process.stdout.write(`✓ loaded context (${context.digest.length} digest points)\n`);
  } catch {
    process.stdout.write("· no context sidecar — authoring from the outline only\n");
  }

  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    try {
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context });
    } finally {
      await renderer.dispose().catch(() => {});
    }
  } catch (e) {
    fail((e as Error).message);
  }
```

- [ ] **Step 4: Typecheck + full unit suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/agentic-author.ts src/agent/index.ts src/cli.ts
git commit -m "feat(agent): agenticAuthor with eyes; wire mindsizer build"
```

---

## Task 12: ingest writes the context sidecar

**Files:**
- Modify: `src/agent/ingest.ts`, `src/cli.ts`
- Test: `tests/agent/ingest.test.ts` (append a case)

- [ ] **Step 1: Add a failing test that ingest surfaces the digest points**

```ts
// tests/agent/ingest.test.ts  (add)
import { describe, it, expect } from "vitest";
import { ingest } from "../../src/agent/ingest";
import { fixedPrompter } from "../../src/agent/prompter";

const fakeModel = {
  async digest() { return { title: "T", keyPoints: ["k1", "k2", "k3"] }; },
  async proposeDirections() { return [{ id: "d1", label: "L", blurb: "b" }]; },
  async generateOutline() { return { title: "T", slides: [{ layout: "plain", title: "A", markdown: "a" }] }; },
};

describe("ingest digest passthrough", () => {
  it("returns the digest key-points for sidecar persistence", async () => {
    const r = await ingest("source text", { model: fakeModel as any, prompter: fixedPrompter("d1") });
    expect(r.digest).toEqual(["k1", "k2", "k3"]);
    expect(r.angle.id).toBe("d1");
  });
});
```

(Adjust the `fakeModel`/`Direction` shapes to match `src/agent/model-client.ts` if they differ.)

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/ingest.test.ts`
Expected: FAIL — `r.digest` undefined.

- [ ] **Step 3: Add `digest` to `IngestResult` in `src/agent/ingest.ts`**

Change the interface and the return:

```ts
export interface IngestResult {
  outlineMarkdown: string;
  pointCount: number;
  angle: Direction;
  digest: string[]; // key-points, for the context sidecar
}
```

In the return object add: `digest: digest.keyPoints,`

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the sidecar in `src/cli.ts` `runIngest`**

After `writeFileSync(outPath, result.outlineMarkdown, "utf8")` (`src/cli.ts:130`), add:

```ts
  // persist the deck context next to the outline so `build` gets the idea, not just the bullet
  try {
    const { serializeContext, sidecarPath } = await import("./agent/index");
    const sc = sidecarPath(outPath);
    writeFileSync(
      sc,
      serializeContext({ sourcePath: resolve(input), digest: result.digest, angle: result.angle.label }),
      "utf8",
    );
    process.stdout.write(`✓ wrote ${sc}\n`);
  } catch {
    /* sidecar is best-effort; build degrades gracefully without it */
  }
```

(Use whatever the `Direction` label field is — adjust `result.angle.label` to the actual property.)

- [ ] **Step 6: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/ingest.ts src/cli.ts tests/agent/ingest.test.ts
git commit -m "feat(agent): ingest persists deck-context sidecar for build"
```

---

## Task 13: Live end-to-end verification against the north-star bar

**Files:** none (manual verification).

- [ ] **Step 1: Re-link and run the full pipeline**

```bash
bun link
mindsizer ingest adolescence.txt -o adolescence.fresh.md --angle <id>   # or interactive
mindsizer build adolescence.fresh.md --open
```

Expected: `✓ loaded context (...)`, `building N slides…`, a sealed `adolescence.fresh.html` that opens as a **linear** deck (arrow keys advance), self-contained (no external refs), with at least one genuinely **interactive** slide.

- [ ] **Step 2: Inspect against the bar**

Open `adolescence.fresh.html` and `adolescence.deck.html` side by side. Confirm: instrument-not-landing-page feel, fits 16:9, an operable slide works, no overlap, no console errors (DevTools).

- [ ] **Step 3: Final green check**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore: end-to-end verification fixups for interactive build"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §4 shell → Tasks 8/9; §5C renderer/eyes → Task 2; §5B agentic author → Task 11; §5D materials + sidecar → Tasks 5/6/12; §5E contract + seal → Tasks 3/4; §6 data flow → Tasks 11/12/13; §7 identity brief → Task 7; §8 bounded tools → Task 10; §10 testing → unit tasks throughout; §11 build order → mirrored by task order.
- **Known seams kept testable:** every deterministic module is TDD'd with fakes; only `fit-check`, `runAgentic`, and `agenticAuthor` are verified-by-running (consistent with existing `fit-check`/`slide-author`).
- **The one risk** (SDK tool API) is isolated to Task 10 with an explicit spike step and a stable contract so later tasks don't depend on the exact SDK shape.
- **Cleanup not in scope:** the repo-root experiment files (`build-*.ts`, `adolescence.*.html`, screenshots) are untracked scratch; remove them in a separate housekeeping step if desired (keep `adolescence.deck.html` as the reference bar).
