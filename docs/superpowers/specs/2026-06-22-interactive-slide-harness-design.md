# Design: Interactive-Slide Authoring Harness

Date: 2026-06-22
Status: Approved (brainstorm) — ready for implementation planning
Supersedes: the static-deck framing of `2026-06-21-bespoke-render-inspect-design.md` and
`2026-06-21-vision-critique-loop-design.md` (those mechanisms are kept and evolved, not discarded).

## 1. Context & motivation

mindsizer's `build` command produced slides the user judged "very plain — not better than
just asking Claude." A live experiment isolated the cause:

- The same model (**Opus 4.8**) powers both mindsizer's pipeline (`src/agent/query.ts:3`,
  `MINDSIZER_MODEL` unset → `claude-opus-4-8`) and the hand-built reference artifacts. The
  quality gap was **not** the model.
- The gap was **harness starvation**. mindsizer's slide-author receives only the outline
  *bullet* (`design-brief.ts`), no room to reason, a checklist critic, and no eyes of its
  own. When Claude built the same deck with (a) the actual source essay, (b) reasoning room,
  and (c) eyes (render→look→fix), the result was dramatically better — same model.
- A further experiment showed two orthogonal axes had been wrongly fused: **linearity**
  (one frame at a time, presenter-paced, a shared reference) is a *feature* worth keeping —
  it is what makes a deck usable as material for discussion; **static-ness** was the real
  comprehension ceiling. Reference artifacts on disk map the space:
  - `adolescence.myhand.html` — linear, static (within-format quality bar)
  - `adolescence.lens.html` / `adolescence.interactive.html` — interactive but non-linear (landing-page drift)
  - `adolescence.deck.html` — **linear AND interactive** (the target): a normal arrow-advanced
    deck whose centerpiece slide is a live, operable instrument.

**Direction (recorded in memory `mindsizer-direction`):** mindsizer becomes an
*interactive-explainer studio*. Keep the linear, self-contained, offline deck; raise slides
from static to *alive* (animated, staged, and where it helps, operable). Target genre is the
**explorable explanation / instrument**, explicitly **not** a marketing landing page.

## 2. Scope

**In scope (this spec):** the **authoring harness** — the core that makes slides good.
- Feed the author the real source + digest + angle (not just the bullet).
- A **hybrid** author: a free agentic author that iterates on its *own* eyes, wrapped in a
  deterministic, unit-tested orchestration shell.
- Allow **interactive slides**: a per-slide scoped `<script>`, sealed into one offline deck.
- Eyes that can inspect **interactive states**, not just the resting frame.

**Out of scope (later specs):** the workspace UI (PRD §17 step 6), PNG/image export
(step 7), smarter per-slide source retrieval, multi-candidate/tournament authoring.

## 3. Goals / non-goals

Goals:
1. Slides convey ideas markedly better than the current static `build` — at the level of the
   hand-built references — by giving the author context, reasoning room, eyes, and freedom.
2. Preserve the deck's defining properties: **linear, presentable, discussable, one
   self-contained offline HTML file**.
3. Keep a deterministic, unit-testable shell despite a free agentic author (the seam pattern
   mindsizer already uses).
4. Maintain a sane security posture while restoring the agent's eyes.

Non-goals:
- Not replacing the deck with a free-scrolling site.
- Not removing the no-LLM mechanical path (`mindsizer <outline.md>` stays as the fast path).
- Not solving "every slide perfectly approved" — quality is raised, not guaranteed.

## 4. Architecture overview

Hybrid: **free agent inside a tested shell.**

```
buildDeck(outline, context, deps)          [deterministic shell — UNIT TESTED with a fake author]
  for each slide:
    materials = gatherMaterials(slide, outline, context)
    html      = await deps.author.authorSlide({ slide, deck, materials })   [SEAM]
    section   = validateSlideSection(html, slide.id)        // throws/repairs → warn
    collect(section)
  return sealDeck(outline, { sections })    // one self-contained offline LINEAR deck

agenticAuthor()  implements SlideAuthor      [INTEGRATION — verified by running]
  Agent-SDK session, BOUNDED tools (render + scratch fs only):
    think → write slide HTML → render(html, interactions?) → LOOK at screenshots → fix
    (self-driven, capped passes) → return { <style>? <section> <script>? } as one HTML string

renderSlide(html, interactions?)             [pure-ish function — UNIT TESTABLE]
  Playwright: load at 1280×720, optionally drive interactions, screenshot each state,
  measure overflow, capture console errors → RenderResult
  (exposed to the agent AS a tool; also used by the shell for a final fit-check)
```

The shell never drives a fix loop itself — the **agent self-iterates** using the render tool.
The shell's remaining jobs are: gather materials, invoke the seam, **validate**, optionally
run a final fit-check (warn on failure), and **seal**.

## 5. Components & interfaces

