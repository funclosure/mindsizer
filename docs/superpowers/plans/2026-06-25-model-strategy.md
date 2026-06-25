# Model Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run each model call at the right tier + effort (Opus author / Sonnet ingest / Haiku judge), and add a content-gate (heuristic + Haiku judge) that self-heals dud slides through the existing retry path.

**Architecture:** A pure `modelFor(role)` resolver feeds `(model, effort)` into the SDK calls. A pure `content-gate` (min-text + probe-marker) plus an injected Haiku judge run inside `buildSlide`; a dud throws the `content-dud:` marker, which `isRetryableError` retries (self-heal). `verifyDeck` gets a heuristic-only backstop.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright, Claude Agent SDK (`effort` option), node-html-parser, zod.

**Spec:** `docs/superpowers/specs/2026-06-25-model-strategy-design.md`.

**Two stages:** Tasks 1–3 = tiering (shippable checkpoint). Tasks 4–10 = the content-gate.

**Testing convention:** pure logic + shell/orchestration with injected fakes → Vitest. SDK/browser paths (`slide-judge`, `verifyDeck`) verified by running.

---

## File Structure

**Create:** `src/agent/models.ts`, `src/render/content-gate.ts`, `src/agent/slide-judge.ts` (+ tests for the first two).
**Modify:** `src/agent/query.ts`, `src/agent/anthropic-client.ts`, `src/agent/agentic-author.ts`, `src/render/retry.ts`, `src/render/build-slide.ts`, `src/render/build-deck.ts`, `src/render/fit-check.ts`, `src/cli.ts` (+ their tests).

---

## Task 1: modelFor

**Files:**
- Create: `src/agent/models.ts`
- Test: `tests/agent/models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/models.test.ts
import { describe, it, expect } from "vitest";
import { modelFor } from "../../src/agent/models";

describe("modelFor", () => {
  it("returns judgment-matched defaults per role", () => {
    expect(modelFor("author", {})).toEqual({ model: "claude-opus-4-8", effort: "medium" });
    expect(modelFor("ingest", {})).toEqual({ model: "claude-sonnet-4-6", effort: "medium" });
    expect(modelFor("judge", {})).toEqual({ model: "claude-haiku-4-5-20251001", effort: "low" });
  });
  it("per-role env overrides model + effort", () => {
    expect(modelFor("author", { MINDSIZER_AUTHOR_MODEL: "x", MINDSIZER_AUTHOR_EFFORT: "high" }))
      .toEqual({ model: "x", effort: "high" });
  });
  it("legacy MINDSIZER_MODEL overrides the model for every role", () => {
    expect(modelFor("ingest", { MINDSIZER_MODEL: "legacy" }).model).toBe("legacy");
    expect(modelFor("author", { MINDSIZER_MODEL: "legacy" }).model).toBe("legacy");
  });
  it("a per-role model beats the legacy override", () => {
    expect(modelFor("author", { MINDSIZER_MODEL: "legacy", MINDSIZER_AUTHOR_MODEL: "specific" }).model).toBe("specific");
  });
  it("an invalid effort falls back to the role default", () => {
    expect(modelFor("judge", { MINDSIZER_JUDGE_EFFORT: "ultra" }).effort).toBe("low");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/models.ts
export type Role = "author" | "ingest" | "judge";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelChoice { model: string; effort: EffortLevel; }

const DEFAULTS: Record<Role, ModelChoice> = {
  author: { model: "claude-opus-4-8", effort: "medium" },
  ingest: { model: "claude-sonnet-4-6", effort: "medium" },
  judge: { model: "claude-haiku-4-5-20251001", effort: "low" },
};
const ROLE_KEY: Record<Role, string> = { author: "AUTHOR", ingest: "INGEST", judge: "JUDGE" };
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Resolve (model, effort) for a role: per-role env > legacy MINDSIZER_MODEL > role default. */
export function modelFor(role: Role, env: Record<string, string | undefined> = process.env): ModelChoice {
  const d = DEFAULTS[role];
  const key = ROLE_KEY[role];
  const model = env[`MINDSIZER_${key}_MODEL`] || env.MINDSIZER_MODEL || d.model;
  const e = env[`MINDSIZER_${key}_EFFORT`];
  const effort = e && (EFFORTS as string[]).includes(e) ? (e as EffortLevel) : d.effort;
  return { model, effort };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/agent/models.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/models.ts tests/agent/models.test.ts
git commit -m "feat(agent): modelFor — per-role (model, effort) with env overrides"
```

