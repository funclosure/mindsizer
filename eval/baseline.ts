#!/usr/bin/env bun
// eval/baseline.ts — run the CURRENT harness (plan → build) on every fetchable source, keep each
// build's progress.jsonl next to its deck, then score every deck (plus the Opus 4.8 reference deck).
//
//   bun run eval:baseline [--run <name>] [--only id,id] [--no-build] [--no-score] [--jobs 2]
//
// All model roles run on MINDSIZER_MODEL (set by eval/opus55.env via the package script).
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadSources, parseManifest, fetchableSources, sourceLabel, type Source } from "./lib/sources";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const RUN = arg("run") ?? `${today}-baseline-${(process.env.MINDSIZER_MODEL ?? "claude-opus-5-5").replace(/^claude-/, "")}`;
const RUN_DIR = join(ROOT, "eval", "results", RUN);
const OUT_DIR = join(ROOT, "eval", "out");
const JOBS = Number(arg("jobs") ?? 2);
const ONLY = arg("only")?.split(",");
const LOG = join(RUN_DIR, "baseline.log.jsonl");

function log(e: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...e });
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

function run(cmd: string[], logFile: string): Promise<{ code: number; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: string[] = [];
    p.stdout.on("data", (d) => chunks.push(String(d)));
    p.stderr.on("data", (d) => chunks.push(String(d)));
    p.on("close", (code) => {
      appendFileSync(logFile, chunks.join(""));
      resolve({ code: code ?? 1, ms: Date.now() - t0 });
    });
  });
}

async function withRetry(label: string, id: string, cmd: string[], logFile: string): Promise<{ ok: boolean; ms: number; attempts: number }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    appendFileSync(logFile, `\n$ ${cmd.join(" ")}   # attempt ${attempt}\n`);
    const r = await run(cmd, logFile);
    log({ id, step: label, attempt, code: r.code, ms: r.ms });
    if (r.code === 0) return { ok: true, ms: r.ms, attempts: attempt };
  }
  return { ok: false, ms: 0, attempts: 2 };
}

async function buildOne(s: Source): Promise<void> {
  const txt = join(ROOT, "eval", ".cache", `${s.id}.txt`);
  const plan = join(OUT_DIR, `${s.id}.plan.md`);
  const deck = join(RUN_DIR, `${s.id}.deck.html`);
  const logFile = join(RUN_DIR, `${s.id}.build.log`);
  if (!existsSync(plan) || process.argv.includes("--replan")) {
    const p = await withRetry("plan", s.id, ["bun", "run", "src/cli.ts", "plan", txt, "--yes", "-o", plan, "--source", s.url, "--source-label", sourceLabel(s)], logFile);
    if (!p.ok) { log({ id: s.id, step: "plan", status: "failed" }); return; }
    writeFileSync(join(RUN_DIR, `${s.id}.plan-ms.txt`), String(p.ms));
  }
  copyFileSync(plan, join(RUN_DIR, `${s.id}.plan.md`));
  const b = await withRetry("build", s.id, ["bun", "run", "src/cli.ts", "build", plan, "-o", deck], logFile);
  if (!b.ok) { log({ id: s.id, step: "build", status: "failed" }); return; }
  const progress = join(OUT_DIR, `${s.id}.plan.build`, "progress.jsonl");
  if (existsSync(progress)) copyFileSync(progress, join(RUN_DIR, `${s.id}.progress.jsonl`));
  log({ id: s.id, step: "build", status: "ok", ms: b.ms, attempts: b.attempts });
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()!); }));
}

async function main() {
  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const { sources } = loadSources(join(ROOT, "eval", "sources.json"));
  const manifestPath = join(ROOT, "eval", ".cache", "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("no eval/.cache/manifest.json — run `bun run eval/fetch.ts` first");
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  let todo = fetchableSources(sources, manifest);
  if (ONLY) todo = todo.filter((s) => ONLY.includes(s.id));
  writeFileSync(join(RUN_DIR, "sources-status.json"), JSON.stringify(
    Object.fromEntries(sources.map((s) => {
      const m = manifest.sources[s.id];
      return [s.id, m?.status === "ok" ? { status: "ok", words: m.words, from: m.from } : { status: "unavailable", reason: m?.status === "unavailable" ? m.reason : "not fetched" }];
    })), null, 2));
  log({ step: "start", run: RUN, sources: todo.map((s) => s.id), model: process.env.MINDSIZER_MODEL });

  if (!process.argv.includes("--no-build")) await pool(todo, JOBS, buildOne);

  if (!process.argv.includes("--no-score")) {
    const jobs: string[][] = [];
    for (const s of todo) {
      const deck = join(RUN_DIR, `${s.id}.deck.html`);
      if (!existsSync(deck)) continue;
      jobs.push(["bun", "run", "eval/score.ts", deck, "--plan", join(RUN_DIR, `${s.id}.plan.md`), "--source", join(ROOT, "eval", ".cache", `${s.id}.txt`), "--source-id", s.id, "--out", join(RUN_DIR, "scores", s.id)]);
    }
    // cross-version reference: the committed Opus 4.8 deck (outline-only, no plan)
    jobs.push(["bun", "run", "eval/score.ts", join(ROOT, "examples", "dont-scale.deck.html"), "--outline", join(ROOT, "examples", "dont-scale.outline.md"), "--source", join(ROOT, "eval", ".cache", "dont-scale.txt"), "--source-id", "dont-scale", "--out", join(RUN_DIR, "scores", "ref-opus-4-8-dont-scale")]);
    await pool(jobs, 2, async (cmd) => {
      const r = await run(cmd, join(RUN_DIR, "score.log"));
      log({ step: "score", deck: cmd[3], code: r.code, ms: r.ms });
    });
    const rr = await run(["bun", "run", "eval/report.ts", "--run", RUN], join(RUN_DIR, "score.log"));
    log({ step: "report", code: rr.code });
  }
}

await main();
