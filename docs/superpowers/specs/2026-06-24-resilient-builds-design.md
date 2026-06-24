# Design: Resilient Builds (guard · retry · resume)

Date: 2026-06-24
Status: Approved (brainstorm) — ready for implementation planning
Builds on: parallel authoring (`2026-06-24-parallel-authoring-design.md`) and the converge phase.

## 1. Context & motivation

Two consecutive 12-slide builds of the Ted Chiang article each failed at the post-seal
`verifyDeck` gate — not from bad content, but from **transient, slide-level infrastructure errors
that the harness sealed as slide content**:

1. The Claude **usage limit** was hit mid-build; the SDK returned "You're out of extra usage ·
   resets 10:50pm" and that text became 5 slides.
2. A **transient API socket drop** ("API Error: The socket connection was closed unexpectedly")
   became one slide (`s_a9r3zhqj`).

Each time, `verifyDeck` correctly failed the build (no garbage shipped) — but a single transient
blip killed an entire ~20-minute build, and a rebuild re-authors all 12 slides from scratch
(`build-deck.ts` has no resume; there is literally a comment "we re-author, not resume"). Yet the
11 good slides' HTML is already saved on disk in `<stem>.build/slides/`.

This phase makes builds resilient: (A) never seal a non-slide as content, (B) self-heal transient
errors with retry, and (C) `--resume` to rebuild only the missing/garbage slides from the saved
good ones.

## 2. Goals / non-goals

Goals:
1. **Output guard:** if the author returns no usable `<section data-slide-id="<id>">` (an error
   string, usage-limit message, or refusal), the deterministic shell **throws** instead of sealing
   it — routing it into the retry/fail path.
2. **Broadened retry:** retry transient network/API errors (socket closed, connection reset,
   `API Error`, `fetch failed`) in addition to overload (429/529). A usage-limit is **not**
   retryable — it fails fast to a clean `slide_failed`.