---

## Task 2: Thread ModelChoice into the SDK calls

**Files:**
- Modify: `src/agent/query.ts`

- [ ] **Step 1: Thread into `options` + `runQuery`.** In `src/agent/query.ts`, add the import at the top (after the existing imports):
```ts
import type { ModelChoice } from "./models";
```
Replace the `options` function:
```ts
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
```
with:
```ts
function options(systemPrompt: string, choice?: ModelChoice) {
  return {
    systemPrompt,
    model: choice?.model ?? MODEL,
    ...(choice?.effort ? { effort: choice.effort } : {}),
    permissionMode: "bypassPermissions",
    allowedTools: [],
    disallowedTools: [
      "Bash", "Read", "Write", "Edit", "Glob", "Grep",
      "Agent", "WebFetch", "WebSearch", "NotebookEdit",
    ],
    includePartialMessages: true,
  };
}
```
Replace the `runQuery` signature/body:
```ts
export async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}
```
with:
```ts
export async function runQuery(systemPrompt: string, userPrompt: string, choice?: ModelChoice): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt, choice) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}
```

- [ ] **Step 2: Thread into `runAgentic`.** In `runAgentic`, change the signature from:
```ts
export async function runAgentic(
  systemPrompt: string,
  userPrompt: string,
  tools: AgenticTools,
): Promise<string> {
```
to:
```ts
export async function runAgentic(
  systemPrompt: string,
  userPrompt: string,
  tools: AgenticTools,
  choice?: ModelChoice,
): Promise<string> {
```
and in the `query({ … options: { … } })` call inside `runAgentic`, change the model line and add effort. Replace:
```ts
      model: process.env.MINDSIZER_MODEL || "claude-opus-4-8",
```
with:
```ts
      model: choice?.model ?? (process.env.MINDSIZER_MODEL || "claude-opus-4-8"),
      ...(choice?.effort ? { effort: choice.effort } : {}),
```

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (no behavior change — `choice` is optional and unused by current callers).

- [ ] **Step 4: Commit**

```bash
git add src/agent/query.ts
git commit -m "feat(agent): thread optional (model, effort) into runQuery/runAgentic"
```

---

## Task 3: Wire ingest (Sonnet) + author (Opus)

**Files:**
- Modify: `src/agent/anthropic-client.ts`, `src/agent/agentic-author.ts`

- [ ] **Step 1: anthropic-client → ingest tier.** In `src/agent/anthropic-client.ts`, add the import:
```ts
import { modelFor, type ModelChoice } from "./models";
```
Change `ask` to take a `choice` and pass it to both `runQuery` calls:
```ts
async function ask<T>(
  system: string,
  user: string,
  schema: ZodType<T>,
  label: string,
  choice: ModelChoice,
): Promise<T> {
  try {
    return parseValidated(await runQuery(system, user, choice), schema);
  } catch {
    const retry = await runQuery(
      system,
      user + "\n\nReturn valid JSON only — no prose, no code fence.",
      choice,
    );
    try {
      return parseValidated(retry, schema);
    } catch {
      throw new Error(`could not parse ${label} output`);
    }
  }
}
```
Change `anthropicClient` to resolve + pass the ingest choice:
```ts
export function anthropicClient(choice: ModelChoice = modelFor("ingest")): ModelClient {
  return {
    async digest(sourceText) {
      const p = digestPrompt(sourceText);
      return ask(p.system, p.user, DigestSchema, "digest", choice);
    },
    async proposeDirections(digest) {
      const p = directionPrompt(digest);
      return ask(p.system, p.user, DirectionsSchema, "direction", choice);
    },
    async generateOutline(digest, angle) {
      const p = outlinePrompt(digest, angle);
      return ask(p.system, p.user, DraftDeckSchema, "outline", choice);
    },
  };
}
```

