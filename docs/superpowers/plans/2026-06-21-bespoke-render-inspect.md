# Bespoke Slide Authoring + Render-and-Inspect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mindsizer build <outline.md>` — the agent authors bespoke comprehension HTML per slide (guided by a Field design brief), a headless render-and-inspect loop guarantees each slide fits 16:9, and the authored sections seal into the offline deck (PRD §17 step 5).

**Architecture:** A build loop (`buildSlide`) runs an injected `SlideAuthor` (LLM) and `FitChecker` (Playwright headless): author → validate section → measure overflow → re-author with the problem (cap 3). `buildDeck` runs it per slide; the CLI writes per-slide files and seals the authored sections (reusing step-3 font-embed/nav). The author + fit-checker sit behind seams so the loop is unit-tested with fakes; the live LLM author and the Playwright checker are integration/verified-by-running.

**Tech Stack:** TypeScript, Bun, Vitest, `playwright` (headless chromium — install validated), the Claude Agent SDK `query()` (step-4 adapter). Builds on steps 1–4.

**Spec:** `docs/superpowers/specs/2026-06-21-bespoke-render-inspect-design.md`

**Reality note (controller):** chromium is already cached (`~/Library/Caches/ms-playwright`) from de-risking, and the overflow-measurement approach is validated (fitting → 0px, overflowing → 1674px). `slide-author.ts` (live LLM) is typecheck-only. Keep `fit-check.ts` OUT of the render barrel so `playwright` doesn't load into unrelated tests.

---

### Task 1: Extract the shared `runQuery` helper

**Files:**
- Create: `src/agent/query.ts`
- Modify: `src/agent/anthropic-client.ts`

This is a refactor of untested code (the Agent SDK adapter), verified by `tsc` + the existing suite staying green. No new test.

- [ ] **Step 1: Create `src/agent/query.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

/** One isolated single-shot turn → full assistant text (loupe's query() pattern). */
export async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({
    prompt: userPrompt as any,
    options: {
      systemPrompt,
      model: MODEL,
      permissionMode: "bypassPermissions",
      allowedTools: [],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
        "Agent", "WebFetch", "WebSearch", "NotebookEdit",
      ],
      includePartialMessages: true,
    },
  }) as any;

  let text = "";
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (
      msg.type === "stream_event" &&
      msg.event?.type === "content_block_delta" &&
      msg.event.delta?.type === "text_delta" &&
      msg.event.delta.text
    ) {
      text += msg.event.delta.text;
    }
    if (msg.type === "result") break;
  }
  return text;
}
```

- [ ] **Step 2: Refactor `src/agent/anthropic-client.ts` to import it**

Remove the local `runQuery`, the `MODEL` const, the `SDKMessage` type, and the `import { query } from "@anthropic-ai/claude-agent-sdk"` line. Add at the top (after the existing imports):
```ts
import { runQuery } from "./query";
```
Leave `ask()` and `anthropicClient()` unchanged (they already call `runQuery`). The file should no longer reference `query`, `MODEL`, or `SDKMessage` directly.

- [ ] **Step 3: Verify**

