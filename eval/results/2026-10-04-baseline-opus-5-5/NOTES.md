## Phase 0: what it took to run the harness on Opus 5.5

| issue | symptom | fix |
|---|---|---|
| **Agent SDK too old for Opus 5.5** | `@anthropic-ai/claude-agent-sdk@0.2.86` bundles Claude Code 2.1.141. Every call on `claude-opus-5-5` came back as a synthetic `result` with `is_error: true`: _"API Error: 400 Claude Code 2.1.141 does not support this model; version 2.1.280 or newer is required."_ `runQuery` surfaced this as `EmptyReplyError` ("returned no output"), which hides the real cause. | Upgraded to `^0.3.289` (package.json + bun.lock). No code changes needed: `query`, `tool`, `createSdkMcpServer`, `effort`, `includePartialMessages` and the `text_delta` stream events are all unchanged. |
| Playwright browser revision | `playwright@1.61` expects `chromium_headless_shell-1228`; this machine ships revision 1194. | Environment-only: symlinked the 1194 headless shell under the 1228 path. No repo change. On a normal machine `bunx playwright install chromium` covers it. |
| Nested Claude Code session | Inside a Claude Code cloud session, the SDK's child `claude` processes inherited the parent's `CLAUDE_CODE_SESSION_ID` / remote-session env and attached to the parent session (same `session_id`, the parent's tool list, ~2× the cache-creation tokens). | `eval/clean-env.sh` strips those variables but keeps the auth ones. Every harness and judge call in this run went through it. |
| `effort` | Checked: `modelFor()` passes each role's default effort (ingest `high`, author/review `medium`, judge `low`), and the 0.3.x SDK still accepts `effort` as an option. | none |
| Forced `tool_choice` / always-on thinking | `src/` never sets `tool_choice` or `thinking`, so no 400s. | none |
| Text between tool calls arrives as empty `thinking` blocks | `runAgentic`'s drain keeps the last assistant `text` turn containing `<section`. The agentic author does **not** depend on it: it seals the best *render-tool candidate* (`pickBestCandidate`) and only falls back to the drained text if the model never rendered. Checked: all 21 baseline slides were sealed from a render candidate. | none |

Smoke test (`build examples/dont-scale.plan.md`): 9 slides, 0 console errors, 3.6 min, ~$10.53. That deck is kept as `dont-scale-committed-plan` and scored like the others.

## Environment limits on this run

- **10 of 11 sources could not be fetched.** The cloud environment's egress policy returned 403 on
  CONNECT for every source host: paulgraham.com, donellameadows.org, distill.pub, doi.org,
  fourmilab.ch, consc.net, alignment.anthropic.com, darioamodei.com, arxiv.org and youtube.com.
  Alternate open copies of the Turing paper (pbworks, umbc.edu) were blocked too. The fetcher
  records each source as `unavailable` with the exact error. Nothing was substituted.
- `dont-scale` was the only fetchable source, via its committed local copy `examples/dont-scale.txt`.
- So this baseline is **two Opus 5.5 decks of one source**: a fresh `plan` + `build`, and a
  `build` of the committed plan. The Opus 4.8 reference deck is the third deck scored. Every
  number below is about one essay. Treat them as a calibrated *starting point* for the harness
  comparison, not as a cross-genre baseline. When the network allows, `bun run eval:fetch &&
  bun run eval:baseline` fills in the other ten.

## Lessons

**What the numbers say (one essay, so read them as directional):**

- **The mechanical gate's misses are mostly craft, not comprehension.** 20 of 21 Opus 5.5 slides
  passed the gate (0 overflow, 0 errors). Only 1 of those 20 scored < 3 on a key criterion
  (claim / mechanism / device): `s_r9egdmae`, where the mechanism is text, not drawing. But 19 of
  the 20 scored **2 on craft**. The judges and the deterministic checks agree on why: 9–11px mono
  labels that won't read at presentation distance, AA contrast failures on 15 of 21 slides (min
  1.28:1), and 1 text collision plus 4 cut-off text runs that the gate can't see. The evaluator
  redesign should own legibility, not just claim and mechanism.
