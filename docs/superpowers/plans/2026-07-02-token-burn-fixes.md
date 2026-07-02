# Token-Burn Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut mindsizer build token burn by seeding content-dud retries with the rejected HTML, making finalize a one-word "DONE" reply, and letting revision render passes send find/replace edits instead of full slide HTML.

**Architecture:** Three independent fixes behind existing seams. (A) `ContentDudError` carries the rejected html through `withRetry` into the next attempt's prompt. (B) The finalize messages in the render-tool callback stop demanding full HTML (the harness already seals `pickBestCandidate(...).html`). (C) A pure `edit-ops` module resolves `{html? , edits?}` render-tool input to full HTML inside `runAgentic`, so `AgenticTools.render`, `Candidate.html`, and all of converge stay untouched.

**Tech Stack:** TypeScript on Bun, vitest (`bun run test` = `vitest run`), zod schemas for the Claude Agent SDK tool.

**Spec:** `docs/superpowers/specs/2026-07-02-token-burn-fixes-design.md`

**Branch:** work on `feat/token-burn-fixes` off `main`.

## File map

| File | Change |
|---|---|
| `src/agent/edit-ops.ts` | **create** — pure `applyEdits` + `resolveRenderInput` |
| `src/agent/query.ts` | render tool: optional `html`, new `edits`, `lastHtml` session state |
| `src/render/converge.ts` | exported finalize message constants (DONE wording) |
| `src/agent/agentic-author.ts` | use the finalize constants |
| `src/render/design-brief.ts` | EYES + output-contract wording; `RepairSeed`; repair prompt section |
| `src/render/content-gate.ts` | `ContentDudError` class |
| `src/render/build-slide.ts` | throw `ContentDudError`; forward `repair` seed |
| `src/render/build-deck.ts` | capture dud → seed next attempt |
| `tests/agent/edit-ops.test.ts` | **create** |
| `tests/render/{converge,design-brief,content-gate,build-slide,build-deck}.test.ts` | extend |

---

### Task 1: edit-ops module (pure find/replace resolution)

**Files:**
- Create: `src/agent/edit-ops.ts`
- Test: `tests/agent/edit-ops.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/edit-ops.test.ts`:

```ts
// tests/agent/edit-ops.test.ts
import { describe, it, expect } from "vitest";
import { applyEdits, resolveRenderInput } from "../../src/agent/edit-ops";

const BASE = `<style>#s .t{font-size:28px}</style><section id="s"><h1>Title</h1><p>Body text</p></section>`;

