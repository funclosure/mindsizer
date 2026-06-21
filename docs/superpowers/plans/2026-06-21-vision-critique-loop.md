# Vision Critique Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `mindsizer build` eyes — render each slide, let the agent SEE the screenshot and critique it (fit, composition, hierarchy, clarity, brand), and re-author against concrete problems. Replaces the blind overflow-only check.

**Architecture:** The fit-check captures a screenshot; a new `SlideCritic` seam takes the PNG + a vision Agent-SDK call and returns `{approved, problems}`; the `buildSlide` loop combines deterministic overflow + the vision verdict and re-authors until approved (capped). Critic injected → loop unit-tested with fakes; the live vision critic is typecheck-only/verified-by-running.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright (screenshot), Claude Agent SDK `query()` **vision** (validated: it read a word off a rendered PNG via session auth). Builds on step 5.

**Spec:** `docs/superpowers/specs/2026-06-21-vision-critique-loop-design.md`

**Reality note:** `slide-critic.ts` + `runVisionQuery` are live (typecheck-only). The build LOOP is fully fake-tested. With NO critic, `buildSlide` behaves identically to step 5 — existing tests must stay green (one `toEqual` updates for the new `approved` field).

---

### Task 1: Add `runVisionQuery` (shared with `runQuery`)

**Files:**
- Modify: `src/agent/query.ts`

Refactor (no behavior change to `runQuery`) + add the vision variant. Verify via `tsc` + suite green; no new test (live code).

- [ ] **Step 1: Overwrite `src/agent/query.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

function options(systemPrompt: string) {
  return {
    systemPrompt,
    model: MODEL,
    permissionMode: "bypassPermissions",
    allowedTools: [],
    disallowedTools: [
      "Bash", "Read", "Write", "Edit", "Glob", "Grep",
      "Agent", "WebFetch", "WebSearch", "NotebookEdit",
    ],
    includePartialMessages: true,
  };
}

async function drain(q: AsyncIterable<SDKMessage>): Promise<string> {
  let text = "";
  for await (const msg of q) {
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

/** One isolated single-shot text turn → full assistant text. */
export async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt) }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}

/** One isolated single-shot turn with an attached image (vision) → full assistant text. */
export async function runVisionQuery(
  systemPrompt: string,
  userText: string,
  pngBase64: string,
): Promise<string> {
  async function* gen() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
          { type: "text", text: userText },
        ],
      },
      parent_tool_use_id: null,
      session_id: "mindsizer",
    };
  }
  const q = query({ prompt: gen() as any, options: options(systemPrompt) }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}
```

- [ ] **Step 2: Verify**

Run: `bunx tsc --noEmit` → clean.
Run: `bunx vitest run` → all green (runQuery unchanged; anthropic-client still imports it).

- [ ] **Step 3: Commit**

```bash
git add src/agent/query.ts
git commit -m "refactor: share query drain/options; add runVisionQuery (Agent SDK vision)"
```

---

### Task 2: Capture the screenshot in the fit-check

**Files:**
- Modify: `src/render/fit-check.ts`
- Test: `tests/render/fit-check.test.ts`

- [ ] **Step 1: Add the failing assertion**

Append to `tests/render/fit-check.test.ts` inside the existing `describe("playwrightFitChecker", ...)`:

```ts
  it("returns a non-empty PNG screenshot", async () => {
    const r = await checker.check(
      `<section data-slide-id="c"><h2 class="s-title">Shot</h2><p class="s-body">x</p></section>`,
    );
    expect(r.png).toBeDefined();
    expect((r.png as Buffer).length).toBeGreaterThan(0);
  }, 30000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/fit-check.test.ts`
Expected: FAIL — `r.png` is undefined.

- [ ] **Step 3: Modify `src/render/fit-check.ts`**

Add `png` to the result interface:
```ts
export interface FitResult {
  fits: boolean;
  overflowPx: number;
  detail: string;
  png?: Buffer;
}
```
In `check()`, capture the screenshot after `setContent` and include it in BOTH returns. Replace the body between `setContent(...)` and the `finally` with:
```ts
        const png = await page.screenshot({ type: "png" });
        const m = await page.evaluate(() => {
          const s = document.querySelector("section[data-slide-id]");
          if (!s) return null;
          return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
        });
        if (!m) return { fits: false, overflowPx: 0, detail: "no <section data-slide-id> found", png };
        const overflowPx = Math.max(0, m.sh - m.ch, m.sw - m.cw);
        return {
          fits: overflowPx <= 2,
          overflowPx,
          detail:
            overflowPx <= 2
              ? "fits the 16:9 frame"
              : `content overflows the 16:9 frame by ${overflowPx}px`,
          png,
        };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/fit-check.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/fit-check.ts tests/render/fit-check.test.ts
git commit -m "feat: fit-check captures the slide screenshot (for vision critique)"
```

