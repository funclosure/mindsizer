# Fit + Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Cut author-tier token waste by making overflow authoritative on the resting frame (killing the phantom-overflow revise loop) and short-circuiting post-seal render calls, without reducing quality.

**Architecture:** A pure `resolveOverflow` in render-helpers (resting + capped-expanded terms); fit-check samples resting before the interactions loop and captures per-frame expanded terms; converge shares one tolerance constant; agentic-author short-circuits post-seal renders with no Playwright and no candidate. `query.ts` is untouched.

**Spec:** `docs/superpowers/specs/2026-07-05-fit-converge-design.md`
**Branch:** `feat/fit-converge` off `main`.

---

### Task 1: pure overflow resolution in render-helpers

**Files:** Modify `src/render/render-helpers.ts`; Test `tests/render/render-helpers.test.ts`

- [ ] **Step 1: Write failing tests.** Append to `tests/render/render-helpers.test.ts` (add any missing imports):

```ts
import { OVERFLOW_TOLERANCE_PX, horizontalOverflow, resolveOverflow } from "../../src/render/render-helpers";

describe("OVERFLOW_TOLERANCE_PX", () => {
  it("is 2", () => { expect(OVERFLOW_TOLERANCE_PX).toBe(2); });
});
describe("horizontalOverflow", () => {
  it("is max(0, sw-cw)", () => {
    expect(horizontalOverflow({ sh: 700, ch: 720, sw: 1300, cw: 1280 })).toBe(20);
    expect(horizontalOverflow({ sh: 700, ch: 720, sw: 1280, cw: 1280 })).toBe(0);
  });
});
describe("resolveOverflow", () => {
  const rest = (sh: number, sw = 1280) => ({ sh, ch: 720, sw, cw: 1280 });
  it("none when resting fits and no expansion", () => {
    expect(resolveOverflow({ resting: rest(720), expandedHoriz: [], expandedBeyondFrame: [] }))
      .toEqual({ overflowPx: 0, axis: "none", detail: expect.stringMatching(/fits/i) });
  });
  it("resting vertical overflow wins", () => {
    const r = resolveOverflow({ resting: rest(820), expandedHoriz: [0], expandedBeyondFrame: [0] });
    expect(r.overflowPx).toBe(100); expect(r.axis).toBe("resting");
  });
  it("resting horizontal overflow counts as resting", () => {
    const r = resolveOverflow({ resting: rest(720, 1330), expandedHoriz: [], expandedBeyondFrame: [] });
    expect(r.overflowPx).toBe(50); expect(r.axis).toBe("resting");
  });
  it("ignores within-frame expansion (expandedBeyondFrame 0)", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [0, 0], expandedBeyondFrame: [0, 0] });
    expect(r.overflowPx).toBe(0); expect(r.axis).toBe("none");
  });
  it("flags an expanded state that grows beyond the frame", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [0], expandedBeyondFrame: [140] });
    expect(r.overflowPx).toBe(140); expect(r.axis).toBe("expanded-vertical");
  });
  it("flags expanded horizontal spill", () => {
    const r = resolveOverflow({ resting: rest(720), expandedHoriz: [30], expandedBeyondFrame: [0] });
    expect(r.overflowPx).toBe(30); expect(r.axis).toBe("expanded-horizontal");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`bunx vitest run tests/render/render-helpers.test.ts`).

- [ ] **Step 3: Implement.** Append to `src/render/render-helpers.ts`:

```ts
/** Overflow past the 2px tolerance is a real fit problem. Single source of truth. */
export const OVERFLOW_TOLERANCE_PX = 2;

/** Horizontal overflow (px) past the frame; 0 if it fits. */
export function horizontalOverflow(m: FrameMetrics): number {
  return Math.max(0, m.sw - m.cw);
}