- **Opus 4.8 → Opus 5.5 (with a plan) moved exactly the criteria the redesign targets.** The 4.8
  reference deck had 3 of 8 gate-passing slides fail a key criterion (38% vs 5%). One of them,
  `s_rb9s0oum`, has three strategy buttons that do nothing; I confirmed that in the real sealed
  deck too, so it is not a scorer artifact. That is the textbook case for a skeptical evaluator,
  and the current gate seals it. The 4.8 deck also had a text-only "mechanism" slide (score 1)
  and two fabricated causal claims.
- **The quiz is the only signal where 4.8 beat 5.5:** 5/8 correct vs 4/8 for both 5.5 decks.
  Most 5.5 misses are *why/how* questions ("why do founders fail to see this", "why start narrow",
  "what are the benefits of doing it by hand"), plus one topic the committed-plan deck never covers (the Big Launch). The 5.5 decks show *what* happens very well (claim
  at rest is 4 on 16 of 21 slides) but drop the source's reasons. The quiz was identical across
  both scorings of every deck, so it is the most stable deck-level signal we have.
- **The current gate rarely lets the model look.** Only 2 of 21 slides were sealed on a clean
  first render (the model never saw a screenshot). The usual pattern is that pass 1 overflows, the
  model sees one screenshot, fixes the overflow, and pass 2 seals. So the model sees its slide
  roughly once, and only when something is broken. A slide that renders clean but illegible is
  never looked at again.

**Surprises while building the scorer:**

- **The SDK failure was silent.** The old SDK's "Claude Code too old for this model" 400 showed up
  as `EmptyReplyError: model returned no output`. `runQuery` should surface `result.is_error`
  text. That is a small harness fix, left for a separate PR because this one must not change
  `src/agent`.
- **The first rubric draft graded the theme, not the slide.** It listed mono kicker labels, a
  dot-grid background and italic-serif accents as "generic". The `field` theme prescribes all
  three, so every slide scored 2 on `not_generic`. The judges now get the theme brief. Pilot
  scores are kept in `pilot-rubric-v0/`.
- **Bounding-box overlap detection is wrong for inline text.** A wrapped `<span>`'s union box
  swallows its inline sibling, which caused 2 false positives in the pilot. Overlap now uses
  per-line rects. Partly cut-off text (inside an `overflow:hidden` chart) also needed its own
  check, because ancestor clipping otherwise hides it.
- **Standalone slide rendering is faithful.** Scoring each slide in fit-check's page shell
  matched the sealed deck everywhere I spot-checked, including the dead-button slide.

**Recommended rubric changes (before tuning on calibration data):**

1. **Add a deterministic minimum-type-size check to craft**: the share of text runs under 12px, and
   the smallest size carrying meaning. It is the dominant craft failure and needs no judge.
2. **Split `not_generic` into layout-defining vs ornamental defaults.** The "2+ defaults → 2" rule
   saturates: 16 of 21 slides score 2 because nearly every slide has a numbered eyebrow plus the
   prose-left / figure-right split, even when the judge says the figure itself is specific.
   Ornaments (eyebrow, readout line) should cost less than a layout default.
3. **`device_works` is the noisiest criterion:** 5 of 14 pairs flipped by 1, though none crossed
   the pass line. Sample it twice and take the minimum, or give the judge a fixed minimum
   exploration (operate, vary, reset) so runs explore the same states.
4. **`claim_at_rest` is near ceiling** (16/21 at 4). Make the reader call harder: a 5-second
   glance at a downscaled screenshot, or require the reader to name the mechanism as well as the
   claim. Otherwise the evaluator's main target can't show improvement.
5. **`fidelity` never gives a 4** (19/21 at 3). The judge treats any paraphrase as "minor
   simplification". Either re-anchor 4 as "no distortion; paraphrase allowed", or collapse
   fidelity to pass/fail plus the fabrication list, which is the part that matters.
6. **`coherence` has almost no resolution** (3 on all three decks, one 3→4 flip). Score its parts
   separately (kit consistency, motif presence, motif development) or drop it until there are
   enough decks to compare.
7. Fill [`eval/calibration.html`](../../calibration.html) (20 slides, shuffled, judge scores
   hidden), then use the disagreements as few-shot anchors, starting with craft and not_generic,
   where the judges are most opinionated.
