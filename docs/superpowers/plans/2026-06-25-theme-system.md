# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the theme (CSS + fonts + author aesthetic-brief) an injectable, swappable unit loaded from `themes/<name>/`, migrate Field in, and ship a light "Paper" theme.

**Architecture:** A `Theme = {name, css, fontFaceCss, brief}` from a directory convention. Injected at the seal, the render fit-check, and the author's brief. Selected by `--theme` → outline frontmatter → `field`. Migration uses copy-then-delete and optional-params-defaulting-to-Field so every task stays green.

**Tech Stack:** TypeScript, Bun, Vitest, Playwright, node-html-parser.

**Spec:** `docs/superpowers/specs/2026-06-25-theme-system-design.md`.

**Testing convention:** pure logic (loader, brief, seal) → Vitest. cli/render verified by running (the McLuhan-in-Paper build).

---

## File Structure
**Create:** `themes/fonts/*` (copied), `themes/field/{theme.css,brief.md,fonts.json}`, `themes/paper/{theme.css,brief.md,fonts.json}`, `src/theme/load.ts` (+ test).
**Modify:** `src/render/design-brief.ts`, `src/agent/agentic-author.ts`, `src/export/seal.ts`, `src/export/build-sink.ts`, `src/cli.ts`, `src/render/preview.ts`, `site/build-home.ts`.
**Delete (final task):** `theme/`, `src/export/fonts.ts`'s `fontFaceCss`, `seal.ts`'s `readFieldCss`.

---

## Task 1: Theme assets (Field migrated + Paper)

**Files:** create under `themes/` (the old `theme/` is left in place — deleted in Task 7 — so nothing breaks yet).

- [ ] **Step 1: Copy the shared fonts + Field css.**
```bash
mkdir -p themes/fonts themes/field themes/paper
cp theme/fonts/*.woff2 themes/fonts/
cp theme/field.css themes/field/theme.css
```

- [ ] **Step 2: `themes/field/fonts.json`**
```json
[
  { "family": "Fraunces", "file": "fraunces.woff2", "style": "normal" },
  { "family": "Fraunces", "file": "fraunces-italic.woff2", "style": "italic" },
  { "family": "Geist", "file": "geist.woff2", "style": "normal" },
  { "family": "Geist Mono", "file": "geist-mono.woff2", "style": "normal" }
]
```

- [ ] **Step 3: `themes/field/brief.md`** (the aesthetic section, verbatim from the current IDENTITY_BRIEF):
```markdown
## Aesthetic — Field
Dark navy ground (#0a1a2f), cream foreground (#f3efe5), a single cyan accent (#4DD9E0); monochrome otherwise. Fraunces (display serif, italic cyan accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels + numerals). Hairline rules (~16% opacity), faint dot-grid. Fonts are already provided — do NOT @import. Avoid AI-slop (no Inter/Roboto/system-ui, no purple gradients, no rounded-card grids, no clip-art).
```

- [ ] **Step 4: `themes/paper/fonts.json`** — identical to Field's (shares the pool):
```json
[
  { "family": "Fraunces", "file": "fraunces.woff2", "style": "normal" },
  { "family": "Fraunces", "file": "fraunces-italic.woff2", "style": "italic" },
  { "family": "Geist", "file": "geist.woff2", "style": "normal" },
  { "family": "Geist Mono", "file": "geist-mono.woff2", "style": "normal" }
]
```