Run: `bunx tsc --noEmit` → clean.
Run: `bunx vitest run` → all existing tests green (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/agent/query.ts src/agent/anthropic-client.ts
git commit -m "refactor: extract shared runQuery helper for the Agent SDK"
```

---

### Task 2: The fit-check (Playwright headless)

**Files:**
- Modify: `package.json` (add `playwright`)
- Create: `src/render/fit-check.ts`
- Test: `tests/render/fit-check.test.ts`

- [ ] **Step 1: Add Playwright + chromium**

Run: `bun add -d playwright`
Run: `bunx playwright install chromium`
Expected: installs (chromium is cached, so the second is near-instant).

- [ ] **Step 2: Write the failing test**

Create `tests/render/fit-check.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { playwrightFitChecker } from "../../src/render/fit-check";

const theme = `
  section[data-slide-id]{box-sizing:border-box;padding:40px;font-family:sans-serif;overflow:hidden;}
  .s-title{font-size:40px;margin:0 0 20px;}
  .s-body{font-size:16px;line-height:1.5;}
`;
const checker = playwrightFitChecker(theme);
afterAll(async () => {
  await checker.dispose();
});

describe("playwrightFitChecker", () => {
  it("reports a small slide as fitting", async () => {
    const r = await checker.check(
      `<section data-slide-id="a"><h2 class="s-title">Hi</h2><p class="s-body">One tidy line.</p></section>`,
    );
    expect(r.fits).toBe(true);
    expect(r.overflowPx).toBeLessThanOrEqual(2);
  }, 30000);

  it("reports a tall slide as overflowing, with a positive overflowPx", async () => {
    const many = Array.from(
      { length: 50 },
      (_, i) => `<p class="s-body">Line ${i}: lorem ipsum dolor sit amet consectetur adipiscing.</p>`,
    ).join("");
    const r = await checker.check(
      `<section data-slide-id="b"><h2 class="s-title">Tall</h2>${many}</section>`,
    );
    expect(r.fits).toBe(false);
    expect(r.overflowPx).toBeGreaterThan(0);
  }, 30000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/render/fit-check.test.ts`
Expected: FAIL — cannot find module `../../src/render/fit-check`.

- [ ] **Step 4: Write the implementation**

Create `src/render/fit-check.ts`:

```ts
import { chromium, type Browser } from "playwright";

export interface FitResult {
  fits: boolean;
  overflowPx: number;
  detail: string;
}

export interface FitChecker {
  check(sectionHtml: string): Promise<FitResult>;
  dispose(): Promise<void>;
}

const W = 1280;
const H = 720;

/** Headless-chromium fit checker: renders a <section> at 16:9 and measures overflow. */
export function playwrightFitChecker(themeCss: string): FitChecker {
  let browser: Browser | null = null;
  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }
  return {
    async check(sectionHtml: string): Promise<FitResult> {
      const b = await getBrowser();
      const page = await b.newPage({ viewport: { width: W, height: H } });
      try {
        await page.setContent(
          `<!DOCTYPE html><html><head><style>
            html,body{margin:0;}
            .stage{width:${W}px;height:${H}px;}
            .stage > section[data-slide-id]{width:${W}px;height:${H}px;aspect-ratio:auto;}
            ${themeCss}
          </style></head><body><div class="stage">${sectionHtml}</div></body></html>`,
          { waitUntil: "networkidle" },
        );
        const m = await page.evaluate(() => {
          const s = document.querySelector("section[data-slide-id]") as HTMLElement | null;
          if (!s) return null;
          return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
        });
        if (!m) return { fits: false, overflowPx: 0, detail: "no <section data-slide-id> found" };
        const overflowPx = Math.max(0, m.sh - m.ch, m.sw - m.cw);
        return {
          fits: overflowPx <= 2,
          overflowPx,
          detail:
            overflowPx <= 2
              ? "fits the 16:9 frame"
              : `content overflows the 16:9 frame by ${overflowPx}px`,
        };
      } finally {
        await page.close();
      }
    },
    async dispose(): Promise<void> {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/render/fit-check.test.ts`
Expected: PASS, 2 tests. (If chromium cannot launch in this environment, report BLOCKED with the exact error — the controller validated it works and will verify.)

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/render/fit-check.ts tests/render/fit-check.test.ts
git commit -m "feat: Playwright headless fit-check (16:9 overflow measurement)"
```

---

### Task 3: The design brief

**Files:**
- Create: `src/render/design-brief.ts`
- Test: `tests/render/design-brief.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/design-brief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DESIGN_BRIEF, slideAuthorPrompt } from "../../src/render/design-brief";

const slide = {
  id: "s_demo",
  layout: "analogy" as const,
  title: "Eventual consistency",
  markdown: "Every copy agrees.\n\n> Like office gossip.",
};
const deck = { title: "EC Deck", slideTitles: ["Eventual consistency", "Trade-off"] };

describe("design brief", () => {
  it("DESIGN_BRIEF carries the Field language + output contract", () => {
    expect(DESIGN_BRIEF).toContain("#4DD9E0");
    expect(DESIGN_BRIEF).toContain("Fraunces");
    expect(DESIGN_BRIEF).toContain("data-slide-id");
    expect(DESIGN_BRIEF).toContain("16:9");
    expect(DESIGN_BRIEF.toLowerCase()).toContain("avoid generic");
  });

  it("slideAuthorPrompt includes the slide id, title, content, and deck title", () => {
    const p = slideAuthorPrompt({ slide, deck });
    expect(p.user).toContain("s_demo");
    expect(p.user).toContain("Eventual consistency");
    expect(p.user).toContain("Like office gossip");
    expect(p.user).toContain("EC Deck");
    expect(p.system).toBe(DESIGN_BRIEF);
  });

  it("includes the fix problem + previous html on a revision", () => {
    const p = slideAuthorPrompt({
      slide,
      deck,
      fix: { previousHtml: "<section>old</section>", problem: "overflows by 120px" },
    });
    expect(p.user).toContain("overflows by 120px");
    expect(p.user).toContain("<section>old</section>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL — cannot find module `../../src/render/design-brief`.

- [ ] **Step 3: Write the implementation**

Create `src/render/design-brief.ts`:

```ts
import type { OutlineSlide } from "../outline/types";

export interface AuthorRequest {
  slide: OutlineSlide;
  deck: { title: string; slideTitles: string[] };
  fix?: { previousHtml: string; problem: string };
}

export interface Prompt {
  system: string;
  user: string;
}

export const DESIGN_BRIEF = [
  "You are mindsizer's slide designer. You turn ONE outline slide into ONE comprehension-first HTML slide that makes the idea CLICK — not a bullet dump.",
  "",
  "## The Field aesthetic",
  "Dark navy ground (#0a1a2f), cream foreground (#f3efe5), a single cyan accent (#4DD9E0); monochrome otherwise. Fonts already provided: Fraunces (display serif — title + emphasis, with italic cyan accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels and numeric readouts). A faint dot-grid is on the frame; hairline rules at ~16% opacity. It should read like a calm instrument panel, never a corporate slide.",
  "",
  "## Make it comprehension-first",
  "- ONE idea per slide; the viewer should get it at a glance.",
  "- PREFER A VISUAL when it helps the idea land: an inline <svg> diagram, a labeled comparison, a stat readout (big Fraunces numbers + Geist Mono labels), a staged build-up, or a metaphor made visual. A picture that explains beats three sentences.",
  "- Density-inverted but NOT empty: compose for the whole 16:9 frame; never leave the lower half blank.",
  "- AVOID generic AI-slop aesthetics: no Inter/Roboto/system-ui fonts, no purple gradients, no rounded-card grids, no clip-art. Use the Field language with intent.",
  "",
  "## Output contract",
  "Return EXACTLY one slide, optionally preceded by a <style> of id-scoped rules:",
  '  <style>#SLIDE_ID .thing { ... }</style>',
  '  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>',
  "- Use the given SLIDE_ID for data-slide-id AND every CSS selector, so styles never leak to other slides.",
  "- You MAY use the shared theme classes (.s-title, .s-body, .s-col-label) and add id-scoped classes for bespoke parts.",
  "- Self-contained: inline <svg> only; NO external images, scripts, links, or @import (fonts are already provided).",
  "- It MUST fit a 1280x720 (16:9) frame with no scrolling. Keep copy tight; give a large visual room.",
  "- Output ONLY the HTML (optional <style> + the <section>) — no markdown fences, no commentary.",
].join("\n");

export function slideAuthorPrompt(req: AuthorRequest): Prompt {
  const { slide, deck, fix } = req;
  let user =
    `Deck: ${deck.title}\n` +
    `All slide titles (for coherence — don't duplicate neighbors): ${deck.slideTitles.join(" · ")}\n\n` +
    `SLIDE_ID: ${slide.id}\n` +
    `Slide title: ${slide.title}\n` +
    `Suggested layout: ${slide.layout}\n` +
    `Content (markdown):\n${slide.markdown}\n`;
  if (fix) {
    user +=
      `\n---\nYour previous attempt did NOT fit the frame.\n` +
      `PROBLEM: ${fix.problem}\n` +
      `Revise to fit 1280x720 — tighten copy, shrink/simplify the visual, or drop a row. Keep the idea intact.\n` +
      `Previous HTML:\n${fix.previousHtml}\n`;
  }
  return { system: DESIGN_BRIEF, user };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat: Field comprehension design brief + slide-author prompt"
```

---

### Task 4: The build loop (`buildSlide`)

**Files:**
- Create: `src/render/build-slide.ts`
- Test: `tests/render/build-slide.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/build-slide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSlide, type SlideAuthor } from "../../src/render/build-slide";
import type { FitResult } from "../../src/render/fit-check";
import type { AuthorRequest } from "../../src/render/design-brief";

const slide = { id: "s_x", layout: "plain" as const, title: "T", markdown: "body" };
const deck = { title: "D", slideTitles: ["T"] };
const ok = `<section data-slide-id="s_x" data-layout="bespoke">ok</section>`;

function recordingAuthor(seq: string[]) {
  const reqs: AuthorRequest[] = [];
  let i = 0;
  const author: SlideAuthor = {
    async authorSlide(req) {
      reqs.push(req);
      return seq[Math.min(i++, seq.length - 1)];
    },
  };
  return { author, reqs };
}
const fitsAlways = { check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits" }) };

describe("buildSlide", () => {
  it("returns on the first attempt when it fits", async () => {
    const a = recordingAuthor([ok]);
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitsAlways });
    expect(r).toEqual({ html: ok, passes: 1, fits: true });
    expect(a.reqs).toHaveLength(1);
    expect(a.reqs[0].fix).toBeUndefined();
  });

  it("re-authors with the overflow problem, then succeeds", async () => {
    const a = recordingAuthor([ok, ok]);
    let n = 0;
    const fit = {
      check: async (): Promise<FitResult> =>
        ++n === 1
          ? { fits: false, overflowPx: 100, detail: "overflows by 100px" }
          : { fits: true, overflowPx: 0, detail: "fits" },
    };
    const r = await buildSlide(slide, deck, { author: a.author, fit });
    expect(r.fits).toBe(true);
    expect(r.passes).toBe(2);
    expect(a.reqs[1].fix?.problem).toBe("overflows by 100px");
    expect(a.reqs[1].fix?.previousHtml).toBe(ok);
  });

  it("gives up after maxPasses, flagging fits:false", async () => {
    const a = recordingAuthor([ok]);
    const fit = { check: async (): Promise<FitResult> => ({ fits: false, overflowPx: 200, detail: "overflows by 200px" }) };
    const r = await buildSlide(slide, deck, { author: a.author, fit, maxPasses: 2 });
    expect(r.fits).toBe(false);
    expect(r.passes).toBe(2);
    expect(a.reqs).toHaveLength(2);
  });

  it("treats a malformed section as a problem and re-authors", async () => {
    const a = recordingAuthor(["<div>not a section</div>", ok]);
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitsAlways });
    expect(r.fits).toBe(true);
    expect(a.reqs).toHaveLength(2);
    expect(a.reqs[1].fix).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — cannot find module `../../src/render/build-slide`.

- [ ] **Step 3: Write the implementation**

Create `src/render/build-slide.ts`:

```ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { FitChecker, FitResult } from "./fit-check";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  fit: Pick<FitChecker, "check">;
  maxPasses?: number;
}

export interface BuiltSlide {
  html: string;
  passes: number;
  fits: boolean;
}

/** author → validate section → fit-check → re-author with the problem (capped). Pure of IO. */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const maxPasses = deps.maxPasses ?? 3;
  let html = "";
  let problem: string | undefined;
  let lastFits = false;

  for (let pass = 1; pass <= maxPasses; pass++) {
    const req: AuthorRequest = problem
      ? { slide, deck, fix: { previousHtml: html, problem } }
      : { slide, deck };
    html = await deps.author.authorSlide(req);

    const sectionIssues = validateSlideSection(html, slide.id);
    if (sectionIssues.length > 0) {
      problem = sectionIssues[0].message;
      lastFits = false;
      continue;
    }

    const fit: FitResult = await deps.fit.check(html);
    lastFits = fit.fits;
    if (fit.fits) return { html, passes: pass, fits: true };
    problem = fit.detail;
  }
  return { html, passes: maxPasses, fits: lastFits };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/build-slide.ts tests/render/build-slide.test.ts
git commit -m "feat: buildSlide loop (author → validate → fit-check → fix)"
```

---

### Task 5: The build orchestrator (`buildDeck`)

**Files:**
- Create: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/build-deck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDeck } from "../../src/render/build-deck";
import { parseOutline } from "../../src/outline/index";
import type { SlideAuthor } from "../../src/render/build-slide";
import type { FitResult } from "../../src/render/fit-check";

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=plain -->
# A

aaa

---

<!-- slide id=s_b layout=plain -->
# B

bbb
`;

const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">${id}</section>`;

describe("buildDeck", () => {
  it("builds a section per slide, keyed by id", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const fit = { check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits" }) };
    const res = await buildDeck(parseOutline(MD), { author, fit });
    expect([...res.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
    expect(res.sections.get("s_a")).toContain('data-slide-id="s_a"');
    expect(res.warnings).toEqual([]);
  });

  it("records a warning for a slide that never fits", async () => {
    const author: SlideAuthor = { async authorSlide(req) { return section(req.slide.id); } };
    const fit = { check: async (): Promise<FitResult> => ({ fits: false, overflowPx: 99, detail: "overflows by 99px" }) };
    const res = await buildDeck(parseOutline(MD), { author, fit, maxPasses: 1 });
    expect(res.warnings.length).toBe(2);
    expect(res.warnings[0]).toContain("s_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — cannot find module `../../src/render/build-deck`.

- [ ] **Step 3: Write the implementation**

Create `src/render/build-deck.ts`:

```ts
import type { Outline } from "../outline/types";
import { buildSlide, type BuildSlideDeps } from "./build-slide";

export interface BuildDeckResult {
  sections: Map<string, string>;
  warnings: string[];
}

/** Author + fit-check every slide; return the sections by id, plus non-fit warnings. */
export async function buildDeck(
  outline: Outline,
  deps: BuildSlideDeps,
): Promise<BuildDeckResult> {
  const deck = {
    title: outline.meta.title,
    slideTitles: outline.slides.map((s) => s.title),
  };
  const sections = new Map<string, string>();
  const warnings: string[] = [];

  for (const slide of outline.slides) {
    const built = await buildSlide(slide, deck, deps);
    sections.set(slide.id, built.html);
    if (!built.fits) {
      warnings.push(`${slide.id} did not fit after ${built.passes} passes`);
    }
  }
  return { sections, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat: buildDeck orchestrator (author + fit-check per slide)"
```

---

### Task 6: The live slide author (typecheck-only)

**Files:**
- Create: `src/agent/slide-author.ts`

Not unit-tested (live LLM). MUST pass `bunx tsc --noEmit`.

- [ ] **Step 1: Write the implementation**

Create `src/agent/slide-author.ts`:

```ts
import { runQuery } from "./query";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor } from "../render/build-slide";

/** Strip a stray ```html code fence if the model wraps its output. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : t).trim();
}

/** Live SlideAuthor over the Claude Agent SDK (auth: Claude Code session). */
export function anthropicSlideAuthor(): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest) {
      const p = slideAuthorPrompt(req);
      return stripFences(await runQuery(p.system, p.user));
    },
  };
}
```

- [ ] **Step 2: Typecheck + suite**

Run: `bunx tsc --noEmit` → clean.
Run: `bunx vitest run` → all green (this file is imported by nothing yet).

- [ ] **Step 3: Commit**

```bash
git add src/agent/slide-author.ts
git commit -m "feat: live Claude slide author (Agent SDK + design brief)"
```

---

### Task 7: Seal the authored sections

**Files:**
- Modify: `src/export/seal.ts`
- Test: `tests/export/seal.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/export/seal.test.ts` inside the existing `describe("sealDeck", ...)` block (the file already imports `sealDeck` and `parseOutline` and defines `MD` with slides `s_a` (analogy) and `s_b` (plain)):

```ts
  it("inlines authored sections when provided, falling back to renderSlide for missing ids", () => {
    const outline = parseOutline(MD);
    const sections = new Map([
      ["s_a", '<section data-slide-id="s_a" data-layout="bespoke">AUTHORED_MARKER</section>'],
    ]);
    const html = sealDeck(outline, { sections });
    expect(html).toContain("AUTHORED_MARKER"); // s_a authored section inlined
    expect(html).toContain('data-slide-id="s_b"'); // s_b fell back to renderSlide
    expect(html).toContain("data:font/woff2;base64,"); // still sealed
  });

  it("exposes readFieldCss returning the theme stylesheet", () => {
    const css = readFieldCss();
    expect(css).toContain("--s-cyan");
    expect(css).toContain("section[data-slide-id]");
  });
```

Also add `readFieldCss` to the import at the top of the test file:
```ts
import { sealDeck, readFieldCss } from "../../src/export/seal";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: FAIL — `readFieldCss` is not exported and `sealDeck` ignores `opts.sections`.

- [ ] **Step 3: Modify `src/export/seal.ts`**

Add an exported `readFieldCss` and use it internally; widen `sealDeck` to accept `opts.sections`. Specifically:

Add this exported function (near the top, after `THEME_DIR` is defined):
```ts
/** Read the bundled Field theme stylesheet. */
export function readFieldCss(): string {
  return readFileSync(join(THEME_DIR, "field.css"), "utf8");
}
```

Change the `sealDeck` signature and the two affected lines:
```ts
export function sealDeck(
  outline: Outline,
  opts: { sections?: Map<string, string> } = {},
): string {
```
Replace the existing `const fieldCss = readFileSync(join(THEME_DIR, "field.css"), "utf8");` with:
```ts
  const fieldCss = readFieldCss();
```
Replace the existing `const sections = outline.slides.map((s) => renderSlide(s)).join("\n");` with:
```ts
  const sections = outline.slides
    .map((s) => opts.sections?.get(s.id) ?? renderSlide(s))
    .join("\n");
```
Everything else in `sealDeck` stays the same.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: PASS (existing seal tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/export/seal.ts tests/export/seal.test.ts
git commit -m "feat: seal authored per-slide sections (+ readFieldCss export)"
```

---

### Task 8: The `build` CLI subcommand + barrels

**Files:**
- Modify: `src/render/index.ts`, `src/export/index.ts`, `src/agent/index.ts`, `src/cli.ts`
- Test: `tests/render/build-cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/build-cli.test.ts` (pre-LLM/pre-browser error paths — they fail before any chromium/Claude call):

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer build CLI (pre-LLM paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["build"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer build");
  });

  it("errors on a missing input file", () => {
    const r = runCli(["build", "/no/such/file.md"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });

  it("rejects an unknown build option", () => {
    const r = runCli(["build", "x.md", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/build-cli.test.ts`
Expected: FAIL — `build` is not dispatched (no "usage: mindsizer build").

- [ ] **Step 3: Update the barrels**

Append to `src/render/index.ts` (do NOT export `./fit-check` — it pulls in Playwright):
```ts
export * from "./design-brief";
export * from "./build-slide";
export * from "./build-deck";
```

Append to `src/export/index.ts`:
```ts
export { readFieldCss } from "./seal";
```

Append to `src/agent/index.ts`:
```ts
export { anthropicSlideAuthor } from "./slide-author";
```

- [ ] **Step 4: Add the `build` subcommand to `src/cli.ts`**

Add these imports at the top (alongside the existing ones):
```ts
import { mkdirSync } from "node:fs";
import { buildDeck } from "./render/index";
import { playwrightFitChecker } from "./render/fit-check";
import { anthropicSlideAuthor } from "./agent/index";
import { sealDeck, fontFaceCss, readFieldCss } from "./export/index";
import { writeSlide } from "./outline/index";
```
(Note: `sealDeck` may already be imported — if so, just add `fontFaceCss, readFieldCss` to that import and don't duplicate.)

Add this function (next to `runIngest`):
```ts
async function runBuild(args: string[]): Promise<void> {
  let input: string | undefined;
  let out: string | undefined;
  let open = false;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--open") {
      open = true;
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  const outline = parseOutline(md);
  process.stdout.write(`building ${outline.slides.length} slides…\n`);

  const fitTheme = fontFaceCss() + "\n" + readFieldCss();
  const fit = playwrightFitChecker(fitTheme);
  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    result = await buildDeck(outline, {
      author: anthropicSlideAuthor(),
      fit,
      maxPasses: 3,
    });
  } catch (e) {
    await fit.dispose();
    fail((e as Error).message);
  }
  await fit.dispose();

  const baseDir = dirname(resolve(input));
  const slidesDir = join(baseDir, basename(input, extname(input)) + ".slides");
  mkdirSync(slidesDir, { recursive: true });
  for (const [id, html] of result.sections) {
    await writeSlide(slidesDir, id, html);
  }
  for (const w of result.warnings) process.stderr.write(`⚠ ${w}\n`);
  process.stdout.write(`✓ authored ${result.sections.size} slides\n`);

  const outPath =
    out ?? join(baseDir, basename(input, extname(input)) + ".html");
  try {
    writeFileSync(outPath, sealDeck(outline, { sections: result.sections }), "utf8");
  } catch {
    fail(`cannot write ${outPath}`);
  }
  process.stdout.write(`✓ sealed → ${outPath}\n`);

  if (open) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    import("node:child_process").then(({ spawn }) =>
      spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref(),
    );
  }
}
```

Update `main` to dispatch `build`:
```ts
function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args[0] === "ingest") {
    void runIngest(args.slice(1));
    return;
  }
  if (args[0] === "build") {
    void runBuild(args.slice(1));
    return;
  }
  runSeal(args);
}
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `bunx vitest run tests/render/build-cli.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Full verification**

Run: `bunx vitest run` — ALL green (existing seal/ingest CLI tests unaffected; the build pre-LLM paths fail before browser/LLM).
Run: `bunx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/render/index.ts src/export/index.ts src/agent/index.ts src/cli.ts tests/render/build-cli.test.ts
git commit -m "feat: mindsizer build subcommand (author → fit-check → seal)"
```

---

## Self-Review

**Spec coverage:**
- §3 design brief → Task 3. ✓
- §4 slide author seam → Task 4 (interface) + Task 6 (live impl). ✓
- §5 fit-check (validated technique) → Task 2. ✓
- §6 build loop → Task 4. ✓
- §7 build orchestrator + per-slide files → Task 5 (orchestrator) + Task 8 (CLI writes `<base>.slides/<id>.html`). ✓
- §8 seal integration → Task 7. ✓
- §9 `build` command → Task 8. ✓
- §10 file structure (+ `query.ts` extraction, fit-check kept out of barrel) → Tasks 1, 8. ✓
- §11 testing (design-brief, build-slide, build-deck with fakes; fit-check integration; seal; CLI pre-LLM; slide-author typecheck-only) → Tasks 2–8. ✓
- Out-of-scope (vision, UI, two-gesture edits, PNG) → correctly absent. ✓

**Placeholder scan:** No TBD/TODO; complete code in every code step; the only untested item (`slide-author.ts`) is deliberate + typecheck-gated. ✓

**Type consistency:** `AuthorRequest`/`Prompt` (Task 3) used by `build-slide` (Task 4), `slide-author` (Task 6). `SlideAuthor`/`BuildSlideDeps`/`BuiltSlide` (Task 4) used by `build-deck` (Task 5), `slide-author` (Task 6). `FitChecker`/`FitResult` (Task 2) imported as types by `build-slide` (Task 4, `import type` so no Playwright at runtime) and used by `fit-check` test. `buildDeck`/`BuildDeckResult` (Task 5) used by the CLI (Task 8). `sealDeck(outline, {sections})` + `readFieldCss` (Task 7) match the CLI's calls (Task 8). `runQuery` (Task 1) used by `anthropic-client` (Task 1) + `slide-author` (Task 6). `writeSlide`/`fontFaceCss`/`anthropicSlideAuthor`/`playwrightFitChecker` imports in Task 8 match their definitions. ✓
