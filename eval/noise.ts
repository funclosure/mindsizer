#!/usr/bin/env bun
// eval/noise.ts — judge-noise report: compare scores/<deck>/scores.json with an independent second
// scoring at scores-r2/<deck>/scores.json (same deck, fresh judge sessions) → noise.json.
//
//   bun run eval:noise --run <run>
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { noise, type DeckScores, type SlideScore } from "./lib/aggregate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--run");
if (i < 0) { console.error("usage: bun run eval:noise --run <run>"); process.exit(2); }
const RUN_DIR = join(ROOT, "eval", "results", process.argv[i + 1]);

const r2dir = join(RUN_DIR, "scores-r2");
if (!existsSync(r2dir)) { console.error(`no ${r2dir} — score some decks a second time into scores-r2/<deck>/ first`); process.exit(1); }
const a: SlideScore[] = [];
const b: SlideScore[] = [];
const decks: string[] = [];
const deckLevel: { deck: string; coherence: (number | null)[]; quiz: (number | null)[] }[] = [];
for (const d of readdirSync(r2dir)) {
  const p1 = join(RUN_DIR, "scores", d, "scores.json");
  const p2 = join(r2dir, d, "scores.json");
  if (!existsSync(p1) || !existsSync(p2)) continue;
  const s1: DeckScores = JSON.parse(readFileSync(p1, "utf8"));
  const s2: DeckScores = JSON.parse(readFileSync(p2, "utf8"));
  // prefix ids so slides from different decks never pair up
  a.push(...s1.slides.map((s) => ({ ...s, id: `${d}/${s.id}` })));
  b.push(...s2.slides.map((s) => ({ ...s, id: `${d}/${s.id}` })));
  decks.push(d);
  deckLevel.push({
    deck: d,
    coherence: [s1.deckCriteria.coherence?.score ?? null, s2.deckCriteria.coherence?.score ?? null],
    quiz: [s1.deckCriteria.quiz?.score ?? null, s2.deckCriteria.quiz?.score ?? null],
  });
}
const rows = noise(a, b);
// per-slide deltas, for eyeballing which slides flip
const perSlide = a.map((s) => {
  const t = b.find((x) => x.id === s.id);
  return { id: s.id, deltas: Object.fromEntries(rows.map((r) => [r.criterion, [s.criteria[r.criterion as keyof typeof s.criteria]?.score ?? null, t?.criteria[r.criterion as keyof typeof s.criteria]?.score ?? null]])) };
});
writeFileSync(join(RUN_DIR, "noise.json"), JSON.stringify({ decks, rows, deckLevel, perSlide }, null, 2));
for (const r of rows) console.log(`${r.criterion.padEnd(16)} pairs ${r.pairs} · same ${r.exact} · ±1 ${r.flip1} · ±2+ ${r.flip2plus} · pass-flip ${r.passFlip} · ${r.trustworthy ? "ok" : "NOISY"}`);
console.log(`✓ wrote noise.json (${decks.join(", ")})`);