- [ ] **Step 5: `themes/paper/theme.css`** — mirrors Field's class contract, light palette (`--s-cyan` is the accent var, ink-blue here):
```css
/* Paper theme — light editorial comprehension slides. Mirrors Field's class contract. */
:root {
  --s-bg: #faf7f0;
  --s-fg: #1a1a1a;
  --s-muted: rgba(26, 26, 26, 0.62);
  --s-dim: rgba(26, 26, 26, 0.40);
  --s-line: rgba(26, 26, 26, 0.14);
  --s-cyan: #1d4ed8;
}
section[data-slide-id] {
  aspect-ratio: 16 / 9;
  box-sizing: border-box;
  background: var(--s-bg);
  color: var(--s-fg);
  border-radius: 8px;
  padding: 44px 52px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  font-family: "Geist", sans-serif;
  -webkit-font-smoothing: antialiased;
  background-image: radial-gradient(circle at 1px 1px, rgba(26, 26, 26, 0.05) 1px, transparent 0);
  background-size: 22px 22px;
}
.s-title {
  font-family: "Fraunces", serif;
  font-variation-settings: "SOFT" 90, "opsz" 90;
  font-weight: 600;
  font-size: 40px;
  line-height: 1.02;
  letter-spacing: -0.02em;
  margin: 0 0 28px;
}
.s-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; flex: 1; align-content: start; }
.s-col-label {
  font-family: "Geist Mono", monospace;
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--s-dim); margin-bottom: 10px;
}
.s-body { font-size: 16px; line-height: 1.55; color: var(--s-muted); margin: 0; }
.s-body p { margin: 0 0 0.6em; }
.s-body p:last-child { margin-bottom: 0; }
.s-analogy {
  border: 1px solid var(--s-line);
  border-left: 2px solid var(--s-cyan);
  border-radius: 0 8px 8px 0;
  padding: 16px 18px;
}
.s-analogy .s-col-label { color: var(--s-cyan); }
.s-analogy .s-body { color: var(--s-fg); }
.s-analogy .s-body strong {
  font-family: "Fraunces", serif; font-style: italic; font-weight: 500;
  font-variation-settings: "SOFT" 100; color: var(--s-cyan);
}
```

- [ ] **Step 6: `themes/paper/brief.md`**
```markdown
## Aesthetic — Paper
A calm light editorial page: warm off-white paper ground (#faf7f0), near-black ink foreground (#1a1a1a), a single restrained ink-blue accent (#1d4ed8); monochrome otherwise. Fraunces (display serif, italic ink-blue accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels + numerals). Hairline rules (~14% ink), generous margins, lots of air — a printed page, NOT a dark dashboard. Fonts are already provided — do NOT @import. Avoid AI-slop (no Inter/Roboto/system-ui, no gradients, no rounded-card grids, no clip-art).
```

- [ ] **Step 7: Verify + commit**

Run: `ls themes/field themes/paper themes/fonts`
Expected: the files above; `themes/fonts` has 4 woff2.
```bash
git add themes
git commit -m "feat(theme): add themes/ — Field migrated + Paper (assets)"
```

---

## Task 2: Theme loader

**Files:**
- Create: `src/theme/load.ts`
- Test: `tests/theme/load.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/theme/load.test.ts
import { describe, it, expect } from "vitest";
import { loadTheme, listThemes } from "../../src/theme/load";

describe("loadTheme", () => {
  it("loads field from disk", () => {
    const t = loadTheme("field");
    expect(t.name).toBe("field");
    expect(t.css).toContain("section[data-slide-id]");
    expect(t.fontFaceCss).toContain("@font-face");
    expect(t.fontFaceCss).toContain("base64,");
    expect(t.brief).toContain("## Aesthetic");
  });
  it("loads paper from disk (light palette)", () => {
    const t = loadTheme("paper");
    expect(t.css).toContain("#faf7f0");
    expect(t.brief).toMatch(/paper|editorial/i);
  });
  it("lists available themes", () => {
    expect(listThemes().sort()).toEqual(expect.arrayContaining(["field", "paper"]));
  });
  it("throws on unknown theme with the available list", () => {
    expect(() => loadTheme("nope")).toThrow(/unknown theme 'nope'.*field/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/theme/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/theme/load.ts
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const THEMES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "themes");

export interface Theme { name: string; css: string; fontFaceCss: string; brief: string; }
interface FontSpec { family: string; file: string; style: "normal" | "italic"; }

/** Theme directory names (folders under themes/, excluding the shared fonts pool). */
export function listThemes(): string[] {
  return readdirSync(THEMES_DIR).filter(
    (n) => n !== "fonts" && statSync(join(THEMES_DIR, n)).isDirectory(),
  );
}

function faceRule(dir: string, spec: FontSpec): string | null {
  // resolve the woff2 from the theme's own fonts/ first, else the shared pool
  const candidates = [join(dir, "fonts", spec.file), join(THEMES_DIR, "fonts", spec.file)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  const b64 = readFileSync(path).toString("base64");
  return (
    `@font-face{font-family:"${spec.family}";font-style:${spec.style};` +
    `font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format("woff2");}`
  );
}

/** Load a theme from themes/<name>/ — { css, fontFaceCss (embedded), brief }. */
export function loadTheme(name: string): Theme {
  const dir = join(THEMES_DIR, name);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`unknown theme '${name}' — available: ${listThemes().join(", ")}`);
  }
  const read = (f: string) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`theme '${name}' is missing ${f}`);
    return readFileSync(p, "utf8");
  };
  const css = read("theme.css");
  const brief = read("brief.md").trim();
  const specs = JSON.parse(read("fonts.json")) as FontSpec[];
  const fontFaceCss = specs.map((s) => faceRule(dir, s)).filter((r): r is string => r !== null).join("\n");
  return { name, css, fontFaceCss, brief };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run tests/theme/load.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/theme/load.ts tests/theme/load.test.ts
git commit -m "feat(theme): loadTheme/listThemes — read a theme from themes/<name>/"
```