- [ ] **Step 2: agentic-author → author tier.** In `src/agent/agentic-author.ts`, add to the imports:
```ts
import { modelFor } from "./models";
```
Find the `runAgentic(system, user, { render: … })` call and add the author choice as the 4th argument. Change:
```ts
      const text = await runAgentic(system, user, {
        render: async (html, interactions): Promise<RenderToolResult> => {
```
…through its closing…
```ts
      });
```
so the call ends with `, modelFor("author"))` instead of `})`. Concretely, the closing of that call becomes:
```ts
          return { images: r.shots };
        },
      }, modelFor("author"));
```

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (the unit suite doesn't invoke the SDK; this is type-level wiring).

- [ ] **Step 4: Commit**

```bash
git add src/agent/anthropic-client.ts src/agent/agentic-author.ts
git commit -m "feat(agent): ingest on Sonnet, author on Opus (via modelFor)"
```

---

## Task 4: content-gate (heuristic)

**Files:**
- Create: `src/render/content-gate.ts`
- Test: `tests/render/content-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/content-gate.test.ts
import { describe, it, expect } from "vitest";
import { slideText, heuristicDud, MIN_SLIDE_CHARS, CONTENT_DUD } from "../../src/render/content-gate";

const long = "Real on-topic teaching content about lossy compression and why detail gets dropped. ".repeat(2);

describe("slideText", () => {
  it("strips tags and <script>/<style> text", () => {
    expect(slideText(`<section><b>A</b><style>z{}</style><script>zzz()</script> B</section>`)).toBe("A B");
  });
});

describe("heuristicDud", () => {
  it("flags a near-empty slide with the char count", () => {
    expect(heuristicDud(`<section data-slide-id="s">LEFT RIGHT</section>`)).toMatch(/chars of content/);
  });
  it("flags a probe scaffold even when long enough", () => {
    const probe = `<section data-slide-id="s">PROBE early rule A B C JS RAN plus enough padding words to clear the minimum length easily</section>`;
    expect(heuristicDud(probe)).toMatch(/probe/i);
  });
  it("returns null for a real slide", () => {
    expect(heuristicDud(`<section data-slide-id="s">${long}</section>`)).toBeNull();
  });
  it("ignores <script> text when measuring length", () => {
    expect(heuristicDud(`<section data-slide-id="s">Hi<script>${"x".repeat(300)}</script></section>`)).toMatch(/chars/);
  });
});

describe("constants", () => {
  it("exports the threshold + the dud marker", () => {
    expect(MIN_SLIDE_CHARS).toBe(60);
    expect(CONTENT_DUD).toBe("content-dud:");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/content-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/content-gate.ts
import { parse } from "node-html-parser";

export const MIN_SLIDE_CHARS = 60;
export const PROBE_MARKERS = /\bPROBE\b|JS RAN|if this box|FLEX \d|LEFT\s+RIGHT|lorem ipsum/i;
export const CONTENT_DUD = "content-dud:";

/** The slide's visible text — tags stripped, <script>/<style> removed, whitespace collapsed. */
export function slideText(html: string): string {
  const root = parse(html);
  root.querySelectorAll("script, style").forEach((n) => n.remove());
  return root.text.replace(/\s+/g, " ").trim();
}

/** A reason string if the slide is an obvious dud (too short / probe scaffold), else null. */
export function heuristicDud(html: string): string | null {
  const t = slideText(html);
  if (t.length < MIN_SLIDE_CHARS) return `only ${t.length} chars of content`;
  if (PROBE_MARKERS.test(t)) return "looks like a debug/probe scaffold";
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/content-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/content-gate.ts tests/render/content-gate.test.ts
git commit -m "feat(render): content-gate heuristic (min text + probe markers)"
```

---

## Task 5: isRetryableError retries content-dud

**Files:**
- Modify: `src/render/retry.ts`
- Test: `tests/render/retry.test.ts`

- [ ] **Step 1: Write the failing test (append).** In `tests/render/retry.test.ts`, inside the existing `describe("isRetryableError", …)` block, add:
```ts
  it("retries a content-dud so duds self-heal", () => {
    expect(isRetryableError(new Error("content-dud: only 12 chars of content"))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: FAIL — `content-dud` isn't retryable yet.

- [ ] **Step 3: Implement.** In `src/render/retry.ts`, add `content-dud` to the `TRANSIENT` regex. Replace:
```ts
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network)/;
```
with:
```ts
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network|content-dud)/;
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/retry.ts tests/render/retry.test.ts
git commit -m "feat(render): isRetryableError retries content-dud (self-heal)"
```

---

## Task 6: Content gate in buildSlide (+ realistic fixtures)

**Files:**
- Modify: `src/render/build-slide.ts`
- Test: `tests/render/build-slide.test.ts`, `tests/render/build-deck.test.ts`

The new ≥60-char heuristic rejects the tiny `<section>…x…</section>` fixtures, so this task lengthens those fixtures (no behavior change) AND adds the gate.

- [ ] **Step 1: Lengthen the buildSlide/buildDeck test fixtures.**

(a) In `tests/render/build-deck.test.ts`, replace the `section` helper:
```ts
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;
```
with a realistic body:
```ts
const section = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">A real slide body with plenty of words, comfortably past the sixty-character content minimum here.</section>`;
```

(b) In `tests/render/build-deck.test.ts`, the "collects per-slide warnings" test returns a section whose `<script>` lacks the slide id; give it visible body text so it clears the heuristic. Replace its author html:
```ts
        return { html: `<section data-slide-id="${req.slide.id}" data-layout="bespoke"><script>doStuff()</script></section>` };
