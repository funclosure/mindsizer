# Agent Loop — `mindsizer ingest` (text → outline) — Design

**Status:** Approved design
**Date:** 2026-06-20
**Scope:** PRD §17 build-order step 4 — the comprehension core: pure text → **digest** → **direction** → **outline.md**. Where mindsizer stops needing a hand-written outline and starts ingesting raw text.
**Builds on:** outline core (step 1 — `mintSlideId`, `validateOutline`, `serializeOutline`) and the `mindsizer` CLI (step 3).
**Resolves:** PRD §7 (digest/direction/outline flow), §8 (purpose model — teach only in v1), §9.2 (Claude Agent SDK), §15.4 (digest as subagent), §15.5 (tappable direction options).

---

## 1. Purpose & boundaries

Add `mindsizer ingest <text-file>`: read raw text, digest it, let the agent propose an *informed* direction (numbered terminal choices), and generate a canonical `outline.md` — which `mindsizer <outline.md>` then seals into a deck (step 3).

**In scope:** the `ingest` subcommand; the three LLM operations (digest, direction, outline) behind a testable seam; the interactive direction prompt (+ non-interactive flags); reuse of the step-1 core to guarantee outline validity.

**Out of scope (later steps):** per-slide iteration / render-and-inspect (step 5), the workspace UI (step 6), other purposes/render shapes, ingest adapters for URL/PDF/YouTube (all normalize to text *before* digest — future), long-source chunking.

---

## 2. Decisions this rests on (resolved)

- **Surface:** interactive CLI `mindsizer ingest <text-file>` with `--angle <id>` / `--yes` for non-interactive use; output is `outline.md` (the editable checkpoint), sealed separately.
- **SDK:** **`@anthropic-ai/claude-agent-sdk`** via `query()`, matching the loupe reference and PRD §9.2. Auth is the Claude Code session (no key required), falling back to `ANTHROPIC_API_KEY` if set (PRD §9.1 BYOK). Tools are fully disabled (`allowedTools: []`) — the SDK is used as a structured multi-turn LLM, exactly as loupe does.
- **Digest as subagent (§15.4):** each operation is a separate, single-shot `query()` with its own isolated context — the digest never shares context with later steps.
- **Structured data without `messages.parse`:** `query()` has no first-class structured-output mode, so digest/direction/outline are prompted to emit **JSON only**, then **Zod-validated with one retry** on parse failure.
- **Outline validity by construction:** the agent returns structured slide data; *we* build the canonical `Outline` (ids via step-1 `mintSlideId`, `purpose: teach`, `theme: field`), `validateOutline`, and `serializeOutline`. The agent never hand-writes ids or frontmatter.
- **v1 purpose = teach; layouts = analogy/plain** (what the renderer supports).

---

## 3. The command

```
mindsizer ingest <text-file> [--angle <id>] [-o <outline.md>] [--yes]
```

- Reads `<text-file>` (plain text). Default output: `<basename>.outline.md` beside the input (the loupe sidecar convention). `-o` overrides.
- **Interactive (default):** prints `digesting…`, then the agent's proposed directions as a numbered list; reads the user's choice from the terminal; writes the outline.
- `--angle <id>`: pick a direction non-interactively (must match a proposed id, else error listing the valid ids). `--yes`: auto-pick the first proposed direction (for scripting/CI).
- Progress to stdout: `✓ digested (N points)`, the direction prompt, `✓ wrote <path>`.
- Errors (stderr, exit 1): unreadable file; no auth available; empty/blank source; the agent returns unparseable data after one retry.
- The default (no `ingest`) `mindsizer <outline.md>` seal path from step 3 is unchanged — `ingest` is a new dispatch branch in `cli.ts`.

Example:
```
$ mindsizer ingest paper.txt
  digesting… (12 key points)
  This reads like a technical spec. Aim it:
   [1] the mental model — why it works
   [2] the build steps — how to use it
  > 1
  ✓ wrote paper.outline.md
$ mindsizer paper.outline.md      # → paper.outline.html
```

