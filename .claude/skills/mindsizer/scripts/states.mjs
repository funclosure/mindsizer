// Every interactive state of a mindsizer page, screenshotted and compared.
// Usage (via states.sh): node states.mjs <page.html> <out-dir>
// For each .fig: clicks every radio option and toggles each checkbox off; for each .scrolly: scrolls every beat.
// Saves a screenshot per state at 1280 and 400 wide, flags states that look the same as another state of the
// same figure (only what is drawn or lit counts, not the verdict text), lists SVG text under 12px at 400 wide, and counts the words in the first read (outside folds).
import fs from 'node:fs';
import path from 'node:path';
const mod = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(mod ? path.join(mod, 'index.mjs') : 'playwright');
const [pageFile, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(pageFile, 'utf8');
if (!/^\s*<!doctype/i.test(html.slice(0, 200))) html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + html;

const browser = await chromium.launch();
const report = { same: [], small: [], errors: [], shots: 0 };
for (const width of [1280, 400]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => report.errors.push(`${width}: ${e.message}`));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const figs = await page.$$('.fig');
  for (let f = 0; f < figs.length; f++) {
    const fig = figs[f];
    const id = (await fig.evaluate(e => (e.closest('[id]') || {}).id)) || 'fig';
    const sig = () => fig.evaluate(e => [...e.querySelectorAll('svg, .words')].map(n => n.tagName === 'DIV' ? [...n.children].map(c => c.className).join() : n.innerHTML).join('|'));
    const seen = new Map();
    const shoot = async (name) => {
      await page.waitForTimeout(750);
      await fig.screenshot({ path: path.join(out, `${width}-${id}-${name}.png`) }); report.shots++;
      const s = await sig(); if (width === 1280) { if (seen.has(s)) report.same.push(`${id}: "${name}" looks the same as "${seen.get(s)}"`); else seen.set(s, name); }
    };
    await fig.scrollIntoViewIfNeeded(); await shoot('rest');
    for (const r of await fig.$$('input[type=radio]')) {
      const rid = await r.getAttribute('id'); if (await r.isChecked()) continue;
      await page.click(`label[for="${rid}"]`); await shoot(rid);
    }
    for (const c of await fig.$$('input[type=checkbox]')) {
      const cid = await c.getAttribute('id');
      await page.click(`label:has(#${cid})`); await shoot(`${cid}-off`); await page.click(`label:has(#${cid})`);
    }
  }
  for (const [s, scrolly] of (await page.$$('.scrolly')).entries()) {
    const beats = await scrolly.$$('.beat');
    for (let i = 0; i < beats.length; i++) {
      await beats[i].evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(800);
      const stick = await scrolly.$('.stick'); await stick.screenshot({ path: path.join(out, `${width}-scrolly${s}-beat${i}.png`) }); report.shots++;
    }
  }
  if (width === 400) report.small = await page.evaluate(() => [...document.querySelectorAll('svg text, svg tspan')].filter(t => !t.querySelector('tspan')).map(t => {
    const ctm = t.getScreenCTM(); const px = parseFloat(getComputedStyle(t).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    return { text: t.textContent.slice(0, 30), px: Math.round(px * 10) / 10 };
  }).filter(t => t.px < 12));
  if (width === 1280) report.words = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body; const words = el => (el.innerText || '').split(/\s+/).filter(Boolean).length;
    const folded = [...main.querySelectorAll('details.more')].reduce((n, d) => n + words(d) - words(d.querySelector('summary') || d), 0);
    const sections = [...main.querySelectorAll('section')].map(s => ({ id: s.id || '(no id)', prose: [...s.querySelectorAll(':scope > .prose p')].reduce((n, p) => n + words(p), 0) }));
    return { firstRead: words(main) - Math.max(0, folded), longProse: sections.filter(s => s.prose > 110) };
  });
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify(report, null, 2));
console.log(`shots: ${report.shots} in ${out}`);
console.log(`first read: ${report.words.firstRead} words` + (report.words.longProse.length ? `; prose over 110 words in: ${report.words.longProse.map(s => s.id + ' (' + s.prose + ')').join(', ')}` : ''));
console.log(`states that look the same: ${report.same.length}` + report.same.map(s => '\n  ' + s).join(''));
console.log(`svg text under 12px at 400 wide: ${report.small.length}` + report.small.slice(0, 5).map(s => `\n  ${s.px}px "${s.text}"`).join(''));
console.log(`script errors: ${report.errors.length}` + report.errors.map(s => '\n  ' + s).join(''));