---

### Task 3: The critic seam + brief

**Files:**
- Create: `src/render/critic-brief.ts`
- Test: `tests/render/critic-brief.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/render/critic-brief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CRITIC_BRIEF, critiqueUserText, CritiqueSchema } from "../../src/render/critic-brief";

describe("critic brief", () => {
  it("names the judged dimensions and asks for JSON", () => {
    expect(CRITIC_BRIEF).toContain("FIT");
    expect(CRITIC_BRIEF).toContain("HIERARCHY");
    expect(CRITIC_BRIEF).toContain("CLARITY");
    expect(CRITIC_BRIEF.toLowerCase()).toContain("json");
  });

  it("critiqueUserText includes the title and overflow", () => {
    const t = critiqueUserText(
      { id: "s_x", layout: "plain", title: "My Slide", markdown: "x" },
      42,
    );
    expect(t).toContain("My Slide");
    expect(t).toContain("42px");
  });

  it("CritiqueSchema accepts a verdict and rejects a bad one", () => {
    expect(CritiqueSchema.parse({ approved: true, problems: [] })).toBeTruthy();
    expect(() => CritiqueSchema.parse({ approved: "yes", problems: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/render/critic-brief.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/render/critic-brief.ts`:

```ts
import { z } from "zod";
import type { OutlineSlide } from "../outline/types";

export const CritiqueSchema = z.object({
  approved: z.boolean(),
  problems: z.array(z.string()),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export interface CritiqueRequest {
  png: Buffer;
  slide: OutlineSlide;
  overflowPx: number;
}

export interface SlideCritic {
  critique(req: CritiqueRequest): Promise<Critique>;
}

export const CRITIC_BRIEF = [
  "You are a demanding design critic reviewing ONE rendered comprehension slide (1280x720, 16:9). The slide image is attached. Judge it honestly and concretely.",
  "",
  "Approve ONLY if it is genuinely strong on ALL of these:",
  "- FIT: nothing clipped or cut off at any edge; the content sits inside the frame.",
  "- COMPOSITION: fills the frame edge-to-edge — not sparse with an empty half, not cramped/crowded. Balanced.",
  "- HIERARCHY: a clear large title and an obvious focal point; not everything one size; a hero number/visual reads first.",
  "- CLARITY: the ONE idea is SHOWN (a diagram, chart, comparison, stat, or metaphor) — not dumped as a paragraph or a plain bullet list.",
  "- BRAND (Field): dark navy ground, cream text, a single cyan accent; calm instrument-panel feel; NO generic AI-slop (no Inter/Roboto, no purple gradients, no clip-art).",
  "",
  "Judge 'genuinely strong', NOT 'perfect' — a clear, well-composed, on-brand slide should pass. Make each problem specific and actionable (e.g. 'the stat 1-2 is small inline text — make it the hero', 'the lower third is empty', 'the analogy caption is clipped at the bottom edge').",
  "",
  'Return JSON ONLY — no prose, no code fence: {"approved": boolean, "problems": string[]}. When approved, problems may be empty.',
].join("\n");

export function critiqueUserText(slide: OutlineSlide, overflowPx: number): string {
  return (
    `Slide title: ${slide.title}\n` +
    `Measured overflow: ${overflowPx}px (0 = fits the 1280x720 frame exactly; >0 means content is clipped).\n` +
    `The rendered slide image is attached. Critique it and return the JSON verdict.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/render/critic-brief.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/critic-brief.ts tests/render/critic-brief.test.ts
git commit -m "feat: SlideCritic seam + critic brief (vision quality judgment)"
```

---

### Task 4: Combine critique into the build loop

**Files:**
- Modify: `src/render/build-slide.ts`
- Test: `tests/render/build-slide.test.ts`

- [ ] **Step 1: Update + extend the tests**

In `tests/render/build-slide.test.ts`, change the first test's exact-match assertion to include `approved`:
```ts
    expect(r).toEqual({ html: ok, passes: 1, fits: true, approved: true });
```
Then append a new block (after the existing `describe("buildSlide", ...)` closes):
```ts
import type { FitResult as _FitResult } from "../../src/render/fit-check"; // (already imported as FitResult above — skip if so)

