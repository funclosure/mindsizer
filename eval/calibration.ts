#!/usr/bin/env bun
// eval/calibration.ts — build eval/calibration.html: ~20 slides chosen across the score range, each
// with its screenshot(s), the plan's intent, and blank 1–4 inputs per criterion for a human rater.
// No backend: "Copy as JSON" puts the ratings on the clipboard (drafts persist in localStorage).
//
//   bun run eval:calibration [--run <run>] [--n 20]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CRITERIA, ANCHORS } from "./lib/criteria";
import type { DeckScores, SlideScore } from "./lib/aggregate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const RUN = arg("run") ?? readdirSync(join(ROOT, "eval", "results")).filter((d) => /baseline/.test(d)).sort().pop()!;
const N = Number(arg("n") ?? 20);
const RUN_DIR = join(ROOT, "eval", "results", RUN);
const OUT = join(ROOT, "eval", "calibration.html");

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Pick n items spread evenly across the sorted score range (always includes both extremes). */
export function spread<T>(items: T[], key: (t: T) => number, n: number): T[] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  if (sorted.length <= n) return sorted;
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(sorted[Math.round((k * (sorted.length - 1)) / (n - 1))]);
  return out;
}

function total(s: SlideScore): number {
  return CRITERIA.reduce((a, c) => { const r = s.criteria[c]; return a + (!r || r.na ? 2.5 : r.score ?? 2.5); }, 0);
}

