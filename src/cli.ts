#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { parseOutline, serializeOutline, validateOutline } from "./outline/index";
import { sealDeck, fileSink } from "./export/index";
import { loadTheme } from "./theme/load";
import { ingest, anthropicClient, fixedPrompter, terminalPrompter, agenticAuthor, parseContext, sidecarPath, serializeContext, PlanParseError } from "./agent/index";
import { slideJudge } from "./agent/slide-judge";
import { buildDeck, identityBrief } from "./render/index";
import { playwrightRenderer, verifyDeck, type Interaction } from "./render/fit-check";
import { hasUsableSection } from "./outline/inject";
import { resetUsage, snapshotUsage } from "./agent/usage-meter";
import { costUsd, fmtUsd } from "./agent/pricing";
import { extractSlides } from "./review/extract-deck";
import { slideReviewer, type SlideReviewRequest } from "./review/slide-review";
import { reviewDeckCoherence } from "./review/deck-review";
import { terminalReport, markdownReport, jsonReport, hasHigh, type ReviewRun, type SlideReviewResult } from "./review/report";
import { slideText } from "./render/content-gate";
import { mapPool } from "./render/pool";
import { modelFor } from "./agent/models";

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function runSeal(args: string[]): void {
  let input: string | undefined;
  let out: string | undefined;
  let open = false;
  let themeName: string | undefined;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--open") {
      open = true;
    } else if (a === "--theme") {
      themeName = args[++k];
      if (!themeName) fail("--theme requires a name");
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input) fail("usage: mindsizer <outline.md> [-o <out.html>] [--open] [--theme <name>]");

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

  let theme;
  try {
    theme = loadTheme(themeName ?? outline.meta.theme ?? "field");
  } catch (e) {
    fail((e as Error).message);
  }

  let html: string;
  try {
    html = sealDeck(outline, { theme });
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

async function runIngestLike(args: string[], mode: "ingest" | "plan"): Promise<void> {
  let input: string | undefined;
  let out: string | undefined;
  let angle: string | undefined;
  let yes = false;
  let sourceUrl: string | undefined;
  let sourceLabel: string | undefined;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--angle") {
      angle = args[++k];
      if (angle === undefined) fail("--angle requires an id");
    } else if (a === "--source") {
      sourceUrl = args[++k];
      if (sourceUrl === undefined) fail("--source requires a url");
    } else if (a === "--source-label") {
      sourceLabel = args[++k];
      if (sourceLabel === undefined) fail("--source-label requires text");
    } else if (a === "--yes") {
      yes = true;
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input)
    fail(`usage: mindsizer ${mode} <text-file> [--angle <id>] [-o <out.md>] [--yes] [--source <url>] [--source-label <text>]`);

  let text: string;
  try {
    text = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  process.stdout.write(mode === "plan" ? "digesting + planning…\n" : "digesting…\n");
  const prompter = angle || yes ? fixedPrompter(angle) : terminalPrompter();
  resetUsage();

  const outPath =
    out ??
    join(
      dirname(resolve(input)),
      basename(input, extname(input)) + (mode === "plan" ? ".plan.md" : ".outline.md"),
    );

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
      let saved = false;
      try {
        writeFileSync(rawPath, JSON.stringify({ raw: e.raw }, null, 2), "utf8");
        saved = true;
      } catch { /* best effort — the planner error below is what matters */ }
      fail(
        `${e.message}\n  ` +
          (saved ? `raw planner reply saved → ${rawPath}` : `could not save the raw planner reply to ${rawPath}`),
      );
    }
    fail((e as Error).message);
  }

  // the agent never sees the attribution flags — inject them into the finished outline
  let outlineMarkdown = result.outlineMarkdown;
  if (sourceUrl || sourceLabel) {
    const o = parseOutline(outlineMarkdown);
    o.meta.source = {
      ...(sourceLabel && { label: sourceLabel }),
      ...(sourceUrl && { url: sourceUrl }),
    };
    outlineMarkdown = serializeOutline(o);
  }

  try {
    writeFileSync(outPath, outlineMarkdown, "utf8");
  } catch {
    fail(`cannot write ${outPath}`);
  }
  process.stdout.write(`✓ wrote ${outPath}\n`);

  // persist the deck context next to the outline so `build` gets the idea, not just the bullet
  try {
    const sc = sidecarPath(outPath);
    writeFileSync(
      sc,
      serializeContext({ sourcePath: resolve(input), digest: result.digest, angle: result.angle.label, direction: result.direction }),
      "utf8",
    );
    process.stdout.write(`✓ wrote ${sc}\n`);
  } catch {
    /* sidecar is best-effort; build degrades gracefully without it */
  }
  printCost();
}