```
with:
```ts
        return { html: `<section data-slide-id="${req.slide.id}" data-layout="bespoke">Enough visible teaching text to clear the sixty-character heuristic comfortably.<script>doStuff()</script></section>` };
```

(c) In `tests/render/build-slide.test.ts`, the existing "output guard" test "returns normally when the author returns a valid section" uses `<section data-slide-id="s_a" data-layout="bespoke">x</section>`. Replace that html with:
```ts
`<section data-slide-id="s_a" data-layout="bespoke">A genuine slide body long enough to pass the content heuristic without trouble at all.</section>`
```

- [ ] **Step 2: Run the suite to confirm the longer fixtures still pass (no gate yet).**

Run: `bunx vitest run tests/render/build-deck.test.ts tests/render/build-slide.test.ts`
Expected: PASS (longer bodies don't change any current assertion).

- [ ] **Step 3: Write the failing gate tests (append to `tests/render/build-slide.test.ts`).**

```ts
describe("buildSlide content gate", () => {
  const slide = { id: "s_a", layout: "bespoke" as const, title: "A", markdown: "a" };
  const deck = { title: "D", slideTitles: ["A"] };
  const materials = { digest: [], angle: "the angle", sourceExcerpt: "", neighborTitles: [] };
  const good = `<section data-slide-id="s_a" data-layout="bespoke">A genuine on-topic slide body, clearly long enough to pass the content heuristic here.</section>`;

  it("throws content-dud on a near-empty section without calling the judge", async () => {
    let judged = false;
    const author: SlideAuthor = { async authorSlide() { return { html: `<section data-slide-id="s_a" data-layout="bespoke">LEFT RIGHT</section>` }; } };
    const judge: SlideJudge = async () => { judged = true; return { isDud: false, reason: "" }; };
    await expect(buildSlide(slide, deck, materials, { author, judge })).rejects.toThrow(/content-dud/);
    expect(judged).toBe(false);
  });

  it("throws content-dud when the judge marks it a dud", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: good }; } };
    const judge: SlideJudge = async () => ({ isDud: true, reason: "off-topic" });
    await expect(buildSlide(slide, deck, materials, { author, judge })).rejects.toThrow(/content-dud: off-topic/);
  });

  it("returns normally when the judge approves", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: good }; } };
    const judge: SlideJudge = async () => ({ isDud: false, reason: "ok" });
    const built = await buildSlide(slide, deck, materials, { author, judge });
    expect(built.html).toContain("s_a");
  });

  it("runs only the heuristic when no judge is provided", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: good }; } };
    const built = await buildSlide(slide, deck, materials, { author });
    expect(built.html).toContain("s_a");
  });
});
```
Add `SlideJudge` to the import from `../../src/render/build-slide` (it's exported in Step 5).

- [ ] **Step 4: Run to verify failure**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — `SlideJudge`/the gate don't exist yet.

- [ ] **Step 5: Implement the gate in `src/render/build-slide.ts`.**

(a) Add the import:
```ts
import { heuristicDud, CONTENT_DUD } from "./content-gate";
```
(b) Add the `SlideJudge` type and the `judge` dep. After the `SlideAuthor` interface, add:
```ts
export type SlideJudge = (req: { title: string; angle: string; html: string }) => Promise<{ isDud: boolean; reason: string }>;
```
and add `judge?: SlideJudge;` to `BuildSlideDeps`:
```ts
export interface BuildSlideDeps {
  author: SlideAuthor;
  renderer?: Pick<SlideRenderer, "render">; // optional final fit-check (warn only)
  judge?: SlideJudge;
}
```
(c) In `buildSlide`, immediately AFTER the existing `hasUsableSection` guard block (the `if (!hasUsableSection(html, slide.id)) { … throw … }`) and BEFORE `const warnings = …`, insert:
```ts
  const dud = heuristicDud(html);
  if (dud) throw new Error(`${CONTENT_DUD} ${dud}`);
  if (deps.judge) {
    const verdict = await deps.judge({ title: slide.title, angle: materials.angle, html });
    if (verdict.isDud) throw new Error(`${CONTENT_DUD} ${verdict.reason}`);
  }
