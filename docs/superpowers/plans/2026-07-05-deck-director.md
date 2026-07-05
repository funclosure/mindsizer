# Deck Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A whole-deck art-direction step: one cheap ingest-tier `directArt` call emits a controlling conceit + shared motif + per-slide role + a deduped interaction instrument, precomputed into a slide-id map the parallel author pool reads, with real cross-slide enforcement threaded into the review coherence pass.

**Architecture:** `directArt` is OPTIONAL on `ModelClient` and called GUARDED + try/catch in ingest (never fatal). Its output rides on `IngestResult.direction` → the `*.context.json` sidecar → `SlideMaterials` → advisory lines in the author's user prompt. Theme stays the deterministic `'field'` default. `reviewDeckCoherence` gains the conceit/motif so a flipped metaphor is caught at review time.

**Spec:** `docs/superpowers/specs/2026-07-05-deck-director-design.md`
**Branch:** `feat/deck-director` off `main`.

---

### Task 1: art-direction schema + optional directArt

**Files:** Modify `src/agent/model-client.ts`; Test `tests/agent/model-client.test.ts`

- [ ] **Step 1: Test.** Append to `tests/agent/model-client.test.ts`:
```ts
import { ArtDirectionSchema, INSTRUMENTS } from "../../src/agent/model-client";
describe("ArtDirectionSchema", () => {
  it("accepts a valid direction with palette instruments", () => {
    const v = ArtDirectionSchema.parse({ conceit: "a ledger", motif: "ruled lines",
      slides: [{ role: "intro", instrument: "toggle" }, { role: "formalize", instrument: "slider" }] });
    expect(v.slides).toHaveLength(2);
  });
  it("rejects an off-palette instrument", () => {
    expect(() => ArtDirectionSchema.parse({ conceit: "x", motif: "y", slides: [{ role: "r", instrument: "hologram" }] })).toThrow();
  });
  it("INSTRUMENTS includes none", () => { expect(INSTRUMENTS).toContain("none"); });
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Append to `src/agent/model-client.ts`:
```ts
export const INSTRUMENTS = ["slider", "toggle", "stepper", "chart", "dial", "reveal", "map", "none"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const ArtDirectionSchema = z.object({
  conceit: z.string(),
  motif: z.string(),
  slides: z.array(z.object({ role: z.string(), instrument: z.enum(INSTRUMENTS) })),
});
export type DeckDirection = z.infer<typeof ArtDirectionSchema>;
```
and add an OPTIONAL method to the `ModelClient` interface (optional so existing clients/fakes stay valid):
```ts
  directArt?(digest: DigestResult, angle: Direction, titles: string[]): Promise<DeckDirection>;
```
- [ ] **Step 4:** Run tests + `bunx tsc --noEmit` — PASS/clean.
- [ ] **Step 5: Commit** — `feat(agent): art-direction schema + optional directArt on ModelClient`

---

### Task 2: artDirectionPrompt

**Files:** Modify `src/agent/prompts.ts`; Test `tests/agent/prompts.test.ts`

- [ ] **Step 1: Test.** Append to `tests/agent/prompts.test.ts`:
```ts
import { artDirectionPrompt } from "../../src/agent/prompts";
describe("artDirectionPrompt", () => {
  const digest = { title: "T", keyPoints: ["a", "b"], sourceCharacter: "c" };
  it("feeds titles + angle and asks for conceit/motif/per-slide role+instrument", () => {
    const p = artDirectionPrompt(digest as any, { id: "x", label: "L", description: "D" } as any, ["S1", "S2"]);
    expect(p.user).toContain("S1"); expect(p.user).toContain("S2"); expect(p.user).toContain("L");
    expect(p.system).toMatch(/conceit/i); expect(p.system).toMatch(/instrument/i);
  });
  it("does not resend slide markdown (titles only)", () => {
    const p = artDirectionPrompt(digest as any, { id: "x", label: "L", description: "D" } as any, ["S1"]);
    expect(p.user).not.toMatch(/markdown/i);
  });
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Add to `src/agent/prompts.ts` (reuse the private `digestText`):
```ts
export function artDirectionPrompt(digest: DigestResult, angle: Direction, titles: string[]): Prompt {
  return {
    system: [
      "You are mindsizer's ART-DIRECTION stage. Give the WHOLE deck one coherent identity so its slides read as one authored piece, not a pile.",
      "Choose: (1) conceit — a single controlling metaphor the whole deck can lean on (e.g. 'a ledger', 'a courtroom', 'a flight checklist'); (2) motif — a shared visual through-line; and per slide: (3) role — its distinct job so no two slides repeat the same point ('introduce the tension', 'formalize it', 'the counter-case'); (4) instrument — one interaction from the fixed palette, VARIED across slides.",
      'Instrument palette (use these exact strings): "slider","toggle","stepper","chart","dial","reveal","map","none".',
      'Respond with JSON only: {"conceit": string, "motif": string, "slides": [{"role": string, "instrument": <palette>}]} — the slides array MUST be the same length and order as the titles given.',
    ].join("\n"),
    user: `Angle: ${angle.label} — ${angle.description}\n\n${digestText(digest)}\n\nSlide titles (in order):\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
  };
}
```
(`digestText` is module-private — the new fn is in the same file so it can call it. `DigestResult`/`Direction` already imported.)
- [ ] **Step 4:** Run tests — PASS.
- [ ] **Step 5: Commit** — `feat(agent): artDirectionPrompt (titles-only, palette-constrained)`

---

### Task 3: anthropic-client implements directArt

**Files:** Modify `src/agent/anthropic-client.ts` (no unit test — matches the untested-adapter convention; covered by tsc + suite)

- [ ] **Step 1: Implement.** Import `ArtDirectionSchema` (from model-client) and `artDirectionPrompt` (from prompts). Add to the returned client object:
```ts
    async directArt(digest, angle, titles) {
      const p = artDirectionPrompt(digest, angle, titles);
      return ask(p.system, p.user, ArtDirectionSchema, "art-direction", choice);
    },
```
- [ ] **Step 2:** `bun run test && bunx tsc --noEmit` — clean.
- [ ] **Step 3: Commit** — `feat(agent): anthropicClient.directArt at the ingest tier`

---

### Task 4: sidecar round-trips direction

**Files:** Modify `src/agent/context-sidecar.ts`; Test `tests/agent/context-sidecar.test.ts`

- [ ] **Step 1: Test.** Append:
```ts
describe("DeckContext.direction round-trip", () => {
  it("serializes + parses direction", () => {
    const ctx = { sourcePath: "/s", digest: ["a"], angle: "ang",
      direction: { conceit: "a ledger", motif: "rules", roleById: { s_a: "intro" }, instrumentById: { s_a: "toggle" } } };
    const back = parseContext(serializeContext(ctx as any));
    expect(back?.direction?.conceit).toBe("a ledger");
    expect(back?.direction?.instrumentById.s_a).toBe("toggle");
  });
  it("parses an OLD sidecar with no direction (backward compat)", () => {
    const back = parseContext(JSON.stringify({ digest: ["a"], angle: "ang" }));
    expect(back).not.toBeNull();
    expect(back?.direction).toBeUndefined();
  });
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** In `src/agent/context-sidecar.ts`:
  - Add to `DeckContext`: `direction?: { conceit: string; motif: string; roleById: Record<string, string>; instrumentById: Record<string, string> };`
  - In `parseContext`, after building the base object, defensively parse direction:
```ts
  const dir = (typeof o.direction === "object" && o.direction !== null) ? o.direction as Record<string, unknown> : undefined;
  const direction = dir && typeof dir.conceit === "string" && typeof dir.motif === "string" ? {
    conceit: dir.conceit, motif: dir.motif,
    roleById: (typeof dir.roleById === "object" && dir.roleById) ? dir.roleById as Record<string, string> : {},
    instrumentById: (typeof dir.instrumentById === "object" && dir.instrumentById) ? dir.instrumentById as Record<string, string> : {},
  } : undefined;
```
  and add `direction` to the returned object. `serializeContext` is `JSON.stringify(ctx, null, 2)` — already round-trips the new field. Leave the required-field check (`digest[]`+`angle`) unchanged.
- [ ] **Step 4:** Run tests — PASS.
- [ ] **Step 5: Commit** — `feat(agent): sidecar round-trips deck direction (backward-compatible)`

---

### Task 5: ingest produces direction (guarded + deduped)

**Files:** Modify `src/agent/ingest.ts`; Test `tests/agent/ingest.test.ts`

- [ ] **Step 1: Test.** Append to `tests/agent/ingest.test.ts` (add a fake that DOES implement directArt):
```ts
it("zips + dedups art-direction onto slide ids, degrading on throw", async () => {
  const model = {
    async digest() { return { title: "T", keyPoints: ["p"], sourceCharacter: "c" }; },
    async proposeDirections() { return [{ id: "a", label: "A", description: "d" }]; },
    async generateOutline() { return { title: "T", slides: [
      { title: "S1", layout: "plain" as const, markdown: "a" },
      { title: "S2", layout: "plain" as const, markdown: "b" }] }; },
    async directArt() { return { conceit: "a ledger", motif: "rules",
      slides: [{ role: "intro", instrument: "toggle" as const }, { role: "again", instrument: "toggle" as const }] }; },
  };
  const r = await ingest("src", { model, prompter: { chooseAngle: async (d: any) => d[0] } });
  expect(r.direction?.conceit).toBe("a ledger");
  const insts = Object.values(r.direction!.instrumentById);
  expect(new Set(insts).size).toBe(insts.length); // duplicate 'toggle' was deduped
});
it("degrades to no direction when directArt throws", async () => {
  const model = {
    async digest() { return { title: "T", keyPoints: ["p"], sourceCharacter: "c" }; },
    async proposeDirections() { return [{ id: "a", label: "A", description: "d" }]; },
    async generateOutline() { return { title: "T", slides: [{ title: "S1", layout: "plain" as const, markdown: "a" }] }; },
    async directArt() { throw new Error("boom"); },
  };
  const r = await ingest("src", { model, prompter: { chooseAngle: async (d: any) => d[0] } });
  expect(r.direction).toBeUndefined();
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** In `src/agent/ingest.ts`:
  - Import `INSTRUMENTS` from `./model-client`.
  - Extend `IngestResult`: `direction?: { conceit: string; motif: string; roleById: Record<string, string>; instrumentById: Record<string, string> };`
  - After the outline is validated (before the return), add:
```ts
  let direction: IngestResult["direction"];
  if (deps.model.directArt) {
    try {
      const art = await deps.model.directArt(digest, angle, outline.slides.map((s) => s.title));
      const pool = INSTRUMENTS.filter((x) => x !== "none");
      const used = new Set<string>();
      const roleById: Record<string, string> = {};
      const instrumentById: Record<string, string> = {};
      outline.slides.forEach((s, i) => {
        const a = art.slides[i];
        roleById[s.id] = a?.role ?? "";
        let inst: string = a?.instrument ?? "none";
        if (inst !== "none" && used.has(inst)) {
          const free = pool.find((x) => !used.has(x));
          if (free) inst = free; // else palette exhausted → accept the repeat
        }
        if (inst !== "none") used.add(inst);
        instrumentById[s.id] = inst;
      });
      direction = { conceit: art.conceit, motif: art.motif, roleById, instrumentById };
    } catch { /* art direction is best-effort — a failure never discards the outline */ }
  }
```
  - Add `direction` to the returned object.
- [ ] **Step 4:** Run tests + `bun run test` — the 4 existing ingest fakes (no directArt) still pass because the call is guarded. PASS.
- [ ] **Step 5: Commit** — `feat(agent): ingest emits guarded, deduped deck direction`

---

### Task 6: cli writes direction to the sidecar

**Files:** Modify `src/cli.ts` (`runIngest`)

- [ ] **Step 1: Implement.** In `runIngest`, where it calls `serializeContext({ sourcePath, digest, angle })`, add `direction: result.direction` (best-effort — the surrounding try/catch is unchanged).
- [ ] **Step 2:** `bun run test && bunx tsc --noEmit` — clean.
- [ ] **Step 3: Commit** — `feat(cli): persist deck direction into the context sidecar`

---

### Task 7: direction reaches the author brief

**Files:** Modify `src/render/materials.ts`, `src/render/design-brief.ts`; Test both test files

- [ ] **Step 1: Tests.** `tests/render/materials.test.ts`:
```ts
it("carries direction fields and computes otherInstruments minus self", () => {
  const ctx = { digest: [], angle: "", direction: { conceit: "a ledger", motif: "rules",
    roleById: { s_a: "intro", s_b: "formalize" }, instrumentById: { s_a: "toggle", s_b: "slider" } } };
  const m = gatherMaterials({ id: "s_a", layout: "plain", title: "A", markdown: "" } as any,
    { meta: {}, slides: [{ id: "s_a" }, { id: "s_b" }] } as any, ctx as any);
  expect(m.conceit).toBe("a ledger"); expect(m.role).toBe("intro"); expect(m.instrument).toBe("toggle");
  expect(m.otherInstruments).toEqual(["slider"]);
});
```
`tests/render/design-brief.test.ts`:
```ts
it("adds advisory art-direction lines when present, omits them when absent", () => {
  const withDir = slideAuthorPrompt({ ...req, materials: { ...req.materials, conceit: "a ledger", motif: "rules", role: "intro", instrument: "toggle", otherInstruments: ["slider"] } }).user;
  expect(withDir).toMatch(/controlling metaphor/i);
  expect(withDir).toContain("a ledger"); expect(withDir).toContain("toggle");
  expect(slideAuthorPrompt(req).user).not.toMatch(/controlling metaphor/i);
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.**
  `materials.ts`: extend `SlideMaterials` with `conceit?: string; motif?: string; role?: string; instrument?: string; otherInstruments?: string[];` and in `gatherMaterials`:
```ts
  const dir = ctx?.direction;
  const instrument = dir?.instrumentById?.[slide.id];
  const otherInstruments = dir
    ? Object.entries(dir.instrumentById).filter(([id, v]) => id !== slide.id && v && v !== "none").map(([, v]) => v)
    : undefined;
```
  add `conceit: dir?.conceit, motif: dir?.motif, role: dir?.roleById?.[slide.id], instrument, otherInstruments` to the return.
  `design-brief.ts` `slideAuthorPrompt`: append presence-guarded lines to the `user` string (before `return`):
```ts
    (materials.conceit ? `\nControlling metaphor for the deck (art direction — advisory): ${materials.conceit}\n` : "") +
    (materials.motif ? `Shared visual motif: ${materials.motif}\n` : "") +
    (materials.role ? `This slide's job in the deck (don't duplicate other slides): ${materials.role}\n` : "") +
    (materials.instrument && materials.instrument !== "none"
      ? `Suggested interaction: a ${materials.instrument}${materials.otherInstruments?.length ? ` — vary from instruments already used elsewhere (${materials.otherInstruments.join(", ")})` : ""}\n`
      : "");
```
- [ ] **Step 4:** Run tests — PASS.
- [ ] **Step 5: Commit** — `feat(render): deck direction reaches each slide's author brief (advisory)`

---

### Task 8: review coherence enforces the metaphor

**Files:** Modify `src/review/deck-review.ts`, `src/cli.ts` (`runReview`); Test `tests/review/deck-review.test.ts`

- [ ] **Step 1: Test.** In `tests/review/deck-review.test.ts`, add: when a `direction` with a conceit is passed, the coherence prompt mentions it (so a flipped metaphor is checked):
```ts
it("threads the controlling conceit into the coherence prompt", async () => {
  reply = JSON.stringify({ findings: [] });
  await reviewDeckCoherence("D", "a", slides, { conceit: "a ledger", motif: "rules" });
  expect(seen[seen.length - 1].user).toContain("a ledger");
});
```
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** `reviewDeckCoherence` gains an optional 4th param `direction?: { conceit: string; motif: string }`. When present, append to the SYSTEM (or user) a check line: `The deck is meant to hold ONE controlling metaphor: "<conceit>" (motif: "<motif>"). Flag any slide that breaks or contradicts it, and any two slides that duplicate the same point.` In `cli.ts` `runReview`, pass `ctx?.direction` (guard for the two fields) into `reviewDeckCoherence`.
- [ ] **Step 4:** Run tests + `bun run test` — PASS.
- [ ] **Step 5: Commit** — `feat(review): coherence pass enforces the deck's controlling metaphor`

---

### Task 9: full verification + finish

- [ ] **Step 1:** `bun run test && bunx tsc --noEmit` — green/clean.
- [ ] **Step 2:** `bun run src/cli.ts 2>&1 | head -1` and `bun run src/cli.ts ingest 2>&1 | head -1` — usage lines, no import errors.
- [ ] **Step 3:** Finish via superpowers:finishing-a-development-branch — merge `feat/deck-director` to `main`.

**Post-merge validation (manual):** re-ingest a source and inspect the `*.context.json` sidecar for a `direction` block; a fresh build's author prompts carry the advisory lines; `review` flags a deliberately metaphor-flipped slide.
