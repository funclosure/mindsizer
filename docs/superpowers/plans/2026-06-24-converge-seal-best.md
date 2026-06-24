# Converge & Seal-Best Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agentic author converge (stop iterating once a render is clean) and seal the **best** rendered pass rather than the model's last text, guarantee each section's `id`, and add a post-seal whole-deck check — recovering the measured ~25% iterate waste while removing the regression / dead-CSS quality bugs.

**Architecture:** The harness governs the render loop: every `render` call is scored and kept as a candidate; on the first clean render (or a hard cap of 4) the `render` tool returns a *text* "finalize now" signal instead of screenshots; after the session the author seals the best candidate, normalized (`extractSlideHtml` + `ensureSectionId`). The CLI runs `verifyDeck` on the sealed file and exits non-zero on a trip.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright (chromium), Claude Agent SDK, `node-html-parser`.

**Spec:** `docs/superpowers/specs/2026-06-24-converge-seal-best-design.md`.

**Testing convention:** pure logic → Vitest. Browser/LLM code (`query.ts`, `agentic-author.ts`, `fit-check.ts`) stays OUT of the Vitest suite and is verified by running. `fit-check` is NOT in the render barrel.

---

## File Structure

**Create**
- `src/render/converge.ts` — `Candidate`, `isCleanCandidate`, `pickBestCandidate`, `RENDER_PASS_CAP`. Pure, unit-tested.
- `tests/render/converge.test.ts`

**Modify**
- `src/outline/inject.ts` — add `ensureSectionId()`. Unit-tested.
- `src/render/design-brief.ts` — EYES section: convergence wording. Unit-tested (existing brief test).
- `src/agent/query.ts` — `RenderToolResult` (`{images}|{text}`); `AgenticTools.render` returns it; tool maps it. Verified-by-running.
- `src/agent/agentic-author.ts` — convergence loop: candidates, clean/cap signals, best-pass, normalize. Verified-by-running.
- `src/render/fit-check.ts` — add `verifyDeck()`; broaden the local `document` declare. Verified-by-running.
- `src/cli.ts` — call `verifyDeck` post-seal, report + exit code.
- `tests/outline/inject.test.ts`, `tests/render/design-brief.test.ts` — extend.

---

## Task 1: Convergence scoring

**Files:**
- Create: `src/render/converge.ts`
- Test: `tests/render/converge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/converge.test.ts
import { describe, it, expect } from "vitest";
import { isCleanCandidate, pickBestCandidate, RENDER_PASS_CAP, type Candidate } from "../../src/render/converge";

const c = (html: string, overflowPx: number, consoleErrors: number): Candidate => ({ html, overflowPx, consoleErrors });

describe("isCleanCandidate", () => {
  it("is clean at overflow ≤ 2 with no console errors", () => {
    expect(isCleanCandidate(c("a", 0, 0))).toBe(true);
    expect(isCleanCandidate(c("a", 2, 0))).toBe(true);
    expect(isCleanCandidate(c("a", 3, 0))).toBe(false);
    expect(isCleanCandidate(c("a", 0, 1))).toBe(false);
  });
});

describe("pickBestCandidate", () => {
  it("returns undefined for no candidates", () => {
    expect(pickBestCandidate([])).toBeUndefined();
  });
  it("prefers fewer console errors, then less overflow", () => {
    const best = pickBestCandidate([c("bad", 0, 2), c("good", 50, 0), c("ok", 10, 0)]);
    expect(best!.html).toBe("ok"); // 0 errors beats 2; among 0-error, 10 < 50
  });
  it("keeps the first-seen on a tie (so an earlier clean pass wins over a later regression)", () => {
    const best = pickBestCandidate([c("clean@4", 0, 0), c("regressed@8", 92, 0)]);
    expect(best!.html).toBe("clean@4");
  });
});

describe("RENDER_PASS_CAP", () => {
  it("is a small positive backstop", () => {
    expect(RENDER_PASS_CAP).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/converge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/converge.ts
export interface Candidate {
  html: string;       // the HTML the model passed to the render tool this pass
  overflowPx: number;
  consoleErrors: number;
}

/** Hard backstop on render passes per slide (the convergence nudge usually exits sooner). */
export const RENDER_PASS_CAP = 4;

/** A render with no overflow (≤2px tolerance) and no console errors is fit-complete. */
export function isCleanCandidate(c: Candidate): boolean {
  return c.overflowPx <= 2 && c.consoleErrors === 0;
}

/**
 * The pass to seal: fewest console errors, then least overflow; first-seen wins ties — so an
 * earlier clean pass beats a later regression. undefined if the model never rendered.
 */
export function pickBestCandidate(cands: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of cands) {
    if (
      !best ||
      c.consoleErrors < best.consoleErrors ||
      (c.consoleErrors === best.consoleErrors && c.overflowPx < best.overflowPx)
    ) {
      best = c;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/converge.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/converge.ts tests/render/converge.test.ts
git commit -m "feat(render): convergence scoring — isCleanCandidate, pickBestCandidate, cap"
```