describe("buildSlide with a vision critic", () => {
  const png = Buffer.from("fakepng");
  const fitOK = {
    check: async (): Promise<FitResult> => ({ fits: true, overflowPx: 0, detail: "fits", png }),
  };

  it("re-authors when the critic rejects, then approves", async () => {
    const a = recordingAuthor([ok, ok]);
    let n = 0;
    const critic = {
      critique: async () =>
        ++n === 1
          ? { approved: false, problems: ["lower third is empty"] }
          : { approved: true, problems: [] },
    };
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitOK, critic });
    expect(r.approved).toBe(true);
    expect(r.passes).toBe(2);
    expect(a.reqs[1].fix?.problem).toContain("lower third is empty");
  });

  it("exhausts with approved:false when the critic keeps rejecting", async () => {
    const a = recordingAuthor([ok]);
    const critic = { critique: async () => ({ approved: false, problems: ["too sparse"] }) };
    const r = await buildSlide(slide, deck, { author: a.author, fit: fitOK, critic, maxPasses: 2 });
    expect(r.approved).toBe(false);
    expect(r.passes).toBe(2);
  });
});
```
(If the top of the file does not already `import type { FitResult } from "../../src/render/fit-check"`, add it; remove the alias line above — it's only a reminder.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — `approved` missing on the result; `critic` not accepted in deps.

- [ ] **Step 3: Rewrite `src/render/build-slide.ts`**

```ts
import type { OutlineSlide } from "../outline/types";
import { validateSlideSection } from "../outline/inject";
import type { AuthorRequest } from "./design-brief";
import type { FitChecker, FitResult } from "./fit-check";
import type { SlideCritic } from "./critic-brief";

export interface SlideAuthor {
  authorSlide(req: AuthorRequest): Promise<string>;
}

export interface BuildSlideDeps {
  author: SlideAuthor;
  fit: Pick<FitChecker, "check">;
  critic?: SlideCritic;
  maxPasses?: number;
}

export interface BuiltSlide {
  html: string;
  passes: number;
  fits: boolean; // overflow within tolerance
  approved: boolean; // overflow OK AND (critic approved, or no critic)
}

