#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
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
    spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref();
  }
}

main(process.argv);
