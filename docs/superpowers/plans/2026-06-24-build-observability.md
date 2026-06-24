# Build Observability & Step-Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mindsizer build` legible and measured — a structured progress log Claude can read mid-run, step-categorized timing (author/revise/render/finalize), and incremental partial-deck persistence so a kill keeps finished slides.

**Architecture:** Pure event emitters (`buildDeck`/`buildSlide`/`agenticAuthor`) push `ProgressEvent`s into an injected `ProgressSink`; the only IO sink (`fileSink`) writes `progress.jsonl` + `status.json`, persists each finished slide, re-seals a partial deck with placeholders, and prints the end breakdown. Step timing is derived purely from the render-tool call boundaries.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright (chromium), `@anthropic-ai/claude-agent-sdk`.

**Spec:** `docs/superpowers/specs/2026-06-24-build-observability-design.md`.

**Testing convention (follow it):** pure logic → Vitest with fakes. Browser/LLM code (`fit-check`, `agentic-author`, `runAgentic`) stays OUT of the Vitest suite and is verified by running. `fileSink` is pure-ish (fs + sealDeck, no browser/LLM) so it IS unit-tested with synthetic events.

---

## File Structure

**Create**
- `src/render/progress.ts` — `StepCategory`, `PassTiming`, `SlideTiming`, `ProgressEvent`, `ProgressSink`, `NOOP_SINK`, `ZERO_TIMING`, `computeSlideTiming`. Pure, unit-tested.
- `src/export/build-sink.ts` — `fileSink()` (the IO sink) + `formatBreakdown()`. Unit-tested with synthetic events.
- `tests/render/progress.test.ts`, `tests/export/build-sink.test.ts`

**Modify**
- `src/export/seal.ts` — add `placeholderSection()`.
- `src/render/build-slide.ts` — `AuthoredSlide`, `SlideAuthor.authorSlide(req, onPass?)`, `BuiltSlide.timing`, thread `onPass`.
- `src/render/build-deck.ts` — emit events, accept `deps.sink`.
- `src/agent/agentic-author.ts` — time each render pass, return `{ html, timing }`, call `onPass`.
- `src/cli.ts` — wire `fileSink` into `runBuild`.
- `src/render/index.ts`, `src/export/index.ts` — barrels.
- Tests: `tests/render/build-slide.test.ts`, `tests/render/build-deck.test.ts`, `tests/export/seal.test.ts` (fakes now return `{ html }`).

---

## Task 1: Progress model + computeSlideTiming