function main() {
  const scoresDir = join(RUN_DIR, "scores");
  const pool: { deck: string; dir: string; s: SlideScore }[] = [];
  for (const d of readdirSync(scoresDir)) {
    const p = join(scoresDir, d, "scores.json");
    if (!existsSync(p)) continue;
    const ds: DeckScores = JSON.parse(readFileSync(p, "utf8"));
    for (const s of ds.slides) pool.push({ deck: d, dir: join(scoresDir, d), s });
  }
  const chosen = spread(pool, (x) => total(x.s), N);
  // shuffle deterministically so the rater doesn't see them in score order (anchoring)
  const order = chosen.map((c, i) => ({ c, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((x) => x.c);

  const cards = order.map(({ deck, dir, s }, idx) => {
    const rel = (p: string) => relative(dirname(OUT), join(dir, p));
    const intent: any = (s as any).intent ?? {};
    const judge = Object.fromEntries(CRITERIA.map((c) => [c, s.criteria[c]?.na ? "n/a" : s.criteria[c]?.score ?? "unknown"]));
    const inputs = CRITERIA.map((c) => {
      const na = s.criteria[c]?.na;
      return `<fieldset class="crit" data-crit="${c}"${na ? " disabled" : ""}>
        <legend>${c}${na ? " <small>(n/a)</small>" : ""}</legend>
        <div class="opts">${[1, 2, 3, 4].map((v) => `<label title="${esc(ANCHORS[c][v as 1])}"><input type="radio" name="${s.id}-${c}" value="${v}"><span>${v}</span></label>`).join("")}
        <label title="can't tell"><input type="radio" name="${s.id}-${c}" value="unknown"><span>?</span></label></div>
        <span class="judge" hidden>judge: ${esc(judge[c])}</span>
      </fieldset>`;
    }).join("");
    return `<article class="card" data-id="${esc(s.id)}" data-deck="${esc(deck)}">
      <header><span class="n">${idx + 1}/${order.length}</span><h2>${esc(s.title)}</h2><span class="meta">${esc(deck)} · ${esc(s.id)} · ${esc(s.kind)}</span></header>
      <div class="grid">
        <div class="shots">
          <a href="${esc(rel(s.shots.rest))}" target="_blank"><img loading="lazy" src="${esc(rel(s.shots.rest))}" alt="resting screenshot of ${esc(s.title)}"></a>
          ${s.shots.interacted.length ? `<div class="thumbs">${s.shots.interacted.map((p, k) => `<a href="${esc(rel(p))}" target="_blank"><img loading="lazy" src="${esc(rel(p))}" alt="interacted state ${k + 1}"></a>`).join("")}</div>` : ""}
        </div>
        <div class="side">
          <dl class="intent">
            ${intent.claim ? `<dt>claim</dt><dd>${esc(intent.claim)}</dd>` : `<dt>content (no plan)</dt><dd class="md">${esc(intent.markdown)}</dd>`}
            ${intent.mechanism ? `<dt>mechanism</dt><dd>${esc(intent.mechanism)}</dd>` : ""}
            ${intent.operate ? `<dt>operate</dt><dd>${esc(intent.operate)}</dd>` : ""}
            ${intent.changes ? `<dt>changes</dt><dd>${esc(intent.changes)}</dd>` : ""}
            ${intent.aha ? `<dt>aha</dt><dd>${esc(intent.aha)}</dd>` : ""}
          </dl>
          <div class="inputs">${inputs}</div>
          <textarea placeholder="notes (what made you score it this way?)"></textarea>
        </div>
      </div>
    </article>`;
  }).join("\n");

  const anchorsHtml = [...CRITERIA, "coherence" as const].filter((c) => c !== "coherence").map((c) =>
    `<details><summary>${c}</summary><ol class="anchors">${[1, 2, 3, 4].map((v) => `<li value="${v}">${esc(ANCHORS[c][v as 1])}</li>`).join("")}</ol></details>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judge Calibration Sheet</title>
<style>
:root{--bg:#f6f5f1;--fg:#1b1d22;--dim:#5d6270;--card:#fff;--line:#d9d6cc;--accent:#2f6fdf;--accent-fg:#fff;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121418;--fg:#e8e6e0;--dim:#9aa0ac;--card:#1b1e24;--line:#30343d;--accent:#6c9cff;--accent-fg:#0b0d10;}}
:root[data-theme="dark"]{--bg:#121418;--fg:#e8e6e0;--dim:#9aa0ac;--card:#1b1e24;--line:#30343d;--accent:#6c9cff;--accent-fg:#0b0d10;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;}
main{max-width:1280px;margin:0 auto;padding:24px 16px 120px;}
h1{font-size:24px;margin:0 0 6px}
p.lede{color:var(--dim);margin:0 0 16px;max-width:75ch}
details{margin:4px 0}summary{cursor:pointer;font-weight:600}
ol.anchors{margin:6px 0 10px;padding-left:28px;color:var(--dim)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:20px 0;}
.card header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:12px}
.card h2{font-size:18px;margin:0}
.n,.meta{color:var(--dim);font-size:12px;font-family:ui-monospace,monospace}
.grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}
@media (max-width:860px){.grid{grid-template-columns:1fr}}
.shots img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px}
.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}
dl.intent{margin:0 0 10px;font-size:13px}dt{font-weight:600;color:var(--dim);text-transform:uppercase;font-size:11px;letter-spacing:.06em;margin-top:6px}dd{margin:2px 0 0}
dd.md{white-space:pre-wrap;max-height:160px;overflow:auto}
fieldset.crit{border:none;padding:4px 0;margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-top:1px solid var(--line)}
fieldset.crit legend{float:left;width:130px;font-size:13px;font-family:ui-monospace,monospace;padding:0}
fieldset[disabled]{opacity:.45}
.opts{display:flex;gap:4px}
.opts label{position:relative}
.opts input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.opts span{display:inline-grid;place-items:center;width:34px;height:30px;border:1px solid var(--line);border-radius:6px;font-weight:600}
.opts input:checked+span{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.opts input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.judge{font-size:12px;color:var(--dim);font-family:ui-monospace,monospace}
textarea{width:100%;min-height:56px;margin-top:8px;background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px;font:inherit}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center}
button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
#status{color:var(--dim);font-size:13px}
#out{width:100%;max-width:1280px;display:none}
</style></head>
<body><main>
<h1>Judge calibration sheet</h1>
<p class="lede">${order.length} slides from run <code>${esc(RUN)}</code>, spread across the judges' score range and shuffled. Score each criterion 1–4 (pass ≥ 3; hover a number for its anchor; “?” = can't tell). Grade the rendered slide, not the intent text. Judge scores are hidden so they don't anchor you; reveal them only after you finish. When done, press <b>Copy as JSON</b> and paste the result into <code>eval/calibration/&lt;your-name&gt;.json</code>. These become few-shot examples and tuning targets for the judge prompts.</p>
<details><summary>Score anchors</summary>${anchorsHtml}</details>
<label><input type="text" id="rater" placeholder="your name" style="font:inherit;padding:6px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg)"></label>
${cards}
<textarea id="out" readonly></textarea>
</main>
<div class="bar"><span id="status">0 / ${order.length * CRITERIA.length} ratings</span>
<button id="reveal">Reveal judge scores</button><button id="copy" class="primary">Copy as JSON</button></div>
<script>
(function(){
  var KEY = "mindsizer-calibration-${esc(RUN)}";
  var run = ${JSON.stringify(RUN)};
  function collect(){
    var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
    var n = 0;
    var slides = cards.map(function(c){
      var scores = {};
      c.querySelectorAll("fieldset.crit").forEach(function(f){
        var v = f.querySelector("input:checked");
        if (f.disabled) { scores[f.dataset.crit] = "n/a"; return; }
        scores[f.dataset.crit] = v ? (v.value === "unknown" ? "unknown" : Number(v.value)) : null;
        if (v) n++;
      });
      return { deck: c.dataset.deck, id: c.dataset.id, scores: scores, notes: c.querySelector("textarea").value };
    });
    return { n: n, data: { run: run, rater: document.getElementById("rater").value, ratedAt: new Date().toISOString(), slides: slides } };
  }
  function save(){
    var r = collect();
    document.getElementById("status").textContent = r.n + " / ${order.length * CRITERIA.filter(() => true).length} ratings";
    try { localStorage.setItem(KEY, JSON.stringify(r.data)); } catch (e) {}
  }
  function restore(){
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      document.getElementById("rater").value = d.rater || "";
      d.slides.forEach(function(s){
        var c = document.querySelector('.card[data-id="' + s.id + '"][data-deck="' + s.deck + '"]');
        if (!c) return;
        Object.keys(s.scores).forEach(function(k){
          var v = s.scores[k];
          if (v === null || v === "n/a") return;
          var i = c.querySelector('fieldset[data-crit="' + k + '"] input[value="' + v + '"]');
          if (i) i.checked = true;
        });
        c.querySelector("textarea").value = s.notes || "";
      });
    } catch (e) {}
  }
  document.addEventListener("change", save);
  document.addEventListener("input", save);
  document.getElementById("reveal").addEventListener("click", function(){
    document.querySelectorAll(".judge").forEach(function(j){ j.hidden = !j.hidden; });
  });
  document.getElementById("copy").addEventListener("click", function(){
    var json = JSON.stringify(collect().data, null, 2);
    var out = document.getElementById("out");
    out.value = json; out.style.display = "block";
    var done = function(){ document.getElementById("status").textContent = "copied ✓ (also shown below)"; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, function(){ out.select(); done(); });
    else { out.select(); try { document.execCommand("copy"); } catch (e) {} done(); }
  });
  restore(); save();
})();
</script>
</body></html>`;
  writeFileSync(OUT, html);
  console.log(`✓ wrote eval/calibration.html (${order.length} slides from ${new Set(order.map((o) => o.deck)).size} decks)`);
}

main();