---

## Task 3: Inject the brief

**Files:**
- Modify: `src/render/design-brief.ts`
- Test: `tests/render/design-brief.test.ts`

- [ ] **Step 1: Update the test** to the new function shape. Replace the `IDENTITY_BRIEF` describe block + the `slideAuthorPrompt` "uses IDENTITY_BRIEF" assertion with:

```ts
import { slideAuthorPrompt, identityBrief, FIELD_AESTHETIC, type AuthorRequest } from "../../src/render/design-brief";

describe("identityBrief", () => {
  it("keeps the universal guidance and injects the given aesthetic", () => {
    const b = identityBrief("## Aesthetic — Test\nbright orange everything.");
    expect(b).toMatch(/landing page/i);   // genre (universal)
    expect(b).toMatch(/1280|16:9/);       // format (universal)
    expect(b).toMatch(/clean/i);          // EYES/converge (universal)
    expect(b).toContain("bright orange everything."); // injected aesthetic
    expect(b).not.toContain("#0a1a2f");   // Field's navy is NOT present
  });
  it("defaults to the Field aesthetic", () => {
    expect(identityBrief()).toContain("#0a1a2f");
    expect(identityBrief()).toBe(identityBrief(FIELD_AESTHETIC));
  });
});

describe("slideAuthorPrompt", () => {
  it("uses identityBrief(aesthetic) as the system prompt", () => {
    const aesthetic = "## Aesthetic — Test\nbright orange.";
    expect(slideAuthorPrompt(req, aesthetic).system).toBe(identityBrief(aesthetic));
  });
  it("feeds the author the idea: title, slide id, angle, digest, source excerpt, neighbours", () => {
    const u = slideAuthorPrompt(req).user;
    expect(u).toContain("s_x");
    expect(u).toContain("The lens");
    expect(u).toContain("How to think about it");
    expect(u).toContain("point one");
    expect(u).toContain("the relevant source span");
    expect(u).toContain("intro");
  });
});
```
(Keep the existing `req` fixture at the top of the file.)

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run tests/render/design-brief.test.ts`
Expected: FAIL — `identityBrief`/`FIELD_AESTHETIC` not exported.

- [ ] **Step 3: Implement.** In `src/render/design-brief.ts`, replace the `export const IDENTITY_BRIEF = [ … ].join("\n");` block with:

```ts
/** The built-in Field aesthetic — the default + fallback (themes/field/brief.md is the source of truth when a theme is loaded). */
export const FIELD_AESTHETIC = [
  "## Aesthetic — Field",
  "Dark navy ground (#0a1a2f), cream foreground (#f3efe5), a single cyan accent (#4DD9E0); monochrome otherwise. Fraunces (display serif, italic cyan accents), Geist (body), Geist Mono (uppercase wide-tracked micro-labels + numerals). Hairline rules (~16% opacity), faint dot-grid. Fonts are already provided — do NOT @import. Avoid AI-slop (no Inter/Roboto/system-ui, no purple gradients, no rounded-card grids, no clip-art).",
].join("\n");