describe("applyEdits", () => {
  it("applies a single unique edit", () => {
    const r = applyEdits(BASE, [{ old: "font-size:28px", new: "font-size:24px" }]);
    expect(r).toEqual({ ok: true, html: BASE.replace("font-size:28px", "font-size:24px") });
  });

  it("applies edits sequentially, later edits seeing earlier results", () => {
    const r = applyEdits("aaa-bbb", [
      { old: "bbb", new: "ccc" },
      { old: "aaa-ccc", new: "done" },
    ]);
    expect(r).toEqual({ ok: true, html: "done" });
  });

  it("fails when old is not found, naming the edit", () => {
    const r = applyEdits(BASE, [{ old: "nope", new: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/edit #1.*not found/);
  });

  it("fails when old is not unique, naming the edit", () => {
    const bad = applyEdits("dup dup", [{ old: "dup", new: "x" }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/edit #1.*more than once/);
  });

  it("fails on an empty old string", () => {
    const r = applyEdits(BASE, [{ old: "", new: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/edit #1.*empty/);
  });

  it("no edits → base unchanged", () => {
    expect(applyEdits(BASE, [])).toEqual({ ok: true, html: BASE });
  });
});

describe("resolveRenderInput", () => {
  it("full html wins and is returned as-is", () => {
    const r = resolveRenderInput("old", { html: "<section>new</section>" });
    expect(r).toEqual({ ok: true, html: "<section>new</section>" });
  });

  it("edits apply against the last html", () => {
    const r = resolveRenderInput("<p>a</p>", { edits: [{ old: "a", new: "b" }] });
    expect(r).toEqual({ ok: true, html: "<p>b</p>" });
  });

  it("edits before any render → helpful error", () => {
    const r = resolveRenderInput(undefined, { edits: [{ old: "a", new: "b" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no previous render/);
  });

  it("neither html nor edits → helpful error", () => {
    const r = resolveRenderInput("<p>a</p>", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/provide `html`.*or `edits`/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/agent/edit-ops.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/edit-ops`.

- [ ] **Step 3: Implement the module**

Create `src/agent/edit-ops.ts`:

```ts
// src/agent/edit-ops.ts
export interface RenderEdit { old: string; new: string }
export type Resolved = { ok: true; html: string } | { ok: false; error: string };

/** Apply find/replace edits sequentially; each `old` must match EXACTLY ONCE in the current text. */
export function applyEdits(base: string, edits: RenderEdit[]): Resolved {
  let html = base;
  for (let i = 0; i < edits.length; i++) {
    const { old } = edits[i];
    if (!old) return { ok: false, error: `edit #${i + 1}: \`old\` is empty — include the exact text to replace` };
    const first = html.indexOf(old);
    if (first === -1) return { ok: false, error: `edit #${i + 1}: old string not found in the last-rendered html` };
    if (html.indexOf(old, first + 1) !== -1) {
      return { ok: false, error: `edit #${i + 1}: old string appears more than once — include more surrounding context to make it unique` };
    }
    html = html.slice(0, first) + edits[i].new + html.slice(first + old.length);
  }
  return { ok: true, html };
}

/** Resolve a render call's input: full `html` wins; otherwise `edits` against the last-rendered html. */
export function resolveRenderInput(
  lastHtml: string | undefined,
  args: { html?: string; edits?: RenderEdit[] },
): Resolved {
  if (args.html) return { ok: true, html: args.html };
  if (args.edits?.length) {
    if (lastHtml === undefined) return { ok: false, error: "no previous render to edit — send full `html` first" };
    return applyEdits(lastHtml, args.edits);
  }
  return { ok: false, error: "provide `html` (full slide) or `edits` (find/replace on your last-rendered html)" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/agent/edit-ops.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/edit-ops.ts tests/agent/edit-ops.test.ts
git commit -m "feat(agent): edit-ops — resolve render-tool {html|edits} input to full html"
```

---

### Task 2: render tool accepts `edits` (query.ts wiring)

**Files:**
- Modify: `src/agent/query.ts:79-101` (tool definition inside `runAgentic`)

The resolution logic is already tested (Task 1); this task is wiring. `AgenticTools.render` and everything downstream keep receiving resolved full HTML.

- [ ] **Step 1: Wire `edits` + `lastHtml` into the render tool**

In `src/agent/query.ts`, add the import at the top with the other local imports:

```ts
import { resolveRenderInput, type RenderEdit } from "./edit-ops";
```

Then replace the `renderTool` definition inside `runAgentic` (currently `const renderTool = tool("render", "Render the given slide HTML …")`) with:

```ts
  let lastHtml: string | undefined;
  const renderTool = tool(
    "render",
    "Render the slide at 1280x720 and return screenshots. Pass full `html` on the FIRST call; for revisions prefer `edits` — exact find/replace patches applied to your last-rendered html (each `old` must appear exactly once). Optionally pass interaction steps to inspect interactive states.",
    {
      html: z.string().optional(),
      edits: z.array(z.object({ old: z.string(), new: z.string() })).optional(),
      interactions: z
        .array(z.object({ click: z.string().optional(), press: z.string().optional(), wait: z.number().optional() }))
        .optional(),
    },
    async (args: { html?: string; edits?: RenderEdit[]; interactions?: { click?: string; press?: string; wait?: number }[] }) => {
      const resolved = resolveRenderInput(lastHtml, args);
      if (!resolved.ok) {
        return { content: [{ type: "text" as const, text: `⚠ ${resolved.error}` }] };
      }
      lastHtml = resolved.html;
      const out = await tools.render(resolved.html, args.interactions);
      if ("text" in out) {
        return { content: [{ type: "text" as const, text: out.text }] };
      }
      return {
        content: out.images.map((png) => ({
          type: "image" as const,
          data: png.toString("base64"),
          mimeType: "image/png",
        })),
      };
    },
  );
```

(`lastHtml` is declared inside `runAgentic`, so state is per authoring session.)

- [ ] **Step 2: Run the full suite to verify nothing broke**

Run: `bun run test`
Expected: PASS (all suites; `query.ts` has no direct tests — this catches type/regression fallout).

- [ ] **Step 3: Commit**

```bash
git add src/agent/query.ts
git commit -m "feat(agent): render tool accepts edits patches against the last-rendered html"
```

---

### Task 3: finalize replies "DONE" (converge constants + agentic-author)

**Files:**
- Modify: `src/render/converge.ts` (add exported messages)
- Modify: `src/agent/agentic-author.ts:46-51` (use them)
- Test: `tests/render/converge.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/render/converge.test.ts` (import `FINALIZE_CLEAN, finalizeBudget` from the same module in the existing import line):

```ts
describe("finalize messages", () => {
  it("tell the model to reply DONE, not to re-emit the html, and not to render again", () => {
    for (const msg of [FINALIZE_CLEAN, finalizeBudget(RENDER_PASS_CAP)]) {
      expect(msg).toContain("DONE");
      expect(msg).toMatch(/do NOT output the HTML again/);
      expect(msg).toMatch(/do NOT call render again/);
    }
  });
  it("the budget message names the pass cap", () => {
    expect(finalizeBudget(4)).toContain("4 passes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/converge.test.ts`
Expected: FAIL — `FINALIZE_CLEAN` / `finalizeBudget` not exported.

- [ ] **Step 3: Add the constants and use them**

Append to `src/render/converge.ts`:

```ts
/** Render-tool reply once a candidate is clean: the harness seals it; the model must not re-emit HTML. */
export const FINALIZE_CLEAN =
  "✅ This slide is clean — no overflow, no console errors. The harness has captured this render as the final slide. Reply with the single word DONE — do NOT output the HTML again and do NOT call render again.";

/** Render-tool reply when the pass budget is exhausted: the harness seals the best candidate. */
export const finalizeBudget = (cap: number): string =>
  `Render budget reached (${cap} passes). The harness will seal your best render. Reply with the single word DONE — do NOT output the HTML again and do NOT call render again.`;
```

In `src/agent/agentic-author.ts`, extend the converge import to include them:

```ts
import { isCleanCandidate, pickBestCandidate, RENDER_PASS_CAP, FINALIZE_CLEAN, finalizeBudget, type Candidate } from "../render/converge";
```

and replace the two returns in the render callback:

```ts
          if (isCleanCandidate(cand)) {
            return { text: FINALIZE_CLEAN };
          }
          if (candidates.length >= RENDER_PASS_CAP) {
            return { text: finalizeBudget(RENDER_PASS_CAP) };
          }
```

(No other change: sealing already uses `pickBestCandidate` at `agentic-author.ts:56-57`, and the `raw = best ? best.html : text` fallback still covers a session that never rendered.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/converge.test.ts && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/converge.ts src/agent/agentic-author.ts tests/render/converge.test.ts
git commit -m "feat(render): finalize asks for DONE — the sealed slide is already the best render"
```

---

### Task 4: brief wording — DONE contract + prefer edits

**Files:**
- Modify: `src/render/design-brief.ts:40-47` (`identityBrief`)
- Test: `tests/render/design-brief.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("identityBrief", …)` in `tests/render/design-brief.test.ts`:

```ts
  it("teaches the edits-over-full-html revision habit and the DONE finalize contract", () => {
    const b = identityBrief();
    expect(b).toMatch(/prefer `edits`/);
    expect(b).toMatch(/reply DONE/);
    expect(b).toMatch(/ONLY if you never called `render`/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Update the brief**

In `src/render/design-brief.ts`, replace the "You have EYES" body line (the long string at line 40) with:

```ts
    "You have a `render` tool that returns screenshots of your slide at 1280x720. Render your work and LOOK. If interactive, pass interaction steps (e.g. click a control, wait) and inspect those states too. Fix overflow, dead space, weak hierarchy, off-brand styling. On your FIRST render pass full `html`; for revisions prefer `edits` — exact find/replace patches on your last-rendered html (each `old` must appear exactly once) — and resend full `html` only for a restructure. The MOMENT a render comes back clean — no overflow and no console errors — the slide is fit-complete: the harness captures that render as the final slide, so reply DONE and STOP. The render tool will tell you when it’s clean; do NOT keep polishing a clean slide (extra passes tend to make it worse, not better). Your section’s `id` is added automatically, so use `#SLIDE_ID` selectors freely.",
```

and replace the output-contract block (lines 42–47) with:

```ts
    "## Output contract",
    "After a clean (or budget-capped) render the harness seals your best render — your final message is just the word DONE.",
    "ONLY if you never called `render`: return the slide EXACTLY as follows, with no markdown fences and no commentary:",
    '  <style>#SLIDE_ID .x{ ... }</style>            (optional, id-scoped)',
    '  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>',
    '  <script>(function(){ /* only touch the #SLIDE_ID subtree */ })();</script>   (optional)',
    "Use the given SLIDE_ID for data-slide-id AND every CSS/JS selector so nothing leaks to other slides. Inline <svg> only; no external images/links/@import.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: PASS (including the pre-existing `/clean/i` assertion).

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat(render): brief teaches edits-based revision + DONE finalize contract"
```

---

### Task 5: `RepairSeed` + repair section in the author prompt

**Files:**
- Modify: `src/render/design-brief.ts` (`AuthorRequest`, `slideAuthorPrompt`)
- Test: `tests/render/design-brief.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("slideAuthorPrompt", …)` in `tests/render/design-brief.test.ts`:

```ts
  it("appends a repair section when a previous attempt was rejected", () => {
    const u = slideAuthorPrompt({ ...req, repair: { html: "<section>the dud</section>", reason: "looks like a debug/probe scaffold" } }).user;
    expect(u).toMatch(/Previous attempt REJECTED/);
    expect(u).toContain("looks like a debug/probe scaffold");
    expect(u).toContain("<section>the dud</section>");
  });
  it("has no repair section without a seed", () => {
    expect(slideAuthorPrompt(req).user).not.toMatch(/REJECTED/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL — `repair` not a known property / section absent.

- [ ] **Step 3: Add the type and prompt section**

In `src/render/design-brief.ts`, add above `AuthorRequest` and extend it:

```ts
/** A content-gate rejection to seed the next authoring attempt (repair, don't redesign). */
export interface RepairSeed { html: string; reason: string }

export interface AuthorRequest {
  slide: OutlineSlide;
  deck: { title: string; slideTitles: string[] };
  materials: SlideMaterials;
  repair?: RepairSeed;
}
```

In `slideAuthorPrompt`, append the repair section to `user` (after the `sourceExcerpt` ternary, before `return`):

```ts
    (req.repair
      ? `\n## Previous attempt REJECTED — repair it\n` +
        `The content gate rejected a previous attempt at this slide — reason: ${req.repair.reason}.\n` +
        `Its HTML is below. Keep the working layout and styling where useful, but replace the placeholder/probe content with REAL teaching content for THIS slide.\n\n` +
        `${req.repair.html}\n`
      : "");
```

(i.e. the `user` expression gains one more `+ (…)` term.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat(render): AuthorRequest.repair seeds a rejected attempt into the prompt"
```

---

### Task 6: `ContentDudError` + build-slide throws and forwards the seed

**Files:**
- Modify: `src/render/content-gate.ts` (add class)
- Modify: `src/render/build-slide.ts` (throw it; `repair` param)
- Test: `tests/render/content-gate.test.ts`, `tests/render/build-slide.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/render/content-gate.test.ts` (add `ContentDudError` to the existing import from `content-gate`):

```ts
describe("ContentDudError", () => {
  it("keeps the content-dud: message prefix and carries reason + html", () => {
    const e = new ContentDudError("only 10 chars of content", "<section>x</section>");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("content-dud: only 10 chars of content");
    expect(e.reason).toBe("only 10 chars of content");
    expect(e.html).toBe("<section>x</section>");
    expect(e.name).toBe("ContentDudError");
  });
});
```

Append to the `describe("buildSlide content gate", …)` block in `tests/render/build-slide.test.ts` (add `import { ContentDudError } from "../../src/render/content-gate";` at the top):

```ts
  it("throws ContentDudError carrying the rejected html (heuristic)", async () => {
    const dudHtml = `<section data-slide-id="s_a" data-layout="bespoke">LEFT RIGHT</section>`;
    const author: SlideAuthor = { async authorSlide() { return { html: dudHtml }; } };
    const err: unknown = await buildSlide(slide, deck, materials, { author }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ContentDudError);
    expect((err as ContentDudError).html).toBe(dudHtml);
  });

  it("throws ContentDudError carrying the rejected html (judge)", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: good }; } };
    const judge: SlideJudge = async () => ({ isDud: true, reason: "off-topic" });
    const err: unknown = await buildSlide(slide, deck, materials, { author, judge }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ContentDudError);
    expect((err as ContentDudError).reason).toBe("off-topic");
    expect((err as ContentDudError).html).toBe(good);
  });
```

Append to the first `describe("buildSlide", …)` block (uses the file-top `fakeAuthor`/`ok` helpers):

```ts
  it("forwards a repair seed to the author's request", async () => {
    const a = fakeAuthor(ok);
    const repair = { html: "<section>old dud</section>", reason: "only 14 chars of content" };
    await buildSlide(slide, deck, materials, { author: a.author }, undefined, repair);
    expect(a.reqs[0].repair).toEqual(repair);
  });

  it("passes no repair seed by default", async () => {
    const a = fakeAuthor(ok);
    await buildSlide(slide, deck, materials, { author: a.author });
    expect(a.reqs[0].repair).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/content-gate.test.ts tests/render/build-slide.test.ts`
Expected: FAIL — `ContentDudError` not exported; plain `Error` thrown; `repair` not forwarded.

- [ ] **Step 3: Implement**

Append to `src/render/content-gate.ts`:

```ts
/** Thrown by the content gate. Carries the rejected html so a retry can REPAIR instead of redesign blind. */
export class ContentDudError extends Error {
  readonly reason: string;
  readonly html: string;
  constructor(reason: string, html: string) {
    super(`${CONTENT_DUD} ${reason}`);
    this.name = "ContentDudError";
    this.reason = reason;
    this.html = html;
  }
}
```

In `src/render/build-slide.ts`:

- Change the content-gate import to `import { heuristicDud, ContentDudError } from "./content-gate";` (the `CONTENT_DUD` constant is no longer used here).
- Add `RepairSeed` to the design-brief type import: `import type { AuthorRequest, RepairSeed } from "./design-brief";`
- Change the signature and the gate throws:

```ts
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  materials: SlideMaterials,
  deps: BuildSlideDeps,
  onPass?: (p: PassTiming) => void,
  repair?: RepairSeed,
): Promise<BuiltSlide> {
  const authored = await deps.author.authorSlide({ slide, deck, materials, repair }, onPass);
  const html = authored.html;
  if (!hasUsableSection(html, slide.id)) {
    const got = html.slice(0, 140).replace(/\s+/g, " ").trim();
    throw new Error(`slide ${slide.id}: author produced no usable <section> (got: ${got})`);
  }
  const dud = heuristicDud(html);
  if (dud) throw new ContentDudError(dud, html);
  if (deps.judge) {
    const verdict = await deps.judge({ title: slide.title, angle: materials.angle, html });
    if (verdict.isDud) throw new ContentDudError(verdict.reason, html);
  }
```

(rest of the function unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/content-gate.test.ts tests/render/build-slide.test.ts`
Expected: PASS (existing `/content-dud/` message assertions still hold — the message format is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/render/content-gate.ts src/render/build-slide.ts tests/render/content-gate.test.ts tests/render/build-slide.test.ts
git commit -m "feat(render): ContentDudError carries the rejected html; buildSlide forwards a repair seed"
```

---

### Task 7: build-deck seeds the retry after a content dud

**Files:**
- Modify: `src/render/build-deck.ts:56-68`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/render/build-deck.test.ts` (add `import type { RepairSeed } from "../../src/render/design-brief";` at the top):

```ts
  it("seeds the retry with the rejected html + reason after a content dud", async () => {
    const dud = `<section data-slide-id="s_a" data-layout="bespoke">LEFT RIGHT</section>`;
    const seen: (RepairSeed | undefined)[] = [];
    const author: SlideAuthor = {
      async authorSlide(req) {
        if (req.slide.id !== "s_a") return { html: section(req.slide.id) };
        seen.push(req.repair);
        return { html: seen.length === 1 ? dud : section("s_a") };
      },
    };
    const r = await buildDeck(outline, { author, sleep: () => Promise.resolve() });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toEqual({ html: dud, reason: "only 10 chars of content" });
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });

  it("does not seed repair after an overload retry", async () => {
    const seen: (RepairSeed | undefined)[] = [];
    const author: SlideAuthor = {
      async authorSlide(req) {
        if (req.slide.id !== "s_a") return { html: section(req.slide.id) };
        seen.push(req.repair);
        if (seen.length === 1) throw new Error("529 overloaded");
        return { html: section("s_a") };
      },
    };
    await buildDeck(outline, { author, sleep: () => Promise.resolve() });
    expect(seen).toEqual([undefined, undefined]);
  });

  it("a dud seed survives a subsequent overload retry", async () => {
    const dud = `<section data-slide-id="s_a" data-layout="bespoke">LEFT RIGHT</section>`;
    const seen: (RepairSeed | undefined)[] = [];
    const author: SlideAuthor = {
      async authorSlide(req) {
        if (req.slide.id !== "s_a") return { html: section(req.slide.id) };
        seen.push(req.repair);
        if (seen.length === 1) return { html: dud };           // attempt 1: dud → seeds repair
        if (seen.length === 2) throw new Error("529 overloaded"); // attempt 2: overload, seed must persist
        return { html: section("s_a") };
      },
    };
    await buildDeck(outline, { author, sleep: () => Promise.resolve() });
    expect(seen[1]).toEqual({ html: dud, reason: "only 10 chars of content" });
    expect(seen[2]).toEqual({ html: dud, reason: "only 10 chars of content" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — `seen[1]` is `undefined` (no seeding yet).

- [ ] **Step 3: Implement the seeding**

In `src/render/build-deck.ts`, add the imports:

```ts
import { ContentDudError } from "./content-gate";
import type { RepairSeed } from "./design-brief";
```

Replace the `withRetry` call (and its preceding comment) inside the `try` block with:

```ts
      // On a retry the whole buildSlide re-runs, so onPass re-fires render_pass from pass 1 —
      // a retried slide's pass counter visibly resets in the log (the slide_retry event emitted
      // between attempts marks the boundary). A content-dud retry is SEEDED with the rejected
      // html + reason so the author repairs instead of redesigning blind; overload/network
      // retries leave the seed untouched.
      let repair: RepairSeed | undefined;
      const built = await withRetry(
        () => buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer, judge: deps.judge }, onPass, repair),
        {
          isRetryable: isRetryableError,
          sleep: deps.sleep,
          onRetry: (attempt, e) => {
            if (e instanceof ContentDudError) repair = { html: e.html, reason: e.reason };
            sink.emit({ type: "slide_retry", at: Date.now(), index, id: slide.id, attempt, reason: (e as Error).message });
          },
        },
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS (including the pre-existing overload-retry and self-heal tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): seed content-dud retries with the rejected html + gate reason"
```

---

### Task 8: full verification

- [ ] **Step 1: Run the entire suite**

Run: `bun run test`
Expected: all suites PASS, no skips.

- [ ] **Step 2: Smoke-check the CLI loads**

Run: `bun run src/cli.ts --help`
Expected: usage output, no import/type errors.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — merge `feat/token-burn-fixes` to `main` per repo convention (specs/plans history shows direct merges).

**Post-merge validation (manual, costs tokens):** rebuild something small (e.g. re-run one deck build) and check the usage line — output tokens should drop roughly by half versus a comparable pre-change build, and any `slide_retry (content-dud…)` should converge on the first seeded attempt.
