# Two-Layer Plan (Fable planner + decoupled visual layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split mindsizer cleanly into Layer 1 (planning on Fable 5.1, emitting a hand-editable `x.plan.md`) and Layer 2 (visual implementation, done by Claude Code via a repo skill today, or by the existing harness via `build --resume`).

**Architecture:** `x.plan.md` is a superset of `outline.md`: front-matter gains a `direction` block and each slide block ends with a fenced ```plan YAML block that the outline parser lifts into a typed `slide.plan`. A new `mindsizer plan` command runs the existing ingest pipeline plus one whole-deck planning call on the ingest tier (now Fable 5.1). Two small CLI commands (`brief`, `fit`) give a Claude Code session the identity text and the eyes it needs; a new `mindsizer-author` skill tells it how to author slide section files that `build --resume` seals.

**Tech Stack:** Bun + TypeScript, Vitest, zod, gray-matter, js-yaml (new explicit dep), Playwright (existing renderer), Claude Agent SDK (existing `runQuery`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-04-two-layer-plan-design.md`.
- Fable model id is exactly `claude-fable-5-1` (verified via the claude-api skill 2026-09-04). Never append a date suffix.
- `device.kind` enum is exactly `instrument | figure | comparison | sequence | static`.
- `claim`, `mechanism`, `device.kind`, `device.resting` are always required; `device.operate`, `device.changes`, `aha` are required only when `kind === "instrument"`; `data`, `source` optional.
- `parseOutline` must stay total (never throws). Plan-fence problems surface from `validateOutline` as issues naming the slide.
- Outlines without a plan fence must parse and serialize byte-for-byte as before (existing tests must keep passing untouched).
- Section files Layer 2 writes go to `<stem>.build/slides/<id>.html` — exactly what `build --resume` already reads.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JQXiqY3qTrCwDfnDoLGQy1
  ```
- Run `bunx vitest run` and `bunx tsc --noEmit` before every commit; both must be clean.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/outline/plan.ts` (new) | `PLAN_KINDS`, `SlidePlanSchema` (zod, single source of truth for the plan shape), `PlanDirectionSchema` |
| `src/outline/types.ts` | `SlidePlan`, `PlanDirection` types; `OutlineSlide.plan?` / `planError?`; `DeckMeta.direction?` |
| `src/outline/parse.ts` | lift the trailing ```plan fence + front-matter `direction` |
| `src/outline/serialize.ts` | write them back |
| `src/outline/validate.ts` | plan schema issues per slide |
| `src/agent/models.ts` | ingest role → Fable 5.1 / high |
| `src/agent/pricing.ts` | fable family rates |
| `src/agent/model-client.ts` | `DeckPlanSchema`, `deckPlanSchema(n)`, `PlanInput`, optional `planDeck` |
| `src/agent/prompts.ts` | `planPrompt(input)` |
| `src/agent/anthropic-client.ts` | `planDeck` with schema-error retry + `PlanParseError` carrying the raw reply |
| `src/agent/ingest.ts` | `ingest(text, deps, { plan: true })` attaches direction + per-slide plans |
| `src/cli.ts` | `plan`, `brief`, `fit` commands; `plan.raw.json` dump on planner failure |
| `src/render/materials.ts` | forward `slide.plan`; direction fallback to front-matter |
| `src/render/design-brief.ts` | "Slide plan" block in the user prompt |
| `.claude/skills/mindsizer-author/SKILL.md` (new) | Layer 2 in Claude Code |
| `.claude/skills/mindsizer/SKILL.md`, `README.md` | document the new flow |

---

### Task 1: Plan schema + outline types

**Files:**
- Create: `src/outline/plan.ts`
- Modify: `src/outline/types.ts`
- Modify: `package.json` (add `js-yaml`, `@types/js-yaml`)
- Test: `tests/outline/plan.test.ts`

**Interfaces:**
- Produces: `PLAN_KINDS`, `PlanKind`, `SlidePlanSchema`, `PlanDirectionSchema`, `SlidePlan`, `PlanDirection`; `OutlineSlide.plan?: SlidePlan`, `OutlineSlide.planError?: string`, `DeckMeta.direction?: PlanDirection`.

- [ ] **Step 1: Add js-yaml as an explicit dependency**

```bash
bun add js-yaml && bun add -d @types/js-yaml
```

- [ ] **Step 2: Write the failing schema test**

`tests/outline/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SlidePlanSchema, PLAN_KINDS, PlanDirectionSchema } from "../../src/outline/plan";

const instrument = {
  claim: "Founders supply the momentum by hand.",
  mechanism: "growth = manual push + self-sustaining term",
  device: { kind: "instrument", operate: "drag a crank", changes: "curve splits", resting: "crank at 40%" },
  aha: "release before the catch → zero",
  data: "m(t) = m(t-1)*(1+r)",
  source: "\"you have to go out and get them\"",
};

describe("SlidePlanSchema", () => {
  it("accepts a full instrument plan", () => {
    expect(SlidePlanSchema.safeParse(instrument).success).toBe(true);
  });
  it("requires operate/changes/aha only for instruments", () => {
    const fig = { claim: "c", mechanism: "m", device: { kind: "figure", resting: "r" } };
    expect(SlidePlanSchema.safeParse(fig).success).toBe(true);
    const bad = { claim: "c", mechanism: "m", device: { kind: "instrument", resting: "r" } };
    const res = SlidePlanSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["device.operate", "device.changes", "aha"]),
    );
  });
  it("rejects an unknown kind and a missing claim", () => {
    expect(SlidePlanSchema.safeParse({ ...instrument, device: { ...instrument.device, kind: "poster" } }).success).toBe(false);
    const { claim: _c, ...noClaim } = instrument;
    expect(SlidePlanSchema.safeParse(noClaim).success).toBe(false);
  });
  it("exposes the closed kind list", () => {
    expect(PLAN_KINDS).toEqual(["instrument", "figure", "comparison", "sequence", "static"]);
  });
});

