# Vision Critique Loop — Giving the Slide-Author Eyes — Design

**Status:** Approved design
**Date:** 2026-06-21
**Scope:** Upgrade the step-5 render-and-inspect loop from a blind overflow check to a **vision critique**: the agent renders a slide, *looks at the screenshot*, judges quality (fit, composition, hierarchy, clarity, on-brand), and re-authors against concrete problems. The thing that makes Claude Code's output good — looking at what you make — applied to mindsizer.
**Builds on:** step 5 (`mindsizer build`: bespoke authoring + Playwright fit-check). Motivated by live findings: brief-only tuning has a quality ceiling + high run-to-run variance; the blind overflow check can't see sparse/clipped/weak slides.

---

## 1. Purpose & boundaries

Today `build` is **blind**: the agent writes a slide once and the only feedback is "does it overflow N px." It can't tell a slide is sparse, has a clipped caption, a weak stat, or no visual. This adds **eyes**: render → screenshot → the agent critiques its own slide → fix.

**In scope:** screenshot capture in the fit-check; a `SlideCritic` seam + a live Agent-SDK **vision** critic; the build loop combining overflow + critique; CLI wiring.

**Out of scope:** changing the author (still tools-disabled HTML generation); the workspace UI (step 6); parallelizing slides; image/PNG export (step 7). The mechanical `mindsizer <outline.md>` seal path is untouched.

**De-risked:** the Claude Agent SDK `query()` accepts an image content block and judges it (probe: it read "BANANA" off a rendered PNG via session auth, no key). Vision through `query()` works.

---

## 2. The loop

```
author → render at 1280×720 (Playwright) → SCREENSHOT + measure overflowPx
  → critic SEES the screenshot → { approved, problems[] }
  → approved := (overflowPx ≤ 2) AND critic.approved
  → if not approved: re-author with the combined problems → re-render → re-look
  → cap at ~3 passes; on exhaustion keep the best attempt (flagged)
```

The deterministic overflow measure stays (cheap ground truth, fed to the critic as a hint). The **vision critique** adds the qualitative judgment overflow-px can't give. One Playwright render per pass serves both (measure + screenshot).

---

## 3. Components

### 3.1 `fit-check.ts` — also capture the screenshot
`FitResult` gains an optional `png?: Buffer`. `playwrightFitChecker.check()` does its existing 1280×720 render, then `page.screenshot({type:"png"})` before measuring, and returns the PNG alongside `{fits, overflowPx, detail}`. (`png` is optional so test fakes need not produce a Buffer.)

### 3.2 `critic-brief.ts` (new, pure, render-domain) — the seam + the taste
```ts
export const CritiqueSchema = z.object({ approved: z.boolean(), problems: z.array(z.string()) });
export type Critique = z.infer<typeof CritiqueSchema>;
export interface CritiqueRequest { png: Buffer; slide: OutlineSlide; overflowPx: number; }
export interface SlideCritic { critique(req: CritiqueRequest): Promise<Critique>; }
export const CRITIC_BRIEF: string;                 // the demanding-critic system prompt
export function critiqueUserText(slide: OutlineSlide, overflowPx: number): string;
```
`CRITIC_BRIEF` instructs a demanding design critic to judge the attached slide image: **fits with nothing clipped; composed edge-to-edge (not sparse, not cramped); strong typographic hierarchy; the idea is *shown* visually, not dumped as text; on-brand Field (navy/cream/cyan, no AI-slop)**. Approve only if **genuinely strong (not perfect)**, so the loop converges. Return JSON `{approved, problems[]}` with concrete, actionable problems.

### 3.3 `slide-critic.ts` (new, agent-domain) — live vision critic (typecheck-only)
`anthropicSlideCritic(): SlideCritic` — calls a new `runVisionQuery(system, userText, pngBase64)` (Agent SDK `query()` with an image+text user message, the validated probe shape), then `parseValidated(text, CritiqueSchema)`. On a parse failure: retry once with a "JSON only" nudge; if it still fails, **default to `{approved:true, problems:[]}`** (a critic glitch must not block the build).

