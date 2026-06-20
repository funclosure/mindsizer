# Agent Loop — `mindsizer ingest` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mindsizer ingest <text-file>` — raw text → digest → direction → canonical `outline.md`, using the Claude Agent SDK (like loupe), with the LLM behind a testable seam (PRD §17 step 4).

**Architecture:** A pure orchestrator (`ingest`) runs three LLM operations through a `ModelClient` interface and a `Prompter` interface (both injected). The real `ModelClient` wraps `@anthropic-ai/claude-agent-sdk`'s `query()` (auth via the Claude Code session, no key); the real `Prompter` reads a numbered choice from the terminal. Generated slide data is rebuilt into a canonical `Outline` via the step-1 core (`mintSlideId`/`validateOutline`/`serializeOutline`), so every outline is valid by construction.

**Tech Stack:** TypeScript, Bun, Vitest, `zod` (schema validation), `@anthropic-ai/claude-agent-sdk` (`query()`, matching loupe). Builds on `src/outline/` (step 1) and `src/cli.ts` (step 3).

**Spec:** `docs/superpowers/specs/2026-06-20-agent-loop-ingest-design.md`

**Reality note for the controller:** the real adapter (`anthropic-client.ts`, Task 6) needs live Claude auth, which this sandbox lacks. It is **typecheck-verified** (`tsc`), not run. The orchestrator, prompts, JSON parsing, and prompter logic are fully unit-tested with fakes. The end-to-end `ingest` is verified by the user running the command.

---

### Task 1: Dependencies + ModelClient types & schemas

**Files:**
- Modify: `package.json` (add `zod`, `@anthropic-ai/claude-agent-sdk`)
- Create: `src/agent/model-client.ts`
- Test: `tests/agent/model-client.test.ts`

- [ ] **Step 1: Add dependencies**

Run: `bun add zod@^3 @anthropic-ai/claude-agent-sdk@^0.2.86`
Expected: both appear under dependencies, install without error.

- [ ] **Step 2: Write the failing test**

Create `tests/agent/model-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
} from "../../src/agent/model-client";

describe("agent schemas", () => {
  it("accepts a valid digest and rejects a malformed one", () => {
    expect(
      DigestSchema.parse({ title: "T", keyPoints: ["a"], sourceCharacter: "spec" }),
    ).toBeTruthy();
    expect(() => DigestSchema.parse({ title: "T" })).toThrow();
  });

  it("accepts valid directions", () => {
    expect(
      DirectionsSchema.parse([{ id: "x", label: "L", description: "d" }]),
    ).toHaveLength(1);
  });

  it("accepts a draft deck and rejects an unknown layout", () => {
    expect(
      DraftDeckSchema.parse({
        title: "T",
        slides: [{ title: "A", layout: "analogy", markdown: "b" }],
      }),
    ).toBeTruthy();
    expect(() =>
      DraftDeckSchema.parse({
        title: "T",
        slides: [{ title: "A", layout: "carousel", markdown: "b" }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/agent/model-client.test.ts`
Expected: FAIL — cannot find module `../../src/agent/model-client`.

- [ ] **Step 4: Write the implementation**

Create `src/agent/model-client.ts`:

```ts
import { z } from "zod";

export const DigestSchema = z.object({
  title: z.string(),
  keyPoints: z.array(z.string()),
  sourceCharacter: z.string(),
});
export type DigestResult = z.infer<typeof DigestSchema>;

export const DirectionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});
export const DirectionsSchema = z.array(DirectionSchema);
export type Direction = z.infer<typeof DirectionSchema>;

export const DraftSlideSchema = z.object({
  title: z.string(),
  layout: z.enum(["analogy", "plain"]),
  markdown: z.string(),
});
export const DraftDeckSchema = z.object({
  title: z.string(),
  slides: z.array(DraftSlideSchema),
});
export type DraftSlide = z.infer<typeof DraftSlideSchema>;
export type DraftDeck = z.infer<typeof DraftDeckSchema>;

/** The LLM-backed operations of the ingest pipeline (the seam). */
export interface ModelClient {
  digest(sourceText: string): Promise<DigestResult>;
  proposeDirections(digest: DigestResult): Promise<Direction[]>;
  generateOutline(digest: DigestResult, angle: Direction): Promise<DraftDeck>;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/agent/model-client.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/agent/model-client.ts tests/agent/model-client.test.ts
git commit -m "feat: agent ModelClient seam + zod schemas"
```

