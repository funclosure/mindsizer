# `mindsizer` CLI + Export-and-Seal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mindsizer <outline.md>` → one self-contained, offline `deck.html` (Field theme, base64-embedded fonts, keyboard-nav runtime) — PRD §17 step 3 delivered as the CLI.

**Architecture:** A pure `sealDeck(outline)` core composes step-2 rendered slides + inlined `theme/field.css` + base64 `@font-face` + a small vanilla nav runtime into one HTML document. A thin `cli.ts` does arg-parsing + file IO around it. Theme assets resolve relative to the module (`import.meta.url`) so the command works from any cwd.

**Tech Stack:** TypeScript, Bun, Vitest. Fonts via Fontsource (OFL woff2 committed to `theme/fonts/`). Builds on `src/outline/` (step 1) and `src/render/` + `theme/field.css` (step 2).

**Spec:** `docs/superpowers/specs/2026-06-20-cli-export-seal-design.md`

**Note for the controller:** Task 1 (font acquisition) is exploratory/network-bound — execute it yourself in the main thread and verify before dispatching subagents for Tasks 2–6.

---

### Task 1: Acquire & commit the Field fonts

**Files:**
- Create: `theme/fonts/fraunces.woff2`, `theme/fonts/fraunces-italic.woff2`, `theme/fonts/geist.woff2`, `theme/fonts/geist-mono.woff2`
- Modify: `package.json` (devDependencies, transient)

- [ ] **Step 1: Add Fontsource packages (OFL woff2 source)**

Run: `bun add -d @fontsource-variable/fraunces @fontsource-variable/geist @fontsource-variable/geist-mono`
Expected: installs. If a package name 404s, find the correct one with `bun pm ls` / npm search (e.g. `@fontsource/geist-sans`, `@fontsource-variable/geist-sans`) and adjust.

- [ ] **Step 2: Locate the woff2 files**

Run: `ls node_modules/@fontsource-variable/fraunces/files/ | grep -i 'latin.*normal\|latin.*italic'` and likewise for geist / geist-mono. Pick the **latin**, **standard/full** axis, **normal** woff2 (and the **italic** woff2 for Fraunces).

- [ ] **Step 3: Copy to canonical names**

Copy the chosen files into `theme/fonts/` with these exact names (the code in Task 2 expects them):
- `fraunces.woff2` (Fraunces variable, normal)
- `fraunces-italic.woff2` (Fraunces variable, italic)
- `geist.woff2` (Geist variable, normal)
- `geist-mono.woff2` (Geist Mono variable, normal)

- [ ] **Step 4: Verify**

Run: `ls -la theme/fonts/ && file theme/fonts/*.woff2`
Expected: four `*.woff2` files, each reported as `Web Open Font Format (Version 2)` and non-trivial size (tens of KB each).

- [ ] **Step 5: Commit**

```bash
git add theme/fonts/ package.json bun.lock
git commit -m "chore: vendor Field fonts (Fraunces roman+italic, Geist, Geist Mono) as woff2"
```

---

### Task 2: Font embedding (`fontFaceCss`)

**Files:**
- Create: `src/export/fonts.ts`
- Test: `tests/export/fonts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/export/fonts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fontFaceCss } from "../../src/export/fonts";

describe("fontFaceCss", () => {
  it("emits base64 @font-face rules for the Field families", () => {
    const css = fontFaceCss();
    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"Fraunces"');
    expect(css).toContain('font-family:"Geist"');
    expect(css).toContain('font-family:"Geist Mono"');
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain("font-style:italic"); // Fraunces italic face
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/fonts.test.ts`
Expected: FAIL — cannot find module `../../src/export/fonts`.

- [ ] **Step 3: Write the implementation**