### A. Orchestrator (deterministic shell)
Evolves `src/render/build-deck.ts` / `build-slide.ts`.

```ts
interface SlideMaterials {
  digest: string[];        // ingest digest points (deck-wide context)
  angle: string;           // the chosen teach-angle
  sourceExcerpt?: string;  // relevant span(s) of the source essay for this slide (v1 optional)
  neighborTitles: string[];
}

interface AuthorRequest {
  slide: OutlineSlide;
  deck: { title: string; slideTitles: string[] };
  materials: SlideMaterials;
}

interface SlideAuthor {
  // returns one HTML string: optional <style>, the <section>, optional scoped <script>
  authorSlide(req: AuthorRequest): Promise<string>;
}

interface BuildDeckDeps {
  author: SlideAuthor;
  renderer?: SlideRenderer;  // optional final fit-check / warn
}
```

The `fix?` field and shell-driven pass loop from the current `AuthorRequest` are removed:
self-iteration moves *inside* the agentic author. The `SlideAuthor` seam is unchanged in
shape, so tests still inject a fake author.

### B. Agentic author (integration)
New `src/agent/agentic-author.ts`, the live impl of `SlideAuthor`.
- An Agent-SDK `query()` session with **tools enabled but bounded** (see §8).
- System prompt = the **identity brief** (§7). User message = the materials (§6).
- The agent authors HTML, calls the `render` tool to see resting AND interactive states,
  critiques its own screenshots, and revises until satisfied or a hard pass cap is hit.
- Returns the final HTML string (style + section + optional script).
- Verified by running (not unit-tested), consistent with `slide-author.ts`/`fit-check.ts`.

### C. The render tool — the eyes
Generalizes `src/render/fit-check.ts`.

```ts
interface Interaction { click?: string; press?: string; wait?: number; }
interface RenderResult {
  shots: Buffer[];        // one PNG per requested state (resting + after each interaction)
  overflowPx: number;     // 0 = fits the 1280×720 frame
  fits: boolean;
  consoleErrors: string[];
}
interface SlideRenderer {
  render(html: string, interactions?: Interaction[]): Promise<RenderResult>;
}
```

- Loads the slide in headless chromium at 1280×720, screenshots the resting frame, then
  applies each interaction step and screenshots after it — so the agent can SEE interactive
  states (e.g. `[{click:"#tune"},{wait:900}]`).
- Exposed to the agentic author as a bounded tool; the agent supplies the `interactions`.
- Reused by the shell for a final, non-interactive fit-check (overflow → warn).
- Unit-testable as a plain function (force a known-overflowing slide → `fits:false`).

### D. Materials pipeline
- `ingest` persists the **digest** and **chosen angle** so `build` can feed them. Mechanism:
  a sidecar `*.context.json` written next to the outline:
  ```json
  { "sourcePath": "adolescence.txt", "digest": ["..."], "angle": "How to think about it",
    "perSlideExcerpt": { "s_xxx": "..." } }
  ```
  Frontmatter is rejected for this (the 10-point digest + excerpts would bloat the human-
  editable outline). The sidecar is optional: if absent, `build` degrades gracefully (author
  gets the outline only, as today).
- `gatherMaterials` assembles per-slide `SlideMaterials` from the outline + sidecar. v1
  passes the whole digest + angle + the slide's own markdown + neighbor titles; `sourceExcerpt`
  is included when the sidecar provides one (smarter per-slide retrieval is a later spec).

### E. Slide contract + seal (the interactivity change)
- **Slide contract** extends to allow an optional scoped `<script>`:
  ```
  <style>#SLIDE_ID .x{...}</style>            (optional, id-scoped — unchanged)
  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>
  <script>/* IIFE; only touch #SLIDE_ID subtree */ (function(){ ... })();</script>   (optional, NEW)
  ```
- `validateSlideSection` (`src/outline/inject.ts`) extends to: accept an optional trailing
  `<script>`, confirm the `<section data-slide-id>` matches the expected id, and best-effort
  check the script is an IIFE that scopes DOM queries under the slide id (warn, don't hard-fail,
  on scope smells).
- `sealDeck` (`src/export/seal.ts`) inlines each slide's `<script>` after its section, plus the
  deck runtime, into one self-contained offline HTML. No external refs (fonts already embedded).

### F. Deck runtime
`src/export/deck-runtime.ts` already does one-slide-at-a-time + arrow nav + the `display:flex
!important` overlap fix. Additions:
- Per-slide scripts run on load (simple; matches the proven `adolescence.deck.html`).
- Keep arrow-key navigation reserved for the deck; slide interactions use mouse/`#id` controls,
  so there is no key conflict (verified in the proof).
- (Future, not v1) a per-slide "activate" hook for enter-animations; v1 runs scripts on load.

## 6. Data flow