```

- [ ] **Step 6: Run to verify pass + full suite**

Run: `bunx vitest run tests/render/build-slide.test.ts && bunx tsc --noEmit && bunx vitest run`
Expected: gate tests PASS; tsc CLEAN; whole suite PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/build-slide.ts tests/render/build-slide.test.ts tests/render/build-deck.test.ts
git commit -m "feat(render): content gate in buildSlide (heuristic + injected judge)"
```

---

## Task 7: buildDeck threads the judge (+ self-heal)

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Write the failing self-heal test (append inside `describe("buildDeck", …)`).**

```ts
  it("self-heals a content-dud slide via retry", async () => {
    const tries: Record<string, number> = {};
    const author: SlideAuthor = {
      async authorSlide(req) {
        tries[req.slide.id] = (tries[req.slide.id] ?? 0) + 1;
        const dudFirst = req.slide.id === "s_a" && tries.s_a === 1;
        return { html: dudFirst ? `<section data-slide-id="s_a" data-layout="bespoke">LEFT RIGHT</section>` : section(req.slide.id) };
      },
    };
    const { sink, events } = recordingSink();
    const r = await buildDeck(outline, { author, sink, sleep: () => Promise.resolve() });
    expect(events.some((e) => e.type === "slide_retry" && e.id === "s_a")).toBe(true);
    expect(events.filter((e) => e.type === "slide_done").length).toBe(2);
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — the dud isn't gated (no `slide_retry`), because `buildDeck` doesn't pass a judge AND `buildSlide`'s heuristic… actually the heuristic DOES run (no judge needed). If this test already passes after Task 6, that's fine — it confirms self-heal works via the heuristic. If so, treat Step 2 as "confirm it passes" and continue. (The behavior under test is the heuristic dud → `content-dud` throw → retry.)

- [ ] **Step 3: Thread the `judge` dep through `buildDeck`.** In `src/render/build-deck.ts`:

(a) add the import:
```ts
import type { SlideJudge } from "./build-slide";
```
(b) add `judge` to `BuildDeckDeps` (after the `reuse?` line):
```ts
  judge?: SlideJudge;
