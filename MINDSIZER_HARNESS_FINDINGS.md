# mindsizer harness — findings from two real build sessions

_Date: 2026-06-24. Author: prior Claude Code session. Purpose: hand-off to a session that will
adjust the mindsizer build harness. Everything below is observed from two end-to-end runs, not
speculation. Where a number is estimated vs. measured, it says so._

## TL;DR

Two 10-slide decks were built with `mindsizer build <outline> --open`:

1. **mitchellh "My AI Adoption Journey"** (built during yesterday's Claude API outage)
2. **linear.app/next "Issue tracking is dead"** (built today, clean — no outage)

Both **completed with exit 0 and printed `✓ authored 10 slides` / `✓ sealed`**, yet **both shipped
a broken deck that only manual browser verification caught.** Separately, each build took
**~80–100 min wall-clock** and the second one alone **consumed ~60% of a 5-hour $100 Max usage
window**. The two headline problems are therefore: **(A) cost/latency per deck**, and **(B) the
seal step declares success while emitting structurally broken HTML.**

---

## A. Cost & latency

| | Session 1 (mitchell) | Session 2 (linear) |
|---|---|---|
| Slides | 10 | 10 |
| Wall-clock | ~80 min (last live check 1:19:15, then completion) | ~85–95 min (last live check 1:24:12, then completion) |
| Outcome | 8/10 slides usable raw | 10/10 sealed but 1 invisible + 6 styling/JS-broken |
| Usage cost | not measured | **~60% of a 5h $100 Max window** |

### What the time is actually spent on (observed via process inspection)

- The build **authors slides sequentially**: at any moment there was exactly **one `claude`
  authoring subprocess** alive (PIDs cycled one after another — 13464→15979 in S1,
  43846→55053→61155 in S2), plus **one `chrome-headless`** render process. Never a fan-out.
- The **parent `bun` process sat at ~0% CPU** (S1: 21–33s total CPU over 60+ min; S2: 11–33s over
  84 min). It is **entirely blocked on model latency**, not compute.
- Each slide goes through the agentic author loop: write HTML → render at 1280×720 → screenshot →
  critique → fix, iterating until "genuinely strong" (`src/render/design-brief.ts`,
  `src/agent/agentic-author.ts`). On Opus, with interactive slides taking the most iterations,
  this works out to **~8–10 min/slide × 10 slides, run back-to-back**.

### Levers (in rough order of impact)

1. **Parallelize slide authoring.** This is the single biggest lever. Slides are independent
   (each is self-contained HTML scoped to its own id). Sequential authoring is why wall-clock ≈
   sum of all slides. Fanning out N authors would cut wall-clock to ≈ slowest slide. The render
   step already uses headless chromium per slide, so concurrency mainly needs more browser
   contexts + concurrent SDK calls.
2. **Cap the per-slide iteration budget.** The author self-iterates on screenshots with no visible
   ceiling. A hard cap (e.g. 2–3 render passes) on most slides would bound both time and tokens.
3. **Right-size the model per step.** The parent is pure I/O wait on Opus. Consider Sonnet for the
   first-draft author pass and reserve Opus (or a single critique pass) for polish. Most tokens
   are spent in the iterate-on-screenshot loop.
4. **Make heavy interactivity opt-in / fewer slides by default.** Interactive slides (sliders,
   click-to-update, drag) cost the most render iterations. A "fast" mode (fewer slides, less
   interactivity) vs. a "full" mode would let the user trade cost for richness up front.

> Note: items 2–4 are inferred from the observed loop + token cost, not from reading the
> iteration-count code directly. Item 1 (sequential, one subprocess at a time) is directly
> observed.

---

## B. Reliability — the seal step ships broken HTML and reports success

This is the more dangerous finding. **In both sessions the harness printed success but produced a
deck that was visibly broken in a browser.** The build's own validator even *printed warnings* for
the exact broken slides, then sealed and exited 0 anyway.

### Session 1 defects (outage-correlated)

- **2 of 10 slides silently dropped.** Seal log: `⚠ s_bjoykzjx: expected exactly one <section
  data-slide-id>, found 0` and the same for `s_u1nb1ag8`. Those sections never made it into the
  sealed file → deck had **8 slides**, not 10. (These two correlate with agents hitting API
  500/529 during the outage.)
- **Stray API-error text baked into the deck.** The literal strings `API Error: 500 Internal
  server error…` and `API Error: 529 Overloaded…` were concatenated as **loose text nodes
  directly inside `<div class="deck">`** (not inside any section). They rendered as faint text
  bleeding past the slide frame.

### Session 2 defects (NO outage — clean run, still broken)

1. **One slide rendered invisible (`s_6tmlt4z2`, slide 9).** The agent's **prose commentary leaked
   into the sealed HTML**: the bytes between slide 8's `</script>` and slide 9's `<section>` were
   `\n<style>`+`` ` ``+` blocks, everything is inlined so it renders identically everywhere… Here
   is the final slide:\n\n`. The **literal `<style>` token in that sentence opened an
   unterminated style element**, which swallowed slide 9's entire `<section>` (and slide 10's
   style block) as CSS text. Result: browser DOM had **9 sections, counter read `01 / 09`**, slide
   9 gone. The seal validator *did* print `⚠ s_6tmlt4z2: expected exactly one <section
   data-slide-id>, found 0` — and sealed it anyway.
2. **6 of 10 sections lacked a standalone `id` attribute** (they had only `data-slide-id="s_xxx"`,
   not `id="s_xxx"`). But the slides' own scoped CSS uses `#s_xxx{…}` and their JS uses
   `document.querySelector('#s_xxx')`. Consequences:
   - `s_nvdsw0l6` (slide 8) had **15 scoped CSS rules that silently did not apply** → unstyled.
   - `s_19pmac2d` (slide 3) threw **`TypeError: Cannot read properties of null (reading
     'querySelectorAll')` at page load** → its interactive control was dead.
   - **Root cause is a spec mismatch in `src/render/design-brief.ts`:** the section template shown
     to the author is `<section data-slide-id="SLIDE_ID" data-layout="bespoke">` (no `id=`), but
     the very next instruction tells the author to "Use the given SLIDE_ID for data-slide-id AND
     every CSS/JS selector." Authors that follow that with `#SLIDE_ID` selectors produce CSS/JS
     that can never match, because the section carries `data-slide-id` but not `id`. The layout
     templates (`src/render/layouts/analogy.ts`, `plain.ts`) also emit only `data-slide-id`.
3. **Non-fatal warnings that were real breakage vs. cosmetic — all treated identically (ignored):**
   - real: the `found 0 <section>` and the `querySelectorAll` console error above.
   - cosmetic: `⚠ s_f2awddrn overflows by 104px`, `⚠ s_nvdsw0l6 overflows by 49px` — when I
     measured the **final** sealed slides every one had **0 overflow** (content fit). So the
     overflow warnings appear to be from an intermediate render state and were false alarms here.
   The harness has no way to tell these apart; it prints all of them and seals regardless.

### Cross-cutting root causes (seal step)

- **The seal step does not strip non-HTML agent output.** Whatever the author returns is
  concatenated in. Both the API-error text (S1) and the explanatory prose (S2) prove the extractor
  (`src/agent/extract-slide.ts`) is not isolating just `<section>…</section>`.
- **No invariant enforced that `id == data-slide-id`** on every section.
- **The build's own validation warnings are advisory, not gating.** `expected exactly one
  <section…> found 0` should be a hard failure (retry that slide), not a printed warning followed
  by a successful seal.
- **No final whole-deck verification.** Each slide is rendered individually during authoring, but
  nothing loads the *assembled* deck once to check: section count == outline count, no console
  errors, counter shows N/N, no loose text outside sections. That single check would have caught
  every Session-2 defect.

---

## C. Concrete fixes to consider (grounded in the above)

**Reliability (do these first — they're cheap and stop shipping broken decks):**

1. In the extractor, **keep only the `<section …data-slide-id>…</section>` of the returned
   content**; discard any prose/preamble/markdown fences before/after it.
2. At seal time, **auto-inject `id="<slide-id>"` on every `<section data-slide-id="<slide-id>">`**
   if missing. (This is exactly the patch I applied by hand to fix Session 2.) Better still, fix
   `design-brief.ts` so the template includes `id="SLIDE_ID"` and the selector instruction is
   consistent.
3. **Make seal validation gating, not advisory:** if a slide yields `found 0 <section>`,
   **re-author that one slide** (bounded retries) instead of sealing it. Distinguish hard failures
   (missing/duplicate section, parse error, unbalanced `<style>`/`<script>`, console error) from
   cosmetic ones (overflow), and only gate on the hard ones.
4. **Add a final assembled-deck check** in headless chromium after seal: load the file, assert
   `.deck section[data-slide-id].length === outline.slides.length`, assert 0 console errors,
   assert no text nodes that are direct children of `.deck`. Fail the build if any trip.

**Cost/latency:**

5. **Author slides concurrently** (biggest win; they're independent and self-scoped).
6. **Bound per-slide render iterations**, and/or **use a cheaper model for the draft pass**.
7. **Offer a fast/cheap mode** (fewer slides, interactivity opt-in) so the user picks the
   cost/richness trade-off before a ~$60, ~90-min run starts.

---

## D. Pointers

- Build entry / seal flow & the `building…` / `authored` / `sealed` messages:
  `src/cli.ts` (~lines 188–230).
- Author loop + screenshot-iterate brief: `src/agent/agentic-author.ts`,
  `src/render/design-brief.ts`, `src/render/fit-check.ts`, `src/render/query.ts`.
- Slide extraction from agent output: `src/agent/extract-slide.ts`.
- Section templates that emit `data-slide-id` (the `id=` mismatch source):
  `src/render/layouts/analogy.ts`, `src/render/layouts/plain.ts`, `src/render/design-brief.ts`.
- Evidence / artifacts left in the repo for cross-checking:
  - `ai-adoption.outline.html` (S1, hand-repaired to 10 slides) +
    `ai-adoption.outline.8slide.bak.html` (raw 8-slide build).
  - `linear-next.outline.html` (S2, hand-repaired) +
    `linear-next.outline.raw.bak.html` (raw build with the invisible slide & missing ids).
  - Both `*.context.json` sidecars and `*.outline.md` spines.

> Scope note: this reflects exactly two builds. The Session-2 defects (leaked prose, missing `id`)
> happened on a **clean run with no outage**, so they are harness bugs, not outage artifacts. The
> Session-1 dropped slides + stray error text are at least partly outage-driven, but the harness
> still sealed and reported success despite them — which is the same underlying gap.