export interface OverflowInput {
  resting: FrameMetrics;          // metrics BEFORE any interaction
  expandedHoriz: number[];        // per-interaction horizontal overflow (sw-cw)
  expandedBeyondFrame: number[];  // per-interaction vertical growth past the 720 frame (sh-H)
}
export interface OverflowResult {
  overflowPx: number;
  axis: "resting" | "expanded-horizontal" | "expanded-vertical" | "none";
  detail: string;
}

/**
 * Resolve a slide's authoritative overflow. The RESTING frame is graded normally; an interaction's
 * expanded state only counts if it spills horizontally or grows the section BEYOND the frame — a
 * within-frame transient (an accordion that opens but stays inside 720px) is ignored, so we stop
 * chasing phantom overflow, while a genuinely broken reveal that blows past the frame is still caught.
 */
export function resolveOverflow(inp: OverflowInput): OverflowResult {
  const restingPx = computeOverflow(inp.resting);
  const eh = Math.max(0, ...inp.expandedHoriz, 0);
  const ev = Math.max(0, ...inp.expandedBeyondFrame, 0);
  const overflowPx = Math.max(restingPx, eh, ev);
  if (overflowPx <= 0) return { overflowPx: 0, axis: "none", detail: "fits the 16:9 frame" };
  const axis = restingPx === overflowPx ? "resting"
    : eh === overflowPx ? "expanded-horizontal"
    : "expanded-vertical";
  const where = axis === "resting" ? "at rest"
    : axis === "expanded-horizontal" ? "when an interaction spills horizontally"
    : "when an interaction expands past the frame";
  return { overflowPx, axis, detail: `content overflows the 16:9 frame by ${overflowPx}px ${where}` };
}
```

Note: `Math.max(0, ...[], 0)` is `0` (empty spread is safe).

- [ ] **Step 4: Run — expect PASS** (`bunx vitest run tests/render/render-helpers.test.ts && bun run test`).
- [ ] **Step 5: Commit** — `git add src/render/render-helpers.ts tests/render/render-helpers.test.ts && git commit -m "feat(render): resolveOverflow — resting-authoritative, expanded-beyond-frame only"`

---

### Task 2: fit-check samples resting before interactions

**Files:** Modify `src/render/fit-check.ts` (the `render` closure, lines ~59-84); Test `tests/render/fit-check.test.ts`

- [ ] **Step 1: Implement.** Add to the imports at the top of `fit-check.ts` (it already imports `computeOverflow` from render-helpers):

```ts
import { computeOverflow, horizontalOverflow, resolveOverflow, OVERFLOW_TOLERANCE_PX } from "./render-helpers";
```

Replace the body of `async function render(html, interactions = [])` (the `try { … } finally { … }`) with:

```ts
    try {
      await page.setContent(pageHtml(themeCss, html), { waitUntil: "networkidle" });
      const measure = () => page.evaluate(() => {
        const s = document.querySelector("section[data-slide-id]");
        if (!s) return null;
        return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
      });
      const resting = await measure();                       // authoritative frame, BEFORE any interaction
      const shots: Buffer[] = [await page.screenshot({ type: "png" })];
      const expandedHoriz: number[] = [];
      const expandedBeyondFrame: number[] = [];
      for (const step of interactions) {
        if (step.click) await page.click(step.click, { timeout: 2000 }).catch(() => {});
        if (step.press) await page.keyboard.press(step.press).catch(() => {});
        if (step.wait) await page.waitForTimeout(step.wait);
        shots.push(await page.screenshot({ type: "png" }));
        const em = await measure();
        if (em) { expandedHoriz.push(horizontalOverflow(em)); expandedBeyondFrame.push(Math.max(0, em.sh - H)); }
      }
      const o = resting
        ? resolveOverflow({ resting, expandedHoriz, expandedBeyondFrame })
        : { overflowPx: 0, axis: "none" as const, detail: "no slide section found" };
      return { shots, overflowPx: o.overflowPx, fits: o.overflowPx <= OVERFLOW_TOLERANCE_PX, consoleErrors };
    } finally {
      await page.close();
    }