```
(c) pass it into the `buildSlide` deps inside the `withRetry` call. Change:
```ts
        () => buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer }, onPass),
```
to:
```ts
        () => buildSlide(slide, deck, materials, { author: deps.author, renderer: deps.renderer, judge: deps.judge }, onPass),
```

- [ ] **Step 4: Run to verify pass + full suite**

Run: `bunx vitest run tests/render/build-deck.test.ts && bunx tsc --noEmit && bunx vitest run`
Expected: PASS; tsc CLEAN.

- [ ] **Step 5: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): buildDeck threads the content judge; duds self-heal"
```

---

## Task 8: The Haiku judge

**Files:**
- Create: `src/agent/slide-judge.ts`
- Verified-by-running (Haiku; no unit test — it hits the model).

- [ ] **Step 1: Implement `src/agent/slide-judge.ts`.**

```ts
// src/agent/slide-judge.ts
import { z } from "zod";
import { runQuery } from "./query";
import { parseValidated } from "./json";
import { modelFor } from "./models";
import type { SlideJudge } from "../render/build-slide";

const VerdictSchema = z.object({ isDud: z.boolean(), reason: z.string() });

/** A cheap Haiku referee: is this slide real on-topic teaching content, or a dud? Fail-open. */
export function slideJudge(): SlideJudge {
  const choice = modelFor("judge");
  return async ({ title, angle, html }) => {
    const system =
      "You are a strict slide reviewer. Decide whether a slide is real, on-topic teaching content " +
      "or a DUD (a placeholder, a debug/probe scaffold, near-empty, or off-topic). Return JSON only.";
    const user =
      `Slide title: ${title}\nDeck angle: ${angle}\n\nSlide HTML:\n${html}\n\n` +
      `Return {"isDud": boolean, "reason": "<one line>"}. isDud=true if it does NOT actually teach "${title}".`;
    try {
      return parseValidated(await runQuery(system, user, choice), VerdictSchema);
    } catch {
      return { isDud: false, reason: "judge unavailable (fail-open)" };
    }
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 3: Verify-by-running (throwaway).** Create `judge.tmp.ts`:
```ts
import { slideJudge } from "./src/agent/slide-judge";
const j = slideJudge();
const probe = `<section data-slide-id="s">PROBE early rule A B C JS RAN ✓</section>`;
const real = `<section data-slide-id="s">Hallucinations are compression artifacts: the model fills a gap with something plausible-sounding, exactly like a JPEG smooths a blurry edge. The only way to catch it is to compare against the original source.</section>`;
console.log("probe:", await j({ title: "Hallucinations are artifacts", angle: "the blurry JPEG lens", html: probe }));
console.log("real :", await j({ title: "Hallucinations are artifacts", angle: "the blurry JPEG lens", html: real }));
```
Run: `bun run judge.tmp.ts`
Expected: `probe` → `{ isDud: true, reason: … }`; `real` → `{ isDud: false, reason: … }`.

- [ ] **Step 4: Clean up + commit**

```bash
rm judge.tmp.ts
git add src/agent/slide-judge.ts
git commit -m "feat(agent): slideJudge — Haiku content referee (fail-open)"
```

---

## Task 9: verifyDeck backstop + CLI wiring

**Files:**
- Modify: `src/render/fit-check.ts`, `src/cli.ts`
- Verified-by-running.

- [ ] **Step 1: Add the heuristic dud check to `verifyDeck`.** In `src/render/fit-check.ts`:

(a) add the import:
```ts
import { MIN_SLIDE_CHARS, PROBE_MARKERS } from "./content-gate";
```
(b) add `duds` to `DeckCheck`:
```ts
export interface DeckCheck {
  sectionCount: number;
  consoleErrors: string[];
  looseText: string[]; // non-whitespace text nodes that are direct children of .deck (prose leak)
  duds: string[];      // sections that are near-empty or look like probe scaffolds
}
```
(c) in the `page.evaluate(() => { … })` call, pass the threshold + marker source and compute duds. Replace the evaluate call:
```ts
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
```
with:
```ts
    const data = await page.evaluate(({ minChars, probeSrc }: { minChars: number; probeSrc: string }) => {
      const deck = document.querySelector(".deck");
      const sectionCount = document.querySelectorAll(".deck section[data-slide-id]").length;
      const probe = new RegExp(probeSrc, "i");
      const looseText: string[] = [];
      const duds: string[] = [];
      if (deck) {
        for (const n of Array.from(deck.childNodes) as any[]) {
          if (n.nodeType === 3 && n.textContent && n.textContent.trim()) {
            looseText.push(String(n.textContent).trim().slice(0, 80));
          }
        }
      }
      for (const s of Array.from(document.querySelectorAll(".deck section[data-slide-id]")) as any[]) {
        const id = s.getAttribute("data-slide-id");
        const t = (s.innerText || "").replace(/\s+/g, " ").trim();
        if (t.length < minChars) duds.push(`${id}: only ${t.length} chars`);
        else if (probe.test(t)) duds.push(`${id}: probe scaffold`);
      }
      return { sectionCount, looseText, duds };
    }, { minChars: MIN_SLIDE_CHARS, probeSrc: PROBE_MARKERS.source });
    return { sectionCount: data.sectionCount, consoleErrors, looseText: data.looseText, duds: data.duds };
