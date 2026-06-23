// Generates the mindsizer GitHub Pages homepage (a Field-aesthetic landing).
// Usage: bun run site/build-home.ts [outPath]   (default: site/index.html)
// Self-contained: embeds the Field fonts as base64; no network at view time.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (p: string) => readFileSync(join(ROOT, "theme/fonts", p)).toString("base64");
const F = {
  fraunces: b64("fraunces.woff2"),
  frauncesItalic: b64("fraunces-italic.woff2"),
  geist: b64("geist.woff2"),
  geistMono: b64("geist-mono.woff2"),
};

const REPO = "https://github.com/funclosure/mindsizer";
const EXAMPLE = "./dont-scale/";

const HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mindsizer — dense text into a deck that clicks</title>
<meta name="description" content="mindsizer reflows hard or dense writing into a self-contained, interactive deck of comprehension-first slides.">
<style>
@font-face{font-family:"Fraunces";font-weight:100 900;src:url(data:font/woff2;base64,${F.fraunces}) format("woff2");}
@font-face{font-family:"Fraunces";font-style:italic;font-weight:100 900;src:url(data:font/woff2;base64,${F.frauncesItalic}) format("woff2");}
@font-face{font-family:"Geist";font-weight:100 900;src:url(data:font/woff2;base64,${F.geist}) format("woff2");}
@font-face{font-family:"Geist Mono";font-weight:100 900;src:url(data:font/woff2;base64,${F.geistMono}) format("woff2");}
:root{--bg:#0a1a2f;--fg:#f3efe5;--muted:rgba(243,239,229,.62);--dim:rgba(243,239,229,.36);
  --line:rgba(243,239,229,.14);--cyan:#4DD9E0;}
*{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--fg);font-family:"Geist",system-ui,sans-serif;line-height:1.5;
  -webkit-font-smoothing:antialiased;
  background-image:radial-gradient(circle at 1px 1px,rgba(243,239,229,.045) 1px,transparent 0);background-size:26px 26px;}
a{color:inherit;}
.wrap{max-width:920px;margin:0 auto;padding:0 32px;}
.mono{font-family:"Geist Mono",monospace;text-transform:uppercase;letter-spacing:.2em;font-size:11px;color:var(--dim);}
.serif{font-family:"Fraunces",serif;font-variation-settings:"SOFT" 90,"opsz" 90;}
.cy{color:var(--cyan);}
.it-cy{font-family:"Fraunces",serif;font-style:italic;font-weight:500;color:var(--cyan);}

nav{display:flex;justify-content:space-between;align-items:center;padding:26px 0;border-bottom:1px solid var(--line);}
nav .brand{font-family:"Fraunces",serif;font-weight:600;font-size:20px;letter-spacing:-.01em;}
nav .brand .dot{color:var(--cyan);}
nav a.gh{font-family:"Geist Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--muted);text-decoration:none;border:1px solid var(--line);border-radius:7px;padding:8px 14px;transition:.18s;}
nav a.gh:hover{border-color:rgba(77,217,224,.5);color:var(--fg);}

.hero{padding:11vh 0 7vh;}
.hero .kick{margin-bottom:22px;}
.hero h1{font-family:"Fraunces",serif;font-variation-settings:"SOFT" 90,"opsz" 90;font-weight:600;
  font-size:clamp(40px,6.4vw,76px);line-height:1.0;letter-spacing:-.02em;max-width:15ch;}
.hero p.lead{color:var(--muted);font-size:clamp(17px,1.9vw,21px);max-width:42ch;margin-top:26px;}
.hero p.lead b{color:var(--fg);font-weight:400;}
.cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:36px;}
.btn{display:inline-block;text-decoration:none;font-weight:600;font-size:15px;border-radius:9px;padding:14px 24px;transition:.18s;}
.btn.primary{background:var(--cyan);color:#06121f;}
.btn.primary:hover{filter:brightness(1.08);transform:translateY(-1px);}
.btn.ghost{border:1px solid var(--line);color:var(--fg);}
.btn.ghost:hover{border-color:rgba(77,217,224,.5);}

.pos{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:54px 0;}
.pos p{font-family:"Fraunces",serif;font-size:clamp(22px,3vw,34px);line-height:1.3;max-width:24ch;}
.pos .muted{color:var(--dim);}

.how{padding:64px 0;}
.how .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:30px;}
.how .step{border:1px solid var(--line);border-radius:12px;padding:24px;}
.how .step .n{font-family:"Fraunces",serif;font-weight:600;font-size:30px;color:var(--cyan);line-height:1;}
.how .step h3{font-size:17px;margin:14px 0 8px;font-weight:600;}
.how .step p{color:var(--muted);font-size:14.5px;}