/** author → validate → fit-check + (optional) vision critique → re-author with problems (capped). */
export async function buildSlide(
  slide: OutlineSlide,
  deck: { title: string; slideTitles: string[] },
  deps: BuildSlideDeps,
): Promise<BuiltSlide> {
  const maxPasses = deps.maxPasses ?? 3;
  let html = "";
  let problem: string | undefined;
  let lastFit: FitResult = { fits: false, overflowPx: 0, detail: "" };

  for (let pass = 1; pass <= maxPasses; pass++) {
    const req: AuthorRequest = problem
      ? { slide, deck, fix: { previousHtml: html, problem } }
      : { slide, deck };
    html = await deps.author.authorSlide(req);

    const sectionIssues = validateSlideSection(html, slide.id);
    if (sectionIssues.length > 0) {
      problem = sectionIssues[0].message;
      lastFit = { fits: false, overflowPx: 0, detail: problem };
      continue;
    }

    lastFit = await deps.fit.check(html);
    const problems: string[] = [];
    if (!lastFit.fits) problems.push(lastFit.detail);
    if (deps.critic && lastFit.png) {
      const verdict = await deps.critic.critique({
        png: lastFit.png,
        slide,
        overflowPx: lastFit.overflowPx,
      });
      if (!verdict.approved) problems.push(...verdict.problems);
    }

    if (problems.length === 0) {
      return { html, passes: pass, fits: true, approved: true };
    }
    problem = problems.join("; ");
  }
  return { html, passes: maxPasses, fits: lastFit.fits, approved: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: PASS (existing + 2 new critic tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/build-slide.ts tests/render/build-slide.test.ts
git commit -m "feat: buildSlide combines overflow + vision critique"
```

---

### Task 5: Warn on un-approved slides in `buildDeck`

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Update the test**

In `tests/render/build-deck.test.ts`, the second test currently asserts a warning for a slide that "never fits". It uses a fit that always overflows + no critic → now `approved` is false → still warns. Update the warning-substring expectation to match the new message: change any assertion of `"did not fit"` to `"did not pass review"` if present; the `warnings.length` and `s_a` substring assertions stay. (If the test only checks `warnings.length` and `contains("s_a")`, no change is needed.)

- [ ] **Step 2: Modify `src/render/build-deck.ts`**

Change the warning condition + message:
```ts
    if (!built.approved) {
      warnings.push(`${slide.id} did not pass review after ${built.passes} passes`);
    }
```
(Everything else unchanged.)

- [ ] **Step 3: Run test to verify it passes**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat: buildDeck warns on slides that fail review (not just overflow)"
```

---

### Task 6: The live vision critic (typecheck-only)

**Files:**
- Create: `src/agent/slide-critic.ts`

Not unit-tested (live vision). MUST pass `bunx tsc --noEmit`.

- [ ] **Step 1: Write the implementation**

Create `src/agent/slide-critic.ts`:

```ts
import { runVisionQuery } from "./query";
import { parseValidated } from "./json";
import {
  CRITIC_BRIEF,
  critiqueUserText,
  CritiqueSchema,
  type SlideCritic,
} from "../render/critic-brief";

/** Live SlideCritic: the agent SEES the rendered slide and judges it (Agent SDK vision). */
export function anthropicSlideCritic(): SlideCritic {
  return {
    async critique({ png, slide, overflowPx }) {
      const userText = critiqueUserText(slide, overflowPx);
      const b64 = png.toString("base64");
      try {
        return parseValidated(await runVisionQuery(CRITIC_BRIEF, userText, b64), CritiqueSchema);
      } catch {
        try {
          return parseValidated(
            await runVisionQuery(CRITIC_BRIEF, userText + "\n\nReturn valid JSON only.", b64),
            CritiqueSchema,
          );
        } catch {
          // A critic glitch must never block the build — approve and move on.
          return { approved: true, problems: [] };
        }
      }
    },
  };
}
```

- [ ] **Step 2: Typecheck + suite**

Run: `bunx tsc --noEmit` → clean.
Run: `bunx vitest run` → all green (imported by nothing yet).

- [ ] **Step 3: Commit**

```bash
git add src/agent/slide-critic.ts
git commit -m "feat: live vision slide critic (Agent SDK sees the rendered slide)"
```

---

### Task 7: Wire the critic into `build` + barrels

**Files:**
- Modify: `src/render/index.ts`, `src/agent/index.ts`, `src/cli.ts`

- [ ] **Step 1: Update the barrels**

Append to `src/render/index.ts`:
```ts
export * from "./critic-brief";
```
Append to `src/agent/index.ts`:
```ts
export { anthropicSlideCritic } from "./slide-critic";
```

- [ ] **Step 2: Wire the critic into `runBuild` in `src/cli.ts`**

Add `anthropicSlideCritic` to the agent import:
```ts
import { ingest, anthropicClient, fixedPrompter, terminalPrompter, anthropicSlideAuthor, anthropicSlideCritic } from "./agent/index";
```
In `runBuild`, add the critic to the `buildDeck` deps:
```ts
      result = await buildDeck(outline, {
        author: anthropicSlideAuthor(),
        fit,
        critic: anthropicSlideCritic(),
        maxPasses: 4,
      });
```

- [ ] **Step 3: Verify**

Run: `bunx vitest run` → ALL green (the build pre-LLM CLI tests still pass; the critic only engages in the live path).
Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/render/index.ts src/agent/index.ts src/cli.ts
git commit -m "feat: mindsizer build now critiques each slide with vision"
```

---

## Self-Review

**Spec coverage:**
- §2 loop (render → screenshot → critique → re-author, capped) → Tasks 2, 4. ✓
- §3.1 fit-check screenshot → Task 2. ✓
- §3.2 critic-brief seam + brief → Task 3. ✓
- §3.3 live vision critic + lenient fallback → Task 6. ✓
- §3.4 runVisionQuery → Task 1. ✓
- §3.5 build-slide combine + `approved` + optional critic (back-compat) → Task 4. ✓
- §3.6 buildDeck warn on !approved + CLI wiring → Tasks 5, 7. ✓
- §5 testing (critic-brief, build-slide with fakes incl. no-critic back-compat, fit-check png, build-deck; slide-critic + runVisionQuery typecheck-only) → Tasks 2–7. ✓
- Out-of-scope (author change, UI, parallelism) → absent. ✓

**Placeholder scan:** No TBD/TODO; complete code in every step; the only untested files (`slide-critic.ts`, `runVisionQuery`) are deliberate + typecheck-gated. ✓

**Type consistency:** `FitResult.png?: Buffer` (Task 2) consumed by `build-slide` (Task 4, `import type`) and `slide-critic` (via CritiqueRequest). `SlideCritic`/`Critique`/`CritiqueRequest`/`CritiqueSchema`/`CRITIC_BRIEF`/`critiqueUserText` (Task 3) used by `build-slide` (Task 4), `slide-critic` (Task 6), barrel (Task 7). `BuiltSlide.approved` (Task 4) used by `build-deck` (Task 5). `runVisionQuery` (Task 1) used by `slide-critic` (Task 6). `anthropicSlideCritic` (Task 6) + barrel + CLI (Task 7) agree. `buildSlide` with no `critic` is unchanged → existing tests hold (one `toEqual` updated for `approved`). ✓
