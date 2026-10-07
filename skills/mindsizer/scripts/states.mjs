// Every interactive state of a mindsizer page, screenshotted and compared.
// Usage (via states.sh): node states.mjs <page.html> <out-dir>
// For each .fig: clicks every radio option and toggles each checkbox off; for each .scrolly: scrolls every beat.
// Saves a screenshot per state at 1280 and 400 wide, flags states that look the same as another state of the
// same figure (only what is drawn or lit counts, not the verdict text), lists SVG text under 12px at 400 wide, and counts the words in the first read (outside folds).
import fs from 'node:fs';
import path from 'node:path';
const mod = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(mod ? path.join(mod, 'index.mjs') : 'playwright');
const [pageFile, out, level = 'medium'] = process.argv.slice(2);
const TARGET = { low: 500, medium: 900, high: 1200 }[level] || 900;
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(pageFile, 'utf8');
if (!/^\s*<!doctype/i.test(html.slice(0, 200))) html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + html;

const browser = await chromium.launch();
const report = { same: [], small: [], errors: [], dupKeys: [], shots: 0, review: [] };
const sheets = {}; // figure id -> [{ file, caption }] at 1280, for the figure review
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => report.errors.push(`${width}: ${e.message}`));
  page.on('console', m => { if (/duplicate key/.test(m.text()) && !report.dupKeys.includes(m.text())) report.dupKeys.push(m.text()); });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const figs = await page.$$('.fig');
  for (let f = 0; f < figs.length; f++) {
    const fig = figs[f];
    const id = (await fig.evaluate(e => (e.closest('[id]') || {}).id)) || 'fig';
    const sig = () => fig.evaluate(e => [...e.querySelectorAll('svg, .words')].map(n => n.tagName === 'DIV' ? [...n.children].map(c => c.className).join() : n.innerHTML).join('|'));
    const seen = new Map();
    const shoot = async (name, caption) => {
      await page.waitForTimeout(750);
      const file = path.join(out, `${width}-${id}-${name}.png`);
      await fig.screenshot({ path: file }); report.shots++;
      if (width === 1280) (sheets[id] = sheets[id] || []).push({ file, caption });
      const s = await sig(); if (width === 1280) { if (seen.has(s)) report.same.push(`${id}: "${name}" looks the same as "${seen.get(s)}"`); else seen.set(s, name); }
    };
    const labelOf = (sel) => page.$eval(sel, e => e.textContent.trim().replace(/\s+/g, ' ')).catch(() => '');
    const checked = await fig.$('input[type=radio]:checked');
    await fig.scrollIntoViewIfNeeded();
    await shoot('rest', 'at rest' + (checked ? ': ' + await labelOf(`label[for="${await checked.getAttribute('id')}"]`) : ''));
    for (const r of await fig.$$('input[type=radio]')) {
      const rid = await r.getAttribute('id'); if (await r.isChecked()) continue;
      await page.click(`label[for="${rid}"]`); await shoot(rid, await labelOf(`label[for="${rid}"]`));
    }
    for (const c of await fig.$$('input[type=checkbox]')) {
      const cid = await c.getAttribute('id');
      await page.click(`label:has(#${cid})`); await shoot(`${cid}-off`, 'off: ' + await labelOf(`label:has(#${cid})`)); await page.click(`label:has(#${cid})`);
    }
  }
  for (const [s, scrolly] of (await page.$$('.scrolly')).entries()) {
    const beats = await scrolly.$$('.beat');
    for (let i = 0; i < beats.length; i++) {
      await beats[i].evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(800);
      const stick = await scrolly.$('.stick'), file = path.join(out, `${width}-scrolly${s}-beat${i}.png`);
      await stick.screenshot({ path: file }); report.shots++;
      if (width === 1280) (sheets[`scrolly${s}`] = sheets[`scrolly${s}`] || []).push({ file, caption: `beat ${i + 1}: ` + await beats[i].evaluate(e => (e.querySelector('h3') || e).textContent.trim()) });
    }
  }
  if (width === 400) report.small = await page.evaluate(() => [...document.querySelectorAll('svg text, svg tspan')].filter(t => !t.querySelector('tspan')).map(t => {
    const ctm = t.getScreenCTM(); const px = parseFloat(getComputedStyle(t).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    return { text: t.textContent.slice(0, 30), px: Math.round(px * 10) / 10 };
  }).filter(t => t.px < 12));
  if (width === 1280) report.handCode = await page.evaluate(() => {
    // the pencil voice is for asides; code, identifiers and exact values belong in print
    const code = /\$\.|\b\w+\.\w+\b|\w\(\)|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|--\w/;
    const out = [];
    for (const el of document.querySelectorAll('main *, svg text')) {
      if (el.children.length && el.tagName !== 'text') continue;
      const t = (el.textContent || '').trim(); if (!t || !/shantell|cursive/i.test(getComputedStyle(el).fontFamily)) continue;
      if (code.test(t)) out.push('code in handwriting: "' + t.slice(0, 40) + '"');
      if (el.classList.contains('tag') && el.scrollWidth > el.clientWidth + 1) out.push('tag cut off: "' + t.slice(0, 40) + '"');
    }
    return out;
  });
  if (width === 1280) report.close = await page.evaluate(() => {
    // the close may only use what the page has already shown: flag names and quoted terms that first appear there
    const main = document.querySelector('main') || document.body, close = document.getElementById('close');
    if (!close) return { missing: true, fresh: [] };
    const all = main.textContent, idx = all.indexOf(close.textContent), before = (idx > 0 ? all.slice(0, idx) : '').toLowerCase();
    // a landing quote (blockquote) is allowed to be new; everything else must have been shown
    const c = close.cloneNode(true); c.querySelectorAll('blockquote').forEach(b => b.remove()); document.body.appendChild(c); c.style.position = 'absolute'; c.style.left = '-99999px';
    const text = c.innerText; c.remove();
    const terms = new Set();
    for (const m of text.matchAll(/[“"]([^”"]{3,60})[”"]/g)) terms.add(m[1].trim());
    for (const line of text.split(/\n|(?<=[.!?:;])\s+/)) {
      const words = line.trim().split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        const w = words[i].replace(/^[^A-Za-z]+|[^A-Za-z’'-]+$/g, '').replace(/[’']s$/, '');
        if (/^[A-Z][a-z’'-]{2,}$/.test(w)) terms.add(w);
      }
    }
    return { missing: false, fresh: [...terms].filter(t => !before.includes(t.toLowerCase())) };
  });
  if (width === 1280) report.words = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body; const words = el => (el.innerText || '').split(/\s+/).filter(Boolean).length;
    const folded = [...main.querySelectorAll('details.more')].reduce((n, d) => n + words(d) - words(d.querySelector('summary') || d), 0);
    const sections = [...main.querySelectorAll('section')].map(s => ({ id: s.id || '(no id)', prose: [...s.querySelectorAll(':scope > .prose p')].reduce((n, p) => n + words(p), 0) }));
    return { firstRead: words(main) - Math.max(0, folded), longProse: sections.filter(s => s.prose > 110) };
  });
  await page.close();
}
// figure review: one sheet per figure, every state side by side, captioned by its control (see SKILL.md, quick check)
const sheetPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
for (const [id, shots] of Object.entries(sheets)) {
  if (shots.length < 2) continue;
  const cells = shots.map(x => `<figure><figcaption>${x.caption.replace(/</g, '&lt;')}</figcaption><img src="data:image/png;base64,${fs.readFileSync(x.file).toString('base64')}"></figure>`).join('');
  await sheetPage.setContent(`<style>body{margin:0;padding:16px;background:#fff;font:15px -apple-system,Helvetica,Arial,sans-serif;color:#222}
    main{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;border:1px solid #ddd;border-radius:8px;padding:10px}
    figcaption{font-weight:600;margin-bottom:6px}img{width:100%;height:auto;display:block}h1{font-size:17px;margin:0 0 12px}</style>
    <h1>${id}: every state, side by side</h1><main>${cells}</main>`, { waitUntil: 'load' });
  const file = path.join(out, `review-${id}.png`);
  await sheetPage.screenshot({ path: file, fullPage: true }); report.review.push(file);
}
await browser.close();
console.log(`shots: ${report.shots} in ${out}`);
const over = report.words.firstRead > TARGET * 1.25;
report.words.level = level; report.words.target = TARGET;
console.log(`first read: ${report.words.firstRead} words (${level}: aim for about ${TARGET})` + (over ? `; over the ${level} budget, cut or fold` : '') + (report.words.longProse.length ? `; prose over 110 words in: ${report.words.longProse.map(s => s.id + ' (' + s.prose + ')').join(', ')}` : ''));
fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify(report, null, 2));
console.log(`states that look the same: ${report.same.length}` + report.same.map(s => '\n  ' + s).join(''));
console.log(`svg text under 12px at 400 wide: ${report.small.length}` + report.small.slice(0, 5).map(s => `\n  ${s.px}px "${s.text}"`).join(''));
console.log(`handwriting problems: ${report.handCode.length}` + report.handCode.slice(0, 8).map(s => '\n  ' + s).join(''));
console.log(`duplicate draw keys: ${report.dupKeys.length}` + report.dupKeys.slice(0, 5).map(s => '\n  ' + s).join(''));
console.log(report.close.missing ? 'close: no section with id="close"' : `close: ${report.close.fresh.length} name(s) or term(s) not shown earlier` + (report.close.fresh.length ? ': ' + report.close.fresh.slice(0, 8).join(', ') : ''));
console.log(`figure review sheets: ${report.review.length}` + report.review.map(s => '\n  ' + s).join(''));
console.log(`script errors: ${report.errors.length}` + report.errors.map(s => '\n  ' + s).join(''));