**Files:**
- Create: `src/render/progress.ts`
- Test: `tests/render/progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/progress.test.ts
import { describe, it, expect } from "vitest";
import { computeSlideTiming, ZERO_TIMING, type PassTiming } from "../../src/render/progress";

describe("computeSlideTiming", () => {
  it("attributes all time to four categories that sum to the total", () => {
    const passes: PassTiming[] = [
      { pass: 1, modelMs: 100, renderMs: 20, overflowPx: 80, consoleErrors: 0 },
      { pass: 2, modelMs: 50, renderMs: 10, overflowPx: 0, consoleErrors: 0 },
    ];
    const t = computeSlideTiming(0, passes, 200);
    expect(t.totalMs).toBe(200);
    expect(t.byCategory).toEqual({ author: 100, revise: 50, render: 30, finalize: 20 });
    const sum = Object.values(t.byCategory).reduce((a, b) => a + b, 0);
    expect(sum).toBe(t.totalMs);
    expect(t.passes).toBe(passes);
  });

  it("puts all model time in author when there are no render passes", () => {
    const t = computeSlideTiming(1000, [], 5000);
    expect(t.byCategory).toEqual({ author: 4000, revise: 0, render: 0, finalize: 0 });
    expect(t.passes).toEqual([]);
  });

  it("ZERO_TIMING is an all-zero slide timing", () => {
    expect(ZERO_TIMING.totalMs).toBe(0);
    expect(ZERO_TIMING.byCategory).toEqual({ author: 0, revise: 0, render: 0, finalize: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/progress.ts
export type StepCategory = "author" | "revise" | "render" | "finalize";

export interface PassTiming {
  pass: number;          // 1-based render pass
  modelMs: number;       // model time before this render (author for pass 1, revise after)
  renderMs: number;      // chromium render + screenshot
  overflowPx: number;    // from the render result — visibility into convergence
  consoleErrors: number;
}

export interface SlideTiming {
  totalMs: number;
  passes: PassTiming[];
  byCategory: Record<StepCategory, number>; // sums to totalMs
}

export type ProgressEvent =
  | { type: "slide_start"; at: number; index: number; total: number; id: string; title: string }
  | { type: "render_pass"; at: number; index: number; id: string; pass: number;
      modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }
  | { type: "slide_done"; at: number; index: number; id: string; html: string;
      timing: SlideTiming; warnings: string[] }
  | { type: "slide_failed"; at: number; index: number; id: string; reason: string }
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };

export interface ProgressSink {
  emit(e: ProgressEvent): void;
}

export const NOOP_SINK: ProgressSink = { emit() {} };

export const ZERO_TIMING: SlideTiming = {
  totalMs: 0,
  passes: [],
  byCategory: { author: 0, revise: 0, render: 0, finalize: 0 },
};

/** Derive the category breakdown from the render-call boundaries. Sums to totalMs. */
export function computeSlideTiming(
  startMs: number,
  passes: PassTiming[],
  endMs: number,
): SlideTiming {
  const totalMs = endMs - startMs;
  const render = passes.reduce((a, p) => a + p.renderMs, 0);
  const author = passes.length ? passes[0].modelMs : totalMs;
  const revise = passes.slice(1).reduce((a, p) => a + p.modelMs, 0);
  const finalize = totalMs - author - revise - render;
  return { totalMs, passes, byCategory: { author, revise, render, finalize } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/progress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/progress.ts tests/render/progress.test.ts
git commit -m "feat(render): progress model + computeSlideTiming (step categories)"
```

---

## Task 2: placeholderSection + partial seal

**Files:**
- Modify: `src/export/seal.ts`
- Test: `tests/export/seal.test.ts` (append)

- [ ] **Step 1: Write the failing test (append a new describe block)**

