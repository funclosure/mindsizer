# mindsizer — Product Requirements Document

**Status:** v1.0 (kickoff draft)
**Last updated:** 2026-06-20
**One-liner:** Paste hard or dense text; a local agent digests it, asks what you need it *for*, and rebuilds it into slides that actually make it *click* — and exports the result as one self-contained HTML file you can carry anywhere.

---

## 1. Vision

Resize large-or-obscure information to fit the reader's mind, aimed by what they intend to *do* with it.

The mental model is **responsive design for cognition**: a responsive layout doesn't shrink a page into an unreadable thumbnail — it *reflows* content to fit a viewport. mindsizer reflows information to fit the human working-memory budget. The source isn't made *smaller* so much as *reflowed to fit the cognitive viewport*.

Two distinct resize operations live under this:

- **Large** is a *volume* problem — too many chunks. Solved by compression and chunking (keep the spine, drop the rest).
- **Obscure** is a *legibility* problem — chunks too dense, abstract, or jargon-knotted. Solved by translation: analogy, re-sequencing, concrete examples.

mindsizer leads with the second. Slides are the **first render target, not the point** — the durable asset is the resized content itself (the outline), so other shapes (brief, checklist, cards) are a roadmap, not a rewrite.

---

## 2. Value proposition

> **Summarizers make it _shorter_. Deck-makers make it _prettier_. mindsizer makes it _click_** — rebuilding hard information into the shape your purpose demands.

That triad is the positioning in one line: it names the two adjacent categories mindsizer is *not* in and states exactly how it's orthogonal to both. Shorter ≠ clearer; prettier ≠ clearer. mindsizer owns *clearer*.

---

## 3. Problem & wedge

### Problem
You have a dense source — a paper, a one-pager, a jargon-thick spec, an abstract concept — that is *available but cognitively locked*. You read it and didn't get it. The slow, painful work is outlining, structuring, de-obscuring, and (only last) presenting it.

### Wedge: de-obscure ("make hard things click")
The defensible, hard, valuable capability is **translation** — finding the analogy, spotting curse-of-knowledge gaps, re-sequencing for build-up. Summarizers are a commodity; an engine that makes hard things legible is not.