/** The author system prompt: universal guidance with the theme's aesthetic injected. */
export function identityBrief(aesthetic: string = FIELD_AESTHETIC): string {
  return [
    "You are mindsizer's slide designer. Turn ONE outline slide into ONE comprehension-first slide that makes the idea CLICK — not a summary, not a bullet dump, not decoration.",
    "",
    "## Genre — an explorable INSTRUMENT, never a landing page",
    "Think Bret Victor explorable / Distill figure / instrument panel. NOT a marketing landing page: no hero tagline, no “scroll” cue, no emoji, no gradient theater, no persuasion funnel. Calm, precise, information-rich with clear hierarchy.",
    "",
    "## Format — ONE slide in a LINEAR deck",
    "Output ONE slide that fits a 1280x720 (16:9) frame with NO scrolling inside the slide. It is one frame in an arrow-advanced deck a presenter walks through — so it must read on its own at rest.",
    "",
    aesthetic,
    "",
    "## Interactivity — when it makes the idea land",
    "You MAY add an optional scoped <script> so the viewer can OPERATE the idea (tune a control, stage a reveal, show cause→effect). Keep it presenter-friendly: a resting state that reads alone PLUS a demonstrable interaction. Interaction must be epistemic (changes understanding), never decorative.",
    "In the sealed deck each slide's <script> runs once on load WHILE the slide is hidden, so do NOT measure layout at load time (getBoundingClientRect / offsetWidth / canvas sizing read 0 for an inactive slide). Drive visuals from CSS or fixed SVG coordinates, or (re)compute geometry inside the interaction handlers, not at load.",
    "",
    "## You have EYES — use them",
    "You have a `render` tool that returns screenshots of your slide at 1280x720. Render your work and LOOK. If interactive, pass interaction steps (e.g. click a control, wait) and inspect those states too. Fix overflow, dead space, weak hierarchy, off-brand styling. The MOMENT a render comes back clean — no overflow and no console errors — the slide is fit-complete: output the final HTML and STOP. The render tool will tell you when it's clean; do NOT keep polishing a clean slide (extra passes tend to make it worse, not better). Your section's `id` is added automatically, so use `#SLIDE_ID` selectors freely.",
    "",
    "## Output contract",
    "Return EXACTLY, with no markdown fences and no commentary:",
    '  <style>#SLIDE_ID .x{ ... }</style>            (optional, id-scoped)',
    '  <section data-slide-id="SLIDE_ID" data-layout="bespoke"> ... </section>',
    '  <script>(function(){ /* only touch the #SLIDE_ID subtree */ })();</script>   (optional)',
    "Use the given SLIDE_ID for data-slide-id AND every CSS/JS selector so nothing leaks to other slides. Inline <svg> only; no external images/links/@import.",
  ].join("\n");
}
```
Then change `slideAuthorPrompt` to take an optional aesthetic:
```ts
export function slideAuthorPrompt(req: AuthorRequest, aesthetic?: string): AuthorPrompt {
```
and its `return { system: IDENTITY_BRIEF, user };` → `return { system: identityBrief(aesthetic), user };`.

- [ ] **Step 4: Run to verify pass + full suite**

Run: `bunx vitest run tests/render/design-brief.test.ts && bunx tsc --noEmit && bunx vitest run`
Expected: PASS; tsc CLEAN (existing `slideAuthorPrompt(req)` callers still compile — aesthetic is optional, defaults Field).

- [ ] **Step 5: Commit**

```bash
git add src/render/design-brief.ts tests/render/design-brief.test.ts
git commit -m "feat(render): identityBrief(aesthetic) — inject the theme aesthetic (default Field)"
```

---

## Task 4: Seal with a theme

**Files:**
- Modify: `src/export/seal.ts`, `src/export/build-sink.ts`

- [ ] **Step 1: `seal.ts` takes a theme.** Add the import:
```ts
import { loadTheme, type Theme } from "../theme/load";
```
Change `sealDeck`'s signature + the css/font lines. Replace:
```ts
export function sealDeck(
  outline: Outline,
  opts: { sections?: Map<string, string> } = {},
): string {
```
with:
```ts
export function sealDeck(
  outline: Outline,
  opts: { sections?: Map<string, string>; theme?: Theme } = {},
): string {
```
and replace the body's `const fieldCss = readFieldCss();` + the `<style>${fontFaceCss()} ${fieldCss} ${DECK_CSS}</style>` region so it uses the theme:
```ts
  const theme = opts.theme ?? loadTheme("field");
```
and in the returned template, replace the `${fontFaceCss()}` line with `${theme.fontFaceCss}` and the `${fieldCss}` line with `${theme.css}`. Remove the now-unused `const fieldCss = readFieldCss();` line. (Leave `readFieldCss`/`fontFaceCss` imports for now — Task 7 removes them.)

- [ ] **Step 2: `build-sink.ts` threads the theme.** Add the import:
```ts
import type { Theme } from "../theme/load";
```
Change `fileSink`'s signature:
```ts
export function fileSink(buildDir: string, outline: Outline, outPath: string): ProgressSink {
```
to:
```ts
export function fileSink(buildDir: string, outline: Outline, outPath: string, theme?: Theme): ProgressSink {
```
and change EVERY `sealDeck(outline, { sections })` call inside `fileSink` (there are a few: the initial reseal + the reseal helper) to `sealDeck(outline, { sections, theme })`. (Find the `reseal` helper — `writeFileSync(outPath, sealDeck(outline, { sections }), "utf8")` — and add `theme`.)

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS (theme optional → defaults to `loadTheme("field")`, identical output; existing seal/sink tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/export/seal.ts src/export/build-sink.ts
git commit -m "feat(export): sealDeck/fileSink accept a Theme (default field)"
```

---

## Task 5: Wire the theme through agentic-author + CLI

**Files:**
- Modify: `src/agent/agentic-author.ts`, `src/cli.ts`, `src/render/preview.ts`, `site/build-home.ts`
- Verified-by-running (Task 9).

- [ ] **Step 1: `agenticAuthor` takes the aesthetic.** In `src/agent/agentic-author.ts`, change `export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {` to:
```ts
export function agenticAuthor(renderer: SlideRenderer, aesthetic?: string): SlideAuthor {
```
and change the `slideAuthorPrompt(req)` call inside to `slideAuthorPrompt(req, aesthetic)`.

- [ ] **Step 2: CLI theme resolution + wiring.** In `src/cli.ts`:

(a) add the import:
```ts
import { loadTheme } from "./theme/load";
```
(b) `runBuild` — parse `--theme`. Next to the other flag locals, add `let themeName: string | undefined;` and in the arg loop add a branch (before the catch-all `-`):
```ts
    } else if (a === "--theme") {
      themeName = args[++k];
      if (!themeName) fail("--theme requires a name");
```
(c) After `outline` is parsed, resolve + load the theme (with a clear error):
```ts
  let theme;
  try {
    theme = loadTheme(themeName ?? outline.meta.theme ?? "field");
  } catch (e) {
    fail((e as Error).message);
  }
```
(d) Replace `const fitTheme = fontFaceCss() + "\n" + readFieldCss();` with:
```ts
  const fitTheme = theme.fontFaceCss + "\n" + theme.css;
```
(e) Change `const sink = fileSink(buildDir, outline, outPath);` to `const sink = fileSink(buildDir, outline, outPath, theme);`.
(f) Change the `buildDeck(outline, { author: agenticAuthor(renderer), … })` call so the author gets the brief: `author: agenticAuthor(renderer, theme.brief)`.
(g) Update the usage string to include `[--theme <name>]`.

- [ ] **Step 3: CLI fast path (`runSeal`).** In `runSeal`, parse the same `--theme` (add the branch + `let themeName`), resolve `const theme = loadTheme(themeName ?? outline.meta.theme ?? "field");` (wrap in try/catch→fail), and change its `sealDeck(outline, …)` call to pass `{ …, theme }` (and `writeFileSync` of the sealed output). Update its usage string with `[--theme <name>]`.

- [ ] **Step 4: Path migrations.**
- `src/render/preview.ts:18` — change `join(process.cwd(), "theme", "field.css")` to `join(process.cwd(), "themes", "field", "theme.css")`.
- `site/build-home.ts:9` — change `join(ROOT, "theme/fonts", p)` to `join(ROOT, "themes/fonts", p)`.

- [ ] **Step 5: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/agentic-author.ts src/cli.ts src/render/preview.ts site/build-home.ts
git commit -m "feat(cli): --theme selection; wire theme into author/renderer/seal; migrate paths"
```

---

## Task 6: Remove the old hardcoded theme path

**Files:** Modify `src/export/seal.ts`, `src/export/fonts.ts`, `src/export/index.ts`; delete `theme/`.

- [ ] **Step 1: Confirm nothing references the old API.**

Run: `grep -rn "readFieldCss\|fontFaceCss\|theme/field\|theme/fonts\|\"theme\"" src site --include="*.ts" | grep -v "themes/"`
Expected: only the definitions in `seal.ts`/`fonts.ts`/`index.ts` (no live callers). If a caller remains, fix it to use `loadTheme`.

- [ ] **Step 2: Remove `readFieldCss`** from `src/export/seal.ts` (the function + the `THEME_DIR` const + the `readFileSync`/`fileURLToPath` imports if now unused) and its re-export from `src/export/index.ts` (`export { readFieldCss } from "./seal";`).

- [ ] **Step 3: Remove `fontFaceCss`** from `src/export/fonts.ts` and its re-export from `src/export/index.ts`. If `fonts.ts` is now empty, delete the file and its `export` line in `index.ts`.

- [ ] **Step 4: Delete the old theme dir.**
```bash
git rm -r theme
```

- [ ] **Step 5: Typecheck + full suite**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(theme): remove the old hardcoded theme/ + readFieldCss/fontFaceCss"
```

---

## Task 7: Live verification (McLuhan in Paper)

**Files:** none (manual). The McLuhan chapter is already ingested → `medium.outline.md` (11 slides).

- [ ] **Step 1: Build McLuhan in Paper.**
```bash
bun run src/cli.ts build medium.outline.md -o /tmp/mcluhan-paper.html --concurrency 4 --theme paper
```
Expected: completes; `✓ deck check passed`; the per-model cost line prints. The deck is **light** (paper ground, ink text) — not Field's dark navy.

- [ ] **Step 2: Confirm the swap visually + that the author was re-briefed.**
Screenshot a few slides (serve + Playwright, or open). Expected: light editorial slides, ink-blue accents — NOT dark. (If slides come out dark, the author wasn't re-briefed — check Task 5 step (f) passes `theme.brief`.)

```bash
grep -c "#faf7f0\|#0a1a2f" /tmp/mcluhan-paper.html   # paper bg present; navy should be largely absent in the theme css
```

- [ ] **Step 3: Field still works (default + flag).**
```bash
bun run src/cli.ts build medium.outline.md -o /tmp/mcluhan-field.html --concurrency 4 --theme field --resume
```
(Reuses the Paper-built slides? No — different build dir is shared; to avoid confusion use a fresh `-o` and let it reuse the saved slides only if valid. Simpler: just confirm `--theme field` resolves + seals the dark theme without error.) Expected: dark Field deck, no error.

- [ ] **Step 4: Final green check.**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: tsc CLEAN; all unit tests PASS.

- [ ] **Step 5: Commit any fixups.**

```bash
git add -A
git commit -m "chore: theme-system live verification (McLuhan in Paper)"
```

---

## Self-review notes (author of this plan)

- **Spec coverage:** §3 layout → Task 1; §4A loader → Task 2; §4D brief → Task 3; §4C seal + §4F sink → Task 4; §4B fonts (folded into the loader's `faceRule`), §4E author threading + §4G cli + §4H paths → Task 5; cleanup of the old hardcoded path → Task 6; §4I Paper → Task 1; §7 live proof → Task 7.
- **Green every task:** copy-then-delete assets (Task 1 keeps `theme/`); optional params defaulting to Field (`identityBrief(aesthetic=FIELD_AESTHETIC)`, `sealDeck({theme?})`, `fileSink(…, theme?)`, `agenticAuthor(renderer, aesthetic?)`) keep existing callers/tests compiling until Task 5 flips them and Task 6 removes the dead path.
- **Type consistency:** `Theme {name,css,fontFaceCss,brief}` (Task 2) consumed by seal/sink (Task 4) + cli (Task 5); `loadTheme`/`listThemes` (Task 2) used in Tasks 4,5; `identityBrief`/`FIELD_AESTHETIC`/`slideAuthorPrompt(req,aesthetic?)` (Task 3) used in agentic-author (Task 5).
- **Known dup (intentional, documented):** the Field aesthetic text lives in both `themes/field/brief.md` (theme source of truth) and `FIELD_AESTHETIC` (in-code default/fallback). The real build passes `loadTheme(name).brief`; the const only fires for a no-arg `identityBrief()`.
- **Out of scope:** per-slide theming, runtime switching, new Paper fonts, theming the homepage/deck-runtime.