---

## 4. Architecture & seams

Two injected interfaces keep the orchestrator pure and unit-testable with no live LLM:

```ts
interface ModelClient {
  digest(sourceText: string): Promise<DigestResult>;
  proposeDirections(digest: DigestResult): Promise<Direction[]>;
  generateOutline(digest: DigestResult, angle: Direction): Promise<DraftDeck>;
}
interface Prompter {
  chooseAngle(options: Direction[]): Promise<Direction>;
}
```

- **Real `ModelClient`** = `anthropic-client.ts`, wrapping `query()` (Agent SDK). **Real `Prompter`** = a `readline` terminal impl, plus a non-interactive picker for `--angle`/`--yes`.
- **Orchestrator** `ingest(sourceText, { model, prompter }, opts)` → outline markdown string. No IO, no SDK, no stdin.

Data flow: `digest → proposeDirections → (chooseAngle) → generateOutline → build Outline (mint ids) → validateOutline → serializeOutline`.

---

## 5. Data shapes (Zod-validated)

```ts
interface DigestResult {
  title: string;            // a working deck title
  keyPoints: string[];      // the spine — ordered key claims
  sourceCharacter: string;  // one-line read, e.g. "reads like a technical spec"
}
interface Direction {
  id: string;               // kebab id, e.g. "mental-model"
  label: string;            // short, e.g. "the mental model"
  description: string;      // why-this-angle, e.g. "why it works"
}
interface DraftSlide {
  title: string;
  layout: "analogy" | "plain";
  markdown: string;         // body markdown (analogy: a blockquote for the analogy)
}
interface DraftDeck {
  title: string;
  slides: DraftSlide[];
}
```

`generateOutline`'s `DraftDeck` is mapped to the canonical `Outline`:
```ts
const outline: Outline = {
  meta: { title: draft.title || digest.title, purpose: "teach", theme: "field" },
  slides: draft.slides.map((s) => ({
    id: mintSlideId(), layout: s.layout, title: s.title, markdown: s.markdown,
  })),
};
// validateOutline(outline) → throw on issues; return serializeOutline(outline)
```

---

## 6. The Agent SDK adapter (`anthropic-client.ts`)

Mirrors loupe's proven `query()` usage. A one-shot helper runs a single isolated turn and returns the full text:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({
    prompt: userPrompt, // single-shot string prompt
    options: {
      systemPrompt,
      model: MODEL,
      permissionMode: "bypassPermissions",
      allowedTools: [],
      disallowedTools: ["Bash","Read","Write","Edit","Glob","Grep","Agent","WebFetch","WebSearch","NotebookEdit"],
      includePartialMessages: true,
    },
  });
  let text = "";
  for await (const msg of q as AsyncIterable<{ type: string; event?: any }>) {
    if (msg.type === "stream_event" && msg.event?.type === "content_block_delta" &&
        msg.event.delta?.type === "text_delta" && msg.event.delta.text) {
      text += msg.event.delta.text;
    }
    if (msg.type === "result") break;
  }
  return text;
}
```

Each `ModelClient` method builds its prompt (§7), calls `runQuery`, and parses the result with `parseValidated(text, schema)` (§8); on a parse failure it retries `runQuery` once with a "return valid JSON only" nudge appended, then throws.

(If a one-shot string prompt proves unsupported by the installed SDK version, fall back to loupe's single-message `MessageChannel` shape — same options, push one message, read to `result`.)

**Auth:** nothing is set — `query()` uses the Claude Code session, falling back to `ANTHROPIC_API_KEY`. No key handling in mindsizer code.

---

## 7. Prompts (`prompts.ts`, pure)

Pure builders, unit-tested for including the source/digest/angle and asking for JSON-only:

- `digestPrompt(sourceText)` — system: "extract the spine of this source as a learner's digest"; user: the source; instruct JSON `{title, keyPoints, sourceCharacter}` only.
- `directionPrompt(digest)` — system: "propose 2–3 *teach* angles tailored to this source, as the informed direction question"; user: the digest; instruct JSON `Direction[]` only.
- `outlinePrompt(digest, angle)` — system: the mindsizer comprehension brief (one idea per slide, analogy/plain layouts, the analogy convention = a `>` blockquote for the analogy); user: digest + chosen angle; instruct JSON `DraftDeck` only.

---

## 8. JSON extraction (`json.ts`, pure)

- `extractJson(text)` — strip ```` ```json ```` fences and leading/trailing prose; return the first balanced `{…}`/`[…]`.
- `parseValidated<T>(text, schema)` — `JSON.parse(extractJson(text))` → `schema.parse(...)`; throws a clear error on failure (the adapter catches it to trigger the one retry).