- **Compression rides along for free** (it's the easy prep step that feeds de-obscuring).
- **Reflow (one source → many shapes) is the long game** (see Roadmap).

---

## 4. Target user

Someone bouncing off information that's *available but locked* — a dense academic paper, a jargon-heavy technical spec, an abstract idea. Concretely: a **learner**, or a **professional crossing into an unfamiliar domain**.

The acute pain is *comprehension*, not polish or speed.

---

## 5. Positioning

mindsizer is a **comprehension tool, not a presentation tool.**

- **Real competitors:** a good tutor, a study group, re-reading the source a third time. These are what someone reaches for when stuck on hard material.
- **Not a competitor:** AI deck-makers (Gamma, Tome, Beautiful.ai). Their job is "I already understand this — make it look presentable, fast." Their metric is polish and speed. Even though both emit slides, the underlying jobs barely overlap.

**Why this distinction earns a line:** framing mindsizer as "AI that makes slides" walks into a crowded, well-funded category measured on polish, where mindsizer is the weaker entrant. Framing it as "makes hard things click" puts it in a category where the deck-makers aren't even participants — and the whole product (digest, purpose question, comprehension-first layouts) is built for *that* fight.

*Caveat:* the AI-deck space moves fast and feature lists will eventually brush against each other. The durable moat is the **wedge and metric** (comprehension), which shapes a fundamentally different product — not any single feature.

---

## 6. Core concepts (mental model)

These are the load-bearing ideas the whole architecture rests on.

### 6.1 The outline is the canonical asset
The outline is the **single source of truth for content and information hierarchy** — render-agnostic, durable. It is the "resized cognitive object." Everything else (HTML slides, future briefs/cards) is a *render* of it. Nothing ever reads the HTML to reconstruct what a slide means.

### 6.2 Content / design separation
- **Content** lives in the outline.
- **Design** lives in the HTML slide.
- These are different *layers*, not different *copies* of the same thing.

### 6.3 One-way content flow
Content flows **one direction only: outline → HTML** (data injected into a design template). Design changes touch **only** the HTML and never flow back up. This makes the outline canonical *by construction of the workflow* — true even for bespoke slides with no clean injection point.

> Analogy — **templating engine:** the bespoke HTML is the *template* (durable, fully free, where visual freedom lives); the outline is the *data* injected into it. Re-injecting data can't wipe a design tweak, because they're different layers.

### 6.4 Single writer
The Claude Agent SDK authors **both** artifacts and reconciles by intent. There is **no user-triggered regeneration** and no multi-writer race. The user steers the agent; the agent decides whether a change is content or design and edits the right artifact.

Two distinct gestures, never one blurry "edit the slide":
- **Edit content** → rewrites the outline, re-injects.
- **Edit design** → touches only this slide's HTML.

### 6.5 Per-slide addressability + self-correction
- The agent edits **one slide surgically** (like editing one function in a file) — never regenerates the whole deck, so slides you already liked stay byte-for-byte intact.
- Before showing a slide, the agent **renders and inspects its own output** (headless screenshot) and fixes overflow/breakage. This is "HTML it has actually looked at," not hopeful HTML.
- **Each slide is a real standalone `.html` file** served by the local server. The workspace preview pane loads it in an **`<iframe>`** (`src` = the per-slide file), so per-slide addressability is *literal*: the agent edits `slides/3.html`, screenshots that exact file, and the preview shows the same bytes that were validated. Isolation is the point — a slide's bespoke CSS/JS can't leak into the workspace chrome and vice versa, which matters because slides are full bespoke documents, not snippets. (The iframe is an *authoring-time* device only; export collapses it — see §6.6, §11.)

### 6.6 Kitchen vs takeout box
- **Authoring phase** (local workspace) can use anything: dev server, hot reload, libraries, the render-and-inspect loop, **per-slide files previewed via iframe** (§6.5).
- **Export phase** *flattens and seals* into one inert, dependency-free `.html` — the iframes collapse, each slide is inlined into the single document, no server, no sandboxing.
- You don't ship someone your kitchen; you ship the sealed box.

---

## 7. User flow

Pure text in → **digest** → **direction** → **outline** → **iterate slides** → **share / export**.

| Step | What happens | Notes |
|------|--------------|-------|
| **Ingest** | User pastes plain text. | v1 = pure text only. Future adapters (URL, YouTube, PDF) normalize to text *before* digest, so digest never knows the source. |
| **Digest** | Agent extracts the spine (key claims, structure, hierarchy). | **Purpose-agnostic** — no aim needed yet. Candidate for a digest subagent (context isolation on long sources). |
| **Direction** | Agent proposes an *informed* purpose/angle, since it's already read the source. | Sits **after** digest deliberately: the question feels *earned*, not gatekeeping, and the agent can tailor it ("this reads like a technical spec — want the mental model, or the build steps?"). |
| **Outline** | Agent produces the outline — the **first purpose-aimed resize**. De-obscuring happens here. | This is the collaboration checkpoint and the canonical content record. |
| **Iterate slides** | Agent generates and refines HTML slides per-slide, with self-check. | Steered via the two gestures (content vs design). |
| **Share / export** | Single self-contained HTML file, and/or per-slide images. | The carry-anywhere artifact is the actual deliverable. |

---

## 8. The purpose model

The single upfront question is **"What will you do with this?"** — because purpose is the *projection function*: it decides not just how much to keep but *what* to keep, and it also selects the ideal output shape.

| Purpose | Keep / drop | Natural render |
|---------|-------------|----------------|
| **Decide** | Keep the so-what and trade-offs; drop derivation. | Conclusion-first brief |
| **Teach** | Keep build-up, analogies, why-it's-true. | **Staged slides — the v1 hero render** |
| **Build** | Keep mechanics and gotchas; drop theory. | Reference / checklist |
| **Pass** | Keep testable distinctions. | Recall cards |

**Purpose is the hinge between Wedge A (de-obscure) and Wedge C (reflow):** one question simultaneously aims the de-obscuring *and* selects the render. This means reflow falls out of a question already being asked — not a rewrite.

**v1 scope:** ship **teach → slides** only. Purpose tunes *angle and depth* within teach; the four-way split stays dormant until other renders ship.

---

## 9. Architecture

### 9.1 Local-first (the key decision)
mindsizer runs as a **local tool: a local server with a browser UI** — essentially the Claude Code shape. This resolves several questions at once:

- The Agent SDK runs **on the user's machine**.
- The user's Anthropic API key lives in a **local env var / config** and never transits a third-party server. The "client-only key" privacy promise holds.
- Rendering happens **server-side on `localhost`**, so the agent can screenshot-and-inspect its own slides *and* export images locally.
- "Single writer" is literal — one local process authors everything.

### 9.2 Powered by the Claude Agent SDK
The multi-turn digest → direction → outline → iterate loop is the SDK's sweet spot. Usage:

- **Agent loop** — the digest→direction→outline→iterate conversation.
- **Custom tools** (in-process MCP server) — a *render-and-validate* tool (render a slide, screenshot, check for overflow/breakage).
- **Hooks** — `PostToolUse` to reject invalid/broken slides and force a retry.
- **File-edit tools** — surgical per-slide HTML edits.
- **Subagent (optional)** — a digest subagent so reading a long source doesn't bloat the main context.

> Claude-only. **BYOK = bring your Anthropic key.**

### 9.3 Renderer is abstracted
The render step is a slot: **outline → some HTML slide representation.** Generated HTML is the chosen direction (full visual freedom — required because the wedge is comprehension and some "click" moments need bespoke visuals a templated deck-maker can't express). **Marp is one possible export path, not the engine.** The single-file portability goal reinforces generated-HTML: you control every byte to inline.

---

## 10. Data model

### 10.1 Outline (canonical)
A structured representation of slides, each with content and a layout selector:

```
Deck
├── meta: { title, purpose, theme }
└── slides: [
      {
        id,
        title,
        content: [ ...points / hierarchy ],   // canonical content
        layout: "analogy" | "build-up" | "quote" | "plain" | ...,  // the design selector
        notes?
      },
      ...
    ]
```

The `layout` field is the **per-slide style knob** — it selects which design binds this slide's data. (Historical note: this is the `style:` field sketched at the very start of ideation; the instinct was correct.)

### 10.2 Slide (rendered)
Generated HTML, **one standalone `.html` file per slide** (e.g. `slides/3.html`), served by the local server and previewed in the workspace via an iframe (§6.5). Where data binds cleanly, content is injected into marked regions; where a slide goes fully bespoke (a hand-built comprehension visual), the agent keeps it faithful to the outline by hand. **Binding where clean, agent-reconciled where bespoke — the outline is the content spec either way.**

---

## 11. Export model

The deliverable is a **single self-contained HTML artifact** — zero dependencies, works by double-click on any machine, offline, indefinitely.

The export phase **flattens and seals**:
- CSS → inlined into a `<style>` block.
- Fonts → subset and base64-embedded into the CSS (or system-font fallback — see Open Questions).
- Images → data URIs.
- Slide navigation (keyboard arrows, slide counter, progress) → inlined as plain `<script>`. **The deck carries its own small runtime**, since there's no server at view-time. (Well-trodden — reveal.js and Marp HTML export do exactly this.)

Secondary export: **per-slide images (PNG)** — free via the server-side headless renderer; good for sharing on Slack/social.

---

## 12. Design language & theming

The first theme is the **"Field" editorial / instrument-panel aesthetic** (from the reference prototype):

- **Type:** Fraunces (variable display serif, `SOFT`/`opsz` axes dialed) + Geist (body) + Geist Mono (micro-labels / readouts).
- **Color:** dark navy ground, cream foreground, a single cyan accent. Monochrome otherwise.
- **Texture:** hairline rules (~16% opacity), dot-grid substrate, uppercase wide-tracked mono labels.

**Critical adaptation — invert the density.** The reference is gloriously *dense* (an identity showcase *wants* to be pored over). Comprehension slides want the opposite: **one idea per frame, generous air, low cognitive load.** Keep the design language; dial the density way down to serve the wedge.

Theming maps to a small library of **comprehension layouts** the `layout` field selects from (analogy two-column, build-up, quote, plain, etc.).

---

## 13. Scope

### v1 — In
- Pure-text input (paste).
- Digest (spine extraction).
- Informed direction (teach-focused; purpose tunes angle/depth).
- Visible, editable, canonical outline.
- Agent-generated HTML slides with per-slide iteration and self-check.
- Content/design routed edits (single writer, two gestures).
- Local server + browser workspace.
- Export: one self-contained HTML file + per-slide PNG images.
- One theme ("Field"), with a small set of comprehension layouts.

### v1 — Out
- Other ingest adapters (URL, YouTube, PDF).
- The other three render shapes (brief, checklist, cards).
- Accounts / cloud sync / collaboration.
- Non-Claude providers.
- Multiple themes / user-authored CSS.

### Roadmap (Wedge C)
- One outline → many render shapes, selected by purpose (decide → brief, build → checklist, pass → cards).
- Additional ingest adapters (all normalize to text before digest).
- Additional themes.

---

## 14. Success metric

**The click** — comprehension, not speed or polish.

> A user pastes something they'd been bouncing off and reaches "oh, *now* I see it," with one round of refinement.

This means a lightweight comprehension signal in the product (a self-rated "now I get it," or a quick check question) rather than only an export button. **Decided:** "the click" is the *sole* north star — no measurable speed proxy. A speed metric ("present-ready in under 2 minutes") was considered and rejected: it's easy to measure but pulls toward the deck-maker category mindsizer is deliberately not in (§5). Comprehension stays the only metric, fuzzy but on-mission.

---

## 15. Decisions (resolved 2026-06-20)

1. **Layout model** → **hybrid.** A predefined library of comprehension layouts covers common cases (consistent, QA-able, bounded); the agent escapes to bespoke only when comprehension genuinely needs it. The "analogy" two-column layout in `wireframe.html` (eventual consistency → office gossip) is the library's first concrete entry.
2. **Font strategy** → **subset + embed.** Use the Field stack (Fraunces / Geist / Geist Mono). Authoring loads them via Google Fonts; the export-and-seal step subsets + base64-embeds them so the single `.html` stays truly offline. (Reference files settle *which* fonts; embedding is just the seal step, §11.)
3. **Success metric** → **"the click" only.** No measurable speed proxy — see §14.
4. **Digest** → **subagent.** Run digest as a subagent for context-isolation on long sources and to keep the main loop fast.
5. **Direction UI** → **tappable proposed options.** The agent presents the informed purpose/angle as selectable options (the "teaching · conceptual" pill in `wireframe.html`), not open chat.

### Design references (locked)
- **Slide theme:** `Field__trust.html` — dark navy `#0a1a2f`, cream `#f3efe5`, single cyan accent `#4DD9E0`, dot-grid substrate, hairline rules ~16%, uppercase wide-tracked mono labels.
- **Workspace UI:** `wireframe.html` — titlebar (localhost + purpose pill + export) · slide strip (per-slide addressability) · two-pane Outline/Preview · agent bar with content/design gesture toggle + routing caption.

---

## 16. Proposed tech stack

*(Proposal, not locked — see Open Questions.)*

- **Server + agent:** TypeScript / Node — one language across the stack, and the Claude Agent SDK has first-class TS support.
- **Rendering / self-inspection / image export:** a headless browser (Playwright or Puppeteer) on `localhost` for screenshot-based self-check and PNG export.
- **Workspace UI:** browser app (outline pane + slide preview + agent bar). Framework choice open (React or lightweight).
- **Exported deck runtime:** vanilla JS for slide navigation, inlined into the single-file output.
- **Outline storage:** local file (the canonical artifact); the deck travels as the exported HTML.

---

## 17. Suggested build order (kickoff)

1. **The seam first.** Define the outline schema and the `outline → HTML` injection contract. This is the spine everything hangs off.
2. **Static render path.** Outline → one themed HTML slide (no agent yet). Prove the "Field" theme survives the density-inversion on a real 16:9 comprehension frame.
3. **Export-and-seal.** Flatten to a single self-contained HTML file with inlined nav runtime. Confirm it runs offline by double-click. (Get the carry-anywhere promise working *early* — it's the product's final form.)
4. **Agent loop — outline generation.** Pure text → digest → direction → outline. The comprehension core.
5. **Agent loop — slide iteration.** Per-slide generation + the render-and-inspect self-check + content/design routed edits.
6. **Workspace UI.** Wire the three panes (outline / preview / agent bar) over the working agent.
7. **Image export + polish.**

---

## 18. Risks

- **Content drift** — regenerating HTML silently mutates meaning. *Mitigation:* one-way content flow + content/design gesture separation (§6).
- **Whole-deck churn** — fixing one slide disturbs others. *Mitigation:* per-slide addressability (§6.5).
- **Brittle generated HTML** — the model emits broken slides. *Mitigation:* render-and-inspect self-correction loop (§6.5, §9.2).
- **De-obscuring is hard to evaluate** — "did it click?" resists automated measurement. *Mitigation:* lightweight in-product comprehension signal; treat the metric as directional.
- **Category confusion** — users / market read it as "another AI deck-maker." *Mitigation:* lead with the comprehension wedge in all copy and UX (§5).

---

*This PRD is the consolidated output of the mindsizer ideation thread. It is meant to be iterated on — §15 holds the live decisions.*
