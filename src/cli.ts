#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { parseOutline, validateOutline } from "./outline/index";
import { sealDeck, fontFaceCss, readFieldCss, fileSink } from "./export/index";
import { ingest, anthropicClient, fixedPrompter, terminalPrompter, agenticAuthor, parseContext, sidecarPath, serializeContext } from "./agent/index";
import { buildDeck } from "./render/index";
import { playwrightRenderer, verifyDeck } from "./render/fit-check";

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
  try {
    writeFileSync(outPath, result.outlineMarkdown, "utf8");
  } catch {
    fail(`cannot write ${outPath}`);
  }
  process.stdout.write(`✓ wrote ${outPath}\n`);

  // persist the deck context next to the outline so `build` gets the idea, not just the bullet
  try {
    const sc = sidecarPath(outPath);
    writeFileSync(
      sc,
      serializeContext({ sourcePath: resolve(input), digest: result.digest, angle: result.angle.label }),
      "utf8",
    );
    process.stdout.write(`✓ wrote ${sc}\n`);
  } catch {
    /* sidecar is best-effort; build degrades gracefully without it */
  }
}

async function runBuild(args: string[]): Promise<void> {
  let input: string | undefined;
  let out: string | undefined;
  let open = false;
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
    } else if (a.startsWith("-")) {
      fail(`unknown option ${a}`);
    } else {
      input ??= a;
    }
  }

  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open] [--concurrency <n>]");

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

  const fitTheme = fontFaceCss() + "\n" + readFieldCss();
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
  const sink = fileSink(buildDir, outline, outPath);
  process.stdout.write(`· progress → ${join(buildDir, "progress.jsonl")}\n`);

  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    try {
      result = await buildDeck(outline, { author: agenticAuthor(renderer), renderer, context, sink, concurrency });
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
    if (problems.length) {
      process.stderr.write("\n✗ deck check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
      process.exitCode = 1; // signal failure but leave the deck on disk for inspection
    } else {
      process.stdout.write(`✓ deck check passed (${check.sectionCount} slides, 0 console errors)\n`);
    }
  } catch (e) {
    process.stderr.write(`· deck check skipped (${(e as Error).message})\n`);
  }

  if (open) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    import("node:child_process").then(({ spawn }) =>
      spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref(),
    );
  }
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args[0] === "ingest") {
    void runIngest(args.slice(1));
    return;
  }
  if (args[0] === "build") {
    void runBuild(args.slice(1));
    return;
  }
  runSeal(args);
}

main(process.argv);