---

### Task 2: JSON extraction & validation

**Files:**
- Create: `src/agent/json.ts`
- Test: `tests/agent/json.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, parseValidated } from "../../src/agent/json";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a ```json code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts the object from surrounding prose", () => {
    expect(extractJson('Here is the digest: {"a":1} — done')).toBe('{"a":1}');
  });

  it("extracts an array", () => {
    expect(extractJson('[{"id":"x"}]')).toBe('[{"id":"x"}]');
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("parseValidated", () => {
  const schema = z.object({ a: z.number() });
  it("parses + validates", () => {
    expect(parseValidated('{"a":1}', schema)).toEqual({ a: 1 });
  });
  it("throws on schema mismatch", () => {
    expect(() => parseValidated('{"a":"x"}', schema)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/json.test.ts`
Expected: FAIL — cannot find module `../../src/agent/json`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/json.ts`:

```ts
import type { ZodType } from "zod";

/**
 * Extract a JSON object/array from model output: strip code fences, then take
 * the span from the first `{`/`[` to the last `}`/`]` (robust to surrounding
 * prose and to braces inside string values).
 */
export function extractJson(text: string): string {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const start = s.search(/[{[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON found in model output");
  }
  return s.slice(start, end + 1);
}

/** Parse + Zod-validate model output. Throws on malformed or invalid JSON. */
export function parseValidated<T>(text: string, schema: ZodType<T>): T {
  return schema.parse(JSON.parse(extractJson(text)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/agent/json.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/json.ts tests/agent/json.test.ts
git commit -m "feat: robust JSON extraction + zod validation for model output"
```

---

### Task 3: Prompt builders

**Files:**
- Create: `src/agent/prompts.ts`
- Test: `tests/agent/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { digestPrompt, directionPrompt, outlinePrompt } from "../../src/agent/prompts";

const digest = {
  title: "Eventual Consistency",
  keyPoints: ["replicas converge", "reads can be stale"],
  sourceCharacter: "technical spec",
};
const angle = { id: "mental-model", label: "the mental model", description: "why it works" };

describe("prompts", () => {
  it("digestPrompt includes the source and asks for JSON only", () => {
    const p = digestPrompt("SOME SOURCE TEXT");
    expect(p.user).toContain("SOME SOURCE TEXT");
    expect(p.system.toLowerCase()).toContain("json only");
  });

  it("directionPrompt includes a key point and asks for teach angles", () => {
    const p = directionPrompt(digest);
    expect(p.user).toContain("replicas converge");
    expect(p.system.toLowerCase()).toContain("json only");
  });

  it("outlinePrompt includes the angle and names the analogy/blockquote convention", () => {
    const p = outlinePrompt(digest, angle);
    expect(p.user).toContain("the mental model");
    expect(p.system).toContain("analogy");
    expect(p.system).toContain(">");
    expect(p.system.toLowerCase()).toContain("json only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/prompts.test.ts`
Expected: FAIL — cannot find module `../../src/agent/prompts`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/prompts.ts`:

```ts
import type { DigestResult, Direction } from "./model-client";

export interface Prompt {
  system: string;
  user: string;
}

export function digestPrompt(sourceText: string): Prompt {
  return {
    system:
      "You are mindsizer's digest stage. Extract the spine of a source for a learner: a working title, the ordered key claims/points, and a one-line characterization of the source. Respond with JSON only — no prose, no code fence: " +
      '{"title": string, "keyPoints": string[], "sourceCharacter": string}.',
    user: `Source:\n\n${sourceText}`,
  };
}

export function directionPrompt(digest: DigestResult): Prompt {
  return {
    system:
      "You are mindsizer's direction stage. Propose 2-3 distinct TEACH angles tailored to this specific source — the way a tutor asks 'do you want the mental model, or the build steps?'. Each angle aims how the explanation is framed. Respond with JSON only — an array of " +
      '{"id": kebab-case string, "label": short string, "description": one phrase}.',
    user: digestText(digest),
  };
}

export function outlinePrompt(digest: DigestResult, angle: Direction): Prompt {
  return {
    system: [
      "You are mindsizer's outline stage. Turn the digest into a comprehension-first slide outline that makes the idea CLICK, aimed by the chosen angle.",
      "Rules: one idea per slide; generous and low cognitive load; build understanding up.",
      "Each slide uses one of two layouts:",
      '- "analogy": a two-column comprehension frame. Its markdown MUST contain a concept explanation AND a blockquote (a line starting with >) giving a concrete analogy with a **bolded** source, e.g. > Like **office gossip** — everyone hears eventually.',
      '- "plain": a title plus body (paragraphs or a bullet list).',
      'Respond with JSON only: {"title": string, "slides": [{"title": string, "layout": "analogy"|"plain", "markdown": string}]}.',
    ].join("\n"),
    user: `Angle: ${angle.label} — ${angle.description}\n\n${digestText(digest)}`,
  };
}

function digestText(d: DigestResult): string {
  return (
    `Digest:\ntitle: ${d.title}\ncharacter: ${d.sourceCharacter}\nkey points:\n` +
    d.keyPoints.map((p) => `- ${p}`).join("\n")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/agent/prompts.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts.ts tests/agent/prompts.test.ts
git commit -m "feat: digest/direction/outline prompt builders"
```

---

### Task 4: Prompter (terminal choice + non-interactive picker)

**Files:**
- Create: `src/agent/prompter.ts`
- Test: `tests/agent/prompter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/prompter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fixedPrompter } from "../../src/agent/prompter";

const options = [
  { id: "mental-model", label: "mental model", description: "why" },
  { id: "build", label: "build", description: "how" },
];

describe("fixedPrompter", () => {
  it("picks the first option when no id is given", async () => {
    expect((await fixedPrompter().chooseAngle(options)).id).toBe("mental-model");
  });

  it("picks the option matching the given id", async () => {
    expect((await fixedPrompter("build").chooseAngle(options)).id).toBe("build");
  });

  it("throws listing valid ids for an unknown id", async () => {
    await expect(fixedPrompter("nope").chooseAngle(options)).rejects.toThrow(
      /unknown angle 'nope'.*mental-model, build/,
    );
  });

  it("throws when there are no options", async () => {
    await expect(fixedPrompter().chooseAngle([])).rejects.toThrow(/no directions/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/prompter.test.ts`
Expected: FAIL — cannot find module `../../src/agent/prompter`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/prompter.ts`:

```ts
import { createInterface } from "node:readline";
import type { Direction } from "./model-client";

export interface Prompter {
  chooseAngle(options: Direction[]): Promise<Direction>;
}

/** Non-interactive picker: a specific id, or the first option. */
export function fixedPrompter(angleId?: string): Prompter {
  return {
    async chooseAngle(options) {
      if (options.length === 0) throw new Error("no directions proposed");
      if (!angleId) return options[0];
      const found = options.find((o) => o.id === angleId);
      if (!found) {
        throw new Error(
          `unknown angle '${angleId}' — choose from: ${options.map((o) => o.id).join(", ")}`,
        );
      }
      return found;
    },
  };
}

/** Interactive terminal picker — prints numbered options, reads a choice. */
export function terminalPrompter(): Prompter {
  return {
    async chooseAngle(options) {
      if (options.length === 0) throw new Error("no directions proposed");
      process.stdout.write("Aim it:\n");
      options.forEach((o, i) =>
        process.stdout.write(`  [${i + 1}] ${o.label} — ${o.description}\n`),
      );
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (true) {
          const answer = await new Promise<string>((resolve) =>
            rl.question("> ", resolve),
          );
          const n = Number(answer.trim());
          if (Number.isInteger(n) && n >= 1 && n <= options.length) {
            return options[n - 1];
          }
          process.stdout.write(`Enter 1-${options.length}.\n`);
        }
      } finally {
        rl.close();
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/agent/prompter.test.ts`
Expected: PASS, 4 tests. (`terminalPrompter` is not unit-tested — it needs a live TTY; it is exercised manually via the CLI.)

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompter.ts tests/agent/prompter.test.ts
git commit -m "feat: prompter (terminal choice + non-interactive picker)"
```

---

### Task 5: The ingest orchestrator (the core)

**Files:**
- Create: `src/agent/ingest.ts`
- Test: `tests/agent/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ingest } from "../../src/agent/ingest";
import { fixedPrompter } from "../../src/agent/prompter";
import { parseOutline } from "../../src/outline/index";
import type { ModelClient } from "../../src/agent/model-client";

const digest = {
  title: "Eventual Consistency",
  keyPoints: ["a", "b", "c"],
  sourceCharacter: "technical spec",
};
const directions = [
  { id: "mental-model", label: "mental model", description: "why" },
  { id: "build", label: "build", description: "how" },
];
const draft = {
  title: "EC",
  slides: [
    {
      title: "Eventual consistency",
      layout: "analogy" as const,
      markdown: "Every copy agrees.\n\n> Like **office gossip**.",
    },
    { title: "Trade-off", layout: "plain" as const, markdown: "- a\n- b" },
  ],
};

function fakeModel(): { client: ModelClient; seenAngle: () => string } {
  let seen = "";
  return {
    seenAngle: () => seen,
    client: {
      digest: async () => digest,
      proposeDirections: async () => directions,
      generateOutline: async (_d, a) => {
        seen = a.id;
        return draft;
      },
    },
  };
}

describe("ingest", () => {
  it("runs the pipeline and returns a valid, round-trippable outline", async () => {
    const m = fakeModel();
    const res = await ingest("some source text", {
      model: m.client,
      prompter: fixedPrompter("build"),
    });
    expect(res.angle.id).toBe("build");
    expect(m.seenAngle()).toBe("build");
    expect(res.pointCount).toBe(3);

    const parsed = parseOutline(res.outlineMarkdown);
    expect(parsed.meta.purpose).toBe("teach");
    expect(parsed.meta.theme).toBe("field");
    expect(parsed.slides).toHaveLength(2);
    expect(parsed.slides[0].id).toMatch(/^s_[0-9a-z]{8}$/);
    expect(parsed.slides[0].layout).toBe("analogy");
    expect(parsed.slides[0].markdown).toContain("office gossip");
  });

  it("defaults to the first proposed angle", async () => {
    const res = await ingest("text", {
      model: fakeModel().client,
      prompter: fixedPrompter(),
    });
    expect(res.angle.id).toBe("mental-model");
  });

  it("invokes onDigest with the digest", async () => {
    let n = 0;
    await ingest("text", {
      model: fakeModel().client,
      prompter: fixedPrompter(),
      onDigest: (d) => {
        n = d.keyPoints.length;
      },
    });
    expect(n).toBe(3);
  });

  it("throws on empty source", async () => {
    await expect(
      ingest("   ", { model: fakeModel().client, prompter: fixedPrompter() }),
    ).rejects.toThrow(/empty/);
  });

  it("throws for an unknown angle id", async () => {
    await expect(
      ingest("text", { model: fakeModel().client, prompter: fixedPrompter("nope") }),
    ).rejects.toThrow(/unknown angle/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/ingest.test.ts`
Expected: FAIL — cannot find module `../../src/agent/ingest`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/ingest.ts`:

```ts
import type { ModelClient, DigestResult, Direction } from "./model-client";
import type { Prompter } from "./prompter";
import type { Outline } from "../outline/types";
import { mintSlideId } from "../outline/id";
import { validateOutline } from "../outline/validate";
import { serializeOutline } from "../outline/serialize";

export interface IngestDeps {
  model: ModelClient;
  prompter: Prompter;
  onDigest?: (digest: DigestResult) => void;
}

export interface IngestResult {
  outlineMarkdown: string;
  pointCount: number;
  angle: Direction;
}

/** text → digest → direction → outline.md (markdown string). No IO of its own. */
export async function ingest(
  sourceText: string,
  deps: IngestDeps,
): Promise<IngestResult> {
  if (!sourceText.trim()) throw new Error("source is empty");

  const digest = await deps.model.digest(sourceText);
  deps.onDigest?.(digest);

  const directions = await deps.model.proposeDirections(digest);
  const angle = await deps.prompter.chooseAngle(directions);
  const draft = await deps.model.generateOutline(digest, angle);

  const outline: Outline = {
    meta: { title: draft.title || digest.title, purpose: "teach", theme: "field" },
    slides: draft.slides.map((s) => ({
      id: mintSlideId(),
      layout: s.layout,
      title: s.title,
      markdown: s.markdown,
    })),
  };

  const issues = validateOutline(outline);
  if (issues.length > 0) {
    throw new Error(
      "generated outline invalid:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  return {
    outlineMarkdown: serializeOutline(outline),
    pointCount: digest.keyPoints.length,
    angle,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/agent/ingest.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/ingest.ts tests/agent/ingest.test.ts
git commit -m "feat: ingest orchestrator (text → outline.md via step-1 core)"
```

---

### Task 6: The Agent SDK adapter (typecheck-only)

**Files:**
- Create: `src/agent/anthropic-client.ts`

This file talks to the live Claude Agent SDK and is **not** unit-tested (no Claude auth in CI). It MUST pass `bunx tsc --noEmit`. It mirrors the sibling `loupe` project's working `query()` usage (`/Users/victor/Documents/Workspace/Projects/loupe/src/server/lens-session.ts`).

- [ ] **Step 1: Write the implementation**

Create `src/agent/anthropic-client.ts`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ZodType } from "zod";
import {
  type ModelClient,
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
} from "./model-client";
import { digestPrompt, directionPrompt, outlinePrompt } from "./prompts";
import { parseValidated } from "./json";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

/** One isolated single-shot turn → full assistant text (loupe's query() pattern). */
async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      model: MODEL,
      permissionMode: "bypassPermissions",
      allowedTools: [],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
        "Agent", "WebFetch", "WebSearch", "NotebookEdit",
      ],
      includePartialMessages: true,
    },
  });

  let text = "";
  for await (const msg of q as AsyncIterable<SDKMessage>) {
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

/** Run a prompt, parse+validate; on a parse failure, retry once, then throw. */
async function ask<T>(
  system: string,
  user: string,
  schema: ZodType<T>,
  label: string,
): Promise<T> {
  try {
    return parseValidated(await runQuery(system, user), schema);
  } catch {
    const retry = await runQuery(
      system,
      user + "\n\nReturn valid JSON only — no prose, no code fence.",
    );
    try {
      return parseValidated(retry, schema);
    } catch {
      throw new Error(`could not parse ${label} output`);
    }
  }
}

/** Real ModelClient over the Claude Agent SDK (auth: Claude Code session / ANTHROPIC_API_KEY). */
export function anthropicClient(): ModelClient {
  return {
    async digest(sourceText) {
      const p = digestPrompt(sourceText);
      return ask(p.system, p.user, DigestSchema, "digest");
    },
    async proposeDirections(digest) {
      const p = directionPrompt(digest);
      return ask(p.system, p.user, DirectionsSchema, "direction");
    },
    async generateOutline(digest, angle) {
      const p = outlinePrompt(digest, angle);
      return ask(p.system, p.user, DraftDeckSchema, "outline");
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean. **If the SDK's `Options`/`Query` types reject a field or the string `prompt`**, mirror loupe's casts: `query({ prompt: userPrompt as any, options: { ... } }) as any` — keep all option fields; cast only as much as needed to satisfy the compiler. Do not delete options. (loupe casts `prompt` with `as any` and the query result `as Query`.)

- [ ] **Step 3: Run the full suite (adapter has no tests, but must not break others)**

Run: `bunx vitest run`
Expected: all existing tests still green (the adapter is imported by nothing yet).

- [ ] **Step 4: Commit**

```bash
git add src/agent/anthropic-client.ts
git commit -m "feat: Claude Agent SDK adapter for the ingest model client"
```

---

### Task 7: Agent barrel + root re-export

**Files:**
- Create: `src/agent/index.ts`
- Modify: `src/index.ts`
- Test: `tests/agent/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ingest, fixedPrompter, anthropicClient, extractJson } from "../../src/agent/index";

describe("agent barrel", () => {
  it("re-exports the public agent API", () => {
    expect(typeof ingest).toBe("function");
    expect(typeof fixedPrompter).toBe("function");
    expect(typeof anthropicClient).toBe("function");
    expect(typeof extractJson).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/index.test.ts`
Expected: FAIL — cannot find module `../../src/agent/index`.

- [ ] **Step 3: Write the implementation**

Create `src/agent/index.ts`:

```ts
export * from "./model-client";
export * from "./prompts";
export * from "./json";
export * from "./prompter";
export * from "./ingest";
export { anthropicClient } from "./anthropic-client";
```

Overwrite `src/index.ts` so it reads EXACTLY:

```ts
export * from "./outline/index";
export * from "./render/index";
export * from "./export/index";
export * from "./agent/index";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/agent/index.test.ts`
Expected: PASS, 1 test. (Importing the barrel loads the Agent SDK at import time; that is import-only and must not throw — loupe imports it the same way.)

- [ ] **Step 5: Commit**

```bash
git add src/agent/index.ts src/index.ts tests/agent/index.test.ts
git commit -m "feat: agent barrel + root re-export"
```

---

### Task 8: `mindsizer ingest` CLI subcommand

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/agent/cli-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/cli-ingest.test.ts` (these exercise the pre-LLM error paths, which do NOT need Claude auth — they fail before any `query()` call):

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync("bun", ["run", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer ingest CLI (pre-LLM paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["ingest"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer ingest");
  });

  it("errors on a missing input file", () => {
    const r = runCli(["ingest", "/no/such/file.txt"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });

  it("rejects an unknown ingest option", () => {
    const r = runCli(["ingest", "x.txt", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/agent/cli-ingest.test.ts`
Expected: FAIL — `mindsizer ingest` is not yet dispatched (no "usage: mindsizer ingest" — current CLI treats `ingest` as an outline path and reports a different error).

- [ ] **Step 3: Rewrite `src/cli.ts` with subcommand dispatch**

Overwrite `src/cli.ts` with (the seal logic from step 3 moves verbatim into `runSeal`, plus the new `runIngest`):

```ts
#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { parseOutline } from "./outline/index";
import { sealDeck } from "./export/index";
import { ingest, anthropicClient, fixedPrompter, terminalPrompter } from "./agent/index";

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function runSeal(args: string[]): void {
  let input: string | undefined;
  let out: string | undefined;
  let open = false;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--open") {
      open = true;
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input) fail("usage: mindsizer <outline.md> [-o <out.html>] [--open]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  // parseOutline is total by contract (the outline module never throws);
  // failures surface as validation issues from sealDeck, handled below.
  const outline = parseOutline(md);
  process.stdout.write(`✓ parsed ${outline.slides.length} slides\n`);

  let html: string;
  try {
    html = sealDeck(outline);
  } catch (e) {
    fail((e as Error).message);
  }
  process.stdout.write("✓ rendered + validated\n");

  const outPath =
    out ??
    join(dirname(resolve(input)), basename(input, extname(input)) + ".html");
  writeFileSync(outPath, html, "utf8");
  process.stdout.write(`✓ sealed → ${outPath}\n`);

  if (open) {
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    import("node:child_process").then(({ spawn }) =>
      spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref(),
    );
  }
}

async function runIngest(args: string[]): Promise<void> {
  let input: string | undefined;
  let out: string | undefined;
  let angle: string | undefined;
  let yes = false;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--angle") {
      angle = args[++k];
      if (angle === undefined) fail("--angle requires an id");
    } else if (a === "--yes") {
      yes = true;
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input)
    fail("usage: mindsizer ingest <text-file> [--angle <id>] [-o <out.md>] [--yes]");

  let text: string;
  try {
    text = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  process.stdout.write("digesting…\n");
  const prompter = angle || yes ? fixedPrompter(angle) : terminalPrompter();

  let result: Awaited<ReturnType<typeof ingest>>;
  try {
    result = await ingest(text, {
      model: anthropicClient(),
      prompter,
      onDigest: (d) =>
        process.stdout.write(`✓ digested (${d.keyPoints.length} points)\n`),
    });
  } catch (e) {
    fail((e as Error).message);
  }

  const outPath =
    out ??
    join(
      dirname(resolve(input)),
      basename(input, extname(input)) + ".outline.md",
    );
  writeFileSync(outPath, result.outlineMarkdown, "utf8");
  process.stdout.write(`✓ wrote ${outPath}\n`);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args[0] === "ingest") {
    void runIngest(args.slice(1));
    return;
  }
  runSeal(args);
}

main(process.argv);
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `bunx vitest run tests/agent/cli-ingest.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full verification**

Run: `bunx vitest run`
Expected: ALL green (existing seal CLI tests still pass — the seal path is unchanged behavior).

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/agent/cli-ingest.test.ts
git commit -m "feat: mindsizer ingest subcommand (text → outline.md)"
```

---

## Self-Review

**Spec coverage:**
- §3 command (`ingest`, `--angle`/`--yes`/`-o`, default `<basename>.outline.md`, progress, errors, dispatch) → Task 8 + Task 4 (picker). ✓
- §4 architecture/seams (`ModelClient`, `Prompter`, pure orchestrator) → Tasks 1, 4, 5. ✓
- §5 data shapes + reuse of step-1 core → Task 1 (schemas) + Task 5 (Outline build). ✓
- §6 Agent SDK adapter (loupe pattern, one-shot, retry-once) → Task 6. ✓
- §7 prompts → Task 3. ✓
- §8 JSON extraction/validation → Task 2. ✓
- §9 file structure + barrel + re-export → Tasks 1–8 + Task 7. ✓
- §10 testing (json, prompts, schemas, ingest core with fakes; adapter typecheck-only; CLI pre-LLM paths) → Tasks 2,3,1,5,6,8. ✓
- §11 error handling table → Task 5 (empty/invalid), Task 4 (unknown angle), Task 8 (file/usage/option), Task 6 (parse-retry). ✓
- Out-of-scope (UI, render-and-inspect, other purposes, adapters) → correctly absent. ✓

**Placeholder scan:** No TBD/TODO; complete code in every code step; the only "not tested" item (the adapter) is deliberate, documented, and typecheck-gated. ✓

**Type consistency:** `DigestResult`/`Direction`/`DraftDeck` from `model-client.ts` used identically in `prompts.ts`, `prompter.ts`, `ingest.ts`, `anthropic-client.ts`. `Prompter`/`fixedPrompter`/`terminalPrompter` (Task 4) consumed by `ingest`/`cli`. `ingest`/`IngestDeps`/`IngestResult` (Task 5) used by the CLI. `anthropicClient` (Task 6) + barrel (Task 7) + CLI import all agree. `parseValidated`/`extractJson` (Task 2) used by the adapter. Schemas `DigestSchema`/`DirectionsSchema`/`DraftDeckSchema` consistent between Task 1 and Task 6. ✓