```ts
// tests/export/seal.test.ts  (add this import + describe; keep everything else)
import { placeholderSection } from "../../src/export/seal";

describe("placeholderSection + partial deck", () => {
  it("placeholderSection is one valid section carrying id and data-slide-id", () => {
    const s = placeholderSection({ id: "s_z", title: "Zed" });
    expect(s).toContain('id="s_z"');
    expect(s).toContain('data-slide-id="s_z"');
    expect(s).toContain("Zed");
    expect(s).toContain("building");
  });

  it("seals a partial deck with a placeholder for a not-yet-built slide", () => {
    const outline = parseOutline(MD); // MD already defined at top of this test file (s_a, s_b)
    const sections = new Map([
      ["s_a", '<section data-slide-id="s_a" data-layout="bespoke">DONE_A</section>'],
      ["s_b", placeholderSection({ id: "s_b", title: "B" })],
    ]);
    const html = sealDeck(outline, { sections });
    expect(html).toContain("DONE_A");
    expect(html).toContain("building");
    expect(html).toContain('data-slide-id="s_b"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: FAIL — `placeholderSection` not exported.

- [ ] **Step 3: Add `placeholderSection` to `src/export/seal.ts`**

`escapeHtml` is already imported in that file (`import { escapeHtml } from "../render/html";`). Add, near the bottom of the file:

```ts
/** A minimal valid section for a slide that hasn't been authored yet (partial-deck preview). */
export function placeholderSection(slide: { id: string; title: string }): string {
  return (
    `<section id="${slide.id}" data-slide-id="${slide.id}" data-layout="bespoke">` +
    `<div class="s-title">${escapeHtml(slide.title)}</div>` +
    `<div class="s-body">building…</div></section>`
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/export/seal.ts tests/export/seal.test.ts
git commit -m "feat(export): placeholderSection for partial-deck preview"
```

---

## Task 3: Author seam gains timing + onPass

**Files:**
- Modify: `src/render/build-slide.ts`
- Test: `tests/render/build-slide.test.ts` (replace)

- [ ] **Step 1: Replace `tests/render/build-slide.test.ts`**

```ts
// tests/render/build-slide.test.ts
import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { AuthorRequest } from "../../src/render/design-brief";
import type { RenderResult } from "../../src/render/fit-check";
import type { SlideMaterials } from "../../src/render/materials";
import type { PassTiming, SlideTiming } from "../../src/render/progress";

const slide = { id: "s_x", layout: "bespoke" as const, title: "T", markdown: "b" };
const deck = { title: "D", slideTitles: ["T"] };
const materials: SlideMaterials = { digest: ["p"], angle: "a", neighborTitles: [] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function fakeAuthor(html: string) {
  const reqs: AuthorRequest[] = [];
  const author: SlideAuthor = { async authorSlide(req) { reqs.push(req); return { html }; } };
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
    const a = fakeAuthor(`<div>not a section</div>`);
    const r = await buildSlide(slide, deck, materials, { author: a.author });
    expect(r.html).toBe(`<div>not a section</div>`);
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

  it("returns the author's timing and forwards onPass", async () => {
    const pass: PassTiming = { pass: 1, modelMs: 5, renderMs: 2, overflowPx: 0, consoleErrors: 0 };
    const timing: SlideTiming = { totalMs: 10, passes: [pass], byCategory: { author: 5, revise: 0, render: 2, finalize: 3 } };
    const seen: PassTiming[] = [];
    const author: SlideAuthor = {
      async authorSlide(_req, onPass) { onPass?.(pass); return { html: ok, timing }; },
    };
    const r = await buildSlide(slide, deck, materials, { author }, (p) => seen.push(p));
    expect(r.timing).toEqual(timing);
    expect(seen).toEqual([pass]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — `authorSlide` returns `{ html }` not assignable to old `string`; `r.timing`/`onPass` unknown.

- [ ] **Step 3: Replace the ENTIRE contents of `src/render/build-slide.ts`**

```ts
// src/render/build-slide.ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { SlideRenderer } from "./fit-check";
import type { SlideMaterials } from "./materials";
import type { PassTiming, SlideTiming } from "./progress";

export interface AuthoredSlide {
  html: string;
  timing?: SlideTiming;
}

export interface SlideAuthor {
  authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  renderer?: Pick<SlideRenderer, "render">; // optional final fit-check (warn only)
}

export interface BuiltSlide {
  html: string;
  fits: boolean;
  warnings: string[];
  timing?: SlideTiming;
}

/**
 * Invoke the (self-iterating) author, validate the section, optionally run a final
 * non-interactive fit-check. The author owns its own render→look→fix loop and reports
 * per-pass timing via onPass; the shell only validates and warns. Pure of process IO.
 */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  materials: SlideMaterials,
  deps: BuildSlideDeps,
  onPass?: (p: PassTiming) => void,
): Promise<BuiltSlide> {
  const authored = await deps.author.authorSlide({ slide, deck, materials }, onPass);
  const html = authored.html;
  const warnings = validateSlideSection(html, slide.id).map((i) => i.message);

  let fits = true;
  if (deps.renderer && warnings.length === 0) {
    const r = await deps.renderer.render(html);
    fits = r.fits;
    if (!r.fits) warnings.push(`overflows the 16:9 frame by ${r.overflowPx}px`);
    for (const e of r.consoleErrors) warnings.push(`console error: ${e}`);
  }
  return { html, fits, warnings, timing: authored.timing };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/build-slide.ts tests/render/build-slide.test.ts
git commit -m "feat(render): author seam returns {html,timing}; thread onPass"
```

---

## Task 4: buildDeck emits progress events

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts` (replace)

- [ ] **Step 1: Replace `tests/render/build-deck.test.ts`**

```ts
// tests/render/build-deck.test.ts
import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { Outline } from "../../src/outline/types";
import type { ProgressEvent, SlideTiming } from "../../src/render/progress";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;
const timing: SlideTiming = { totalMs: 10, passes: [{ pass: 1, modelMs: 6, renderMs: 2, overflowPx: 0, consoleErrors: 0 }], byCategory: { author: 6, revise: 0, render: 2, finalize: 2 } };

function recordingSink() {
  const events: ProgressEvent[] = [];
  return { sink: { emit: (e: ProgressEvent) => events.push(e) }, events };
}

describe("buildDeck", () => {
  it("authors every slide and keys sections by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return { html: section(req.slide.id) }; } };
    const r = await buildDeck(outline, { author });
    expect([...r.sections.keys()]).toEqual(["s_a", "s_b"]);
    expect(r.warnings).toEqual([]);
  });

  it("collects per-slide warnings with the slide id prefix", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: `<div>bad</div>` }; } };
    const r = await buildDeck(outline, { author });
    expect(r.warnings.every((w) => /^s_[ab]:/.test(w))).toBe(true);
    expect(r.warnings.length).toBe(2);
  });

  it("passes deck-context-derived materials to the author", async () => {
    let seenAngle = "";
    const author: SlideAuthor = {
      async authorSlide(req) { seenAngle = req.materials.angle; return { html: section(req.slide.id) }; },
    };
    await buildDeck(outline, { author, context: { digest: ["p"], angle: "lens" } });
    expect(seenAngle).toBe("lens");
  });

  it("emits slide_start / render_pass / slide_done per slide and a final deck_done", async () => {
    const author: SlideAuthor = {
      async authorSlide(req, onPass) {
        onPass?.({ pass: 1, modelMs: 6, renderMs: 2, overflowPx: 0, consoleErrors: 0 });
        return { html: section(req.slide.id), timing };
      },
    };
    const { sink, events } = recordingSink();
    await buildDeck(outline, { author, sink });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("slide_start");
    expect(types).toContain("render_pass");
    expect(types.filter((t) => t === "slide_done").length).toBe(2);
    expect(types[types.length - 1]).toBe("deck_done");
    const done = events.find((e) => e.type === "deck_done") as Extract<ProgressEvent, { type: "deck_done" }>;
    expect(done.slides).toBe(2);
    expect(done.byCategory.render).toBe(4); // 2 slides × renderMs 2
  });

  it("emits slide_failed and keeps going when an author throws", async () => {
    let n = 0;
    const author: SlideAuthor = {
      async authorSlide(req) { if (n++ === 0) throw new Error("kaboom"); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink });
    expect(events.some((e) => e.type === "slide_failed")).toBe(true);
    expect(events[events.length - 1].type).toBe("deck_done");
    expect([...r.sections.keys()]).toEqual(["s_b"]); // first failed, second authored
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — `sink` not a known dep; no events emitted.

- [ ] **Step 3: Replace the ENTIRE contents of `src/render/build-deck.ts`**

```ts
// src/render/build-deck.ts
import type { Outline } from "../outline/types";
import { buildSlide, type SlideAuthor, type BuildSlideDeps } from "./build-slide";
import { gatherMaterials } from "./materials";
import type { DeckContext } from "../agent/context-sidecar";
import { NOOP_SINK, ZERO_TIMING, type ProgressSink, type StepCategory } from "./progress";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

export interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: BuildSlideDeps["renderer"];
  context?: DeckContext;
  sink?: ProgressSink;
}

/** Author every slide with gathered materials, emitting progress; return sections + warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildDeckDeps,
): Promise<BuildDeckResult> {
  const sink = deps.sink ?? NOOP_SINK;
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];
  const total = outline.slides.length;
  const deckStart = Date.now();
  const agg: Record<StepCategory, number> = { author: 0, revise: 0, render: 0, finalize: 0 };

  for (let index = 0; index < total; index++) {
    const slide = outline.slides[index];
    sink.emit({ type: "slide_start", at: Date.now(), index, total, id: slide.id, title: slide.title });
    const materials = gatherMaterials(slide, outline, deps.context);
    const onPass = (p: { pass: number; modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }) =>
      sink.emit({ type: "render_pass", at: Date.now(), index, id: slide.id, ...p });
    try {
      const built = await buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer }, onPass);
      sections.set(slide.id, built.html);
      for (const w of built.warnings) warnings.push(`${slide.id}: ${w}`);
      const timing = built.timing ?? ZERO_TIMING;
      (Object.keys(agg) as StepCategory[]).forEach((k) => (agg[k] += timing.byCategory[k]));
      sink.emit({ type: "slide_done", at: Date.now(), index, id: slide.id, html: built.html, timing, warnings: built.warnings });
    } catch (e) {
      sink.emit({ type: "slide_failed", at: Date.now(), index, id: slide.id, reason: (e as Error).message });
    }
  }

  sink.emit({ type: "deck_done", at: Date.now(), slides: total, totalMs: Date.now() - deckStart, byCategory: agg });
  return { sections, warnings };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): buildDeck emits progress events (+ per-slide failure isolation)"
```

---

## Task 5: agenticAuthor times each render pass

**Files:**
- Modify: `src/agent/agentic-author.ts`
- Verified-by-running (imports `runAgentic` → the SDK; exercised live in Task 7).

- [ ] **Step 1: Replace the ENTIRE contents of `src/agent/agentic-author.ts`**

```ts
// src/agent/agentic-author.ts
import { runAgentic } from "./query";
import { extractSlideHtml } from "./extract-slide";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor, AuthoredSlide } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";
import { computeSlideTiming, type PassTiming } from "../render/progress";

/**
 * Live agentic author: hands the model the materials + identity brief and a bounded
 * `render` tool, lets it self-iterate on its own screenshots, returns the final slide HTML.
 * Times each render pass from the tool-call boundaries and reports them via onPass.
 */
export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide> {
      const { system, user } = slideAuthorPrompt(req);
      const startMs = Date.now();
      let lastBoundary = startMs;
      const passes: PassTiming[] = [];

      const text = await runAgentic(system, user, {
        render: async (html, interactions) => {
          const reqAt = Date.now();
          const modelMs = reqAt - lastBoundary; // author (pass 1) or revise (later)
          const r = await renderer.render(html, interactions);
          const renderMs = Date.now() - reqAt;
          lastBoundary = Date.now();
          const p: PassTiming = {
            pass: passes.length + 1,
            modelMs,
            renderMs,
            overflowPx: r.overflowPx,
            consoleErrors: r.consoleErrors.length,
          };
          passes.push(p);
          onPass?.(p);
          return r.shots;
        },
      });

      const timing = computeSlideTiming(startMs, passes, Date.now());
      return { html: extractSlideHtml(text), timing };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN. (If `AuthoredSlide` isn't exported from `build-slide`, it was added in Task 3 — confirm.)

- [ ] **Step 3: Commit**

```bash
git add src/agent/agentic-author.ts
git commit -m "feat(agent): agenticAuthor times each render pass, returns SlideTiming"
```

---

## Task 6: The file sink (progress.jsonl + status.json + partial seal + breakdown)

**Files:**
- Create: `src/export/build-sink.ts`
- Test: `tests/export/build-sink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/export/build-sink.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSink, formatBreakdown } from "../../src/export/build-sink";
import type { Outline } from "../../src/outline/types";
import type { SlideTiming } from "../../src/render/progress";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
  ],
};
const timing: SlideTiming = { totalMs: 100, passes: [], byCategory: { author: 60, revise: 30, render: 5, finalize: 5 } };

describe("fileSink", () => {
  it("writes progress.jsonl, status.json, slide files, and a partial deck as events arrive", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-sink-"));
    const buildDir = join(dir, "out.build");
    const outPath = join(dir, "out.html");
    const sink = fileSink(buildDir, outline, outPath);

    // initial partial deck exists (all placeholders)
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("building");

    sink.emit({ type: "slide_start", at: 1, index: 0, total: 2, id: "s_a", title: "A" });
    sink.emit({ type: "render_pass", at: 2, index: 0, id: "s_a", pass: 1, modelMs: 60, renderMs: 5, overflowPx: 0, consoleErrors: 0 });
    sink.emit({ type: "slide_done", at: 3, index: 0, id: "s_a", html: '<section data-slide-id="s_a" data-layout="bespoke">REAL_A</section>', timing, warnings: [] });

    // status reflects progress
    const status = JSON.parse(readFileSync(join(buildDir, "status.json"), "utf8"));
    expect(status.doneCount).toBe(1);
    // the slide file was written
    expect(readFileSync(join(buildDir, "slides", "s_a.html"), "utf8")).toContain("REAL_A");
    // partial deck now has the real slide A and a placeholder B
    const deck = readFileSync(outPath, "utf8");
    expect(deck).toContain("REAL_A");
    expect(deck).toContain("building");
    // progress log grew
    const lines = readFileSync(join(buildDir, "progress.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).type).toBe("slide_start");

    sink.emit({ type: "deck_done", at: 4, slides: 2, totalMs: 200, byCategory: { author: 120, revise: 60, render: 10, finalize: 5 } });
    expect(existsSync(join(buildDir, "timing.json"))).toBe(true);
  });
});

describe("formatBreakdown", () => {
  it("reports each category as a percentage that includes an overhead remainder", () => {
    const out = formatBreakdown(
      { type: "deck_done", at: 0, slides: 2, totalMs: 200, byCategory: { author: 120, revise: 60, render: 10, finalize: 5 } },
      [],
    );
    expect(out).toMatch(/author/);
    expect(out).toMatch(/revise/);
    expect(out).toMatch(/overhead/); // 200 - 195 = 5 → ~2%
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/export/build-sink.ts`**

```ts
// src/export/build-sink.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outline } from "../outline/types";
import type { ProgressEvent, ProgressSink, SlideTiming, StepCategory } from "../render/progress";
import { sealDeck, placeholderSection } from "./seal";

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** Render the end-of-build step breakdown (printed + a sane fallback if totals are zero). */
export function formatBreakdown(
  done: Extract<ProgressEvent, { type: "deck_done" }>,
  slideTimings: SlideTiming[],
): string {
  const c = done.byCategory;
  const stepSum = c.author + c.revise + c.render + c.finalize;
  const overhead = Math.max(0, done.totalMs - stepSum);
  const denom = done.totalMs || 1;
  const pct = (n: number) => `${Math.round((n / denom) * 100)}%`;
  const slowest = [...slideTimings]
    .map((t, i) => ({ i, t }))
    .sort((a, b) => b.t.totalMs - a.t.totalMs)
    .slice(0, 3)
    .map((x) => `#${x.i + 1} ${fmtMs(x.t.totalMs)} (${x.t.passes.length} passes)`)
    .join(" · ");
  return (
    `build complete — ${done.slides} slides in ${fmtMs(done.totalMs)}\n` +
    `  by step:  revise ${pct(c.revise)} · author ${pct(c.author)} · render ${pct(c.render)} · finalize ${pct(c.finalize)} · overhead ${pct(overhead)}\n` +
    (slowest ? `  slowest:  ${slowest}\n` : "")
  );
}

/**
 * The build's IO sink: writes a structured event log + status snapshot, persists each finished
 * slide, re-seals a partial deck (placeholders for pending slides) so it's openable mid-build,
 * and prints/saves the step breakdown at the end.
 */
export function fileSink(buildDir: string, outline: Outline, outPath: string): ProgressSink {
  mkdirSync(join(buildDir, "slides"), { recursive: true });
  const progressPath = join(buildDir, "progress.jsonl");
  const statusPath = join(buildDir, "status.json");
  const start = Date.now();

  // every slide starts as a placeholder so the partial deck always has the full count
  const sections = new Map<string, string>();
  for (const s of outline.slides) sections.set(s.id, placeholderSection(s));
  const slideTimings: SlideTiming[] = [];
  let doneCount = 0;
  let current: { index: number; total: number; id: string; title: string; pass: number } | null = null;

  const reseal = () => {
    try { writeFileSync(outPath, sealDeck(outline, { sections }), "utf8"); } catch { /* best-effort */ }
  };
  const writeStatus = (lastEvent: string) => {
    try {
      writeFileSync(
        statusPath,
        JSON.stringify({ current, elapsedMs: Date.now() - start, doneCount, lastEvent }, null, 2),
        "utf8",
      );
    } catch { /* best-effort */ }
  };

  reseal(); // initial all-placeholder deck

  return {
    emit(e: ProgressEvent) {
      try { appendFileSync(progressPath, JSON.stringify(e) + "\n"); } catch { /* best-effort */ }

      if (e.type === "slide_start") {
        current = { index: e.index, total: e.total, id: e.id, title: e.title, pass: 0 };
        process.stdout.write(`▶ ${e.index + 1}/${e.total} "${e.title}"\n`);
      } else if (e.type === "render_pass") {
        if (current) current.pass = e.pass;
        process.stdout.write(`   pass ${e.pass} · render ${fmtMs(e.renderMs)} · overflow ${e.overflowPx} · +${fmtMs(e.modelMs)} model\n`);
      } else if (e.type === "slide_done") {
        sections.set(e.id, e.html);
        slideTimings.push(e.timing);
        doneCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`✓ ${e.index + 1}/${current?.total ?? "?"} done · ${fmtMs(e.timing.totalMs)}\n`);
      } else if (e.type === "slide_failed") {
        doneCount++;
        process.stderr.write(`✗ ${e.index + 1} ${e.id}: ${e.reason}\n`);
      } else if (e.type === "deck_done") {
        reseal();
        try {
          writeFileSync(
            join(buildDir, "timing.json"),
            JSON.stringify({ totalMs: e.totalMs, byCategory: e.byCategory, slides: slideTimings }, null, 2),
            "utf8",
          );
        } catch { /* best-effort */ }
        process.stdout.write("\n" + formatBreakdown(e, slideTimings));
      }

      writeStatus(e.type);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: PASS (2 describes).

- [ ] **Step 5: Commit**

```bash
git add src/export/build-sink.ts tests/export/build-sink.test.ts
git commit -m "feat(export): fileSink — progress log, status, partial-deck seal, step breakdown"
```

---

## Task 7: Wire the sink into `mindsizer build` + barrels + live verify

**Files:**
- Modify: `src/render/index.ts`, `src/export/index.ts` (barrels)
- Modify: `src/cli.ts` (`runBuild`)
- Verified-by-running.

- [ ] **Step 1: Export the new modules**

In `src/render/index.ts` add:

```ts
export * from "./progress";
```

In `src/export/index.ts` add:

```ts
export { placeholderSection } from "./seal";
export { fileSink, formatBreakdown } from "./build-sink";
```

- [ ] **Step 2: Rewire `runBuild` in `src/cli.ts`**

Add `fileSink` to the export-barrel import at the top of cli.ts (it currently imports `sealDeck, fontFaceCss, readFieldCss` from `./export/index`):

```ts
import { sealDeck, fontFaceCss, readFieldCss, fileSink } from "./export/index";
```

Replace the build+seal section — from `const fitTheme = …` through the final `✓ sealed → …` write (currently `src/cli.ts:190-230`) — with:

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

  const baseDir = dirname(resolve(input));
  const stem = basename(input, extname(input));
  const outPath = out ?? join(baseDir, stem + ".html");
  const buildDir = join(baseDir, stem + ".build");
  // the sink writes progress.jsonl/status.json under buildDir and re-seals outPath incrementally
  const sink = fileSink(buildDir, outline, outPath);
  process.stdout.write(`· progress → ${join(buildDir, "progress.jsonl")}\n`);

  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    try {
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink });
    } finally {
      await renderer.dispose().catch(() => {});
    }
  } catch (e) {
    fail((e as Error).message);
  }

  for (const w of result.warnings) process.stderr.write(`⚠ ${w}\n`);
  process.stdout.write(`✓ sealed → ${outPath}\n`);
```

Note: the sink already wrote per-slide files (`buildDir/slides/`) and the final sealed deck, so the old `.slides` dir loop and the explicit `sealDeck(...)` write are removed. `mkdirSync`/`writeSlide` may now be unused imports in cli.ts — remove them from the import line if tsc flags them as unused (tsc with the project config does not error on unused imports by default, but clean them if `writeSlide` is no longer referenced anywhere in cli.ts).

- [ ] **Step 3: Typecheck + full unit suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all tests PASS.

- [ ] **Step 4: Live verification (needs Claude auth + chromium)**

Build the bundled example (or any short outline) in the background and inspect the live progress:

```bash
bun run src/cli.ts build examples/dont-scale.outline.md -o /tmp/obs-demo.html &
# while it runs:
cat examples/dont-scale.build/status.json          # current slide + pass + elapsed
tail -f examples/dont-scale.build/progress.jsonl    # streaming step events
open /tmp/obs-demo.html                              # partial deck; refresh to watch it fill
```

Expected: `status.json` updates with the current slide/pass; `progress.jsonl` grows one line per step; the partial deck opens and fills in; at the end the step **breakdown** prints (by-category percentages + slowest slides) and `examples/dont-scale.build/timing.json` exists. (Note: the output `-o` path's build dir is derived from the INPUT stem, so it's `examples/dont-scale.build/`.)

- [ ] **Step 5: Commit**

```bash
git add src/render/index.ts src/export/index.ts src/cli.ts
git commit -m "feat(cli): mindsizer build emits live progress + incremental partial deck + step breakdown"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 step model → Task 1 (`computeSlideTiming`) + Task 5 (boundary capture); §5A model → Task 1; §5B seam → Task 3; §5C author → Task 5; §5D orchestrator → Task 4; §5E sink → Task 6; §5F placeholder → Task 2; §6 file formats → Task 6; §7 breakdown → Task 6 (`formatBreakdown`); §8 operating pattern → Task 7 live verify; §10 testing → unit tasks throughout; §11 build order → task order.
- **Type consistency:** `PassTiming`/`SlideTiming`/`ProgressEvent`/`ProgressSink`/`StepCategory`/`ZERO_TIMING`/`computeSlideTiming` defined in Task 1 and used identically in Tasks 3–6; `AuthoredSlide` defined in Task 3, consumed in Task 5; `fileSink`/`formatBreakdown` defined in Task 6, wired in Task 7.
- **Seam discipline:** `progress.ts` and `build-sink.ts` are pure/fs-only and unit-tested; `agentic-author.ts` (SDK) and the live `playwrightRenderer` stay out of the unit graph; `fit-check` is still not exported from the render barrel.
- **Out of scope (later phases):** robust extractor, `id==data-slide-id`, gating/retry, whole-deck check (Phase 2); iteration cap / parallelize / cheaper model / fast mode (Phase 3, chosen from this phase's timing).