```

(`H` is the frame-height const already defined in the file, = 720. `check()` calls `render` with no interactions, so both arrays are empty → resting-only, unchanged behavior.)

- [ ] **Step 2: Add interaction tests** to `tests/render/fit-check.test.ts` (these render real HTML in chromium — follow the file's existing renderer-construction pattern; if the suite has a teardown flake under load, its 3 existing tests passing is the signal). Add a describe block:

```ts
describe("render — interaction overflow", () => {
  const theme = "";
  const wrap = (body: string) => `<section data-slide-id="s_i" style="width:1280px;height:720px;overflow:hidden;position:relative">${body}</section>`;
  // a resting-fitting slide whose button, when clicked, expands WITHIN the frame → must still fit
  const withinFrame = wrap(`<div id="x" style="height:200px"></div><button onclick="document.getElementById('x').style.height='500px'">go</button>`);
  // a slide whose button expands the section BEYOND 720 → must be flagged
  const beyondFrame = wrap(`<div id="y" style="height:600px"></div><button onclick="document.getElementById('y').style.height='1200px'">go</button>`);
  // a slide that spills horizontally at rest
  const horiz = wrap(`<div style="width:1400px;height:100px"></div>`);

  it("ignores a within-frame expansion (fits after interaction)", async () => {
    const r = playwrightRenderer(theme);
    try { const out = await r.render(withinFrame, [{ click: "#s_i button", wait: 50 }]); expect(out.fits).toBe(true); }
    finally { await r.dispose(); }
  });
  it("flags an expansion that grows past the frame", async () => {
    const r = playwrightRenderer(theme);
    try { const out = await r.render(beyondFrame, [{ click: "#s_i button", wait: 50 }]); expect(out.fits).toBe(false); expect(out.overflowPx).toBeGreaterThan(2); }
    finally { await r.dispose(); }
  });
  it("flags resting horizontal spill", async () => {
    const r = playwrightRenderer(theme);
    try { const out = await r.render(horiz); expect(out.fits).toBe(false); }
    finally { await r.dispose(); }
  });
});
```

Adjust the `playwrightRenderer` import/selector to match the file's existing tests if they differ.

- [ ] **Step 3: Run — expect PASS** (`bunx vitest run tests/render/fit-check.test.ts && bunx tsc --noEmit`). If the known playwright teardown-hook flake fires under full-suite load, re-run this file alone.
- [ ] **Step 4: Commit** — `git add src/render/fit-check.ts tests/render/fit-check.test.ts && git commit -m "feat(render): fit-check grades the resting frame; expanded state only flags beyond-frame/horizontal"`

---

### Task 3: converge shares the tolerance constant

**Files:** Modify `src/render/converge.ts`; Test `tests/render/converge.test.ts`

- [ ] **Step 1: Add the test** to `tests/render/converge.test.ts`:

```ts
it("isCleanCandidate uses the shared 2px tolerance", () => {
  expect(isCleanCandidate({ html: "a", overflowPx: 2, consoleErrors: 0 })).toBe(true);
  expect(isCleanCandidate({ html: "a", overflowPx: 3, consoleErrors: 0 })).toBe(false);
});
```

- [ ] **Step 2: Implement.** In `src/render/converge.ts` add the import and use it:

```ts
import { OVERFLOW_TOLERANCE_PX } from "./render-helpers";
```

and change `isCleanCandidate`'s `c.overflowPx <= 2` to `c.overflowPx <= OVERFLOW_TOLERANCE_PX`.

- [ ] **Step 3: Run — expect PASS** (`bunx vitest run tests/render/converge.test.ts && bun run test`).
- [ ] **Step 4: Commit** — `git add src/render/converge.ts tests/render/converge.test.ts && git commit -m "refactor(render): converge shares OVERFLOW_TOLERANCE_PX with fit-check"`

---

### Task 4: post-seal short-circuit in agentic-author

**Files:** Modify `src/agent/agentic-author.ts` (the `render` tool callback + surrounding closure); Test `tests/agent/agentic-author.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `tests/agent/agentic-author.test.ts` (it already mocks `runAgentic` with a scriptable `script`; reuse that harness). Add:

```ts
it("short-circuits post-seal renders — no extra renderer calls, finalize text after seal", async () => {
  const shots = { shots: [Buffer.from("png")], overflowPx: 0, fits: true, consoleErrors: [] as string[] };
  const rc = { render: vi.fn(async () => shots) };
  script = async (tools) => {
    await tools.render(CLEAN_HTML);          // pass 1 → clean → seals
    const a = await tools.render(CLEAN_HTML); // post-seal → short-circuit (text), no render
    const b = await tools.render(CLEAN_HTML); // post-seal → short-circuit (text), no render
    expect("text" in a && "text" in b).toBe(true);
    return "DONE";
  };
  const slide = await agenticAuthor(rc).authorSlide(req);
  expect(rc.render).toHaveBeenCalledTimes(1);   // only the pre-seal render actually ran
  expect(slide.html).toContain("real content"); // sealed = the first clean candidate
});
```

(Uses the same `CLEAN_HTML`, `req`, and `cleanRenderer` fixtures the file's existing sealing test uses; if the existing test names the renderer differently, mirror it.)

- [ ] **Step 2: Run — expect FAIL** (renderer called 3×).

- [ ] **Step 3: Implement.** In `src/agent/agentic-author.ts`, add a `GRACE` const near `RENDER_PASS_CAP`'s import usage (top of `authorSlide` or module scope):

```ts
const POST_SEAL_GRACE = 3; // cheap no-op replies after seal before switching to the budget message
```

Inside `authorSlide`, before the `runAgentic` call, add closure state alongside `passes`/`candidates`:

```ts
      let sealed = false;
      let postSealRenders = 0;
```

In the `render` tool callback, at the VERY TOP (before `renderer.render`):

```ts
        render: async (html, interactions): Promise<RenderToolResult> => {
          if (sealed) {
            postSealRenders++;
            return { text: postSealRenders < POST_SEAL_GRACE ? FINALIZE_CLEAN : finalizeBudget(RENDER_PASS_CAP) };
          }
          // …existing: time the pass, call renderer.render, push candidate, score…
```

and where the callback currently detects a clean candidate and returns `FINALIZE_CLEAN`, set the flag first:

```ts
          if (isCleanCandidate(cand)) {
            sealed = true;
            return { text: FINALIZE_CLEAN };
          }
```

Leave the `RENDER_PASS_CAP` budget branch, the candidate push, and `pickBestCandidate` sealing unchanged. No `ac.abort()`. `FINALIZE_CLEAN`/`finalizeBudget` are already imported from converge.

- [ ] **Step 4: Run — expect PASS** (`bunx vitest run tests/agent/agentic-author.test.ts && bun run test && bunx tsc --noEmit`).
- [ ] **Step 5: Commit** — `git add src/agent/agentic-author.ts tests/agent/agentic-author.test.ts && git commit -m "feat(agent): post-seal render calls short-circuit — no Playwright, no candidate"`

---

### Task 5: full verification + finish

- [ ] **Step 1:** `bun run test && bunx tsc --noEmit` — all green, clean.
- [ ] **Step 2:** `bun run src/cli.ts 2>&1 | head -1` — usage line, no import errors.
- [ ] **Step 3:** Finish via superpowers:finishing-a-development-branch — merge `feat/fit-converge` to `main`.

**Post-merge validation (manual):** rebuild a small deck and compare per-slide pass counts in `progress.jsonl` against a pre-change build — expect fewer revise passes and no visual regressions (spot-check the interactive slides).