Create `src/export/fonts.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "theme",
  "fonts",
);

interface FontSpec {
  family: string;
  file: string;
  style: "normal" | "italic";
}

const FONTS: FontSpec[] = [
  { family: "Fraunces", file: "fraunces.woff2", style: "normal" },
  { family: "Fraunces", file: "fraunces-italic.woff2", style: "italic" },
  { family: "Geist", file: "geist.woff2", style: "normal" },
  { family: "Geist Mono", file: "geist-mono.woff2", style: "normal" },
];

function faceRule(spec: FontSpec): string | null {
  let data: Buffer;
  try {
    data = readFileSync(join(FONTS_DIR, spec.file));
  } catch {
    return null; // missing file → skip (degrade to system fallback)
  }
  const b64 = data.toString("base64");
  return (
    `@font-face{font-family:"${spec.family}";font-style:${spec.style};` +
    `font-weight:100 900;font-display:swap;` +
    `src:url(data:font/woff2;base64,${b64}) format("woff2");}`
  );
}

/** Build @font-face rules with base64-embedded woff2 for the Field type stack. */
export function fontFaceCss(): string {
  return FONTS.map(faceRule)
    .filter((r): r is string => r !== null)
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/export/fonts.test.ts`
Expected: PASS, 1 test. (Requires Task 1 fonts present.)

- [ ] **Step 5: Commit**

```bash
git add src/export/fonts.ts tests/export/fonts.test.ts
git commit -m "feat: base64 @font-face embedding for the Field type stack"
```

---

### Task 3: Deck viewer runtime constants

**Files:**
- Create: `src/export/deck-runtime.ts`
- Test: `tests/export/deck-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/export/deck-runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DECK_CSS, NAV_JS } from "../../src/export/deck-runtime";

describe("deck runtime", () => {
  it("DECK_CSS targets the active slide and the deck sections", () => {
    expect(DECK_CSS).toContain("section[data-slide-id]");
    expect(DECK_CSS).toContain(".is-active");
    expect(DECK_CSS).toContain(".deck-progress");
  });

  it("NAV_JS handles arrow keys and updates counter + progress", () => {
    expect(NAV_JS).toContain("ArrowRight");
    expect(NAV_JS).toContain("ArrowLeft");
    expect(NAV_JS).toContain("deck-counter");
    expect(NAV_JS).toContain("deck-progress");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/deck-runtime.test.ts`
Expected: FAIL — cannot find module `../../src/export/deck-runtime`.

- [ ] **Step 3: Write the implementation**

Create `src/export/deck-runtime.ts`:

```ts
/** Viewer chrome CSS for the sealed deck: one slide at a time, centered 16:9. */
export const DECK_CSS = `
  html, body { margin: 0; height: 100%; background: #070d16; }
  body { font-family: "Geist", system-ui, sans-serif; }
  .deck { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  .deck section[data-slide-id] { display: none; width: min(96vw, calc(96vh * 16 / 9)); }
  .deck section[data-slide-id].is-active { display: flex; }
  .deck-counter {
    position: fixed; right: 18px; bottom: 14px;
    font-family: "Geist Mono", monospace; font-size: 11px;
    letter-spacing: 0.16em; color: rgba(243, 239, 229, 0.5);
  }
  .deck-progress {
    position: fixed; left: 0; bottom: 0; height: 2px;
    background: #4DD9E0; width: 0; transition: width 0.2s ease;
  }
`;

/** Inline keyboard-nav runtime carried by the sealed deck (no server at view time). */
export const NAV_JS = `
(function () {
  var slides = Array.prototype.slice.call(
    document.querySelectorAll('.deck section[data-slide-id]')
  );
  if (!slides.length) return;
  var i = 0;
  var counter = document.querySelector('.deck-counter');
  var progress = document.querySelector('.deck-progress');
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, idx) { s.classList.toggle('is-active', idx === i); });
    if (counter) counter.textContent = pad(i + 1) + ' / ' + pad(slides.length);
    if (progress) progress.style.width = ((i + 1) / slides.length * 100) + '%';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault(); show(i + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); show(i - 1);
    }
  });
  show(0);
})();
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/export/deck-runtime.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/deck-runtime.ts tests/export/deck-runtime.test.ts
git commit -m "feat: deck viewer runtime (DECK_CSS + keyboard NAV_JS)"
```

---

### Task 4: The seal core (`sealDeck`)

**Files:**
- Create: `src/export/seal.ts`
- Test: `tests/export/seal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/export/seal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sealDeck } from "../../src/export/seal";
import { parseOutline } from "../../src/outline/index";
import type { Outline } from "../../src/outline/types";

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=analogy -->
# A