These hold the fragile parsing logic and are fully unit-tested even though the live `query()` is not.

---

## 9. File structure

```
src/agent/
├── model-client.ts     # ModelClient interface + types + Zod schemas
├── prompts.ts          # pure prompt builders
├── json.ts             # extractJson + parseValidated (pure)
├── anthropic-client.ts # real ModelClient over @anthropic-ai/claude-agent-sdk (not unit-tested — live)
├── prompter.ts         # Prompter interface + readline impl + non-interactive picker
├── ingest.ts           # orchestrator: ingest(sourceText, deps, opts) → outline markdown
└── index.ts            # barrel
src/cli.ts              # + `ingest` subcommand dispatch
package.json            # + @anthropic-ai/claude-agent-sdk, zod
```

`src/index.ts` re-exports `./agent/index`.

---

## 10. Testing

- **json.ts** — strips fences, extracts the object from surrounding prose, validates against a schema, throws on malformed input.
- **prompts.ts** — each builder includes its inputs (source text / digest points / angle label) and asks for JSON only.
- **model-client.ts** — Zod schemas accept valid shapes and reject bad ones (e.g. unknown layout).
- **ingest.ts (the core)** — with a **fake `ModelClient`** (canned digest/directions/draft) and **fake `Prompter`** (picks a given id): asserts the pipeline runs in order, honors `--angle`, mints stable ids, and returns markdown that **round-trips through step-1 `parseOutline`** with `purpose: teach` and the chosen slides. An invalid `--angle` id throws listing valid ids.
- **Not unit-tested (documented):** `anthropic-client.ts` (needs live Claude auth — this sandbox has none) and the `ingest` CLI subprocess path. The adapter is *typechecked* against the installed SDK types via `tsc`; behavior is verified by the user running `mindsizer ingest` with their Claude Code session.

---

## 11. Error handling

| Condition | Behavior |
|-----------|----------|
| input file unreadable | stderr `error: cannot read <path>`, exit 1 |
| source empty/blank | stderr `error: source is empty`, exit 1 |
| `--angle` not among proposed | stderr `error: unknown angle '<id>' — choose from: <ids>`, exit 1 |
| agent returns unparseable JSON after one retry | stderr `error: could not parse <step> output`, exit 1 |
| generated outline fails `validateOutline` | stderr lists issues, exit 1 |
| no Claude auth | the SDK surfaces an auth error → stderr, exit 1 |
| success | progress to stdout, write outline.md, exit 0 |

---

## 12. Summary

`mindsizer ingest <text-file>` digests raw text, proposes an informed teach-angle as numbered terminal choices, and generates a canonical `outline.md` — using the Claude Agent SDK exactly as loupe does (no key; session auth), with the LLM behind a `ModelClient` seam so the pipeline is fully unit-tested, and the step-1 core reused so every generated outline is valid by construction. The result feeds the step-3 sealer: `mindsizer paper.outline.md` → a deck.
