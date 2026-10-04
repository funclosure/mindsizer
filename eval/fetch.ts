#!/usr/bin/env bun
// eval/fetch.ts — turn every source in eval/sources.json into clean plain text at
// eval/.cache/<id>.txt and record per-source status in eval/.cache/manifest.json.
// Source texts are NEVER committed (the repo is public); eval/.cache/ is gitignored.
//
//   bun run eval/fetch.ts            # fetch everything not already cached
//   bun run eval/fetch.ts --force    # refetch
//   bun run eval/fetch.ts <id> ...   # only these ids
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse, type HTMLElement } from "node-html-parser";
import { loadSources, type Source, type Manifest, type ManifestEntry } from "./lib/sources";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "eval", ".cache");
const MANIFEST = join(CACHE, "manifest.json");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";

/** Known open full-text locations to try BEFORE the canonical url (same work, not a substitute). */
const ALTERNATES: Record<string, string[]> = {
  "turing-cmi": [
    "https://phil415.pbworks.com/f/TuringComputing.pdf",
    "https://www.csee.umbc.edu/courses/471/papers/turing.pdf",
    "https://redirect.cs.umbc.edu/courses/471/papers/turing.pdf",
  ],
  "chollet-measure": ["https://arxiv.org/pdf/1911.01547"],
};

const DROP = "script,style,noscript,nav,header,footer,aside,form,svg,figure figcaption+*,button,iframe";

/** Pick the element that most plausibly holds the article body. */
export function articleRoot(root: HTMLElement): HTMLElement {
  for (const sel of ["d-article", "article", "main", ".entry-content", ".post-content", ".post", "#content", ".content"]) {
    const el = root.querySelector(sel);
    if (el && el.textContent.trim().length > 1500) return el;
  }
  // Fallback: the element whose direct <p> children carry the most text.
  let best: HTMLElement = root.querySelector("body") ?? root;
  let bestLen = 0;
  for (const el of root.querySelectorAll("div, td, section, body")) {
    const len = el.childNodes
      .filter((n) => (n as HTMLElement).tagName === "P" || n.nodeType === 3)
      .reduce((a, n) => a + n.textContent.trim().length, 0);
    if (len > bestLen) { bestLen = len; best = el; }
  }
  return best;
}

/** HTML → readable plain text: block elements become paragraphs; entities decoded. */
export function htmlToText(html: string): string {
  const root = parse(html, { blockTextElements: { script: false, style: false, pre: true } });
  const art = articleRoot(root);
  for (const el of art.querySelectorAll(DROP)) el.remove();
  const blocks = art.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,dt,dd");
  let text: string;
  if (blocks.length > 5) {
    text = blocks
      .filter((b) => !b.closest("li") || b.tagName === "LI") // avoid double-counting nested blocks
      .map((b) => (b.tagName.startsWith("H") ? "\n" : "") + b.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  } else {
    // pages like paulgraham.com use <br><br> inside one <font> — split on breaks
    text = art.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
    text = parse(`<x>${text}</x>`).textContent;
  }
  return tidy(text);
}

export function tidy(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

/** WebVTT auto-captions → plain transcript: drop timestamps/tags, collapse the rolling duplicates. */
export function vttToText(vtt: string): string {
  const out: string[] = [];
  for (const raw of vtt.split("\n")) {
    const line = raw.replace(/<[^>]+>/g, "").trim();
    if (!line || line === "WEBVTT" || /^(Kind|Language|NOTE)\b/.test(line) || /-->/.test(line) || /^\d+$/.test(line)) continue;
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  // rolling captions repeat the previous line as a prefix of the next — keep the new tail only
  const words: string[] = [];
  for (const l of out) {
    const w = l.split(/\s+/);
    let k = Math.min(w.length, words.length);
    while (k > 0 && words.slice(words.length - k).join(" ") !== w.slice(0, k).join(" ")) k--;
    words.push(...w.slice(k));
  }
  const text = words.join(" ");
  // paragraph every ~120 words so downstream chunking has breaks
  const paras: string[] = [];
  const ws = text.split(" ");
  for (let i = 0; i < ws.length; i += 120) paras.push(ws.slice(i, i + 120).join(" "));
  return tidy(paras.join("\n\n"));
}

async function fetchUrl(url: string): Promise<{ body: Buffer; type: string }> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/pdf,*/*" }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
  return { body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "" };
}

async function pdfToText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return tidy(Array.isArray(text) ? text.join("\n\n") : text);
}

async function fetchText(s: Source): Promise<{ text: string; from: string }> {
  if (s.local) return { text: tidy(readFileSync(join(ROOT, s.local), "utf8")), from: s.local };
  const urls = [...(ALTERNATES[s.id] ?? []), s.url];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const { body, type } = await fetchUrl(url);
      const isPdf = type.includes("pdf") || body.subarray(0, 4).toString() === "%PDF";
      let text = isPdf ? await pdfToText(body) : htmlToText(body.toString("utf8"));
      if (s.id === "lovelace-note-g") text = trimToNoteG(text);
      if (text.length < 2000) throw new Error(`extracted only ${text.length} chars from ${url} (paywall or wrong page?)`);
      return { text, from: url };
    } catch (e) {
      errors.push(`${url}: ${(e as Error).message}${(e as any).cause ? ` (${(e as any).cause.message ?? (e as any).cause})` : ""}`);
    }
  }
  throw new Error(errors.join(" | "));
}

/** Note G plus the preceding Notes for context (the full Sketch + all Notes is ~65k words). */
export function trimToNoteG(text: string): string {
  const g = text.search(/\bNote G\b/);
  if (g < 0) return text;
  const startD = text.search(/\bNote D\b/);
  return tidy(text.slice(startD >= 0 && startD < g ? startD : Math.max(0, g - 20000)));
}

function fetchVideo(s: Source): { text: string; from: string } {
  const dir = join(CACHE, `${s.id}.subs`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("yt-dlp", [
    "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt",
    "-o", join(dir, "%(id)s.%(ext)s"), s.url,
  ], { encoding: "utf8", timeout: 180_000 });
  if (r.error) throw new Error(`yt-dlp not runnable: ${r.error.message}`);
  const vtt = readdirSync(dir).find((f) => f.endsWith(".vtt"));
  if (!vtt) throw new Error(`yt-dlp produced no captions (exit ${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" / ")}`);
  return { text: vttToText(readFileSync(join(dir, vtt), "utf8")), from: `${s.url} (yt-dlp auto-captions)` };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--"));
  mkdirSync(CACHE, { recursive: true });
  const { sources } = loadSources(join(ROOT, "eval", "sources.json"));
  const manifest: Manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { sources: {} };
  for (const s of sources) {
    if (only.length && !only.includes(s.id)) continue;
    const out = join(CACHE, `${s.id}.txt`);
    if (!force && existsSync(out) && manifest.sources[s.id]?.status === "ok") { console.log(`· ${s.id}: cached`); continue; }
    let entry: ManifestEntry;
    try {
      const { text, from } = s.kind === "video" ? fetchVideo(s) : await fetchText(s);
      writeFileSync(out, text, "utf8");
      entry = { status: "ok", from, chars: text.length, words: text.split(/\s+/).length, fetchedAt: new Date().toISOString() };
      console.log(`✓ ${s.id}: ${entry.words} words from ${from}`);
    } catch (e) {
      entry = { status: "unavailable", reason: (e as Error).message.slice(0, 2000), fetchedAt: new Date().toISOString() };
      console.log(`✗ ${s.id}: unavailable — ${entry.reason}`);
    }
    manifest.sources[s.id] = entry;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
}

if ((import.meta as { main?: boolean }).main) await main();