```
text → ingest → digest + angle (+ sidecar) → outline.md
                                   │
build <outline.md>  ──────────────┘
  shell: per slide → gatherMaterials → agenticAuthor (own eyes) → HTML(style+section+script?)
       → validateSlideSection → (final fit-check → warn) → sealDeck
  → ONE self-contained, offline, LINEAR, interactive deck.html
```

## 7. The identity brief (replaces the heavy DESIGN_BRIEF)
A short, identity-first system prompt, not a long rulebook (the experiment showed a heavy
brief *suppressed* the model). It states:
- **Mission:** make ONE idea CLICK; comprehension-first, not summarize/prettify.
- **Genre:** explorable explanation / instrument — **NOT a landing page** (no marketing hero,
  no "scroll" cue, no emoji, no gradient theater, no persuasion funnel).
- **Format:** ONE slide in a LINEAR deck; must fit 1280×720 (16:9), no scrolling within the slide.
- **Aesthetic:** Field (navy/cream/one cyan accent, Fraunces/Geist/Geist-Mono, hairlines, mono
  labels, instrument-panel calm). Fonts already provided.
- **Interactivity:** allowed and encouraged WHEN it makes the idea land (operate it, stage it,
  reveal cause→effect) — via an optional scoped `<script>`. Keep it presenter-friendly: a
  resting state that reads on its own, plus a demonstrable interaction.
- **Eyes mandate:** you have a `render` tool — use it; check the resting frame AND your
  interactive states; fix overflow, dead space, weak hierarchy, off-brand/AI-slop.
- **Output contract:** the §5E slide contract; output only the HTML.

## 8. Security posture
mindsizer currently disables all tools. The agentic author needs tools ON — but bounded:
- Expose **only**: the `render` tool, and scratch read/write confined to a temp dir.
- **No raw Bash, no network, no arbitrary fs.** `permissionMode: "bypassPermissions"` remains
  acceptable *because* the available tools are a tiny, safe allow-list (not the blanket
  `allowDangerouslySkipPermissions` previously removed in review).
- Authored `<script>` is our agent's output, scoped to the slide; sealed deck runs offline.

## 9. Error handling & resilience
- Agentic author returns malformed/again-overflowing HTML → shell logs a warning
  (`<id> did not meet the bar`) and still seals what it has; the deck never fails to build.
- `render` tool / chromium failure mid-author → the agent gets a tool error and can retry or
  proceed; the final shell fit-check is best-effort (warn, never block the seal).
- Missing sidecar → degrade to outline-only materials.
- `validateSlideSection` failure → warn + fall back to wrapping the raw section if salvageable.

## 10. Testing strategy
- **Unit (fakes):** orchestrator/`buildDeck` (fake `SlideAuthor`), `validateSlideSection`
  (incl. the new `<script>` cases), `sealDeck` (per-slide JS inlined, one file, zero external
  refs), deck runtime (per-slide script runs; arrows still navigate; overlap fix intact),
  `gatherMaterials`, sidecar read/write.
- **Function-level:** `renderSlide` overflow + interaction-state screenshots (force a known
  slide, assert `fits`, assert N shots for N interactions).
- **Integration / verified-by-running:** `agenticAuthor` against live Opus 4.8 + chromium —
  produces a real interactive deck from `adolescence.outline.md`, visually confirmed against
  the `adolescence.deck.html` bar.

## 11. Rough build order (for the plan)
1. `renderSlide` (generalize fit-check: interactions + multi-shot + console errors) + tests.
2. Slide contract + `validateSlideSection` `<script>` support + `sealDeck` JS inlining +
   deck-runtime per-slide JS + tests.
3. `ingest` sidecar persistence (digest+angle) + `gatherMaterials` + tests.
4. Orchestrator (`buildDeck`/`build-slide`) reshape to the materials-fed, self-iterating seam
   + tests with a fake author.
5. The bounded tool wiring (render tool + scratch fs) for the SDK session.
6. `agenticAuthor` + the identity brief; wire `mindsizer build` to it.
7. Live run on `adolescence.outline.md`; verify against the north-star bar; iterate.

## 12. Open risks
- **Cost / latency:** per-slide agentic authoring with eyes is slower and pricier than one-shot.
  Acceptable for quality; revisit batching/parallelism later.
- **Tool-use through the SDK:** wiring a bounded custom `render` tool (vs enabling raw fs/Bash)
  is the main integration unknown; spike it early (build order step 5).
- **Script scoping:** authored JS could touch global/other-slide DOM; mitigated by IIFE +
  id-scoping convention + validator warnings + one-at-a-time display. Not bulletproof; our
  agent is the only author.

## 13. Success criteria
- `mindsizer build adolescence.outline.md` yields a **linear, offline, single-file** deck whose
  slides are comprehension-grade and include at least one genuinely **interactive** slide,
  at the quality of `adolescence.deck.html` — produced by the harness, not by hand.
- The shell remains green under unit tests with a fake author; `tsc` clean.