describe("PlanDirectionSchema", () => {
  it("requires conceit + motif + arc strings", () => {
    expect(PlanDirectionSchema.safeParse({ conceit: "a", motif: "b", arc: "c" }).success).toBe(true);
    expect(PlanDirectionSchema.safeParse({ conceit: "a", motif: "b" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bunx vitest run tests/outline/plan.test.ts`
Expected: FAIL — cannot resolve `../../src/outline/plan`.

- [ ] **Step 4: Create `src/outline/plan.ts`**

```ts
import { z } from "zod";

/** The closed set of comprehension devices Layer 1 may assign to a slide. */
export const PLAN_KINDS = ["instrument", "figure", "comparison", "sequence", "static"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

const nonEmpty = z.string().trim().min(1);

/**
 * One slide's plan — what Layer 1 (planning) decides and Layer 2 (visual) implements.
 * `operate`, `changes`, `aha` are mandatory for an instrument, optional otherwise.
 */
export const SlidePlanSchema = z
  .object({
    claim: nonEmpty,
    mechanism: nonEmpty,
    device: z.object({
      kind: z.enum(PLAN_KINDS),
      operate: nonEmpty.optional(),
      changes: nonEmpty.optional(),
      resting: nonEmpty,
    }),
    aha: nonEmpty.optional(),
    data: nonEmpty.optional(),
    source: nonEmpty.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.device.kind !== "instrument") return;
    if (!p.device.operate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["device", "operate"], message: "required for an instrument" });
    if (!p.device.changes) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["device", "changes"], message: "required for an instrument" });
    if (!p.aha) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aha"], message: "required for an instrument" });
  });
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

/** Deck-level direction carried in plan.md front-matter. */
export const PlanDirectionSchema = z.object({ conceit: nonEmpty, motif: nonEmpty, arc: nonEmpty });
export type PlanDirection = z.infer<typeof PlanDirectionSchema>;
```

- [ ] **Step 5: Extend `src/outline/types.ts`**

Replace the file's `DeckMeta` and `OutlineSlide` with:

```ts
import type { SlidePlan, PlanDirection } from "./plan";
export type { SlidePlan, PlanDirection, PlanKind } from "./plan";
export { PLAN_KINDS } from "./plan";

/** Deck-level metadata, parsed from the outline.md frontmatter. */
export interface DeckMeta {
  title: string;
  purpose: "teach"; // v1 fixed; widens with the reflow roadmap
  theme: string; // v1: "field"
  /** Attribution for the source text, rendered as deck chrome. At least one key set when present. */
  source?: { label?: string; url?: string };
  /** Whole-deck direction (plan.md only): controlling conceit, visual motif, argument arc. */
  direction?: PlanDirection;
}

/** One slide's canonical content. `markdown` is render-agnostic. */
export interface OutlineSlide {
  id: string; // stable, permanent, e.g. "s_abc12345"
  layout: string; // "analogy" | "build-up" | "quote" | "plain" | "bespoke"
  title: string; // from the `#` heading
  markdown: string; // raw body markdown — canonical content
  /** Layer-1 plan lifted from the trailing ```plan fence (plan.md only). */
  plan?: SlidePlan;
  /** Set when a ```plan fence was present but not valid YAML; the fence stays in `markdown`. */
  planError?: string;
}
```

(Leave `Outline` and `KNOWN_LAYOUTS` as they are.)

- [ ] **Step 6: Run tests + typecheck**

Run: `bunx vitest run tests/outline/plan.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/outline/plan.ts src/outline/types.ts tests/outline/plan.test.ts
git commit -m "feat(outline): SlidePlan schema + plan/direction fields on the outline model"
```

---

### Task 2: Parse and serialize the plan fence + direction

**Files:**
- Modify: `src/outline/parse.ts`
- Modify: `src/outline/serialize.ts`
- Modify: `src/outline/index.ts`
- Test: `tests/outline/plan-roundtrip.test.ts`

**Interfaces:**
- Consumes: `SlidePlan`, `PlanDirection`, `OutlineSlide.plan/planError`, `DeckMeta.direction` (Task 1).
- Produces: `parseOutline` lifts the fence; `serializeOutline` writes it back; round trip is stable.

- [ ] **Step 1: Write the failing round-trip tests**

`tests/outline/plan-roundtrip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseOutline } from "../../src/outline/parse";
import { serializeOutline } from "../../src/outline/serialize";
import type { Outline } from "../../src/outline/types";

const PLAN_MD = `---
title: Crank
purpose: teach
theme: field
direction:
  conceit: hand-cranking an engine
  motif: a flywheel
  arc: force → resist → catch
---

<!-- slide id=s_a -->
# Startups don't start themselves

Founders are the engine.

\`\`\`plan
claim: Founders supply the momentum by hand.
mechanism: growth = push + momentum
device:
  kind: instrument
  operate: drag a crank
  changes: curve splits
  resting: crank at 40%
aha: release early → zero
\`\`\`

---

<!-- slide id=s_b layout=plain -->
# No plan here

- just prose
`;

describe("parseOutline — plan fence + direction", () => {
  it("lifts direction from front-matter", () => {
    const o = parseOutline(PLAN_MD);
    expect(o.meta.direction).toEqual({ conceit: "hand-cranking an engine", motif: "a flywheel", arc: "force → resist → catch" });
  });
  it("lifts the trailing plan fence into slide.plan and strips it from markdown", () => {
    const s = parseOutline(PLAN_MD).slides[0];
    expect(s.plan?.claim).toBe("Founders supply the momentum by hand.");
    expect(s.plan?.device.kind).toBe("instrument");
    expect(s.markdown).toBe("Founders are the engine.");
    expect(s.planError).toBeUndefined();
  });
  it("leaves a fence-less slide untouched", () => {
    const s = parseOutline(PLAN_MD).slides[1];
    expect(s.plan).toBeUndefined();
    expect(s.markdown).toBe("- just prose");
  });
  it("keeps a malformed fence in markdown and records planError", () => {
    const bad = PLAN_MD.replace("aha: release early → zero", "aha: [unclosed");
    const s = parseOutline(bad).slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/yaml/i);
    expect(s.markdown).toContain("```plan");
  });
  it("records planError when the fence is valid YAML but not a mapping", () => {
    const bad = PLAN_MD.replace(/```plan[\s\S]*?```/, "```plan\n- a\n- b\n```");
    const s = parseOutline(bad).slides[0];
    expect(s.plan).toBeUndefined();
    expect(s.planError).toMatch(/mapping/i);
  });
  it("does not parse direction without conceit + motif + arc", () => {
    const o = parseOutline(PLAN_MD.replace("  arc: force → resist → catch\n", ""));
    expect(o.meta.direction).toBeUndefined();
  });
});

describe("serializeOutline — plan fence + direction", () => {
  const outline: Outline = {
    meta: { title: "Crank", purpose: "teach", theme: "field", direction: { conceit: "c", motif: "m", arc: "a" } },
    slides: [
      { id: "s_a", layout: "bespoke", title: "T", markdown: "prose",
        plan: { claim: "cl", mechanism: "me", device: { kind: "figure", resting: "r" }, source: "q: with colon" } },
      { id: "s_b", layout: "plain", title: "U", markdown: "- x" },
    ],
  };
  it("writes direction and a trailing plan fence", () => {
    const md = serializeOutline(outline);
    expect(md).toContain("direction:\n  conceit: c\n  motif: m\n  arc: a");
    expect(md).toMatch(/prose\n\n```plan\nclaim: cl\n[\s\S]*```\n/);
    expect(md.split("```plan").length - 1).toBe(1);
  });
  it("round-trips parse(serialize(o)) === o", () => {
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);
  });
  it("serialize(parse(md)) is stable after one pass", () => {
    const once = serializeOutline(parseOutline(PLAN_MD));
    expect(serializeOutline(parseOutline(once))).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/outline/plan-roundtrip.test.ts`
Expected: FAIL (direction undefined, plan undefined).

- [ ] **Step 3: Update `src/outline/parse.ts`**

Add imports at the top:

```ts
import yaml from "js-yaml";
import type { DeckMeta, Outline, OutlineSlide, SlidePlan } from "./types";
import { PlanDirectionSchema } from "./plan";
```

Add after `parseSource`:

```ts
/** A ```plan fence at the very end of a slide body. */
const PLAN_FENCE_RE = /\n*```plan[ \t]*\n([\s\S]*?)\n```[ \t]*$/;

/** Front-matter `direction` → PlanDirection, or undefined when absent/incomplete. */
function parseDirection(raw: unknown): DeckMeta["direction"] {
  const r = PlanDirectionSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

/**
 * Lift a trailing ```plan fence out of a slide body. Returns the body without the fence and
 * the parsed plan — or, when the fence isn't valid YAML / not a mapping, the ORIGINAL body
 * (fence kept, so serialize round-trips) plus a planError. Shape validation is validate.ts's job.
 */
function liftPlan(body: string): { markdown: string; plan?: SlidePlan; planError?: string } {
  const m = body.match(PLAN_FENCE_RE);
  if (!m) return { markdown: body };
  let value: unknown;
  try {
    value = yaml.load(m[1]);
  } catch (e) {
    return { markdown: body, planError: `plan fence is not valid YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { markdown: body, planError: "plan fence must be a YAML mapping" };
  }
  return { markdown: body.slice(0, m.index).trim(), plan: value as SlidePlan };
}
```

In `parseOutline`, change the meta construction and the slide mapping:

```ts
  const source = parseSource(data.source);
  const direction = parseDirection(data.direction);
  const meta: DeckMeta = {
    title: String(data.title ?? ""),
    purpose: "teach",
    theme: String(data.theme ?? "field"),
    ...(source && { source }),
    ...(direction && { direction }),
  };
```

and replace the slide `return` with:

```ts
    const lifted = liftPlan(body.trim());
    return {
      id,
      layout,
      title,
      markdown: lifted.markdown,
      ...(lifted.plan && { plan: lifted.plan }),
      ...(lifted.planError && { planError: lifted.planError }),
    };
```

- [ ] **Step 4: Update `src/outline/serialize.ts`**

```ts
import matter from "gray-matter";
import yaml from "js-yaml";
import type { Outline } from "./types";

/** Serialize the canonical Outline model back to Marp-style outline.md (plan.md when plans are present). */
export function serializeOutline(o: Outline): string {
  const body = o.slides
    .map((s) => {
      const layoutAttr =
        s.layout && s.layout !== "bespoke" ? ` layout=${s.layout}` : "";
      const head = `<!-- slide id=${s.id}${layoutAttr} -->`;
      const parts = [head, `# ${s.title}`];
      if (s.markdown.trim().length > 0) {
        parts.push("", s.markdown.trim());
      }
      if (s.plan) {
        // lineWidth -1: never fold long strings, so parse(serialize(x)) is byte-stable
        const y = yaml.dump(s.plan, { lineWidth: -1, noRefs: true }).trimEnd();
        parts.push("", "```plan", y, "```");
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  const src = o.meta.source;
  return matter.stringify(`\n${body}\n`, {
    title: o.meta.title,
    purpose: o.meta.purpose,
    theme: o.meta.theme,
    ...(src && {
      source: {
        ...(src.label && { label: src.label }),
        ...(src.url && { url: src.url }),
      },
    }),
    ...(o.meta.direction && { direction: { ...o.meta.direction } }),
  });
}
```

- [ ] **Step 5: Export the plan module from the barrel**

In `src/outline/index.ts` add:

```ts
export type { SlidePlan, PlanDirection, PlanKind } from "./plan";
export { PLAN_KINDS, SlidePlanSchema, PlanDirectionSchema } from "./plan";
```

- [ ] **Step 6: Run the full outline suite + typecheck**

Run: `bunx vitest run tests/outline && bunx tsc --noEmit`
Expected: all PASS (existing parse/serialize/integration tests untouched and green).

- [ ] **Step 7: Commit**

```bash
git add src/outline tests/outline/plan-roundtrip.test.ts
git commit -m "feat(outline): parse + serialize the plan fence and front-matter direction"
```

---

### Task 3: Validate plans

**Files:**
- Modify: `src/outline/validate.ts`
- Test: `tests/outline/validate.test.ts` (append)

**Interfaces:**
- Produces: `validateOutline` emits `{ slideId, message }` for `planError` and for each zod issue on `slide.plan`.

- [ ] **Step 1: Append failing tests**

Append to `tests/outline/validate.test.ts`:

```ts
describe("validateOutline — plans", () => {
  it("reports a planError verbatim, naming the slide", () => {
    const o = deck([{ id: "s_a", layout: "bespoke", title: "A", markdown: "x", planError: "plan fence is not valid YAML: bad" }]);
    expect(validateOutline(o)).toEqual([{ slideId: "s_a", message: "plan fence is not valid YAML: bad" }]);
  });
  it("reports schema issues with their path", () => {
    const o = deck([{ id: "s_a", layout: "bespoke", title: "A", markdown: "x",
      plan: { claim: "c", mechanism: "m", device: { kind: "instrument", resting: "r" } } as any }]);
    const msgs = validateOutline(o).map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringContaining("plan.device.operate"),
      expect.stringContaining("plan.aha"),
    ]));
    expect(validateOutline(o).every((i) => i.slideId === "s_a")).toBe(true);
  });
  it("accepts a valid plan silently", () => {
    const o = deck([{ id: "s_a", layout: "bespoke", title: "A", markdown: "x",
      plan: { claim: "c", mechanism: "m", device: { kind: "static", resting: "r" } } }]);
    expect(validateOutline(o)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/outline/validate.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

In `src/outline/validate.ts` add the import and the loop body:

```ts
import { SlidePlanSchema } from "./plan";
```

Inside the `for (const s of o.slides)` loop, after the layout check:

```ts
    if (s.planError) issues.push({ slideId: s.id, message: s.planError });
    if (s.plan) {
      const r = SlidePlanSchema.safeParse(s.plan);
      if (!r.success) {
        for (const i of r.error.issues) {
          issues.push({ slideId: s.id, message: `plan.${i.path.join(".")}: ${i.message}` });
        }
      }
    }
```

- [ ] **Step 4: Run + typecheck**

Run: `bunx vitest run tests/outline && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/outline/validate.ts tests/outline/validate.test.ts
git commit -m "feat(outline): validate slide plans (fence errors + schema issues name the slide)"
```

---

### Task 4: Ingest tier → Fable 5.1; fable pricing

**Files:**
- Modify: `src/agent/models.ts`
- Modify: `src/agent/pricing.ts`
- Test: `tests/agent/models.test.ts`, `tests/agent/pricing.test.ts`

- [ ] **Step 1: Update the failing expectations**

In `tests/agent/models.test.ts` change the ingest line of "returns judgment-matched defaults per role" to:

```ts
    expect(modelFor("ingest", {})).toEqual({ model: "claude-fable-5-1", effort: "high" });
```

Append to `tests/agent/pricing.test.ts` inside `describe("costUsd")`:

```ts
  it("prices the fable family ($10 in / $50 out per 1M)", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-fable-5-1", {})).toBeCloseTo(10, 5);
    const o = { input: 0, output: M, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(o, "claude-fable-5-1", {})).toBeCloseTo(50, 5);
    expect(costUsd(u, "claude-mythos-5-1", {})).toBeCloseTo(10, 5);
  });
  it("honours MINDSIZER_PRICE_FABLE", () => {
    const u = { input: M, output: 0, cacheRead: 0, cacheCreate: 0 };
    expect(costUsd(u, "claude-fable-5-1", { MINDSIZER_PRICE_FABLE: "1,2,3,4" })).toBeCloseTo(1, 5);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/models.test.ts tests/agent/pricing.test.ts`
Expected: FAIL (ingest default is sonnet; fable priced as opus).

- [ ] **Step 3: Implement**

`src/agent/models.ts` — change the ingest default:

```ts
  ingest: { model: "claude-fable-5-1", effort: "high" },
```

`src/agent/pricing.ts` — add the family:

```ts
const DEFAULTS: Record<"fable" | "opus" | "sonnet" | "haiku", Rate> = {
  fable: { input: 10, output: 50, cacheRead: 0.25, cacheCreate: 12.5 },
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1.0 },
};
```

and in `family()` add before the haiku check:

```ts
  if (m.includes("fable") || m.includes("mythos")) return "fable";
```

- [ ] **Step 4: Run + typecheck**

Run: `bunx vitest run tests/agent && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/models.ts src/agent/pricing.ts tests/agent/models.test.ts tests/agent/pricing.test.ts
git commit -m "feat(models): ingest tier runs on Fable 5.1 at high effort; fable pricing"
```

---

### Task 5: Plan schema on the model client + the planner prompt

**Files:**
- Modify: `src/agent/model-client.ts`
- Modify: `src/agent/prompts.ts`
- Test: `tests/agent/model-client.test.ts` (append), `tests/agent/prompts.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export interface PlanInput {
    sourceText: string;
    digest: DigestResult;
    angle: Direction;
    art?: { conceit: string; motif: string };
    slides: { title: string; markdown: string }[];
  }
  export const DeckPlanSchema; // { direction: PlanDirection, slides: SlidePlan[] }
  export function deckPlanSchema(n: number); // DeckPlanSchema refined to slides.length === n
  export type DeckPlan = z.infer<typeof DeckPlanSchema>;
  ModelClient.planDeck?(input: PlanInput): Promise<DeckPlan>;
  export function planPrompt(input: PlanInput): Prompt;
  ```

- [ ] **Step 1: Append failing tests**

`tests/agent/model-client.test.ts` — append:

```ts
import { DeckPlanSchema, deckPlanSchema } from "../../src/agent/model-client";

describe("DeckPlanSchema", () => {
  const slide = { claim: "c", mechanism: "m", device: { kind: "static", resting: "r" } };
  const plan = { direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide, slide] };
  it("accepts direction + a slide array", () => {
    expect(DeckPlanSchema.safeParse(plan).success).toBe(true);
  });
  it("deckPlanSchema(n) rejects a wrong slide count", () => {
    expect(deckPlanSchema(2).safeParse(plan).success).toBe(true);
    const r = deckPlanSchema(3).safeParse(plan);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/3 slides/);
  });
});
```

`tests/agent/prompts.test.ts` — append:

```ts
import { planPrompt } from "../../src/agent/prompts";

describe("planPrompt", () => {
  const input = {
    sourceText: "FULL SOURCE ESSAY",
    digest,
    angle,
    art: { conceit: "a ledger", motif: "ruled lines" },
    slides: [{ title: "One", markdown: "body one" }, { title: "Two", markdown: "body two" }],
  };
  it("carries the full source, digest, angle, art direction and every slide", () => {
    const p = planPrompt(input);
    expect(p.user).toContain("FULL SOURCE ESSAY");
    expect(p.user).toContain("replicas converge");
    expect(p.user).toContain("the mental model");
    expect(p.user).toContain("a ledger");
    expect(p.user).toContain("1. One");
    expect(p.user).toContain("body two");
  });
  it("states the boundary, the kinds, and the JSON contract", () => {
    const p = planPrompt(input);
    expect(p.system).toContain("mechanism");
    expect(p.system).toContain('"instrument"');
    expect(p.system).toContain("same length and order");
    expect(p.system.toLowerCase()).toContain("json only");
  });
  it("omits the art-direction line when absent", () => {
    const p = planPrompt({ ...input, art: undefined });
    expect(p.user).not.toContain("Art direction");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/model-client.test.ts tests/agent/prompts.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Extend `src/agent/model-client.ts`**

Append:

```ts
import { SlidePlanSchema, PlanDirectionSchema } from "../outline/plan";

/** Everything the planner sees: the whole idea, not a bullet. */
export interface PlanInput {
  sourceText: string;
  digest: DigestResult;
  angle: Direction;
  /** Prior art direction (conceit/motif), advisory — the planner restates the final direction. */
  art?: { conceit: string; motif: string };
  slides: { title: string; markdown: string }[];
}

/** Whole-deck plan: the final direction + one SlidePlan per slide, in slide order. */
export const DeckPlanSchema = z.object({
  direction: PlanDirectionSchema,
  slides: z.array(SlidePlanSchema),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;

/** DeckPlanSchema pinned to the expected slide count. */
export function deckPlanSchema(n: number) {
  return DeckPlanSchema.refine((d) => d.slides.length === n, {
    path: ["slides"],
    message: `expected exactly ${n} slides in slide order`,
  });
}
```

(Move the `import { SlidePlanSchema, PlanDirectionSchema }` line to the top of the file with the other imports.) Add to the `ModelClient` interface:

```ts
  /** Optional: whole-deck slide planning (Layer 1). Optional so existing clients/fakes stay valid. */
  planDeck?(input: PlanInput): Promise<DeckPlan>;
```

- [ ] **Step 4: Add `planPrompt` to `src/agent/prompts.ts`**

Update the import line to `import type { DigestResult, Direction, PlanInput } from "./model-client";` and append:

```ts
export function planPrompt(input: PlanInput): Prompt {
  const system = [
    "You are mindsizer's PLANNING stage — the layer that decides what each slide must make the reader understand and HOW, before any visual design happens. A separate visual designer will implement your plan; it decides composition, typography, and how figures are drawn. You decide everything else.",
    "",
    "For EVERY slide, in the order given, produce:",
    "- claim: the one thing the reader should believe after this slide (one sentence).",
    "- mechanism: what actually moves — inputs, the relation, the output. Depict the mechanism, not its name: the picture must be able to show this.",
    "- device: { kind, operate?, changes?, resting }. kind is one of \"instrument\" (the reader operates a control and watches the concept respond), \"figure\" (a static diagram of the mechanism), \"comparison\" (two options side by side, the difference visible), \"sequence\" (a staged build or state progression), \"static\" (words and hierarchy only). For an instrument, operate = what the reader moves, changes = what visibly responds. resting = the state that must read alone with NO interaction, always.",
    "- aha: the specific moment or contrast the device exists to produce (required for an instrument).",
    "- data: when the mechanism is quantitative, the formula or the actual numbers to draw from — so the designer never invents.",
    "- source: the short source excerpt this slide is faithful to.",
    "Vary the device kinds across the deck; do not make every slide an instrument. Interaction must change understanding, never decorate.",
    "",
    "Also restate the deck's direction: conceit (one controlling metaphor), motif (a shared visual through-line), arc (one line: how the argument moves slide to slide).",
    "",
    'Respond with JSON only — no prose, no code fence: {"direction": {"conceit": string, "motif": string, "arc": string}, "slides": [{"claim": string, "mechanism": string, "device": {"kind": string, "operate"?: string, "changes"?: string, "resting": string}, "aha"?: string, "data"?: string, "source"?: string}]}. The slides array MUST be the same length and order as the slides given.',
  ].join("\n");
  const slides = input.slides
    .map((s, i) => `${i + 1}. ${s.title}\n${s.markdown}`)
    .join("\n\n");
  const user =
    `Angle: ${input.angle.label} — ${input.angle.description}\n\n` +
    digestText(input.digest) +
    (input.art ? `\n\nArt direction so far (advisory): conceit = ${input.art.conceit}; motif = ${input.art.motif}` : "") +
    `\n\nSlides (in order):\n\n${slides}\n\n` +
    `Full source text:\n\n${input.sourceText}`;
  return { system, user };
}
```

- [ ] **Step 5: Run + typecheck**

Run: `bunx vitest run tests/agent && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/model-client.ts src/agent/prompts.ts tests/agent/model-client.test.ts tests/agent/prompts.test.ts
git commit -m "feat(agent): DeckPlan schema + planner prompt (Layer 1 contract)"
```

---

### Task 6: `planDeck` on the Anthropic client, `ingest({ plan: true })`

**Files:**
- Modify: `src/agent/anthropic-client.ts`
- Modify: `src/agent/ingest.ts`
- Modify: `src/agent/index.ts`
- Test: `tests/agent/ingest.test.ts` (append), `tests/agent/anthropic-client-plan.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export class PlanParseError extends Error { raw: string }           // anthropic-client.ts
  export async function ingest(sourceText, deps, opts?: { plan?: boolean }): Promise<IngestResult>
  ```
  When `opts.plan` is true the returned `outlineMarkdown` carries `direction` + a plan fence per slide.

- [ ] **Step 1: Write the failing ingest tests**

Append to `tests/agent/ingest.test.ts`:

```ts
describe("ingest — plan mode", () => {
  const slidePlan = { claim: "c", mechanism: "m", device: { kind: "figure" as const, resting: "r" } };
  const deckPlan = { direction: { conceit: "a crank", motif: "flywheel", arc: "push → catch" }, slides: [slidePlan, slidePlan] };

  it("attaches direction + per-slide plans to the outline", async () => {
    const calls: unknown[] = [];
    const client: ModelClient = { ...fakeModel().client, planDeck: async (input) => { calls.push(input); return deckPlan; } };
    const res = await ingest("the source", { model: client, prompter: fixedPrompter("build") }, { plan: true });
    const parsed = parseOutline(res.outlineMarkdown);
    expect(parsed.meta.direction).toEqual(deckPlan.direction);
    expect(parsed.slides.map((s) => s.plan)).toEqual([slidePlan, slidePlan]);
    expect(calls).toHaveLength(1);
    const input = calls[0] as { sourceText: string; slides: { title: string }[] };
    expect(input.sourceText).toBe("the source");
    expect(input.slides.map((s) => s.title)).toEqual(["Eventual consistency", "Trade-off"]);
  });

  it("passes the art-direction conceit/motif to the planner when available", async () => {
    let seenArt: unknown;
    const client: ModelClient = {
      ...fakeModel().client,
      directArt: async () => ({ conceit: "ledger", motif: "rules", slides: [{ role: "a", instrument: "slider" as const }, { role: "b", instrument: "none" as const }] }),
      planDeck: async (input) => { seenArt = input.art; return deckPlan; },
    };
    await ingest("t", { model: client, prompter: fixedPrompter() }, { plan: true });
    expect(seenArt).toEqual({ conceit: "ledger", motif: "rules" });
  });

  it("is fatal when the client cannot plan", async () => {
    await expect(ingest("t", { model: fakeModel().client, prompter: fixedPrompter() }, { plan: true }))
      .rejects.toThrow(/cannot plan/);
  });

  it("propagates a planner failure (no silent degrade)", async () => {
    const client: ModelClient = { ...fakeModel().client, planDeck: async () => { throw new Error("planner exploded"); } };
    await expect(ingest("t", { model: client, prompter: fixedPrompter() }, { plan: true }))
      .rejects.toThrow("planner exploded");
  });

  it("does not call planDeck without the option", async () => {
    let called = false;
    const client: ModelClient = { ...fakeModel().client, planDeck: async () => { called = true; return deckPlan; } };
    const res = await ingest("t", { model: client, prompter: fixedPrompter() });
    expect(called).toBe(false);
    expect(parseOutline(res.outlineMarkdown).slides[0].plan).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing client test**

`tests/agent/anthropic-client-plan.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const runQuery = vi.fn();
vi.mock("../../src/agent/query", () => ({ runQuery: (...a: unknown[]) => runQuery(...a) }));

import { anthropicClient, PlanParseError } from "../../src/agent/anthropic-client";

const input = {
  sourceText: "src",
  digest: { title: "T", keyPoints: ["k"], sourceCharacter: "essay" },
  angle: { id: "a", label: "A", description: "d" },
  slides: [{ title: "One", markdown: "m1" }, { title: "Two", markdown: "m2" }],
};
const slide = { claim: "c", mechanism: "m", device: { kind: "static", resting: "r" } };
const good = JSON.stringify({ direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide, slide] });

describe("anthropicClient.planDeck", () => {
  beforeEach(() => runQuery.mockReset());

  it("returns the parsed plan on a clean reply", async () => {
    runQuery.mockResolvedValueOnce(good);
    const p = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input);
    expect(p.slides).toHaveLength(2);
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("retries once with the schema error in the prompt, then succeeds", async () => {
    const short = JSON.stringify({ direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide] });
    runQuery.mockResolvedValueOnce(short).mockResolvedValueOnce(good);
    const p = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input);
    expect(p.slides).toHaveLength(2);
    expect(runQuery).toHaveBeenCalledTimes(2);
    const retryUser = runQuery.mock.calls[1][1] as string;
    expect(retryUser).toMatch(/expected exactly 2 slides/);
  });

  it("throws PlanParseError carrying the raw reply after the second failure", async () => {
    runQuery.mockResolvedValueOnce("not json").mockResolvedValueOnce("still not json");
    const err = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input).catch((e) => e);
    expect(err).toBeInstanceOf(PlanParseError);
    expect((err as PlanParseError).raw).toBe("still not json");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bunx vitest run tests/agent/ingest.test.ts tests/agent/anthropic-client-plan.test.ts`
Expected: FAIL (no `planDeck`, no `PlanParseError`, ingest ignores opts).

- [ ] **Step 4: Implement `planDeck` in `src/agent/anthropic-client.ts`**

Add imports:

```ts
import { deckPlanSchema, type DeckPlan, type PlanInput } from "./model-client";
import { planPrompt } from "./prompts";
```

Add before `anthropicClient`:

```ts
/** The planner reply could not be parsed/validated twice; `raw` is the last reply, for inspection. */
export class PlanParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "PlanParseError";
  }
}

function issueText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return (e as Error).message;
}

/** One planning call: on a schema/parse failure retry ONCE with the error spelled out, then throw PlanParseError. */
async function askPlan(input: PlanInput, choice: ModelChoice): Promise<DeckPlan> {
  const p = planPrompt(input);
  const schema = deckPlanSchema(input.slides.length);
  const first = await runQuery(p.system, p.user, choice);
  try {
    return parseValidated(first, schema);
  } catch (e) {
    const retry = await runQuery(
      p.system,
      p.user + `\n\nYour previous reply was rejected: ${issueText(e)}. Return valid JSON only — no prose, no code fence.`,
      choice,
    );
    try {
      return parseValidated(retry, schema);
    } catch (e2) {
      throw new PlanParseError(`could not parse plan output: ${issueText(e2)}`, retry);
    }
  }
}
```

Add `import { ZodError, type ZodType } from "zod";` (replacing the existing `import type { ZodType } from "zod";`). Add to the returned client object:

```ts
    async planDeck(input) {
      return askPlan(input, choice);
    },
```

- [ ] **Step 5: Implement plan mode in `src/agent/ingest.ts`**

Change the signature and add the planning step after the art-direction block (before `return`):

```ts
export async function ingest(
  sourceText: string,
  deps: IngestDeps,
  opts: { plan?: boolean } = {},
): Promise<IngestResult> {
```

```ts
  // Layer 1 planning — the plan IS the product, so (unlike art direction) failure is fatal.
  if (opts.plan) {
    if (!deps.model.planDeck) throw new Error("this model client cannot plan (no planDeck)");
    const plan = await deps.model.planDeck({
      sourceText,
      digest,
      angle,
      art: direction ? { conceit: direction.conceit, motif: direction.motif } : undefined,
      slides: outline.slides.map((s) => ({ title: s.title, markdown: s.markdown })),
    });
    outline.meta.direction = plan.direction;
    outline.slides.forEach((s, i) => { s.plan = plan.slides[i]; });
  }
```

- [ ] **Step 6: Export `PlanParseError` from the barrel**

In `src/agent/index.ts` change the anthropic line to:

```ts
export { anthropicClient, PlanParseError } from "./anthropic-client";
```

- [ ] **Step 7: Run + typecheck**

Run: `bunx vitest run tests/agent && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/agent tests/agent/ingest.test.ts tests/agent/anthropic-client-plan.test.ts
git commit -m "feat(agent): planDeck on the Anthropic client + ingest plan mode"
```

---

### Task 7: `mindsizer plan` command

**Files:**
- Modify: `src/cli.ts` (`runIngest` → shared `runIngestLike(args, mode)`; dispatch `plan`)
- Test: `tests/agent/cli-plan.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

`tests/agent/cli-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer plan CLI (pre-LLM paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["plan"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer plan");
  });
  it("errors on a missing input file", () => {
    const r = runCli(["plan", "/no/such/file.txt"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });
  it("rejects an unknown option", () => {
    const r = runCli(["plan", "x.txt", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/agent/cli-plan.test.ts`
Expected: FAIL — `plan` falls through to `runSeal`, which prints `cannot read plan`.

- [ ] **Step 3: Refactor `runIngest` in `src/cli.ts`**

Rename the existing function to `runIngestLike(args: string[], mode: "ingest" | "plan")` and make these edits inside it:

- usage line:
  ```ts
  if (!input)
    fail(`usage: mindsizer ${mode} <text-file> [--angle <id>] [-o <out.md>] [--yes] [--source <url>] [--source-label <text>]`);
  ```
- status line: `process.stdout.write(mode === "plan" ? "digesting + planning…\n" : "digesting…\n");`
- the `ingest(...)` call gets the option and the raw-dump on planner failure:
  ```ts
  const outPath =
    out ??
    join(dirname(resolve(input)), basename(input, extname(input)) + (mode === "plan" ? ".plan.md" : ".outline.md"));

  let result: Awaited<ReturnType<typeof ingest>>;
  try {
    result = await ingest(
      text,
      {
        model: anthropicClient(),
        prompter,
        onDigest: (d) => process.stdout.write(`✓ digested (${d.keyPoints.length} points)\n`),
      },
      { plan: mode === "plan" },
    );
  } catch (e) {
    if (e instanceof PlanParseError) {
      const rawPath = outPath.replace(/\.md$/i, "") + ".raw.json";
      try { writeFileSync(rawPath, JSON.stringify({ raw: e.raw }, null, 2), "utf8"); } catch { /* best effort */ }
      fail(`${e.message}\n  raw planner reply saved → ${rawPath}`);
    }
    fail((e as Error).message);
  }
  ```
  and delete the later `const outPath = ...` block (it moved up).
- import `PlanParseError` from `./agent/index`.

Add two thin wrappers and the dispatch:

```ts
async function runIngest(args: string[]): Promise<void> { return runIngestLike(args, "ingest"); }
async function runPlan(args: string[]): Promise<void> { return runIngestLike(args, "plan"); }
```

In `main`, after the `ingest` branch:

```ts
  if (args[0] === "plan") {
    void runPlan(args.slice(1));
    return;
  }
```

- [ ] **Step 4: Run the CLI suites + typecheck**

Run: `bunx vitest run tests/agent/cli-plan.test.ts tests/agent/cli-ingest.test.ts && bunx tsc --noEmit`
Expected: PASS (ingest's messages are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/agent/cli-plan.test.ts
git commit -m "feat(cli): mindsizer plan — ingest + Layer-1 planning → x.plan.md"
```

---

### Task 8: Harness pluggability — materials + author prompt read the plan

**Files:**
- Modify: `src/render/materials.ts`
- Modify: `src/render/design-brief.ts`
- Test: `tests/render/materials.test.ts` (append), `tests/render/design-brief.test.ts` (append)

**Interfaces:**
- Produces: `SlideMaterials.plan?: SlidePlan`; `slideAuthorPrompt` renders a `## Slide plan` block when present.

- [ ] **Step 1: Append failing tests**

`tests/render/materials.test.ts`:

```ts
describe("gatherMaterials — plan", () => {
  const plan = { claim: "c", mechanism: "m", device: { kind: "figure" as const, resting: "r" } };
  it("forwards slide.plan", () => {
    const o: Outline = { ...outline, slides: [{ ...outline.slides[0], plan }, outline.slides[1], outline.slides[2]] };
    expect(gatherMaterials(o.slides[0], o, undefined).plan).toEqual(plan);
  });
  it("falls back to front-matter direction for conceit/motif when the sidecar has none", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "fm-conceit", motif: "fm-motif", arc: "x" } } };
    const m = gatherMaterials(o.slides[0], o, { digest: [], angle: "" });
    expect(m.conceit).toBe("fm-conceit");
    expect(m.motif).toBe("fm-motif");
  });
  it("prefers sidecar direction over front-matter", () => {
    const o: Outline = { ...outline, meta: { ...outline.meta, direction: { conceit: "fm", motif: "fm", arc: "x" } } };
    const ctx: DeckContext = { digest: [], angle: "", direction: { conceit: "sc", motif: "sc", roleById: {}, instrumentById: {} } };
    expect(gatherMaterials(o.slides[0], o, ctx).conceit).toBe("sc");
  });
});
```

`tests/render/design-brief.test.ts`:

```ts
describe("slideAuthorPrompt — slide plan", () => {
  const plan = {
    claim: "Founders supply momentum by hand.",
    mechanism: "growth = push + momentum",
    device: { kind: "instrument" as const, operate: "drag a crank", changes: "curve splits", resting: "crank at 40%" },
    aha: "release early → zero",
    data: "m(t)=m(t-1)*(1+r)",
    source: "you have to go out and get them",
  };
  it("renders every plan field and tells the author to implement, not re-plan", () => {
    const p = slideAuthorPrompt({ ...req, materials: { ...req.materials, plan } });
    expect(p.user).toContain("## Slide plan");
    for (const s of ["Founders supply momentum", "growth = push", "instrument", "drag a crank", "curve splits", "crank at 40%", "release early", "m(t)=", "go out and get them"]) {
      expect(p.user).toContain(s);
    }
    expect(p.user).toMatch(/implement this plan/i);
    expect(p.user.indexOf("## Slide plan")).toBeLessThan(p.user.indexOf("Slide content (markdown)"));
  });
  it("has no plan block without a plan", () => {
    expect(slideAuthorPrompt(req).user).not.toContain("## Slide plan");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/materials.test.ts tests/render/design-brief.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/render/materials.ts`**

```ts
import type { Outline, OutlineSlide, SlidePlan } from "../outline/types";
import type { DeckContext } from "../agent/context-sidecar";

export interface SlideMaterials {
  digest: string[];
  angle: string;
  sourceExcerpt?: string;
  neighborTitles: string[];
  conceit?: string;         // whole-deck controlling metaphor (art direction)
  motif?: string;           // shared visual motif
  role?: string;            // this slide's job in the deck
  instrument?: string;      // assigned interaction from the palette
  otherInstruments?: string[]; // instruments already claimed by other slides (vary from these)
  plan?: SlidePlan;         // Layer-1 plan (plan.md) — implement it, don't re-plan
}

/** Per-slide context handed to the author: the idea, not just the bullet. */
export function gatherMaterials(
  slide: OutlineSlide,
  outline: Outline,
  ctx?: DeckContext,
): SlideMaterials {
  const idx = outline.slides.findIndex((s) => s.id === slide.id);
  const neighborTitles = outline.slides
    .filter((_, i) => i === idx - 1 || i === idx + 1)
    .map((s) => s.title);
  const dir = ctx?.direction;
  const fm = outline.meta.direction; // plan.md front-matter — fallback when the sidecar has none
  const otherInstruments = dir
    ? Object.entries(dir.instrumentById)
        .filter(([id, v]) => id !== slide.id && v && v !== "none")
        .map(([, v]) => v)
    : undefined;
  return {
    digest: ctx?.digest ?? [],
    angle: ctx?.angle ?? "",
    sourceExcerpt: ctx?.perSlideExcerpt?.[slide.id],
    neighborTitles,
    conceit: dir?.conceit ?? fm?.conceit,
    motif: dir?.motif ?? fm?.motif,
    role: dir?.roleById?.[slide.id],
    instrument: dir?.instrumentById?.[slide.id],
    otherInstruments,
    plan: slide.plan,
  };
}
```

- [ ] **Step 4: Implement the plan block in `src/render/design-brief.ts`**

Add a helper above `slideAuthorPrompt`:

```ts
import type { SlidePlan } from "../outline/types";

/** The Layer-1 plan, rendered for the author. Present only for plan.md builds. */
function planBlock(p: SlidePlan): string {
  const d = p.device;
  return [
    "## Slide plan (from the planning layer — IMPLEMENT THIS PLAN, do not re-plan)",
    `Claim: ${p.claim}`,
    `Mechanism: ${p.mechanism}`,
    `Device: ${d.kind}` +
      (d.operate ? ` — the reader operates: ${d.operate}` : "") +
      (d.changes ? ` — what visibly changes: ${d.changes}` : ""),
    `Resting state (must read alone): ${d.resting}`,
    ...(p.aha ? [`Aha: ${p.aha}`] : []),
    ...(p.data ? [`Data (draw from this, never invent): ${p.data}`] : []),
    ...(p.source ? [`Source anchor: ${p.source}`] : []),
    "",
  ].join("\n");
}
```

In `slideAuthorPrompt`, insert the block between `Suggested layout` and `Slide content`:

```ts
    `Suggested layout: ${slide.layout}\n` +
    (materials.plan ? "\n" + planBlock(materials.plan) + "\n" : "") +
    `Slide content (markdown):\n${slide.markdown}\n\n` +
```

- [ ] **Step 5: Run + typecheck**

Run: `bunx vitest run tests/render && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/materials.ts src/render/design-brief.ts tests/render/materials.test.ts tests/render/design-brief.test.ts
git commit -m "feat(render): the harness reads the Layer-1 plan (materials + author prompt)"
```

---

### Task 9: `mindsizer brief`

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/export/cli-brief.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/export/cli-brief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer brief", () => {
  it("prints the author identity brief with the Field aesthetic by default", () => {
    const r = runCli(["brief"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Aesthetic — Field");
    expect(r.stdout).toContain("1280x720");
    expect(r.stdout).toContain("data-slide-id");
  });
  it("honours --theme", () => {
    const r = runCli(["brief", "--theme", "paper"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("Aesthetic — Field");
  });
  it("fails on an unknown theme", () => {
    const r = runCli(["brief", "--theme", "nope"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown theme");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/export/cli-brief.test.ts`
Expected: FAIL (`brief` falls through to `runSeal`).

- [ ] **Step 3: Implement**

In `src/cli.ts` import `identityBrief` from `./render/index` and add:

```ts
/** Print the author system prompt (genre + format + theme aesthetic + contract) — the shared identity for any Layer 2. */
function runBrief(args: string[]): void {
  let themeName = "field";
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--theme") {
      themeName = args[++k];
      if (!themeName) fail("--theme requires a name");
    } else {
      fail(`unknown option ${a}`);
    }
  }
  let theme;
  try {
    theme = loadTheme(themeName);
  } catch (e) {
    fail((e as Error).message);
  }
  process.stdout.write(identityBrief(theme.brief) + "\n");
}
```

Dispatch in `main`:

```ts
  if (args[0] === "brief") {
    runBrief(args.slice(1));
    return;
  }
```

- [ ] **Step 4: Run + typecheck**

Run: `bunx vitest run tests/export/cli-brief.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/export/cli-brief.test.ts
git commit -m "feat(cli): mindsizer brief — print the shared author identity for any Layer 2"
```

---

### Task 10: `mindsizer fit`

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/render/cli-fit.test.ts`

**Interfaces:**
- Consumes: `playwrightRenderer(themeCss).render(html, interactions)` → `{ shots, overflowPx, fits, consoleErrors }`; `hasUsableSection`.
- Produces: `mindsizer fit <slide.html> [--shot <png>] [--steps <json>] [--theme <name>]`. Exit 0 when clean (fits + 0 console errors), 1 when not, 2 when the file has no usable section.

- [ ] **Step 1: Write the failing tests (pre-browser paths only)**

`tests/render/cli-fit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer fit (pre-browser paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["fit"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer fit");
  });
  it("errors on a missing file", () => {
    const r = runCli(["fit", "/no/such/slide.html"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });
  it("exits 2 when the file has no usable <section data-slide-id>", () => {
    const dir = mkdtempSync(join(tmpdir(), "fit-"));
    const f = join(dir, "s_x.html");
    writeFileSync(f, "<div>not a slide</div>");
    const r = runCli(["fit", f]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no <section data-slide-id");
  });
  it("rejects malformed --steps JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "fit-"));
    const f = join(dir, "s_x.html");
    writeFileSync(f, '<section data-slide-id="s_x"></section>');
    const r = runCli(["fit", f, "--steps", "{nope"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--steps must be a JSON array");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/cli-fit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/cli.ts` add (imports already present: `readFileSync`, `writeFileSync`, `playwrightRenderer`, `loadTheme`; add `import type { Interaction } from "./render/fit-check";`):

```ts
/** Layer-2 eyes: render one saved slide section at 1280×720 and report overflow + console errors. */
async function runFit(args: string[]): Promise<void> {
  let input: string | undefined;
  let shot: string | undefined;
  let stepsRaw: string | undefined;
  let themeName = "field";
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--shot") {
      shot = args[++k];
      if (!shot) fail("--shot requires a path");
    } else if (a === "--steps") {
      stepsRaw = args[++k];
      if (stepsRaw === undefined) fail("--steps requires a JSON array");
    } else if (a === "--theme") {
      themeName = args[++k];
      if (!themeName) fail("--theme requires a name");
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }
  if (!input) fail("usage: mindsizer fit <slide.html> [--shot <png>] [--steps '<json array>'] [--theme <name>]");

  let html: string;
  try {
    html = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }
  // the section id is the file stem by convention (<stem>.build/slides/<id>.html)
  const id = basename(input, extname(input));
  if (!hasUsableSection(html, id)) {
    process.stderr.write(`error: no <section data-slide-id="${id}"> in ${input} (exactly one is required)\n`);
    process.exit(2);
  }

  let steps: Interaction[] = [];
  if (stepsRaw !== undefined) {
    try {
      const v = JSON.parse(stepsRaw);
      if (!Array.isArray(v)) throw new Error();
      steps = v as Interaction[];
    } catch {
      fail("--steps must be a JSON array of {click?, press?, wait?}");
    }
  }

  let theme;
  try {
    theme = loadTheme(themeName);
  } catch (e) {
    fail((e as Error).message);
  }

  const shotPath = shot ?? resolve(input).replace(/\.html$/i, "") + ".png";
  const renderer = playwrightRenderer(theme.fontFaceCss + "\n" + theme.css);
  try {
    const r = await renderer.render(html, steps);
    r.shots.forEach((png, i) => {
      const p = i === 0 ? shotPath : shotPath.replace(/\.png$/i, "") + `-${i}.png`;
      writeFileSync(p, png);
      process.stdout.write(`${i === 0 ? "resting" : `after step ${i}`} → ${p}\n`);
    });
    const clean = r.fits && r.consoleErrors.length === 0;
    process.stdout.write(`overflow: ${r.overflowPx}px · console errors: ${r.consoleErrors.length} · ${clean ? "CLEAN" : "NOT CLEAN"}\n`);
    for (const e of r.consoleErrors) process.stdout.write(`  ! ${e}\n`);
    if (!clean) process.exitCode = 1;
  } finally {
    await renderer.dispose().catch(() => {});
  }
}
```

Dispatch in `main`:

```ts
  if (args[0] === "fit") {
    void runFit(args.slice(1));
    return;
  }
```

- [ ] **Step 4: Run + typecheck, then a live smoke**

Run: `bunx vitest run tests/render/cli-fit.test.ts && bunx tsc --noEmit`
Expected: PASS.

Live smoke (needs chromium):

```bash
bun run src/cli.ts fit examples/dont-scale.outline.build/slides/$(ls examples/dont-scale.outline.build/slides | head -1)
```

Expected: `resting → …png`, then `overflow: 0px · console errors: 0 · CLEAN`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/render/cli-fit.test.ts
git commit -m "feat(cli): mindsizer fit — Layer-2 eyes for one saved slide section"
```

---

### Task 11: The `mindsizer-author` skill + docs

**Files:**
- Create: `.claude/skills/mindsizer-author/SKILL.md`
- Modify: `.claude/skills/mindsizer/SKILL.md` (§2 + §3)
- Modify: `README.md` (commands table, how-it-works)

- [ ] **Step 1: Write the skill**

`.claude/skills/mindsizer-author/SKILL.md`:

````markdown
---
name: mindsizer-author
description: >-
  Be mindsizer's VISUAL DESIGNER (Layer 2): turn an existing `*.plan.md` — where a planning
  layer has already decided each slide's claim, mechanism, comprehension device, resting state
  and source anchor — into rendered 1280×720 slide sections, check them with `mindsizer fit`,
  and seal them into one offline interactive deck with `mindsizer build --resume`. Use when the
  user points at a plan.md, says "author/design/implement/build the slides from the plan", or
  wants to hand-author some slides and let the harness do the rest. Do NOT use it to plan
  (that's `mindsizer plan`) or to build from a plain outline.md (that's the `mindsizer` skill).
---

# mindsizer-author — Layer 2 in Claude Code

You are the visual designer. The plan already says WHAT each slide teaches and HOW (the
device). You decide composition, hierarchy, how the figure is drawn, how a control looks, and
you fix what the render shows. **Implement the plan; do not re-plan it.** If a plan entry is
impossible as written, say so to the user and propose the smallest change — don't silently
substitute.

## 0. Load the identity and the drawing rules

```bash
mindsizer brief            # the author system prompt: genre, 16:9 format, Field aesthetic, output contract
```

Read that output as your brief. Then load the `artifact-diagramming` skill — its rules
("depict the mechanism, not its name", label the arrows, inline SVG only, `currentColor`,
one figure one claim) are how mindsizer figures should be drawn. Keep the deck's palette
(the brief's aesthetic) over the diagramming skill's theme notes — slides are sealed with a
theme stylesheet, not the artifact viewer's theme.

## 1. Read the plan

Open `<name>.plan.md`. Front-matter `direction` (conceit / motif / arc) applies to every
slide. Each slide block has prose (the CONTENT to place, not rewrite) and a ```plan fence:
claim · mechanism · device{kind, operate, changes, resting} · aha · data · source.

## 2. Author each slide as a section file

Write one file per slide at `<name>.plan.build/slides/<slide-id>.html` (create the dirs).
File shape — exactly what the harness saves:

```html
<style>#s_xxxxxxxx .cls { … }</style>                         <!-- optional, id-scoped -->
<section data-slide-id="s_xxxxxxxx" data-layout="bespoke"> … </section>
<script>(function(){ /* touch only the #s_xxxxxxxx subtree */ })();</script>   <!-- optional -->
```

Rules that matter:
- Exactly ONE `<section data-slide-id="<id>">`, id = the slide's id from the plan.
- Fits 1280×720 with no scrolling; the **resting state** from the plan must read alone.
- Interactive only when the plan's device is an `instrument`; the interaction must produce the
  plan's `aha`. Scripts run once on load while the slide is hidden — never measure layout at
  load (`getBoundingClientRect`/`offsetWidth` read 0); compute inside handlers or use fixed SVG
  coordinates.
- Figures: inline `<svg>` with `viewBox`, labelled arrows, `currentColor`; draw the mechanism.
- Quantitative? Use the plan's `data` verbatim. No invented numbers.
- No external images/fonts/@import; fonts are provided by the theme.

## 3. Look at every slide

```bash
mindsizer fit <name>.plan.build/slides/<id>.html                  # resting frame
mindsizer fit … --steps '[{"click":"#s_x .crank","wait":300}]'    # plus interactive states
```

It writes a PNG next to the file and prints `overflow: Npx · console errors: N · CLEAN|NOT CLEAN`.
Read the PNG. Fix overflow, dead space, weak hierarchy, off-brand styling; re-run. Stop the
moment it's CLEAN — extra passes tend to make slides worse.

## 4. Seal

```bash
mindsizer build <name>.plan.md --resume --open
```

`--resume` reuses every saved slide file, hands any MISSING slide to the harness author, seals
with the theme + deck runtime, and runs the whole-deck check. Mixing is fine: author the hard
slides yourself, let the harness fill the rest.

## 5. Show it

The result is one offline HTML deck (`<name>.plan.html` by default). Open it, or publish it
as an Artifact so the user can view it in the browser. **← / →** navigate.
````

- [ ] **Step 2: Point the `mindsizer` skill at the new flow**

In `.claude/skills/mindsizer/SKILL.md`, replace the §2 heading/intro paragraph with:

```markdown
## 2. Ingest → outline (or `plan` → a richer plan.md)

Two entry points. **Prefer `plan`** — it runs the same digest/angle pipeline on the strongest
model and additionally writes, per slide, the claim, the mechanism, the comprehension device
(what the reader operates and what changes), the resting state, and a source anchor:

```bash
mindsizer plan <source.txt> --yes -o <name>.plan.md
```

The resulting `plan.md` is the hand-editable contract between planning and visual design. You
can then EITHER hand it to the harness (`mindsizer build <name>.plan.md`) OR author the slides
yourself with the `mindsizer-author` skill. The classic `ingest` still exists for the old flow:
```

(keep the existing `mindsizer ingest …` code block and the rest of §2 below it.)

- [ ] **Step 3: README**

Add a row to the Commands table after `ingest`:

```markdown
| `mindsizer plan <text-file> [--yes] [-o out.plan.md] [--source <url>] [--source-label <text>]` | **Layer 1.** Everything `ingest` does, plus a whole-deck planning pass on the strongest model that writes each slide's *claim · mechanism · device (kind, operate, changes, resting) · aha · data · source* as a ```plan fence, and the deck's `direction` (conceit/motif/arc) in front-matter. The resulting `*.plan.md` is a hand-editable contract any visual layer can implement — the harness (`build`) or a Claude Code session (`mindsizer-author` skill). |
| `mindsizer brief [--theme <name>]` | Print the author identity brief (genre, 16:9 format, theme aesthetic, output contract) — the shared brief for any Layer 2. |
| `mindsizer fit <slide.html> [--shot <png>] [--steps <json>]` | Render one saved slide section at 1280×720; write the screenshot(s); report overflow + console errors. Exit 0 when clean. |
```

And under **How it works**, add before the diagram:

```markdown
mindsizer is two layers with one file between them:

- **Layer 1 — planning** (`plan`, Fable 5.1): digest → angle → outline → art direction → per-slide plan. Owns the *claim*, the *mechanism*, the *comprehension device*, the *resting state*, the *data*, the *source anchor*. Output: `x.plan.md`.
- **Layer 2 — visual design + implementation**: composition, hierarchy, how the figure is drawn, how a control looks, render-and-fix. Either the built-in harness (`build`) or a Claude Code session (the `mindsizer-author` skill, using `brief` for identity and `fit` for eyes) — both seal through the same `build --resume`.
```

- [ ] **Step 4: Full suite + typecheck**

Run: `bunx vitest run && bunx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills README.md
git commit -m "docs(skill): mindsizer-author skill (Layer 2 in Claude Code) + plan flow docs"
```

---

### Task 12: Live verification (run, not unit)

**Files:** none committed except the example plan if it looks good.

- [ ] **Step 1: Plan the bundled example on Fable 5.1**

```bash
bun run src/cli.ts plan examples/dont-scale.txt --yes -o examples/dont-scale.plan.md \
  --source https://www.paulgraham.com/ds.html --source-label "Paul Graham — “Do Things That Don’t Scale”"
```

Expected: `digesting + planning…`, `✓ digested (…)`, `✓ wrote examples/dont-scale.plan.md`, `✓ wrote examples/dont-scale.plan.context.json`, a cost line naming `Fable`. Then:

```bash
bun run src/cli.ts examples/dont-scale.plan.md -o /dev/null   # seal path parses + validates it
```

Expected: `✓ parsed N slides`, `✓ rendered + validated`.

- [ ] **Step 2: Read the plan**

Open `examples/dont-scale.plan.md`. Check: every slide has a fence; device kinds vary; each `instrument` has operate/changes/aha; quantitative slides carry `data`; `direction.arc` reads as the deck's argument.

- [ ] **Step 3: Author through the skill**

In a fresh Claude Code session in the repo: "use the mindsizer-author skill on examples/dont-scale.plan.md". Verify it runs `mindsizer brief`, writes `examples/dont-scale.plan.build/slides/<id>.html`, runs `mindsizer fit` per slide, and finishes with `mindsizer build examples/dont-scale.plan.md --resume`.

Expected: `· resume: reusing N/N saved slides`, `✓ deck check passed`.

- [ ] **Step 4: Compare and record**

Open `examples/dont-scale.plan.html` next to `examples/dont-scale.deck.html`. Note in a short section appended to `MINDSIZER_HARNESS_FINDINGS_2.md` (or a new `MINDSIZER_HARNESS_FINDINGS_3.md`): plan cost/time, whether the plan's devices were implementable as written, and where Layer 2 diverged from the plan. Commit the example plan + findings:

```bash
git add examples/dont-scale.plan.md examples/dont-scale.plan.context.json MINDSIZER_HARNESS_FINDINGS_3.md
git commit -m "chore(example): dont-scale plan.md from the Fable planner + findings"
```