.start{padding:10px 0 70px;}
.start h2{font-family:"Fraunces",serif;font-weight:600;font-size:clamp(26px,3.4vw,38px);letter-spacing:-.01em;}
.start .note{color:var(--muted);margin:14px 0 22px;font-size:16px;}
.start .note code{font-family:"Geist Mono",monospace;font-size:13px;color:var(--fg);background:rgba(243,239,229,.06);padding:2px 7px;border-radius:5px;}
pre{background:#081424;border:1px solid var(--line);border-radius:12px;padding:22px 24px;overflow:auto;}
pre code{font-family:"Geist Mono",monospace;font-size:13.5px;line-height:1.7;color:var(--fg);}
pre .c{color:var(--dim);}

footer{border-top:1px solid var(--line);padding:30px 0 60px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;}
footer a{color:var(--muted);text-decoration:none;}
footer a:hover{color:var(--cyan);}
@media(max-width:680px){.how .grid{grid-template-columns:1fr;}}
</style></head>
<body>
<div class="wrap">

  <nav>
    <div class="brand">mindsizer<span class="dot">.</span></div>
    <a class="gh" href="${REPO}">GitHub &#8599;</a>
  </nav>

  <header class="hero">
    <div class="mono kick">Responsive design · for cognition</div>
    <h1>Dense text &rarr; a deck that makes it <span class="it-cy">click</span>.</h1>
    <p class="lead">mindsizer digests hard or dense writing, asks what you need it <b>for</b>, and rebuilds it into a self-contained deck of comprehension-first slides &mdash; including genuinely <b>interactive</b> ones you can operate.</p>
    <div class="cta">
      <a class="btn primary" href="${EXAMPLE}">&#9654;&nbsp; See the live example</a>
      <a class="btn ghost" href="${REPO}#readme">Read the docs</a>
    </div>
  </header>

  <section class="pos">
    <p>Summarizers make it <span class="muted">shorter</span>. Deck-makers make it <span class="muted">prettier</span>.<br>mindsizer makes it <span class="it-cy">click</span>.</p>
  </section>

  <section class="how">
    <div class="mono">How it works</div>
    <div class="grid">
      <div class="step"><div class="n">01</div><h3>Digest &amp; aim</h3><p>It distills the source and asks what you intend to <em>do</em> with it &mdash; the angle shapes the whole deck.</p></div>
      <div class="step"><div class="n">02</div><h3>Author with eyes</h3><p>An agent designs each slide, renders it, <em>looks</em> at the result, and fixes it &mdash; reaching for an interactive instrument when it helps the idea land.</p></div>
      <div class="step"><div class="n">03</div><h3>One offline file</h3><p>Everything seals into a single self-contained HTML deck &mdash; linear, presentable, and shareable anywhere, no server.</p></div>
    </div>
  </section>

  <section class="start">
    <h2>Start in 30 seconds</h2>
    <p class="note">Just want to see it? Open <code>examples/dont-scale.deck.html</code> &mdash; no install, no setup. To make your own:</p>
<pre><code><span class="c"># install (needs Bun) + register the command</span>
bun install &amp;&amp; bun link

<span class="c"># turn any article into an interactive deck</span>
mindsizer ingest article.txt -o article.outline.md
mindsizer build article.outline.md --open

<span class="c"># …or rebuild the bundled example</span>
bun run example</code></pre>
  </section>

  <footer>
    <span class="mono">mindsizer &mdash; local-first comprehension tool</span>
    <span><a href="${EXAMPLE}">live example</a> &nbsp;·&nbsp; <a href="${REPO}">source</a></span>
  </footer>

</div>
</body></html>`;

const out = process.argv[2] || join(ROOT, "site", "index.html");
writeFileSync(out, HTML);
console.log(`wrote ${out} — ${(HTML.length / 1024).toFixed(0)}KB`);