```

- [ ] **Step 2: Report duds + wire the judge in `src/cli.ts`.**

(a) add the import:
```ts
import { slideJudge } from "./agent/slide-judge";
```
(b) pass the judge into `buildDeck`. Change:
```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency, reuse });
```
to:
```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency, reuse, judge: slideJudge() });
```
(c) report duds in the post-seal gate. Find the `verifyDeck` result handling block (where `check.consoleErrors` / `check.looseText` are turned into `problems`) and add, alongside those loops:
```ts
    for (const d of check.duds) problems.push(`content dud: ${d}`);
```

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (fit-check/cli aren't in the unit graph beyond the existing fit-check tests).

- [ ] **Step 4: Verify-by-running (throwaway).** Create `verifydeck.tmp.ts`:
```ts
import { verifyDeck } from "./src/render/fit-check";
const good = `<!doctype html><body><div class="deck">
  <section data-slide-id="s1" data-layout="bespoke">A real slide body with plenty of words, well past the sixty character content minimum here.</section>
</div></body>`;
const dud = `<!doctype html><body><div class="deck">
  <section data-slide-id="s1" data-layout="bespoke">LEFT RIGHT</section>
</div></body>`;
console.log("good:", await verifyDeck(good));  // duds: []
console.log("dud :", await verifyDeck(dud));   // duds: ["s1: only 10 chars"]
```
Run: `bun run verifydeck.tmp.ts`
Expected: `good` → `duds: []`; `dud` → `duds` contains `s1`.

- [ ] **Step 5: Clean up + commit**

```bash
rm verifydeck.tmp.ts
git add src/render/fit-check.ts src/cli.ts
git commit -m "feat(render,cli): verifyDeck heuristic dud backstop + wire the Haiku judge"
```

---

## Task 10: Live verification + author-effort A/B

**Files:** none (manual).

- [ ] **Step 1: Real build — confirm tiers + self-heal.**

```bash
bun run src/cli.ts build chiang.outline.md -o /tmp/ms-demo.html --concurrency 4 --resume
```
Expected: builds fine (reuses saved slides), `✓ deck check passed (… 0 console errors)` with no `content dud` problems. (If you delete a slide file first, the re-author should self-heal a probe via `slide_retry` rather than shipping a dud.)

- [ ] **Step 2: Confirm the model tiers actually took effect.**

Set explicit envs and check no crash + reasonable behavior:
```bash
MINDSIZER_AUTHOR_EFFORT=high MINDSIZER_INGEST_MODEL=claude-sonnet-4-6 \
  bun run src/cli.ts build chiang.outline.md -o /tmp/ms-eff.html --concurrency 4 --resume
