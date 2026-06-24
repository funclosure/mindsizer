# Resilient Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make builds survive transient slide-level errors — never seal a non-`<section>` response as content, retry transient network/API failures (but not usage-limits), and add `--resume` to re-author only the missing/garbage slides from saved good ones.

**Architecture:** A shared `hasUsableSection(html, id)` predicate backs both an output guard in `buildSlide` (throw on non-slide output → routes into `withRetry`/`slide_failed`) and the `--resume` validity check. `isRetryableError` broadens retries to transient errors while excluding usage-limits. `buildDeck` takes a `reuse` map and emits a `slide_reused` event for cached slides.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright, Claude Agent SDK, node-html-parser.

**Spec:** `docs/superpowers/specs/2026-06-24-resilient-builds-design.md`.

**Testing convention:** pure logic + shell/orchestration with injected fakes → Vitest. SDK/browser paths verified by running (the `--resume` rebuild).

---

## File Structure

**Modify**
- `src/outline/inject.ts` — add `hasUsableSection`. Unit-tested.
- `src/render/retry.ts` — add `isRetryableError`. Unit-tested.
- `src/render/progress.ts` — add `slide_reused` event.
- `src/render/build-slide.ts` — output guard (throw on no usable section). Unit-tested.
- `src/render/build-deck.ts` — `reuse` map + `slide_reused` + use `isRetryableError`. Unit-tested.
- `src/export/build-sink.ts` — handle `slide_reused`; `reused` in summary. Unit-tested.
- `src/cli.ts` — `--resume` flag + reuse scan.
- Test files alongside each.

---

## Task 1: hasUsableSection

**Files:**
- Modify: `src/outline/inject.ts`
- Test: `tests/outline/inject.test.ts`

- [ ] **Step 1: Write the failing test (append + merge the import).**

In `tests/outline/inject.test.ts`, add `hasUsableSection` to the existing import from `../../src/outline/inject`, and append:

```ts
describe("hasUsableSection", () => {
  const sec = (id: string) => `<section data-slide-id="${id}" data-layout="bespoke">x</section>`;
  it("true for exactly one section with the expected id", () => {
    expect(hasUsableSection(sec("s_a"), "s_a")).toBe(true);
  });
  it("true with a leading <style> and trailing <script>", () => {
    expect(hasUsableSection(`<style>#s_a{}</style>${sec("s_a")}<script>/*x*/</script>`, "s_a")).toBe(true);
  });
  it("false when there is no section (error text / garbage)", () => {
    expect(hasUsableSection("API Error: The socket connection was closed unexpectedly.", "s_a")).toBe(false);
  });
  it("false when the id does not match", () => {
    expect(hasUsableSection(sec("s_b"), "s_a")).toBe(false);
  });
  it("false when there are two sections", () => {
    expect(hasUsableSection(sec("s_a") + sec("s_a"), "s_a")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: FAIL — `hasUsableSection` not exported.

- [ ] **Step 3: Implement.** In `src/outline/inject.ts`, add right after `ensureSectionId` (it shares the `parseHtml` import already used by `validateSlideSection`):

```ts
/** True iff html has exactly one <section data-slide-id> whose id === expectedId. */
export function hasUsableSection(html: string, expectedId: string): boolean {
  const sections = parseHtml(html).querySelectorAll("section[data-slide-id]");
  return sections.length === 1 && sections[0].getAttribute("data-slide-id") === expectedId;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/outline/inject.test.ts`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/outline/inject.ts tests/outline/inject.test.ts
git commit -m "feat(outline): hasUsableSection — exactly one matching slide section"
```

---

## Task 2: isRetryableError

**Files:**
- Modify: `src/render/retry.ts`
- Test: `tests/render/retry.test.ts`

- [ ] **Step 1: Write the failing test (append + merge the import).**

In `tests/render/retry.test.ts`, add `isRetryableError` to the existing import from `../../src/render/retry`, and append:

```ts
describe("isRetryableError", () => {
  it("retries overload + rate-limit", () => {
    expect(isRetryableError(new Error("529 overloaded"))).toBe(true);
    expect(isRetryableError(new Error("rate limit"))).toBe(true);
  });
  it("retries transient network / API errors", () => {
    expect(isRetryableError(new Error("API Error: The socket connection was closed unexpectedly."))).toBe(true);
    expect(isRetryableError(new Error("read ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });
  it("does NOT retry a usage-limit (it won't self-heal)", () => {
    expect(isRetryableError(new Error("You're out of extra usage · resets 10:50pm"))).toBe(false);
    expect(isRetryableError(new Error("usage limit reached"))).toBe(false);
  });
  it("does NOT retry unknown errors", () => {
    expect(isRetryableError(new Error("boom"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: FAIL — `isRetryableError` not exported.

- [ ] **Step 3: Implement.** In `src/render/retry.ts`, add right after `isOverload`:

```ts
const USAGE_LIMIT = /(out of\b.*\busage|usage limit|resets )/;
const TRANSIENT = /(socket|econnreset|etimedout|connection reset|connection closed|api error|fetch failed|network)/;

/** Retry overload + transient network/API errors, but NOT a usage-limit (which won't self-heal). */
export function isRetryableError(e: unknown): boolean {
  const s = String((e as { message?: unknown })?.message ?? e).toLowerCase();
  if (USAGE_LIMIT.test(s)) return false;
  return isOverload(e) || TRANSIENT.test(s);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/retry.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/render/retry.ts tests/render/retry.test.ts
git commit -m "feat(render): isRetryableError — transient network/API yes, usage-limit no"
```

---

## Task 3: slide_reused event

**Files:**
- Modify: `src/render/progress.ts`

- [ ] **Step 1: Add the event.** In `src/render/progress.ts`, the `ProgressEvent` union currently has `slide_retry` then `deck_done`. Add `slide_reused` right after `slide_retry`:

```ts
  | { type: "slide_retry"; at: number; index: number; id: string; attempt: number; reason: string }
  | { type: "slide_reused"; at: number; index: number; id: string; html: string }
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: CLEAN.

- [ ] **Step 3: Commit**

```bash
git add src/render/progress.ts
git commit -m "feat(render): add slide_reused progress event"
```

---

## Task 4: Output guard in buildSlide

**Files:**
- Modify: `src/render/build-slide.ts`
- Test: `tests/render/build-slide.test.ts`

- [ ] **Step 1: Write the failing test (append).**

In `tests/render/build-slide.test.ts`, append (the file already imports `buildSlide`/`SlideAuthor`; add an import only if missing):

```ts
describe("buildSlide output guard", () => {
  const slide = { id: "s_a", layout: "bespoke" as const, title: "A", markdown: "a" };
  const deck = { title: "D", slideTitles: ["A"] };
  const materials = { digest: [], angle: "", sourceExcerpt: "", neighborTitles: [] };

  it("throws when the author returns no usable <section> (transient error text)", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: "API Error: socket connection closed unexpectedly" }; } };
    await expect(buildSlide(slide, deck, materials, { author })).rejects.toThrow(/no usable <section>/);
  });

  it("returns normally when the author returns a valid section", async () => {
    const author: SlideAuthor = { async authorSlide() { return { html: `<section data-slide-id="s_a" data-layout="bespoke">x</section>` }; } };
    const built = await buildSlide(slide, deck, materials, { author });
    expect(built.html).toContain("s_a");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: FAIL — `buildSlide` returns the garbage instead of throwing.

- [ ] **Step 3: Implement.** In `src/render/build-slide.ts`:

(a) add `hasUsableSection` to the existing import:
```ts
import { validateSlideSection, hasUsableSection } from "../outline/inject";
```

(b) in `buildSlide`, immediately after `const html = authored.html;`, insert the guard before the `validateSlideSection` line:
```ts
  if (!hasUsableSection(html, slide.id)) {
    const got = html.slice(0, 140).replace(/\s+/g, " ").trim();
    throw new Error(`slide ${slide.id}: author produced no usable <section> (got: ${got})`);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-slide.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/build-slide.ts tests/render/build-slide.test.ts
git commit -m "feat(render): guard — throw if the author seals no usable <section>"
```

---

## Task 5: buildDeck reuse + isRetryableError

**Files:**
- Modify: `src/render/build-deck.ts`
- Test: `tests/render/build-deck.test.ts`

- [ ] **Step 1: Write the failing test (append).**

In `tests/render/build-deck.test.ts`, append inside the `describe("buildDeck", …)` block (before its closing `});`):

```ts
  it("reuses cached slides without calling the author, authoring the rest", async () => {
    const authored: string[] = [];
    const author: SlideAuthor = {
      async authorSlide(req) { authored.push(req.slide.id); return { html: section(req.slide.id) }; },
    };
    const { sink, events } = recordingSink();
    const reuse = new Map([["s_a", section("s_a")]]);
    const r = await buildDeck(outline, { author, sink, reuse });
    expect(authored).toEqual(["s_b"]); // s_a reused, only s_b authored
    expect(events.some((e) => e.type === "slide_reused" && e.id === "s_a")).toBe(true);
    expect(events.some((e) => e.type === "slide_start" && e.id === "s_a")).toBe(false); // reused → no slide_start
    expect([...r.sections.keys()].sort()).toEqual(["s_a", "s_b"]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: FAIL — `buildDeck` doesn't accept `reuse` / doesn't emit `slide_reused`.

- [ ] **Step 3: Implement.** Three edits to `src/render/build-deck.ts`:

(a) change the retry import:
```ts
import { withRetry, isRetryableError } from "./retry";
```

(b) add `reuse` to `BuildDeckDeps` (after the `sleep` line):
```ts
  reuse?: Map<string, string>;               // id → saved valid html (from --resume); skips authoring
```

(c) at the very top of the `mapPool` task callback — BEFORE the `slide_start` emit — insert the reuse short-circuit, and change the `withRetry` predicate to `isRetryableError`:
```ts
  await mapPool(outline.slides, concurrency, async (slide, index) => {
    const cached = deps.reuse?.get(slide.id);
    if (cached) {
      sections.set(slide.id, cached);
      sink.emit({ type: "slide_reused", at: Date.now(), index, id: slide.id, html: cached });
      return;
    }
    sink.emit({ type: "slide_start", at: Date.now(), index, total, id: slide.id, title: slide.title });
    // …unchanged… (materials, onPass, try { withRetry( … , { isRetryable: isRetryableError, sleep: deps.sleep, onRetry … }) } catch …)
```
(In the existing `withRetry` options object, replace `isRetryable: isOverload,` with `isRetryable: isRetryableError,`.)

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/render/build-deck.test.ts`
Expected: PASS (existing retry test still passes — `isRetryableError` matches "529 overloaded" — plus the new reuse test).

- [ ] **Step 5: Full suite + typecheck**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/build-deck.ts tests/render/build-deck.test.ts
git commit -m "feat(render): buildDeck reuse map (--resume) + isRetryableError"
```

---

## Task 6: Sink handles slide_reused

**Files:**
- Modify: `src/export/build-sink.ts`
- Test: `tests/export/build-sink.test.ts`

- [ ] **Step 1: Update + add tests.**

In `tests/export/build-sink.test.ts`:

(a) Update the existing `formatBreakdown` test's stats arg + add a `reused` assertion. Replace its `formatBreakdown(…)` call's third argument `{ peakInFlight: 4, retries: 1, failedCount: 0 }` with `{ peakInFlight: 4, retries: 1, failedCount: 0, reused: 3 }`, and add inside that `it`:
```ts
    expect(out).toMatch(/reused: 3/);
```

(b) Append a fileSink reuse test:
```ts
it("reuses a saved slide: sets the section, writes the file, counts it done", () => {
  const dir = mkdtempSync(join(tmpdir(), "ms-sink-reuse-"));
  const buildDir = join(dir, "out.build");
  const outPath = join(dir, "out.html");
  const sink = fileSink(buildDir, outline, outPath);

  sink.emit({ type: "slide_reused", at: 1, index: 0, id: "s_a", html: '<section data-slide-id="s_a" data-layout="bespoke">REUSED_A</section>' });

  expect(readFileSync(join(buildDir, "slides", "s_a.html"), "utf8")).toContain("REUSED_A");
  expect(readFileSync(outPath, "utf8")).toContain("REUSED_A"); // in the partial deck
  const status = JSON.parse(readFileSync(join(buildDir, "status.json"), "utf8"));
  expect(status.doneCount).toBe(1);
  expect(status.reused).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: FAIL — `BreakdownStats` has no `reused`; the sink doesn't handle `slide_reused`.

- [ ] **Step 3: Implement.** Four edits to `src/export/build-sink.ts`:

(a) add `reused` to `BreakdownStats`:
```ts
export interface BreakdownStats { peakInFlight: number; retries: number; failedCount: number; reused: number; }
```

(b) in `formatBreakdown`, update the stats line to include `reused`:
```ts
    `  peak in-flight: ${stats.peakInFlight} · retries: ${stats.retries} · reused: ${stats.reused} · failed: ${stats.failedCount}\n` +
```

(c) in `fileSink`, add a counter next to the others:
```ts
  let reusedCount = 0;
```
and add a `slide_reused` branch right before the `slide_done` branch:
```ts
      } else if (e.type === "slide_reused") {
        sections.set(e.id, e.html);
        doneCount++;
        reusedCount++;
        try { writeFileSync(join(buildDir, "slides", `${e.id}.html`), e.html, "utf8"); } catch { /* best-effort */ }
        reseal();
        process.stdout.write(`[#${e.index + 1}] ↺ reused\n`);
```

(d) thread `reusedCount` through `status.json`, `timing.json`, and the `formatBreakdown` call:
- in `writeStatus`, add `reused: reusedCount,` to the JSON object;
- in the `deck_done` branch's `timing.json` write, add `reusedCount` to the object;
- in the `deck_done` branch's `formatBreakdown(e, slides, { … })` call, add `reused: reusedCount` to the stats object.

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/export/build-sink.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/export/build-sink.ts tests/export/build-sink.test.ts
git commit -m "feat(export): sink handles slide_reused (set section, count, reseal) + reused in summary"
```

---

## Task 7: CLI --resume

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Import `hasUsableSection`.** Add near the other imports in `src/cli.ts`:
```ts
import { hasUsableSection } from "./outline/inject";
```

- [ ] **Step 2: Parse the flag.** In `runBuild`, after `let open = false;` (the existing declarations), add:
```ts
  let resume = false;
```
and in the arg loop, add a branch after the `--concurrency`/`-c` branch (before the catch-all `else if (a.startsWith("-"))`):
```ts
    } else if (a === "--resume") {
      resume = true;
```

- [ ] **Step 3: Update the usage string.** Replace:
```ts
  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open] [--concurrency <n>]");
```
with:
```ts
  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open] [--concurrency <n>] [--resume]");
```

- [ ] **Step 4: Build the reuse map.** After the `const sink = fileSink(buildDir, outline, outPath);` line and its `progress →` write, before the `let result` block, insert:
```ts
  const reuse = new Map<string, string>();
  if (resume) {
    for (const s of outline.slides) {
      try {
        const saved = readFileSync(join(buildDir, "slides", `${s.id}.html`), "utf8");
        if (hasUsableSection(saved, s.id)) reuse.set(s.id, saved);
      } catch { /* slide not built yet */ }
    }
    process.stdout.write(`· resume: reusing ${reuse.size}/${outline.slides.length} saved slides\n`);
  }
```

- [ ] **Step 5: Pass it into `buildDeck`.** Replace:
```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency });
```
with:
```ts
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency, reuse });
```

- [ ] **Step 6: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): --resume — reuse valid saved slides, re-author only the rest"
```

---

## Task 8: Live verification (resume the Chiang deck)

**Files:** none (manual). The previous failed build left `chiang.outline.build/slides/` with 11 good slides + the garbage `s_a9r3zhqj.html`.

- [ ] **Step 1: Confirm the saved state.**

```bash
ls chiang.outline.build/slides/ | wc -l        # 12 files
grep -l "API Error\|socket connection" chiang.outline.build/slides/*.html   # → s_a9r3zhqj.html (the garbage)
```

- [ ] **Step 2: Resume-build.**

```bash
bun run src/cli.ts build chiang.outline.md -o chiang.deck.html --concurrency 4 --resume
```

Expected: prints `· resume: reusing 11/12 saved slides`; only `[#4] author…` (s_a9r3zhqj) runs; the 11 reused show `↺ reused`; ends with `✓ deck check passed (12 slides, 0 console errors)` and a summary line including `reused: 11`. Total time ≈ one slide (~2–4 min), not ~20.

- [ ] **Step 3: Verify the deck.**

```bash
grep -oE '<section[^>]*data-slide-id="[^"]*"' chiang.deck.html | wc -l   # 12
grep -ciE 'API Error|out of .*usage|socket connection' chiang.deck.html  # 0
```

Then **screenshot all 12 slides** (serve + Playwright) and eyeball each for real content before any deploy.

- [ ] **Step 4: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups.**

```bash
git add -A
git commit -m "chore: resilient-builds live-verification fixups"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3A `hasUsableSection` → Task 1; §3B `isRetryableError` → Task 2; §3D `slide_reused` → Task 3; §3C guard → Task 4; §3E reuse + retryable → Task 5; §3F sink → Task 6; §3G cli → Task 7; §6 testing → unit tasks + Task 8 live; §7 build order → task order; §8 success criteria → Task 8 checks.
- **Type consistency:** `hasUsableSection(html, id)` (Task 1) used in Tasks 4 & 7; `isRetryableError` (Task 2) used in Task 5; `slide_reused {index,id,html}` (Task 3) emitted in Task 5, consumed in Task 6; `BreakdownStats.reused` (Task 6) matches its single caller (the sink) + the updated test; `reuse?: Map<string,string>` on `BuildDeckDeps` (Task 5) supplied by the CLI (Task 7) and the test.
- **Existing tests preserved:** the build-deck retry test ("529 overloaded") still passes because `isRetryableError` includes overload; the build-sink `fileSink` test is unchanged (only `formatBreakdown`'s stats arg gains `reused`).
- **Ordering subtlety:** the reuse short-circuit is placed BEFORE `slide_start` so reused slides never enter `inFlight` (Task 5 step 3c) — the test asserts no `slide_start` for the reused id.
- **Out of scope:** automatic resume, source-hash invalidation, the clean-but-wrong-content gap.
