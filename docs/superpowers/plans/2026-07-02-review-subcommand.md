# `mindsizer review` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A findings-only `mindsizer review <outline.md>` subcommand that renders every sealed slide, looks at it with a review-tier model (exercising interactive controls), cross-checks content against the source, runs a whole-deck coherence pass, and writes a prioritized report.

**Architecture:** An agentic reviewer per slide reusing the author's `runAgentic` render-tool loop, pointed at fixed sealed fragments via two small generalizations (`initialHtml` seeding; interaction-only re-render). A pure `extract-deck` splitter feeds it from the sealed deck; a text-only coherence pass and a pure report module complete the pipeline, wired by `runReview` in the CLI.

**Tech Stack:** TypeScript on Bun, vitest (`bun run test`), zod, node-html-parser, Playwright renderer (existing), Claude Agent SDK via existing `runAgentic`/`runQuery`.

**Spec:** `docs/superpowers/specs/2026-07-02-review-subcommand-design.md`

**Branch:** work on `feat/review-subcommand` off `main`.

## File map

| File | Change |
|---|---|
| `src/agent/edit-ops.ts` | re-render-as-is rule in `resolveRenderInput` |
| `src/agent/query.ts` | `runAgentic` gains `opts.initialHtml` |
| `src/agent/models.ts` | new `review` role |
| `src/review/findings.ts` | **create** — shared Finding types + zod schemas |
| `src/review/extract-deck.ts` | **create** — sealed-deck splitter (pure) |
| `src/review/slide-review.ts` | **create** — per-slide agentic reviewer |
| `src/review/deck-review.ts` | **create** — coherence pass (text-only) |
| `src/review/report.ts` | **create** — findings → terminal/md/json (pure) |
| `src/cli.ts` | `runReview` + family-based cost labels |
| `tests/agent/edit-ops.test.ts`, `tests/agent/models.test.ts` | extend |
| `tests/review/{extract-deck,slide-review,deck-review,report}.test.ts` | **create** |

---

### Task 1: re-render-as-is rule in edit-ops

**Files:**
- Modify: `src/agent/edit-ops.ts` (`resolveRenderInput`)
- Test: `tests/agent/edit-ops.test.ts`

- [ ] **Step 1: Update the tests.** In `tests/agent/edit-ops.test.ts`, the existing test `"neither html nor edits → helpful error"` asserts an error when `lastHtml` exists — that behavior is changing. REPLACE that test with these two:

```ts
  it("neither html nor edits with a previous render → re-renders it as-is", () => {
    expect(resolveRenderInput("<p>a</p>", {})).toEqual({ ok: true, html: "<p>a</p>" });
  });

  it("neither html nor edits and no previous render → helpful error", () => {
    const r = resolveRenderInput(undefined, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/provide `html`.*or `edits`/);
  });
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `bunx vitest run tests/agent/edit-ops.test.ts`
Expected: FAIL — re-render case currently returns the error object.

- [ ] **Step 3: Implement.** In `src/agent/edit-ops.ts`, replace the final line of `resolveRenderInput`:

```ts
  if (lastHtml !== undefined) return { ok: true, html: lastHtml };
  return { ok: false, error: "provide `html` (full slide) or `edits` (find/replace on your last-rendered html)" };
```

Also update the function's JSDoc to: `/** Resolve a render call's input: full \`html\` wins; \`edits\` patch the last-rendered html; neither re-renders it as-is. */`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/agent/edit-ops.test.ts && bun run test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/edit-ops.ts tests/agent/edit-ops.test.ts
git commit -m "feat(agent): interaction-only render calls re-render the last html as-is"
```

---

### Task 2: `runAgentic` accepts `opts.initialHtml`

**Files:**
- Modify: `src/agent/query.ts` (`runAgentic` signature + `lastHtml` init)

- [ ] **Step 1: Implement.** In `src/agent/query.ts`, change `runAgentic`'s signature:

```ts
export async function runAgentic(
  systemPrompt: string,
  userPrompt: string,
  tools: AgenticTools,
  choice?: ModelChoice,
  opts?: { initialHtml?: string },
): Promise<{ text: string; usage: TokenUsage }> {
```

and change the state initialization from `let lastHtml: string | undefined;` to:

```ts
  let lastHtml: string | undefined = opts?.initialHtml;
```

Nothing else changes — with Task 1, a first tool call carrying only `interactions` now resolves to the seeded html.

- [ ] **Step 2: Verify**

Run: `bun run test && bunx tsc --noEmit`
Expected: ALL PASS / clean (existing callers pass no `opts`; behavior unchanged for them).

- [ ] **Step 3: Commit**

```bash
git add src/agent/query.ts
git commit -m "feat(agent): runAgentic can seed the render tool with initialHtml"
```

---

### Task 3: `review` model role