```
Expected: completes; deck check passes.

- [ ] **Step 3: Author-effort A/B (the measurement).**

Build the same small outline twice (delete the `.build` dir between runs to force full re-author), once per effort, and compare telemetry:
```bash
rm -rf <stem>.outline.build; MINDSIZER_AUTHOR_EFFORT=medium bun run src/cli.ts build <stem>.outline.md -o /tmp/med.html --concurrency 4
python3 -c "import json;d=json.load(open('<stem>.outline.build/timing.json'));print('medium: wall',round(d['totalMs']/1000),'s; passes',[s['timing']['passes'].__len__() for s in d['slides']])"
rm -rf <stem>.outline.build; MINDSIZER_AUTHOR_EFFORT=high bun run src/cli.ts build <stem>.outline.md -o /tmp/high.html --concurrency 4
python3 -c "import json;d=json.load(open('<stem>.outline.build/timing.json'));print('high: wall',round(d['totalMs']/1000),'s; passes',[s['timing']['passes'].__len__() for s in d['slides']])"
```
Expected output: per-effort wall-clock + per-slide pass counts. **Decision:** if `high` reduces total passes/model-time, set the `author` default effort to `high` in `models.ts` (one-line change + commit); otherwise keep `medium`. Record the numbers in the commit message.

- [ ] **Step 4: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups (incl. the effort-default decision).**

```bash
git add -A
git commit -m "chore: model-strategy live verification + author-effort default from A/B"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 models/threading/wiring → Tasks 1–3; §4 content-gate heuristic → Task 4; retry contract → Task 5; build-slide self-heal gate → Task 6; buildDeck threading → Task 7; Haiku judge → Task 8; verifyDeck backstop + cli → Task 9; A/B + live → Task 10. §6 fail-open judge → Task 8 (catch → not-a-dud). §7 testing → unit tasks + verified-by-running.
- **Type consistency:** `ModelChoice` (Task 1) consumed in Tasks 2–3 & 8; `modelFor` roles match the spec defaults; `SlideJudge` defined in build-slide (Task 6), implemented in slide-judge (Task 8), threaded in build-deck (Task 7) and cli (Task 9); `CONTENT_DUD`/`heuristicDud`/`MIN_SLIDE_CHARS`/`PROBE_MARKERS` (Task 4) used in Tasks 5 (string contract), 6, 9; `DeckCheck.duds` (Task 9) consumed by the cli loop in the same task.
- **Fixture ripple handled:** Task 6 lengthens the `section` helper + the warnings-test fixture + the resilient-builds guard "valid section" fixture so the ≥60-char heuristic doesn't break existing buildSlide/buildDeck tests; Step 2 confirms green before the gate lands.
- **Ordering:** `SlideJudge` type exists (Task 6) before it's imported (Tasks 7, 8); `slideJudge()` exists (Task 8) before the cli imports it (Task 9).
- **Out of scope:** per-slide adaptive tier; a Haiku judge in the post-seal gate (backstop is heuristic-only); caching.