### 3.4 `query.ts` — add `runVisionQuery`
Alongside the text-only `runQuery`, add `runVisionQuery(systemPrompt, userText, pngBase64)` that yields one user message with `content: [{type:"image", source:{type:"base64", media_type:"image/png", data}}, {type:"text", text}]` and drains the same way. Factor the shared options + drain loop so the two don't duplicate.

### 3.5 `build-slide.ts` — combine overflow + critique
`BuildSlideDeps` gains an **optional** `critic?: SlideCritic`. Per pass: render → collect overflow problems → if `deps.critic` and a `png` is present, add critic problems → `approved = problems.length === 0`. Return early when approved; on exhaustion return the last attempt. `BuiltSlide` gains `approved: boolean` (kept alongside `fits` for back-compat). With **no critic**, behavior is identical to step 5 (existing tests unchanged).

### 3.6 `build-deck.ts` + `cli.ts`
`buildDeck` warns on `!built.approved` (was `!built.fits`). The CLI constructs `anthropicSlideCritic()` and passes it in `buildDeck` deps.

---

## 4. File structure

```
src/render/
├── fit-check.ts        # + png?: Buffer in FitResult (screenshot in check)
├── critic-brief.ts     # NEW — SlideCritic seam, CritiqueSchema, CRITIC_BRIEF, critiqueUserText (pure)
├── build-slide.ts      # + optional critic in the loop; BuiltSlide.approved
└── build-deck.ts       # warn on !approved
src/agent/
├── query.ts            # + runVisionQuery (shared drain/options with runQuery)
└── slide-critic.ts     # NEW — anthropicSlideCritic() (live vision; typecheck-only)
src/cli.ts              # wire the critic into buildDeck
barrels                 # render: export critic-brief; agent: export anthropicSlideCritic
```

---

## 5. Testing (honest)

- **critic-brief.ts** — `CRITIC_BRIEF` contains the judged dimensions + "JSON"; `critiqueUserText` includes the title + overflow px; `CritiqueSchema` accepts/rejects shapes.
- **build-slide.ts** — with a fake critic: (a) overflow-OK + critic-approved → returns approved in 1 pass; (b) critic rejects with problems then approves → re-authors with the problems, succeeds pass 2; (c) critic keeps rejecting → exhausts, `approved:false`; (d) **no critic → identical to step 5** (existing tests stay green). Fake `fit` returns a dummy `png` Buffer for critic paths.
- **build-deck.ts** — warns on `!approved` (critic-driven), still works with no critic.
- **fit-check.ts** — existing integration test still passes; add that `check()` returns a non-empty `png` Buffer.
- **Not unit-tested (documented):** `slide-critic.ts` (live vision) + `runVisionQuery` — integration/verified-by-running (the BANANA probe validated the mechanism; I'll verify with a real `adolescence` build + screenshots).
- **Cost note:** each pass now makes 2 LLM calls (author + vision critic); `build` is slower/pricier. It's the offline path, capped passes — acceptable; logged so the user sees per-slide passes.

---

## 6. Risks

- **Critic too harsh → always exhausts.** Mitigation: calibrate `CRITIC_BRIEF` to "genuinely strong, not perfect"; cap passes; keep best attempt. If it over-rejects in practice, soften the brief (tuning knob).
- **Critic glitch / unparseable JSON.** Mitigation: retry once, then default-approve (never block the build).
- **Latency/cost.** Accepted for the offline `build`; future work could critique once rather than every pass, or parallelize slides.

---

## 7. Summary

mindsizer's slide-author gains **eyes**: it renders, screenshots, and the agent critiques its own slide — judging composition, hierarchy, clarity, and brand, not just overflow — then re-authors against concrete problems. This is the harness capability that makes Claude Code's output good, applied to slide generation, and the real fix for the quality/consistency ceiling that brief-tuning alone couldn't break. Behind the `SlideCritic` seam, so the loop stays fully unit-tested; the live vision critic is verified by building a real deck.