---

## Task 2: ensureSectionId

**Files:**
- Modify: `src/outline/inject.ts`
- Test: `tests/outline/inject.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test (append)**

```ts
// tests/outline/inject.test.ts  (ADD this import if not present, and ADD this describe block)
import { ensureSectionId } from "../../src/outline/inject";

describe("ensureSectionId", () => {
  it("injects id when the section has only data-slide-id", () => {
    const out = ensureSectionId(`<section data-slide-id="s_x" data-layout="bespoke">hi</section>`, "s_x");
    expect(out).toContain('<section id="s_x" data-slide-id="s_x" data-layout="bespoke">');
  });

  it("is idempotent when a standalone id is already present", () => {
    const html = `<section id="s_x" data-slide-id="s_x" data-layout="bespoke">hi</section>`;
    expect(ensureSectionId(html, "s_x")).toBe(html);
  });

  it("leaves a leading <style> and trailing <script> untouched", () => {
    const html = `<style>#s_x .k{color:red}</style><section data-slide-id="s_x" data-layout="bespoke"><b class="k">x</b></section><script>/*#s_x*/</script>`;
    const out = ensureSectionId(html, "s_x");
    expect(out).toContain("<style>#s_x .k{color:red}</style>");
    expect(out).toContain("<script>/*#s_x*/</script>");
    expect(out).toContain('<section id="s_x" data-slide-id="s_x"');
  });

  it("returns the input unchanged when there is no section", () => {
    expect(ensureSectionId(`<div>nope</div>`, "s_x")).toBe(`<div>nope</div>`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: FAIL — `ensureSectionId` not exported.

- [ ] **Step 3: Add `ensureSectionId` to `src/outline/inject.ts`** (string-based, so it never reserializes/mangles `<style>`/`<script>`):

```ts
/**
 * Ensure the slide's <section data-slide-id="X"> also carries id="X" so the author's
 * `#X{…}` CSS/JS selectors actually match. String surgery on the opening tag only —
 * never reserializes the body, so <style>/<script> content is untouched. Idempotent.
 */
export function ensureSectionId(html: string, expectedId: string): string {
  const open = html.match(/<section\b[^>]*\bdata-slide-id=("|')[^"']+\1[^>]*>/i);
  if (!open) return html;
  const tag = open[0];
  const withoutDsid = tag.replace(/\bdata-slide-id=("|')[^"']*\1/i, "");
  if (/\bid=("|')/.test(withoutDsid)) return html; // already has a standalone id
  const fixed = tag.replace(/<section\b/i, `<section id="${expectedId}"`);
  return html.replace(tag, fixed);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: PASS (existing inject tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/outline/inject.ts tests/outline/inject.test.ts
git commit -m "feat(outline): ensureSectionId injects id= onto the slide section (unconditional)"
```

---

## Task 3: Brief convergence wording

**Files:**
- Modify: `src/render/design-brief.ts`
- Test: `tests/render/design-brief.test.ts`

- [ ] **Step 1: Update the test (add a convergence assertion)**

In `tests/render/design-brief.test.ts`, the `IDENTITY_BRIEF` describe block currently asserts three matches. Replace that `it(...)` with:

```ts
  it("states the instrument-not-landing-page identity, the 16:9 constraint, eyes, and convergence", () => {
    expect(IDENTITY_BRIEF).toMatch(/landing page/i);
    expect(IDENTITY_BRIEF).toMatch(/1280|16:9/);
    expect(IDENTITY_BRIEF).toMatch(/render/i);             // it has eyes
    expect(IDENTITY_BRIEF).toMatch(/clean/i);              // converge: stop when clean
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL — current brief has no `/clean/i`.

- [ ] **Step 3: Replace the EYES line in `src/render/design-brief.ts`**

Find this line (currently around line 33):

```ts
  "You have a `render` tool that returns screenshots of your slide at 1280x720. Render your work and LOOK. If interactive, pass interaction steps (e.g. click a control, wait) and inspect those states too. Fix overflow, dead space, weak hierarchy, off-brand styling. Iterate until it is genuinely strong, then return the final HTML.",
```

Replace it with:

```ts
  "You have a `render` tool that returns screenshots of your slide at 1280x720. Render your work and LOOK. If interactive, pass interaction steps (e.g. click a control, wait) and inspect those states too. Fix overflow, dead space, weak hierarchy, off-brand styling. The MOMENT a render comes back clean — no overflow and no console errors — the slide is fit-complete: output the final HTML and STOP. The render tool will tell you when it's clean; do NOT keep polishing a clean slide (extra passes tend to make it worse, not better). Your section's `id` is added automatically, so use `#SLIDE_ID` selectors freely.",
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat(render): brief tells the author to stop once a render is clean"
```

---

## Task 4: RenderToolResult contract + agentic-author convergence loop

**Files:**
- Modify: `src/agent/query.ts`
- Modify: `src/agent/agentic-author.ts`
- Verified-by-running. Gate: `bunx tsc --noEmit` CLEAN + `bunx vitest run` fully PASS (these two files change together; the contract change to `AgenticTools.render` only compiles once `agentic-author` is updated).

- [ ] **Step 1: In `src/agent/query.ts`, change the `AgenticTools` contract + the tool mapping.**

Replace the `AgenticTools` interface (currently lines 47-49):

```ts
export type RenderToolResult = { images: Buffer[] } | { text: string };

export interface AgenticTools {
  render(html: string, interactions?: { click?: string; press?: string; wait?: number }[]): Promise<RenderToolResult>;
}
```

Replace the `renderTool` callback body (currently lines 70-79, the `async (args) => { const shots = …; return { content: shots.map(...) }; }`) with:

```ts
    async (args: { html: string; interactions?: { click?: string; press?: string; wait?: number }[] }) => {
      const out = await tools.render(args.html, args.interactions);
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
```

- [ ] **Step 2: Replace the ENTIRE contents of `src/agent/agentic-author.ts` with**

```ts
// src/agent/agentic-author.ts
import { runAgentic, type RenderToolResult } from "./query";
import { extractSlideHtml } from "./extract-slide";
import { ensureSectionId } from "../outline/inject";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor, AuthoredSlide } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";
import { computeSlideTiming, type PassTiming } from "../render/progress";
import { isCleanCandidate, pickBestCandidate, RENDER_PASS_CAP, type Candidate } from "../render/converge";

/**
 * Live agentic author. The harness governs the render loop: every pass is scored and kept as a
 * candidate; once a render is clean (or the cap is hit) the render tool returns a text "finalize
 * now" signal instead of screenshots; afterward we seal the BEST candidate (not the model's last
 * text), normalized with the section id guaranteed. Times each pass via onPass (unchanged).
 */
export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest, onPass?: (p: PassTiming) => void): Promise<AuthoredSlide> {
      const { system, user } = slideAuthorPrompt(req);
      const startMs = Date.now();
      let lastBoundary = startMs;
      const passes: PassTiming[] = [];
      const candidates: Candidate[] = [];

      const text = await runAgentic(system, user, {
        render: async (html, interactions): Promise<RenderToolResult> => {
          const reqAt = Date.now();
          const modelMs = reqAt - lastBoundary;
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
          const cand: Candidate = { html, overflowPx: r.overflowPx, consoleErrors: r.consoleErrors.length };
          candidates.push(cand);

          if (isCleanCandidate(cand)) {
            return { text: "✅ This slide is clean — no overflow, no console errors. Output the FINAL HTML now and do NOT call render again." };
          }
          if (candidates.length >= RENDER_PASS_CAP) {
            return { text: `Render budget reached (${RENDER_PASS_CAP} passes). Output your BEST version now and do NOT call render again.` };
          }
          return { images: r.shots };
        },
      });

      const best = pickBestCandidate(candidates);
      const raw = best ? best.html : text; // fall back to model's final text only if it never rendered
      const finalHtml = ensureSectionId(extractSlideHtml(raw), req.slide.id);
      const timing = computeSlideTiming(startMs, passes, Date.now());
      return { html: finalHtml, timing };
    },
  };
}
```

- [ ] **Step 3: Typecheck + full unit suite (the gate)**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all tests PASS (the contract change and its sole consumer are now consistent).

- [ ] **Step 4: Commit**

```bash
git add src/agent/query.ts src/agent/agentic-author.ts
git commit -m "feat(agent): converge & seal-best — text finalize signal, cap, best-pass + id"
```

---

## Task 5: verifyDeck

**Files:**
- Modify: `src/render/fit-check.ts`
- Verified-by-running (Playwright; no model needed).

- [ ] **Step 1: In `src/render/fit-check.ts`, broaden the local `document` declare so `verifyDeck`'s `page.evaluate` can use full DOM.**

Replace the line (currently line 6):

```ts
declare const document: { querySelector(selector: string): null | Record<string, number> };
```

with:

```ts
// `document` exists only inside page.evaluate() (browser context); typed loosely on purpose.
declare const document: any;
```

- [ ] **Step 2: Append `verifyDeck` to `src/render/fit-check.ts`**

```ts
export interface DeckCheck {
  sectionCount: number;
  consoleErrors: string[];
  looseText: string[]; // non-whitespace text nodes that are direct children of .deck (prose leak)
}

/** Load a sealed deck once headless and report structural problems for the whole-deck gate. */
export async function verifyDeck(html: string): Promise<DeckCheck> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.setContent(html, { waitUntil: "networkidle" });
    const data = await page.evaluate(() => {
      const deck = document.querySelector(".deck");
      const sectionCount = document.querySelectorAll(".deck section[data-slide-id]").length;
      const looseText: string[] = [];
      if (deck) {
        for (const n of Array.from(deck.childNodes) as any[]) {
          if (n.nodeType === 3 && n.textContent && n.textContent.trim()) {
            looseText.push(String(n.textContent).trim().slice(0, 80));
          }
        }
      }
      return { sectionCount, looseText };
    });
    return { sectionCount: data.sectionCount, consoleErrors, looseText: data.looseText };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 4: Verify-by-running (a throwaway script — no model, just chromium)**

Create `verify-deck.tmp.ts`:

```ts
import { verifyDeck } from "./src/render/fit-check";
const good = `<!doctype html><body><div class="deck">
  <section data-slide-id="s1" data-layout="bespoke">one</section>
  <section data-slide-id="s2" data-layout="bespoke">two</section>
</div></body>`;
const bad = `<!doctype html><body><div class="deck">
  leaked prose here
  <section data-slide-id="s1" data-layout="bespoke">one<script>document.querySelector('#missing').x()</script></section>
</div></body>`;
console.log("good:", await verifyDeck(good));   // sectionCount 2, no console errors, no loose text
console.log("bad: ", await verifyDeck(bad));    // sectionCount 1, ≥1 console error, looseText ["leaked prose here"]
```

Run: `bun run verify-deck.tmp.ts`
Expected: `good` → `{ sectionCount: 2, consoleErrors: [], looseText: [] }`; `bad` → `sectionCount: 1`, a non-empty `consoleErrors`, and `looseText: ["leaked prose here"]`.

- [ ] **Step 5: Clean up + commit**

```bash
rm verify-deck.tmp.ts
git add src/render/fit-check.ts
git commit -m "feat(render): verifyDeck — whole-deck headless check (count, console errors, loose text)"
```

---

## Task 6: CLI runs the whole-deck check

**Files:**
- Modify: `src/cli.ts`
- Verified-by-running (exercised live in Task 7).

- [ ] **Step 1: Import `verifyDeck`**

In `src/cli.ts`, the renderer import currently is `import { playwrightRenderer } from "./render/fit-check";`. Change it to:

```ts
import { playwrightRenderer, verifyDeck } from "./render/fit-check";
```

- [ ] **Step 2: Run the check after the seal.** In `runBuild`, immediately AFTER the line `process.stdout.write(\`✓ sealed → ${outPath}\n\`);`, add:

```ts
  // whole-deck gate: load the assembled deck once and assert it's structurally sound
  try {
    const sealed = readFileSync(outPath, "utf8");
    const check = await verifyDeck(sealed);
    const problems: string[] = [];
    if (check.sectionCount !== outline.slides.length) {
      problems.push(`section count ${check.sectionCount} ≠ ${outline.slides.length} outline slides`);
    }
    for (const e of check.consoleErrors) problems.push(`console error on load: ${e}`);
    for (const t of check.looseText) problems.push(`loose text outside a slide: "${t}"`);
    if (problems.length) {
      process.stderr.write("\n✗ deck check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
      process.exitCode = 1; // signal failure but leave the deck on disk for inspection
    } else {
      process.stdout.write(`✓ deck check passed (${check.sectionCount} slides, 0 console errors)\n`);
    }
  } catch (e) {
    process.stderr.write(`· deck check skipped (${(e as Error).message})\n`);
  }
```

(`readFileSync` is already imported at the top of cli.ts. `process.exitCode = 1` defers the non-zero exit so the `--open` block that follows still runs.)

- [ ] **Step 3: Typecheck + full unit suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): whole-deck check after seal (fails the build, deck preserved)"
```

---

## Task 7: Live verification

**Files:** none (manual).

- [ ] **Step 1: Build a short outline and watch convergence**

Use a 2-slide outline (create one, or reuse `examples/dont-scale.outline.md` for a longer real run):

```bash
bun run src/cli.ts build examples/dont-scale.outline.md -o /tmp/conv-demo.html &
# while it runs / after it finishes:
grep render_pass examples/dont-scale.build/progress.jsonl | tail -20
```

Expected in `progress.jsonl`: once a slide's `render_pass` shows `overflowPx ≤ 2` and
`consoleErrors 0`, the slide produces **at most one more** render_pass (usually none) — not 3–8.
No slide should run to many passes after going clean.

- [ ] **Step 2: Confirm best-pass sealing + id on every section**

```bash
# every sealed section must carry a standalone id=
python3 -c "
import re; h=open('/tmp/conv-demo.html').read()
for t in re.findall(r'<section\b[^>]*>', h):
    dsid=re.search(r'data-slide-id=\"([^\"]+)\"', t)
    has=bool(re.search(r'(?<!-)\bid=\"', t))
    print((dsid.group(1) if dsid else '?'), 'id=', has)
"
```

Expected: `id= True` for **every** section.

- [ ] **Step 3: Confirm the deck check ran**

Expected: the build prints `✓ deck check passed (N slides, 0 console errors)` (or a clear `✗ deck check FAILED` with specifics and a non-zero exit).

- [ ] **Step 4: Final green check**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "chore: converge & seal-best live-verification fixups"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 loop → Task 4; §4 RenderToolResult → Task 4; §5A converge → Task 1; §5B ensureSectionId → Task 2; §5C/D query+author → Task 4; §5E brief → Task 3; §5F verifyDeck+cli → Tasks 5–6; §8 testing → unit tasks + verify-by-running; §9 build order → task order; §10 success criteria → Task 7 checks.
- **Type consistency:** `Candidate`/`isCleanCandidate`/`pickBestCandidate`/`RENDER_PASS_CAP` (Task 1) used in Task 4; `RenderToolResult` (Task 4 query.ts) consumed by Task 4 agentic-author; `ensureSectionId` (Task 2) called in Task 4; `verifyDeck`/`DeckCheck` (Task 5) used in Task 6.
- **Seam discipline:** `converge.ts` + `ensureSectionId` are pure/unit-tested; `query.ts`/`agentic-author.ts`/`fit-check.ts` stay out of the Vitest graph (verified-by-running); `verifyDeck` lives in `fit-check.ts`, still not exported from the render barrel (cli imports it directly).
- **Out of scope (later):** parallelize authoring (latency lever); re-author-on-hard-failure retry (R3). The extractor (R1) is already fixed.