3. **`--resume`:** a plain `build` re-authors everything (today's behaviour); `build --resume`
   reuses any valid saved slide and re-authors only the missing/garbage ones.

Non-goals (YAGNI / later):
- Automatic resume (re-decided: opt-in flag, to avoid serving a stale slide when the outline
  changed).
- Source-hash invalidation (detecting that a slide's outline text changed since it was built) —
  `--resume` is for recovering from a failed run, not incremental edits; documented as such.
- The probe-slide / "clean but wrong content" gap — separate concern ([[mindsizer-clean-not-correct-gap]]);
  this phase only catches non-`<section>` output, not on-topic-ness.

## 3. Components & interfaces

### A. Section validity — `src/outline/inject.ts` (pure, unit-tested)
```ts
/** True iff html has exactly one <section data-slide-id> and its id === expectedId. */
export function hasUsableSection(html: string, expectedId: string): boolean;
```
Reuses the existing `node-html-parser` path (same parse as `validateSlideSection`). This single
predicate backs BOTH the output guard (C) and the resume-validity check (F).

### B. Retryable classification — `src/render/retry.ts` (pure, unit-tested)
```ts
/** Retry overload + transient network/API errors, but NOT a usage-limit (which won't self-heal). */
export function isRetryableError(e: unknown): boolean;
```
Logic on `String(message ?? e).toLowerCase()`:
- **Not retryable (return false first):** `out of` + `usage`, `usage limit`, `resets ` (the
  usage-cap message) — retrying just re-hits the wall.
- **Retryable (return true):** `isOverload` patterns (`429`/`529`/`overload`/`rate limit`/
  `rate_limit`) OR transient patterns (`socket`, `econnreset`, `etimedout`, `connection reset`,
  `connection closed`, `api error`, `fetch failed`, `network`).
- **Otherwise false** (conservative — unknown garbage fails fast, loud).

`isOverload` stays exported (still unit-tested). `build-deck` switches its `withRetry` predicate
from `isOverload` to `isRetryableError`.

### C. Output guard — `src/render/build-slide.ts`
After `const html = (await deps.author.authorSlide(...)).html`, before the existing
`validateSlideSection` warnings:
```ts
if (!hasUsableSection(html, slide.id)) {
  const got = html.slice(0, 140).replace(/\s+/g, " ").trim();
  throw new Error(`slide ${slide.id}: author produced no usable <section> (got: ${got})`);
}
```
The thrown message embeds the leaked text (e.g. "API Error: … socket … closed" or "out of extra
usage … resets"), so `isRetryableError` can classify it correctly downstream. Advisory checks
(overflow, console errors, script-scoping warnings) are unchanged — they stay non-fatal warnings.

### D. Resume event — `src/render/progress.ts`
```ts
| { type: "slide_reused"; at: number; index: number; id: string; html: string }
```
Carries `html` so the sink can set the section + reseal the partial/final deck (symmetric with
`slide_done`). `deck_done.byCategory` excludes reused slides (they contribute 0 model-time).

### E. Orchestration — `src/render/build-deck.ts`
`BuildDeckDeps` gains `reuse?: Map<string, string>` (slide id → saved valid html). In each pool
task, before authoring:
```ts
const cached = deps.reuse?.get(slide.id);
if (cached) {
  sections.set(slide.id, cached);
  sink.emit({ type: "slide_reused", at: Date.now(), index, id: slide.id, html: cached });
  return;
}
// …otherwise author via withRetry({ isRetryable: isRetryableError, … }) as today
```
Reused slides are instant (no author call, no render). The `withRetry` predicate becomes
`isRetryableError`.

### F. Sink — `src/export/build-sink.ts`
Handle `slide_reused` like a lightweight `slide_done`: `sections.set(e.id, e.html)`, write
`slides/<id>.html`, `reseal()`, `doneCount++`, track a `reusedCount`, print `[#N] ↺ reused`. The
end-of-build summary's stats line gains `reused: <n>`; `formatBreakdown` and `BreakdownStats` take
a `reused` field. `timing.json` records `reusedCount`.

### G. CLI — `src/cli.ts`
Add `--resume`. When set, after computing `buildDir`, before `buildDeck`:
```ts
const reuse = new Map<string, string>();
if (resume) {
  for (const s of outline.slides) {
    try {
      const saved = readFileSync(join(buildDir, "slides", `${s.id}.html`), "utf8");
      if (hasUsableSection(saved, s.id)) reuse.set(s.id, saved);
    } catch { /* not built yet */ }
  }
  process.stdout.write(`· resume: reusing ${reuse.size}/${outline.slides.length} saved slides\n`);
}
// pass `reuse` into buildDeck deps (omit/empty Map when not resuming)
```
A normal `build` passes no `reuse` (full rebuild). `--resume` reuses valid saved slides; the
garbage one (no valid section) is absent from the map → re-authored.

## 4. Data flow

```
build [--resume] →
  cli: if --resume, scan <stem>.build/slides/*.html, validate hasUsableSection → reuse Map
  buildDeck(outline, { …, reuse }):
    per slide (bounded pool):
      reuse.has(id) ? emit slide_reused(html) + set section            (instant)
                    : withRetry(buildSlide, isRetryableError) → author  (self-heals transient)
                        buildSlide throws if author output has no usable <section>
                          → retryable transient: retries; usage-limit/unknown: slide_failed (loud)
  sink: slide_reused/slide_done set sections → reseal partial+final deck
  cli: verifyDeck(sealed) gate (unchanged)
```

## 5. Error handling
- Transient API/network error → `buildSlide` throws (no usable section) → `isRetryableError` true →
  `withRetry` retries with backoff → usually succeeds; else `slide_failed` after the cap.
- Usage-limit → throws → `isRetryableError` **false** → immediate `slide_failed` (no pointless
  retries); `verifyDeck` fails the build loudly; `build --resume` after reset fills it in.
- Reused slide that is somehow invalid → it never enters the `reuse` map (the CLI validates with
  `hasUsableSection` before adding), so it is re-authored.
- `--resume` with no `.build/` dir → empty `reuse` map → behaves like a full build.

## 6. Testing strategy
- **Unit (pure):**
  - `hasUsableSection`: one valid section → true; no section → false; id mismatch → false; two
    sections → false.
  - `isRetryableError`: overload patterns → true; `socket … closed` / `ECONNRESET` / `API Error` /
    `fetch failed` → true; `out of extra usage … resets` / `usage limit` → false; `boom` → false.
- **Unit (shell/orchestration with fakes — no SDK):**
  - `buildSlide`: a fake author returning `"API Error: socket closed"` (no section) → `buildSlide`
    rejects/throws; a fake author returning a valid `<section>` → returns normally.
  - `build-deck`: a `reuse` Map containing one slide → `slide_reused` (with html) emitted, the
    author is **not** called for that slide and **is** called for the rest; both end up in
    `sections`. A fake author that throws a retryable error twice then succeeds still recovers
    (existing retry test, now via `isRetryableError`).
  - `build-sink`: a `slide_reused` event sets the section, writes the slide file, reseals, and
    counts toward `doneCount`; `formatBreakdown` shows `reused: n`.
- **Verified-by-running:** `mindsizer build chiang.outline.md --resume` — confirm the log shows
  "reusing 11/12", only `s_a9r3zhqj` is authored, `verifyDeck` passes, 12 sections, then
  screenshot all 12 slides before any deploy.

## 7. Build order (for the plan)
1. `hasUsableSection` in `inject.ts` + tests.
2. `isRetryableError` in `retry.ts` + tests.
3. `slide_reused` event in `progress.ts`.
4. Output guard in `build-slide.ts` + tests.
5. `build-deck.ts`: `reuse` map + `slide_reused` + switch to `isRetryableError` + tests.
6. `build-sink.ts`: `slide_reused` handling + `reused` in summary + tests.
7. `cli.ts`: `--resume` flag + reuse scan, pass into `buildDeck`.
8. Live: `build --resume` the Chiang deck (re-author only the garbage slide), verify + screenshot.

## 8. Success criteria
- A transient API/socket error on a slide is **retried** and the build completes (no whole-build
  failure); a usage-limit produces a clean named `slide_failed`, never sealed garbage.
- `build --resume` reuses every valid saved slide (logs the count), re-authors only the
  missing/garbage ones, and the resulting deck passes `verifyDeck` with the full section count.
- The author never seals a non-`<section>` string as a slide.
- `tsc` clean; pure pieces (`hasUsableSection`, `isRetryableError`) and the fakes-based
  shell/orchestration/sink behaviours green under unit tests.