async function runIngest(args: string[]): Promise<void> {
  return runIngestLike(args, "ingest");
}

async function runPlan(args: string[]): Promise<void> {
  return runIngestLike(args, "plan");
}

/** Print a per-model API-equivalent USD cost line from the usage meter (nothing if empty). */
function printCost(): void {
  const entries = Object.entries(snapshotUsage());
  if (!entries.length) return;
  const label = (m: string) => (m.includes("haiku") ? "Haiku" : m.includes("sonnet") ? "Sonnet" : m.includes("fable") || m.includes("mythos") ? "Fable" : "Opus");
  const parts = entries.map(([m, u]) => `${label(m)} ${fmtUsd(costUsd(u, m))}`);
  const total = entries.reduce((s, [m, u]) => s + costUsd(u, m), 0);
  process.stdout.write(`  cost (API-equiv · est):  ~${fmtUsd(total)} — ${parts.join(" · ")}\n`);
}

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

async function runBuild(args: string[]): Promise<void> {
  let input: string | undefined;
  let out: string | undefined;
  let open = false;
  let resume = false;
  let themeName: string | undefined;
  const envC = Number(process.env.MINDSIZER_CONCURRENCY);
  let concurrency = Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-o" || a === "--out") {
      out = args[++k];
      if (out === undefined) fail("-o requires a path");
    } else if (a === "--open") {
      open = true;
    } else if (a === "--concurrency" || a === "-c") {
      const v = Number(args[++k]);
      if (!Number.isFinite(v) || v < 1) fail("--concurrency requires an integer ≥ 1");
      concurrency = Math.floor(v);
    } else if (a === "--resume") {
      resume = true;
    } else if (a === "--theme") {
      themeName = args[++k];
      if (!themeName) fail("--theme requires a name");
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open] [--concurrency <n>] [--resume] [--theme <name>]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  const outline = parseOutline(md);
  const issues = validateOutline(outline);
  if (issues.length > 0) {
    fail(
      "invalid outline:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }
  process.stdout.write(`building ${outline.slides.length} slides…\n`);
  resetUsage();

  let theme;
  try {
    theme = loadTheme(themeName ?? outline.meta.theme ?? "field");
  } catch (e) {
    fail((e as Error).message);
  }

  const fitTheme = theme.fontFaceCss + "\n" + theme.css;
  const renderer = playwrightRenderer(fitTheme);

  // load the optional context sidecar written by ingest
  let context;
  try {
    const raw = readFileSync(sidecarPath(resolve(input)), "utf8");
    context = parseContext(raw) ?? undefined;
    if (context) process.stdout.write(`✓ loaded context (${context.digest.length} digest points)\n`);
  } catch {
    process.stdout.write("· no context sidecar — authoring from the outline only\n");
  }

  const baseDir = dirname(resolve(input));
  const stem = basename(input, extname(input));
  const outPath = out ?? join(baseDir, stem + ".html");
  const buildDir = join(baseDir, stem + ".build");
  // the sink writes progress.jsonl/status.json under buildDir and re-seals outPath incrementally
  const sink = fileSink(buildDir, outline, outPath, theme);
  process.stdout.write(`· progress → ${join(buildDir, "progress.jsonl")}\n`);
  const reuse = new Map<string, string>();
  if (resume) {
    for (const s of outline.slides) {
      try {
        const saved = readFileSync(join(buildDir, "slides", `${s.id}.html`), "utf8");
        if (hasUsableSection(saved, s.id)) reuse.set(s.id, saved);
      } catch { /* slide not built yet */ }
    }
    process.stdout.write(`· resume: reusing ${reuse.size}/${outline.slides.length} saved slides\n`);
  }

  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    try {
      result = await buildDeck(outline, { author: agenticAuthor(renderer, theme.brief), renderer, context, sink, concurrency, reuse, judge: slideJudge() });
    } finally {
      await renderer.dispose().catch(() => {});
    }
  } catch (e) {
    fail((e as Error).message);
  }

  for (const w of result.warnings) process.stderr.write(`⚠ ${w}\n`);
  process.stdout.write(`✓ sealed → ${outPath}\n`);

  // whole-deck gate: load the assembled deck once and assert it's structurally sound
  try {
    const sealed = readFileSync(outPath, "utf8");
    const check = await verifyDeck(sealed);
    const problems: string[] = [];
    if (check.sectionCount !== outline.slides.length) {
      problems.push(`section count ${check.sectionCount} ≠ ${outline.slides.length} outline slides`);
    }
    for (const e of check.consoleErrors) problems.push(`console error on load: ${e}`);
    for (const t of check.looseText) problems.push(`loose text outside a slide: "${t}"`);
    for (const d of check.duds) problems.push(`content dud: ${d}`);
    if (problems.length) {
      process.stderr.write("\n✗ deck check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
      process.exitCode = 1; // signal failure but leave the deck on disk for inspection
    } else {
      process.stdout.write(`✓ deck check passed (${check.sectionCount} slides, 0 console errors)\n`);
    }
  } catch (e) {
    process.stderr.write(`· deck check skipped (${(e as Error).message})\n`);
  }

  printCost();

  if (open) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    import("node:child_process").then(({ spawn }) =>
      spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref(),
    );
  }
}

