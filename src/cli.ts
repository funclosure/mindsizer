#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { parseOutline, writeSlide } from "./outline/index";
import { sealDeck, fontFaceCss, readFieldCss } from "./export/index";
import { ingest, anthropicClient, fixedPrompter, terminalPrompter, anthropicSlideAuthor } from "./agent/index";
import { buildDeck } from "./render/index";
import { playwrightFitChecker } from "./render/fit-check";

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
}

async function runBuild(args: string[]): Promise<void> {
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

  if (!input) fail("usage: mindsizer build <outline.md> [-o <out.html>] [--open]");

  let md: string;
  try {
    md = readFileSync(resolve(input), "utf8");
  } catch {
    fail(`cannot read ${input}`);
  }

  const outline = parseOutline(md);
  process.stdout.write(`building ${outline.slides.length} slides…\n`);

  const fitTheme = fontFaceCss() + "\n" + readFieldCss();
  const fit = playwrightFitChecker(fitTheme);
  let result: Awaited<ReturnType<typeof buildDeck>>;
  try {
    result = await buildDeck(outline, {
      author: anthropicSlideAuthor(),
      fit,
      maxPasses: 3,
    });
  } catch (e) {
    await fit.dispose();
    fail((e as Error).message);
  }
  await fit.dispose();

  const baseDir = dirname(resolve(input));
  const slidesDir = join(baseDir, basename(input, extname(input)) + ".slides");
  mkdirSync(slidesDir, { recursive: true });
  for (const [id, html] of result.sections) {
    await writeSlide(slidesDir, id, html);
  }
  for (const w of result.warnings) process.stderr.write(`⚠ ${w}\n`);
  process.stdout.write(`✓ authored ${result.sections.size} slides\n`);

  const outPath =
    out ?? join(baseDir, basename(input, extname(input)) + ".html");
  try {
    writeFileSync(outPath, sealDeck(outline, { sections: result.sections }), "utf8");
  } catch {
    fail(`cannot write ${outPath}`);
  }
  process.stdout.write(`✓ sealed → ${outPath}\n`);

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