**Files:**
- Modify: `src/agent/models.ts`
- Test: `tests/agent/models.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `tests/agent/models.test.ts` (match the file's existing style — it tests `modelFor` with env objects):

```ts
describe("review role", () => {
  it("defaults to the author-tier model at medium effort", () => {
    expect(modelFor("review", {})).toEqual({ model: "claude-opus-4-8", effort: "medium" });
  });
  it("honors MINDSIZER_REVIEW_MODEL and MINDSIZER_REVIEW_EFFORT", () => {
    expect(modelFor("review", { MINDSIZER_REVIEW_MODEL: "claude-sonnet-5", MINDSIZER_REVIEW_EFFORT: "low" }))
      .toEqual({ model: "claude-sonnet-5", effort: "low" });
  });
  it("falls back to legacy MINDSIZER_MODEL", () => {
    expect(modelFor("review", { MINDSIZER_MODEL: "claude-fable-5" }).model).toBe("claude-fable-5");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/agent/models.test.ts`
Expected: FAIL — `"review"` is not a valid `Role`.

- [ ] **Step 3: Implement.** In `src/agent/models.ts`:

```ts
export type Role = "author" | "ingest" | "judge" | "review";
```

add to `DEFAULTS`:

```ts
  review: { model: "claude-opus-4-8", effort: "medium" },
```

and to `ROLE_KEY`:

```ts
  review: "REVIEW",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/agent/models.test.ts && bun run test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/models.ts tests/agent/models.test.ts
git commit -m "feat(agent): review model role (author-tier default, env-overridable)"
```

---

### Task 4: shared findings types + schemas

**Files:**
- Create: `src/review/findings.ts`
- Test: `tests/review/findings.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/review/findings.test.ts`:

```ts
// tests/review/findings.test.ts
import { describe, it, expect } from "vitest";
import { SlideFindingsSchema, CoherenceFindingsSchema } from "../../src/review/findings";

describe("SlideFindingsSchema", () => {
  it("accepts a valid findings payload", () => {
    const v = SlideFindingsSchema.parse({
      findings: [
        { check: "visual", severity: "high", summary: "s", detail: "d", suggestion: "fix" },
        { check: "content", severity: "low", summary: "s2", detail: "d2", suggestion: "fix2" },
      ],
    });
    expect(v.findings).toHaveLength(2);
  });
  it("accepts an empty findings list (slide passes)", () => {
    expect(SlideFindingsSchema.parse({ findings: [] }).findings).toEqual([]);
  });
  it("rejects unknown check kinds and severities", () => {
    expect(() => SlideFindingsSchema.parse({ findings: [{ check: "vibes", severity: "high", summary: "", detail: "", suggestion: "" }] })).toThrow();
    expect(() => SlideFindingsSchema.parse({ findings: [{ check: "visual", severity: "fatal", summary: "", detail: "", suggestion: "" }] })).toThrow();
  });
});

describe("CoherenceFindingsSchema", () => {
  it("accepts findings with a slideId or null", () => {
    const v = CoherenceFindingsSchema.parse({
      findings: [
        { slideId: "s_a", check: "coherence", severity: "medium", summary: "s", detail: "d", suggestion: "x" },
        { slideId: null, check: "coherence", severity: "low", summary: "s", detail: "d", suggestion: "x" },
      ],
    });
    expect(v.findings[1].slideId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/review/findings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement.** Create `src/review/findings.ts`:

```ts
// src/review/findings.ts
import { z } from "zod";

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

const FindingBase = {
  severity: z.enum(SEVERITIES),
  summary: z.string(),
  detail: z.string(),
  suggestion: z.string(),
};

/** One per-slide finding from the visual/interaction/content reviewer. */
export const SlideFindingSchema = z.object({ check: z.enum(["visual", "interaction", "content"]), ...FindingBase });
export type SlideFinding = z.infer<typeof SlideFindingSchema>;
export const SlideFindingsSchema = z.object({ findings: z.array(SlideFindingSchema) });

/** One whole-deck finding from the coherence pass (slideId null = deck-level). */
export const CoherenceFindingSchema = z.object({ slideId: z.string().nullable(), check: z.literal("coherence"), ...FindingBase });
export type CoherenceFinding = z.infer<typeof CoherenceFindingSchema>;
export const CoherenceFindingsSchema = z.object({ findings: z.array(CoherenceFindingSchema) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/review/findings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review/findings.ts tests/review/findings.test.ts
git commit -m "feat(review): shared finding types + zod schemas"
```

---

### Task 5: sealed-deck splitter

**Files:**
- Create: `src/review/extract-deck.ts`
- Test: `tests/review/extract-deck.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/review/extract-deck.test.ts`:

```ts
// tests/review/extract-deck.test.ts
import { describe, it, expect } from "vitest";
import { extractSlides } from "../../src/review/extract-deck";
import { sealDeck } from "../../src/export/index";
import type { Outline } from "../../src/outline/types";

const outline: Outline = {
  meta: { title: "D", purpose: "teach", theme: "field" },
  slides: [
    { id: "s_a", layout: "bespoke", title: "A", markdown: "a" },
    { id: "s_b", layout: "bespoke", title: "B", markdown: "b" },
    { id: "s_c", layout: "bespoke", title: "C", markdown: "c" },
  ],
};
const frag = (id: string, opts: { style?: boolean; script?: boolean } = {}) =>
  (opts.style ? `<style>#${id} .x{color:red}</style>\n` : "") +
  `<section data-slide-id="${id}" data-layout="bespoke">Body of ${id} with plenty of words to look like a real slide.</section>` +
  (opts.script ? `\n<script>(function(){/* ${id} */})();</script>` : "");

describe("extractSlides", () => {
  it("round-trips a sealDeck deck: one fragment per slide, style+script attached to the right slide", () => {
    const sections = new Map([
      ["s_a", frag("s_a", { style: true, script: true })],
      ["s_b", frag("s_b")], // style-less, script-less
      ["s_c", frag("s_c", { style: true })],
    ]);
    const deck = sealDeck(outline, { sections });
    const out = extractSlides(deck);
    expect(out.map((s) => s.id)).toEqual(["s_a", "s_b", "s_c"]);
    expect(out[0].fragment).toContain("#s_a .x");
    expect(out[0].fragment).toContain("/* s_a */");
    expect(out[1].fragment).not.toContain("<style>");
    expect(out[2].fragment).toContain("#s_c .x");
    expect(out[2].fragment).not.toContain("/* s_a */"); // s_a's script must not leak forward
  });

  it("survives hand-edited whitespace and comments between slides", () => {
    const sections = new Map([
      ["s_a", frag("s_a", { style: true }) + "\n<!-- edited by hand -->\n"],
      ["s_b", frag("s_b", { script: true })],
      ["s_c", frag("s_c")],
    ]);
    const deck = sealDeck(outline, { sections });
    const out = extractSlides(deck);
    expect(out.map((s) => s.id)).toEqual(["s_a", "s_b", "s_c"]);
    expect(out[1].fragment).toContain("<script>");
  });

  it("does not swallow the deck's own nav script or css", () => {
    const deck = sealDeck(outline, { sections: new Map([["s_a", frag("s_a")], ["s_b", frag("s_b")], ["s_c", frag("s_c", { script: true })]]) });
    const out = extractSlides(deck);
    for (const s of out) expect(s.fragment).not.toMatch(/deck-progress|is-active/);
  });

  it("returns [] for html with no slide sections", () => {
    expect(extractSlides("<html><body><p>nope</p></body></html>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/review/extract-deck.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement.** Create `src/review/extract-deck.ts`:

```ts
// src/review/extract-deck.ts
import { parse, type HTMLElement } from "node-html-parser";

export interface DeckSlide { id: string; fragment: string }

/**
 * Split a sealed deck into per-slide fragments: each slide's id-scoped <style> block(s),
 * its <section data-slide-id>, and its trailing <script> block(s), in document order.
 * Grouping rule over `.deck`'s child elements: a <style> starts a new group when the current
 * group already has its <section>; the deck-level nav script lives OUTSIDE `.deck`, so it is
 * never visited. Non-element noise (text, comments) between slides is ignored.
 */
export function extractSlides(deckHtml: string): DeckSlide[] {
  const root = parse(deckHtml);
  const deck = root.querySelector(".deck");
  if (!deck) return [];

  const out: DeckSlide[] = [];
  let buf: HTMLElement[] = [];
  let section: HTMLElement | null = null;

  const flush = () => {
    if (!section) { buf = []; return; }
    const id = section.getAttribute("data-slide-id");
    if (id) out.push({ id, fragment: buf.map((n) => n.toString()).join("\n") });
    buf = [];
    section = null;
  };

  for (const node of deck.childNodes) {
    const el = node as HTMLElement;
    if (typeof el.tagName !== "string" || !el.tagName) continue; // skip text/comment nodes
    const tag = el.tagName.toUpperCase();
    if (tag === "STYLE" && section) flush();          // a style after a section opens the next slide
    if (tag === "SECTION") {
      if (section) flush();                            // back-to-back sections (style-less slide)
      section = el;
    }
    if (tag === "STYLE" || tag === "SECTION" || tag === "SCRIPT") buf.push(el);
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/review/extract-deck.test.ts && bun run test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review/extract-deck.ts tests/review/extract-deck.test.ts
git commit -m "feat(review): extract per-slide fragments from a sealed deck"
```

---

### Task 6: per-slide agentic reviewer

**Files:**
- Create: `src/review/slide-review.ts`
- Test: `tests/review/slide-review.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/review/slide-review.test.ts` (module-mock pattern from `tests/agent/agentic-author.test.ts`):

```ts
// tests/review/slide-review.test.ts
import { describe, it, expect, vi } from "vitest";
import type { AgenticTools } from "../../src/agent/query";

let script: (tools: AgenticTools, opts?: { initialHtml?: string }) => Promise<string>;
const calls: { system: string; user: string; opts?: { initialHtml?: string } }[] = [];

vi.mock("../../src/agent/query", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/agent/query")>();
  return {
    ...mod,
    runAgentic: vi.fn(async (system: string, user: string, tools: AgenticTools, _choice: unknown, opts?: { initialHtml?: string }) => {
      calls.push({ system, user, opts });
      const text = await script(tools, opts);
      return { text, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } };
    }),
  };
});

import { slideReviewer, REVIEW_RENDER_CAP } from "../../src/review/slide-review";

const FRAGMENT = `<style>#s_t{color:red}</style><section data-slide-id="s_t">real body</section>`;
const req = { id: "s_t", title: "T", angle: "the angle", digest: ["p1"], sourceExcerpt: "the source", fragment: FRAGMENT };
const shot = { shots: [Buffer.from("png")], overflowPx: 0, fits: true, consoleErrors: [] };
const renderer = { render: vi.fn(async () => shot) };

describe("slideReviewer", () => {
  it("seeds the fragment, forwards interactions to the renderer, and returns parsed findings", async () => {
    calls.length = 0;
    script = async (tools) => {
      const r = await tools.render(FRAGMENT, [{ click: "#btn" }]);
      expect("images" in r).toBe(true);
      return JSON.stringify({ findings: [{ check: "visual", severity: "medium", summary: "dead space", detail: "band", suggestion: "tighten" }] });
    };
    const findings = await slideReviewer(renderer)(req);
    expect(calls[0].opts?.initialHtml).toBe(FRAGMENT);
    expect(calls[0].user).toContain("the source");
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("visual");
  });

  it("returns [] for an empty findings payload", async () => {
    script = async () => JSON.stringify({ findings: [] });
    expect(await slideReviewer(renderer)(req)).toEqual([]);
  });

  it("caps render calls and returns the budget message after the cap", async () => {
    script = async (tools) => {
      let budgetMsg = "";
      for (let i = 0; i < REVIEW_RENDER_CAP + 2; i++) {
        const r = await tools.render(FRAGMENT);
        if ("text" in r && /budget/i.test(r.text)) budgetMsg = r.text;
      }
      expect(budgetMsg).toMatch(/write your findings/i);
      return JSON.stringify({ findings: [] });
    };
    const rc = { render: vi.fn(async () => shot) };
    await slideReviewer(rc)(req);
    expect(rc.render).toHaveBeenCalledTimes(REVIEW_RENDER_CAP);
  });

  it("retries the session once when the final text is not valid findings JSON", async () => {
    let attempt = 0;
    script = async () => (++attempt === 1 ? "sorry, here are my thoughts…" : JSON.stringify({ findings: [] }));
    expect(await slideReviewer(renderer)(req)).toEqual([]);
    expect(attempt).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/review/slide-review.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement.** Create `src/review/slide-review.ts`:

```ts
// src/review/slide-review.ts
import { runAgentic, type AgenticTools, type RenderToolResult } from "../agent/query";
import { modelFor } from "../agent/models";
import { parseValidated } from "../agent/json";
import { SlideFindingsSchema, type SlideFinding } from "./findings";
import type { SlideRenderer } from "../render/fit-check";

/** Hard cap on render calls per review session (resting state + interaction states). */
export const REVIEW_RENDER_CAP = 6;

export interface SlideReviewRequest {
  id: string;
  title: string;
  angle: string;
  digest: string[];
  sourceExcerpt?: string;
  fragment: string;
}

const SYSTEM = [
  "You are mindsizer's slide REVIEWER. You are looking at ONE sealed slide from a finished deck.",
  "You do NOT redesign or rewrite — you report findings a fixer can act on. Empty findings = the slide passes.",
  "",
  "## What to check",
  "VISUAL — the slide must fit 1280x720 with no clipped content; no large dead-space bands; clear hierarchy;",
  "on-theme (calm instrument aesthetic, not a landing page). Look at the screenshot, not just the code.",
  "INTERACTION — read the fragment for controls (buttons, sliders, toggles). Exercise the meaningful ones via",
  "the render tool's `interactions` (click a selector, wait). A control must respond VISIBLY; flag dead controls",
  "and feedback so subtle a presenter would miss it.",
  "CONTENT — compare the slide's claims, examples, numbers and names against the source excerpt and digest.",
  "Flag fabricated specifics, drifted details, and claims the source does not support. Analogies and framing",
  "are the deck's own voice — only flag them when they distort the source's meaning.",
  "",
  "## Severity",
  "high = wrong, broken, or unreadable (content contradicts source; control dead; text clipped).",
  "medium = clearly worth fixing (dead-space band; drifted example; invisible feedback).",
  "low = polish (inconsistent labels, minor crowding).",
  "",
  "## Tools & output",
  "Call `render` FIRST with no arguments to see the slide at rest (the harness already has the slide's html —",
  "never send `html` or `edits`). Then, if the slide has controls, call render again passing only `interactions`.",
  `You have at most ${REVIEW_RENDER_CAP} render calls.`,
  'End with EXACTLY this JSON and nothing else: {"findings": [{"check": "visual"|"interaction"|"content",',
  '"severity": "high"|"medium"|"low", "summary": "<one sentence>", "detail": "<what/where>", "suggestion": "<concrete fix>"}]}',
].join("\n");

function userPrompt(req: SlideReviewRequest): string {
  return (
    `Slide id: ${req.id}\nSlide title: ${req.title}\nDeck angle: ${req.angle}\n\n` +
    `Deck digest:\n${req.digest.map((d) => `- ${d}`).join("\n") || "(none)"}\n\n` +
    (req.sourceExcerpt ? `Source (for content fidelity):\n${req.sourceExcerpt}\n\n` : "No source available — SKIP content-fidelity checks.\n\n") +
    `Sealed slide fragment:\n${req.fragment}`
  );
}

/** Review one sealed slide: look, poke the controls, cross-check content. Findings only. */
export function slideReviewer(renderer: Pick<SlideRenderer, "render">): (req: SlideReviewRequest) => Promise<SlideFinding[]> {
  const choice = modelFor("review");
  return async (req) => {
    const runOnce = async (): Promise<SlideFinding[]> => {
      let renders = 0;
      const tools: AgenticTools = {
        render: async (html, interactions): Promise<RenderToolResult> => {
          if (renders >= REVIEW_RENDER_CAP) {
            return { text: `Render budget reached (${REVIEW_RENDER_CAP}) — write your findings JSON now and do NOT call render again.` };
          }
          renders++;
          const r = await renderer.render(html, interactions);
          return { images: r.shots };
        },
      };
      const { text } = await runAgentic(SYSTEM, userPrompt(req), tools, choice, { initialHtml: req.fragment });
      return parseValidated(text, SlideFindingsSchema).findings;
    };
    try {
      return await runOnce();
    } catch {
      return await runOnce(); // one full retry on parse/transport failure; second failure propagates
    }
  };
}
```

Note: `tools.render` receives the RESOLVED html from `runAgentic` (the seeded fragment), so passing it straight to `renderer.render` is correct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/review/slide-review.test.ts && bun run test && bunx tsc --noEmit`
Expected: ALL PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/review/slide-review.ts tests/review/slide-review.test.ts
git commit -m "feat(review): per-slide agentic reviewer (visual + interaction + content)"
```

---

### Task 7: deck coherence pass

**Files:**
- Create: `src/review/deck-review.ts`
- Test: `tests/review/deck-review.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/review/deck-review.test.ts`:

```ts
// tests/review/deck-review.test.ts
import { describe, it, expect, vi } from "vitest";

let reply: string;
const seen: { system: string; user: string }[] = [];

vi.mock("../../src/agent/query", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/agent/query")>();
  return { ...mod, runQuery: vi.fn(async (system: string, user: string) => { seen.push({ system, user }); return reply; }) };
});

import { reviewDeckCoherence } from "../../src/review/deck-review";

const slides = [
  { id: "s_a", title: "A", text: "alpha body text" },
  { id: "s_b", title: "B", text: "beta body text" },
];

describe("reviewDeckCoherence", () => {
  it("sends every slide's title+text and returns parsed findings", async () => {
    seen.length = 0;
    reply = JSON.stringify({ findings: [{ slideId: "s_b", check: "coherence", severity: "low", summary: "dup", detail: "repeats A", suggestion: "merge" }] });
    const out = await reviewDeckCoherence("Deck", "angle", slides);
    expect(seen[0].user).toContain("alpha body text");
    expect(seen[0].user).toContain("beta body text");
    expect(out).toHaveLength(1);
    expect(out[0].slideId).toBe("s_b");
  });

  it("accepts deck-level findings (slideId null) and empty lists", async () => {
    reply = JSON.stringify({ findings: [{ slideId: null, check: "coherence", severity: "medium", summary: "s", detail: "d", suggestion: "x" }] });
    expect((await reviewDeckCoherence("D", "a", slides))[0].slideId).toBeNull();
    reply = JSON.stringify({ findings: [] });
    expect(await reviewDeckCoherence("D", "a", slides)).toEqual([]);
  });

  it("fails open (returns []) when the model reply is unparseable", async () => {
    reply = "not json";
    expect(await reviewDeckCoherence("D", "a", slides)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/review/deck-review.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement.** Create `src/review/deck-review.ts`:

```ts
// src/review/deck-review.ts
import { runQuery } from "../agent/query";
import { modelFor } from "../agent/models";
import { parseValidated } from "../agent/json";
import { CoherenceFindingsSchema, type CoherenceFinding } from "./findings";

export interface CoherenceSlide { id: string; title: string; text: string }

const SYSTEM = [
  "You review a slide DECK as a whole (text only — visuals are reviewed elsewhere).",
  "Check: narrative order (does each slide build on the last?), duplicated ideas across slides,",
  "and terminology/label consistency (e.g. mixed kicker conventions, one slide numbering itself).",
  "Report findings only; empty findings = coherent. severity: high = broken narrative,",
  "medium = clear duplication/inconsistency, low = polish.",
  'End with EXACTLY: {"findings": [{"slideId": "<id>"|null, "check": "coherence", "severity": "high"|"medium"|"low",',
  '"summary": "...", "detail": "...", "suggestion": "..."}]} — slideId null for whole-deck findings.',
].join("\n");

/** Text-only whole-deck coherence pass. Fail-open: unparseable reply → no findings. */
export async function reviewDeckCoherence(deckTitle: string, angle: string, slides: CoherenceSlide[]): Promise<CoherenceFinding[]> {
  const user =
    `Deck: ${deckTitle}\nAngle: ${angle}\n\n` +
    slides.map((s, i) => `## Slide ${i + 1} — ${s.title} (${s.id})\n${s.text}`).join("\n\n");
  try {
    return parseValidated(await runQuery(SYSTEM, user, modelFor("review")), CoherenceFindingsSchema).findings;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/review/deck-review.test.ts && bun run test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review/deck-review.ts tests/review/deck-review.test.ts
git commit -m "feat(review): text-only whole-deck coherence pass"
```

---

### Task 8: report writer

**Files:**
- Create: `src/review/report.ts`
- Test: `tests/review/report.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/review/report.test.ts`:

```ts
// tests/review/report.test.ts
import { describe, it, expect } from "vitest";
import { terminalReport, markdownReport, jsonReport, hasHigh, type ReviewRun } from "../../src/review/report";

const run: ReviewRun = {
  meta: { deck: "/tmp/d.html", source: "/tmp/s.txt", model: "claude-opus-4-8", date: "2026-07-02T00:00:00Z" },
  slides: [
    { id: "s_a", title: "A", findings: [
      { check: "visual", severity: "high", summary: "clipped text", detail: "401px overflow", suggestion: "shrink" },
      { check: "content", severity: "low", summary: "label nit", detail: "…", suggestion: "…" },
    ]},
    { id: "s_b", title: "B", findings: [] },
  ],
  deck: [{ slideId: null, check: "coherence", severity: "medium", summary: "dup idea", detail: "…", suggestion: "…" }],
};

describe("report", () => {
  it("terminal report groups by slide, marks severities, and tallies", () => {
    const t = terminalReport(run);
    expect(t).toContain("s_a");
    expect(t).toMatch(/✗.*clipped text/);
    expect(t).toMatch(/·.*label nit/);
    expect(t).toMatch(/⚠.*dup idea/);
    expect(t).toMatch(/1 high · 1 medium · 1 low/);
    expect(t).toMatch(/s_b.*✓/); // passing slide shown as clean
  });

  it("markdown report includes meta and all findings", () => {
    const m = markdownReport(run);
    expect(m).toContain("claude-opus-4-8");
    expect(m).toContain("401px overflow");
    expect(m).toContain("Deck-level");
  });

  it("json report round-trips the run", () => {
    expect(JSON.parse(jsonReport(run))).toEqual(run);
  });

  it("hasHigh detects high severity anywhere (slides or deck)", () => {
    expect(hasHigh(run)).toBe(true);
    expect(hasHigh({ ...run, slides: [run.slides[1]], deck: [] })).toBe(false);
    expect(hasHigh({ ...run, slides: [], deck: [{ ...run.deck[0], severity: "high" }] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/review/report.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement.** Create `src/review/report.ts`:

```ts
// src/review/report.ts
import type { SlideFinding, CoherenceFinding, Severity } from "./findings";

export interface SlideReviewResult { id: string; title: string; findings: SlideFinding[] }
export interface ReviewRun {
  meta: { deck: string; source: string | null; model: string; date: string };
  slides: SlideReviewResult[];
  deck: CoherenceFinding[];
}

const MARK: Record<Severity, string> = { high: "✗", medium: "⚠", low: "·" };
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const bySeverity = <F extends { severity: Severity }>(fs: F[]): F[] => [...fs].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

function tally(run: ReviewRun): Record<Severity, number> {
  const t: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const s of run.slides) for (const f of s.findings) t[f.severity]++;
  for (const f of run.deck) t[f.severity]++;
  return t;
}

/** True if any finding (per-slide or deck-level) is high severity. */
export function hasHigh(run: ReviewRun): boolean {
  return run.slides.some((s) => s.findings.some((f) => f.severity === "high")) || run.deck.some((f) => f.severity === "high");
}

export function terminalReport(run: ReviewRun): string {
  const lines: string[] = [];
  for (const s of run.slides) {
    if (!s.findings.length) { lines.push(`${s.id} — ${s.title}  ✓`); continue; }
    lines.push(`${s.id} — ${s.title}`);
    for (const f of bySeverity(s.findings)) lines.push(`  ${MARK[f.severity]} [${f.check}] ${f.summary} — ${f.detail}`);
  }
  if (run.deck.length) {
    lines.push("deck-level");
    for (const f of bySeverity(run.deck)) lines.push(`  ${MARK[f.severity]} [coherence${f.slideId ? ` · ${f.slideId}` : ""}] ${f.summary} — ${f.detail}`);
  }
  const t = tally(run);
  lines.push(`${t.high} high · ${t.medium} medium · ${t.low} low across ${run.slides.length} slides`);
  return lines.join("\n");
}

export function markdownReport(run: ReviewRun): string {
  const lines = [
    `# Deck review — ${run.meta.deck}`,
    "",
    `- date: ${run.meta.date}`,
    `- model: ${run.meta.model}`,
    `- source: ${run.meta.source ?? "(none — content fidelity skipped)"}`,
    "",
  ];
  for (const s of run.slides) {
    lines.push(`## ${s.title} (\`${s.id}\`)`, "");
    if (!s.findings.length) { lines.push("Passes.", ""); continue; }
    for (const f of bySeverity(s.findings)) lines.push(`- **${f.severity}** [${f.check}] ${f.summary}`, `  - ${f.detail}`, `  - fix: ${f.suggestion}`);
    lines.push("");
  }
  lines.push("## Deck-level", "");
  if (!run.deck.length) lines.push("Coherent.", "");
  else for (const f of bySeverity(run.deck)) lines.push(`- **${f.severity}**${f.slideId ? ` (${f.slideId})` : ""} ${f.summary}`, `  - ${f.detail}`, `  - fix: ${f.suggestion}`);
  const t = tally(run);
  lines.push("", `**${t.high} high · ${t.medium} medium · ${t.low} low**`);
  return lines.join("\n");
}

export function jsonReport(run: ReviewRun): string {
  return JSON.stringify(run, null, 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/review/report.test.ts && bun run test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/review/report.ts tests/review/report.test.ts
git commit -m "feat(review): findings report — terminal, markdown, json + exit-code predicate"
```

---

### Task 9: CLI `runReview` + cost-label fix

**Files:**
- Modify: `src/cli.ts` (new `runReview`, dispatch in `main`, `printCost` labels)

No new unit tests (cli functions are unexported, matching the existing commands); verification is the full suite, typecheck, and a usage smoke test.

- [ ] **Step 1: Fix the cost labels.** In `src/cli.ts` `printCost`, replace the `label` function (roles are no longer 1:1 with families now that review shares the author tier):

```ts
  const label = (m: string) => (m.includes("haiku") ? "Haiku" : m.includes("sonnet") ? "Sonnet" : m.includes("fable") || m.includes("mythos") ? "Fable" : "Opus");
```

- [ ] **Step 2: Add `runReview`.** In `src/cli.ts`, add imports:

```ts
import { extractSlides } from "./review/extract-deck";
import { slideReviewer, type SlideReviewRequest } from "./review/slide-review";
import { reviewDeckCoherence } from "./review/deck-review";
import { terminalReport, markdownReport, jsonReport, hasHigh, type ReviewRun, type SlideReviewResult } from "./review/report";
import { slideText } from "./render/content-gate";
import { mapPool } from "./render/pool";
import { modelFor } from "./agent/models";
```

then add the command (after `runBuild`):

```ts
const SOURCE_CAP = 12_000; // chars of source text fed to each fidelity check

async function runReview(args: string[]): Promise<void> {
  let input: string | undefined;
  let deckPath: string | undefined;
  let json = false;
  const envC = Number(process.env.MINDSIZER_CONCURRENCY);
  let concurrency = Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--deck") {
      deckPath = args[++k];
      if (!deckPath) fail("--deck requires a path");
    } else if (a === "--json") {
      json = true;
    } else if (a === "--concurrency" || a === "-c") {
      const v = Number(args[++k]);
      if (!Number.isFinite(v) || v < 1) fail("--concurrency requires an integer ≥ 1");
      concurrency = Math.floor(v);
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }
  if (!input) fail("usage: mindsizer review <outline.md> [--deck <deck.html>] [--json] [--concurrency <n>]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }
  const outline = parseOutline(md);

  let theme;
  try {
    theme = loadTheme(outline.meta.theme ?? "field");
  } catch (e) {
    fail((e as Error).message);
  }

  const baseDir = dirname(resolve(input));
  const stem = basename(input, extname(input));
  const deck = deckPath ? resolve(deckPath) : join(baseDir, stem + ".html");
  let deckHtml: string;
  try {
    deckHtml = readFileSync(deck, "utf8");
  } catch {
    fail(`cannot read deck ${deck} — build it first or pass --deck`);
  }
  const fragments = extractSlides(deckHtml);
  if (fragments.length === 0) fail(`no slides found in ${deck}`);

  // sidecar → digest/angle/source; each rung degrades with a notice
  let digest: string[] = [];
  let angle = "";
  let sourceExcerpt: string | undefined;
  let sourcePath: string | null = null;
  try {
    const ctx = parseContext(readFileSync(sidecarPath(resolve(input)), "utf8"));
    if (ctx) {
      digest = ctx.digest;
      angle = ctx.angle;
      if (ctx.sourcePath) {
        try {
          const full = readFileSync(ctx.sourcePath, "utf8");
          sourcePath = ctx.sourcePath;
          sourceExcerpt = full.length > SOURCE_CAP ? full.slice(0, SOURCE_CAP) + "\n[…source truncated…]" : full;
        } catch {
          process.stdout.write("· source file unreadable — fidelity checks fall back to the digest\n");
        }
      }
    }
  } catch {
    process.stdout.write("· no context sidecar — reviewing visuals + interactions + coherence only\n");
  }

  process.stdout.write(`reviewing ${outline.slides.length} slides… (model: ${modelFor("review").model})\n`);
  resetUsage();
  const renderer = playwrightRenderer(theme.fontFaceCss + "\n" + theme.css);
  const byId = new Map(fragments.map((f) => [f.id, f.fragment]));
  const review = slideReviewer(renderer);

  let slideResults: SlideReviewResult[];
  let deckFindings: Awaited<ReturnType<typeof reviewDeckCoherence>>;
  try {
    const slidesP = mapPool(outline.slides, concurrency, async (s): Promise<SlideReviewResult> => {
      const fragment = byId.get(s.id);
      if (!fragment) {
        return { id: s.id, title: s.title, findings: [{ check: "visual", severity: "high", summary: "slide missing from deck", detail: `no <section data-slide-id="${s.id}"> in ${deck}`, suggestion: "rebuild the deck" }] };
      }
      const reqData: SlideReviewRequest = { id: s.id, title: s.title, angle, digest, sourceExcerpt, fragment };
      process.stdout.write(`[${s.id}] reviewing…\n`);
      return { id: s.id, title: s.title, findings: await review(reqData) };
    });
    const coherenceP = reviewDeckCoherence(
      outline.meta.title,
      angle,
      fragments.map((f) => ({ id: f.id, title: outline.slides.find((s) => s.id === f.id)?.title ?? f.id, text: slideText(f.fragment) })),
    );
    const [pool, coherence] = await Promise.all([slidesP, coherenceP]);
    deckFindings = coherence;
    slideResults = pool.map((r, i) =>
      r.ok
        ? r.value
        : { id: outline.slides[i].id, title: outline.slides[i].title, findings: [{ check: "visual" as const, severity: "high" as const, summary: "review failed", detail: String((r.error as Error)?.message ?? r.error), suggestion: "re-run review" }] },
    );
  } finally {
    await renderer.dispose().catch(() => {});
  }

  // sections present in the deck but absent from the outline are a structural mismatch
  const outlineIds = new Set(outline.slides.map((s) => s.id));
  for (const f of fragments) {
    if (!outlineIds.has(f.id)) {
      deckFindings.push({ slideId: f.id, check: "coherence", severity: "high", summary: "deck section not in outline", detail: `<section data-slide-id="${f.id}"> has no outline slide`, suggestion: "rebuild the deck from this outline, or review against the right outline" });
    }
  }

  const run: ReviewRun = {
    meta: { deck, source: sourcePath, model: modelFor("review").model, date: new Date().toISOString() },
    slides: slideResults,
    deck: deckFindings,
  };

  const reportBase = deck.replace(/\.html$/i, "");
  writeFileSync(reportBase + ".review.md", markdownReport(run), "utf8");
  process.stdout.write(`✓ wrote ${reportBase}.review.md\n`);
  if (json) {
    writeFileSync(reportBase + ".review.json", jsonReport(run), "utf8");
    process.stdout.write(`✓ wrote ${reportBase}.review.json\n`);
  }
  process.stdout.write("\n" + terminalReport(run) + "\n");
  printCost();
  if (hasHigh(run)) process.exitCode = 1;
}
```

- [ ] **Step 3: Dispatch it.** In `main`, before the `runSeal` fallback:

```ts
  if (args[0] === "review") {
    void runReview(args.slice(1));
    return;
  }
```

- [ ] **Step 4: Verify**

Run: `bun run test && bunx tsc --noEmit`
Expected: ALL PASS / clean.
Run: `bun run src/cli.ts review 2>&1 | head -2`
Expected: `error: usage: mindsizer review <outline.md> [--deck <deck.html>] [--json] [--concurrency <n>]`

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): mindsizer review — findings-only deck review + family cost labels"
```

---

### Task 10: full verification

- [ ] **Step 1: Full suite + typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 2: Usage smoke**

Run: `bun run src/cli.ts 2>&1 | head -2` (seal usage) and `bun run src/cli.ts review 2>&1 | head -2` (review usage)
Expected: both print usage lines, no import errors.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — merge `feat/review-subcommand` to `main` per repo convention.

**Post-merge validation (manual, costs tokens):** `mindsizer review ~/Downloads/understand-ai.outline.md --deck ~/Downloads/understand-ai.outline.html --json` — expect it to re-find the classes of issue fixed by hand on 2026-07-02 to be absent, produce a sensible report, and exit 0 (or 1 with justified highs).