const SOURCE_CAP = 12_000; // chars of source text fed to each fidelity check

async function runReview(args: string[]): Promise<void> {
  let input: string | undefined;
  let deckPath: string | undefined;
  let json = false;
  const envC = Number(process.env.MINDSIZER_CONCURRENCY);
  let concurrency = Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4;

  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--deck") {
      deckPath = args[++k];
      if (!deckPath) fail("--deck requires a path");
    } else if (a === "--json") {
      json = true;
    } else if (a === "--concurrency" || a === "-c") {
      const v = Number(args[++k]);
      if (!Number.isFinite(v) || v < 1) fail("--concurrency requires an integer ≥ 1");
      concurrency = Math.floor(v);
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }
  if (!input) fail("usage: mindsizer review <outline.md> [--deck <deck.html>] [--json] [--concurrency <n>]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }
  const outline = parseOutline(md);
  const issues = validateOutline(outline);
  if (issues.length > 0) {
    fail(
      "invalid outline:\n" +
        issues
          .map((i) => `  - ${i.slideId ? i.slideId + ": " : ""}${i.message}`)
          .join("\n"),
    );
  }

  let theme;
  try {
    theme = loadTheme(outline.meta.theme ?? "field");
  } catch (e) {
    fail((e as Error).message);
  }

  const baseDir = dirname(resolve(input));
  const stem = basename(input, extname(input));
  const deck = deckPath ? resolve(deckPath) : join(baseDir, stem + ".html");
  let deckHtml: string;
  try {
    deckHtml = readFileSync(deck, "utf8");
  } catch {
    fail(`cannot read deck ${deck} — build it first or pass --deck`);
  }
  const fragments = extractSlides(deckHtml);
  if (fragments.length === 0) fail(`no slides found in ${deck}`);

  // sidecar → digest/angle/source; each rung degrades with a notice
  let digest: string[] = [];
  let angle = "";
  let sourceExcerpt: string | undefined;
  let sourcePath: string | null = null;
  let direction: { conceit: string; motif: string } | undefined;
  try {
    const ctx = parseContext(readFileSync(sidecarPath(resolve(input)), "utf8"));
    if (ctx) {
      digest = ctx.digest;
      angle = ctx.angle;
      if (ctx.direction) direction = { conceit: ctx.direction.conceit, motif: ctx.direction.motif };
      if (ctx.sourcePath) {
        try {
          const full = readFileSync(ctx.sourcePath, "utf8");
          sourcePath = ctx.sourcePath;
          sourceExcerpt = full.length > SOURCE_CAP ? full.slice(0, SOURCE_CAP) + "\n[…source truncated…]" : full;
        } catch {
          process.stdout.write("· source file unreadable — fidelity checks fall back to the digest\n");
        }
      }
    }
  } catch {
    process.stdout.write("· no context sidecar — reviewing visuals + interactions + coherence only\n");
  }

  process.stdout.write(`reviewing ${outline.slides.length} slides… (model: ${modelFor("review").model})\n`);
  resetUsage();
  const renderer = playwrightRenderer(theme.fontFaceCss + "\n" + theme.css);
  const byId = new Map(fragments.map((f) => [f.id, f.fragment]));
  const review = slideReviewer(renderer);

  let slideResults: SlideReviewResult[];
  let deckFindings: Awaited<ReturnType<typeof reviewDeckCoherence>>;
  try {
    const slidesP = mapPool(outline.slides, concurrency, async (s): Promise<SlideReviewResult> => {
      const fragment = byId.get(s.id);
      if (!fragment) {
        return { id: s.id, title: s.title, findings: [{ check: "visual", severity: "high", summary: "slide missing from deck", detail: `no <section data-slide-id="${s.id}"> in ${deck}`, suggestion: "rebuild the deck" }] };
      }
      const reqData: SlideReviewRequest = { id: s.id, title: s.title, angle, digest, sourceExcerpt, fragment };
      process.stdout.write(`[${s.id}] reviewing…\n`);
      return { id: s.id, title: s.title, findings: await review(reqData) };
    });
    const coherenceP = reviewDeckCoherence(
      outline.meta.title,
      angle,
      fragments.map((f) => ({ id: f.id, title: outline.slides.find((s) => s.id === f.id)?.title ?? f.id, text: slideText(f.fragment) })),
      direction,
    );
    const [pool, coherence] = await Promise.all([slidesP, coherenceP]);
    deckFindings = coherence;
    slideResults = pool.map((r, i) =>
      r.ok
        ? r.value
        : { id: outline.slides[i].id, title: outline.slides[i].title, findings: [{ check: "visual" as const, severity: "high" as const, summary: "review failed", detail: String((r.error as Error)?.message ?? r.error), suggestion: "re-run review" }] },
    );
  } finally {
    await renderer.dispose().catch(() => {});
  }

  // sections present in the deck but absent from the outline are a structural mismatch
  const outlineIds = new Set(outline.slides.map((s) => s.id));
  for (const f of fragments) {
    if (!outlineIds.has(f.id)) {
      deckFindings.push({ slideId: f.id, check: "coherence", severity: "high", summary: "deck section not in outline", detail: `<section data-slide-id="${f.id}"> has no outline slide`, suggestion: "rebuild the deck from this outline, or review against the right outline" });
    }
  }

  const run: ReviewRun = {
    meta: { deck, source: sourcePath, model: modelFor("review").model, date: new Date().toISOString() },
    slides: slideResults,
    deck: deckFindings,
  };

  const reportBase = deck.replace(/\.html$/i, "");
  writeFileSync(reportBase + ".review.md", markdownReport(run), "utf8");
  process.stdout.write(`✓ wrote ${reportBase}.review.md\n`);
  if (json) {
    writeFileSync(reportBase + ".review.json", jsonReport(run), "utf8");
    process.stdout.write(`✓ wrote ${reportBase}.review.json\n`);
  }
  process.stdout.write("\n" + terminalReport(run) + "\n");
  printCost();
  if (hasHigh(run)) process.exitCode = 1;
}

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
  } catch (e) {
    fail((e as Error).message);
  }
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args[0] === "ingest") {
    void runIngest(args.slice(1));
    return;
  }
  if (args[0] === "plan") {
    void runPlan(args.slice(1));
    return;
  }
  if (args[0] === "build") {
    void runBuild(args.slice(1));
    return;
  }
  if (args[0] === "review") {
    void runReview(args.slice(1));
    return;
  }
  if (args[0] === "brief") {
    runBrief(args.slice(1));
    return;
  }
  if (args[0] === "fit") {
    void runFit(args.slice(1));
    return;
  }
  runSeal(args);
}

main(process.argv);