concept here

> the **analogy**

---

<!-- slide id=s_b layout=plain -->
# B

- x
`;

describe("sealDeck", () => {
  it("seals a deck into one self-contained html document", () => {
    const html = sealDeck(parseOutline(MD));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('data-slide-id="s_a"');
    expect(html).toContain('data-slide-id="s_b"');
    expect(html).toContain("--s-cyan"); // field.css inlined
    expect(html).toContain("data:font/woff2;base64,"); // fonts embedded
    expect(html).toContain("ArrowRight"); // nav runtime inlined
  });

  it("throws listing issues for an invalid outline", () => {
    const bad: Outline = {
      meta: { title: "", purpose: "teach", theme: "field" },
      slides: [],
    };
    expect(() => sealDeck(bad)).toThrow(/invalid outline/);
  });

  it("throws naming the slide + layout for an unsupported layout", () => {
    const md = `---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_x layout=bespoke -->\n# X\n\nbody\n`;
    expect(() => sealDeck(parseOutline(md))).toThrow(/no static renderer/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: FAIL — cannot find module `../../src/export/seal`.

- [ ] **Step 3: Write the implementation**

Create `src/export/seal.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Outline } from "../outline/types";
import { validateOutline } from "../outline/validate";
import { renderSlide } from "../render/render-slide";
import { escapeHtml } from "../render/html";
import { fontFaceCss } from "./fonts";
import { DECK_CSS, NAV_JS } from "./deck-runtime";

const THEME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "theme",
);

/** Assemble an Outline into one self-contained, offline deck.html string. */
export function sealDeck(outline: Outline): string {
  const issues = validateOutline(outline);
  if (issues.length > 0) {
    throw new Error(
      "invalid outline:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  const sections = outline.slides.map((s) => renderSlide(s)).join("\n");
  const fieldCss = readFileSync(join(THEME_DIR, "field.css"), "utf8");
  const title = escapeHtml(outline.meta.title || "deck");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${fontFaceCss()}
${fieldCss}
${DECK_CSS}
</style>
</head>
<body>
<div class="deck">
${sections}
</div>
<div class="deck-counter"></div>
<div class="deck-progress"></div>
<script>
${NAV_JS}
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/export/seal.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/seal.ts tests/export/seal.test.ts
git commit -m "feat: sealDeck — outline → one self-contained offline deck.html"
```

---

### Task 5: Export barrel + root re-export

**Files:**
- Create: `src/export/index.ts`
- Modify: `src/index.ts`
- Test: `tests/export/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/export/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sealDeck, fontFaceCss } from "../../src/export/index";

describe("export barrel", () => {
  it("re-exports the public export API", () => {
    expect(typeof sealDeck).toBe("function");
    expect(typeof fontFaceCss).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/index.test.ts`
Expected: FAIL — cannot find module `../../src/export/index`.

- [ ] **Step 3: Write the implementation**

Create `src/export/index.ts`:

```ts
export { sealDeck } from "./seal";
export { fontFaceCss } from "./fonts";
export { DECK_CSS, NAV_JS } from "./deck-runtime";
```

Overwrite `src/index.ts` so it reads EXACTLY:

```ts
export * from "./outline/index";
export * from "./render/index";
export * from "./export/index";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/export/index.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/export/index.ts src/index.ts tests/export/index.test.ts
git commit -m "feat: export barrel + root re-export"
```

---

### Task 6: The `mindsizer` CLI

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (add `bin`)
- Test: `tests/export/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/export/cli.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=analogy -->
# A

concept here

> the **analogy**

---

<!-- slide id=s_b layout=plain -->
# B

- x
`;

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("mindsizer CLI", () => {
  it("seals a deck file end-to-end", () => {
    dir = mkdtempSync(join(tmpdir(), "mindsizer-cli-"));
    const mdPath = join(dir, "deck.md");
    writeFileSync(mdPath, SAMPLE);
    const outPath = join(dir, "deck.html");
    execFileSync("bun", ["run", "src/cli.ts", mdPath, "-o", outPath], {
      cwd: process.cwd(),
    });
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain('data-slide-id="s_a"');
    expect(html).toContain('data-slide-id="s_b"');
    expect(html).toContain("data:font/woff2;base64,");
  });

  it("exits non-zero for a missing input file", () => {
    expect(() =>
      execFileSync("bun", ["run", "src/cli.ts", "/no/such/file.md"], {
        cwd: process.cwd(),
        stdio: "pipe",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/export/cli.test.ts`
Expected: FAIL — `src/cli.ts` does not exist (bun errors, execFileSync throws on BOTH tests; the first test fails because the file is never produced).

- [ ] **Step 3: Write the implementation**

Create `src/cli.ts`:

```ts
#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { parseOutline } from "./outline/index";
import { sealDeck } from "./export/index";

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  let input: string | undefined;
  let out: string | undefined;
  let open = false;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
    } else if (a === "--open") {
      open = true;
    } else if (!a.startsWith("-")) {
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
    Bun.spawn([opener, outPath]);
  }
}

main(process.argv);
```

- [ ] **Step 4: Add the `bin` entry to `package.json`**

Add a top-level `"bin"` key so `bun link` registers the command (place it next to `"module"`):

```json
  "bin": { "mindsizer": "src/cli.ts" },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/export/cli.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Full verification + manual smoke**

Run: `bunx vitest run`
Expected: ALL tests green.

Run: `bunx tsc --noEmit`
Expected: clean.

Run a real end-to-end seal (writes next to the sample, default output name):
```bash
bun run src/cli.ts examples/sample-deck.md 2>/dev/null || true
```
(If `examples/sample-deck.md` does not exist, skip this manual line — the CLI test already proves the path with a temp file.)

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts package.json tests/export/cli.test.ts
git commit -m "feat: mindsizer CLI — outline.md → sealed deck.html"
```

---

## Self-Review

**Spec coverage:**
- §3 command (args `-o`/`--open`, default output name, progress, error exits, thin shell) → Task 6. ✓
- §4 seal pipeline (validate → render in order → assemble; module-relative theme path) → Task 4. ✓
- §5 font embedding (Fraunces roman+italic, Geist, Geist Mono; base64 `@font-face`; missing-file skip) → Tasks 1 & 2. ✓
- §6 deck runtime (DECK_CSS one-slide/active/counter/progress; NAV_JS arrows/space/clamped) → Task 3. ✓
- §7 file structure + `src/index.ts` re-export + `bin` → Tasks 5 & 6. ✓
- §8 testing (fonts, deck-runtime, seal incl. invalid + unsupported-layout throws, CLI smoke incl. missing-file non-zero) → Tasks 2,3,4,6. ✓
- §9 error handling table → Task 6 `fail()` + Task 4 throws. ✓
- Out-of-scope (agent, server, PNG, subsetting, build-up/quote/bespoke) → correctly absent; unsupported layouts throw via reused `renderSlide`. ✓
- **Visual check** (§8 last bullet) → controller does it post-implementation (headless screenshot + ArrowRight), not a unit task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; Task 1 is exploratory but has concrete commands + a verification gate. ✓

**Type consistency:** `Outline`/`OutlineSlide` from `../outline/types`; reused functions `validateOutline`, `renderSlide`, `escapeHtml`, `parseOutline` match their step-1/step-2 signatures. New symbols consistent across tasks and barrels: `fontFaceCss` (Task 2), `DECK_CSS`/`NAV_JS` (Task 3), `sealDeck` (Task 4), all re-exported in Task 5. CLI imports `parseOutline` from `./outline/index` and `sealDeck` from `./export/index`. Font filenames in Task 2 (`fraunces.woff2`, `fraunces-italic.woff2`, `geist.woff2`, `geist-mono.woff2`) match Task 1's canonical names. ✓
