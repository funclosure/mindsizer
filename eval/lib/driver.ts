// eval/lib/driver.ts — headless-Chromium driver for scoring one slide in the harness's own frame.
// Slides are split out of the sealed deck with src/review/extract-deck.ts and rendered standalone at
// 1280×720 exactly like src/render/fit-check.ts renders them while authoring; the harness gate
// numbers (overflow, console errors) come from fit-check's playwrightRenderer itself.
import { chromium, type Browser, type Page } from "playwright";
import { extractSlides, type DeckSlide } from "../../src/review/extract-deck";
import { playwrightRenderer, type SlideRenderer } from "../../src/render/fit-check";
import { DECK_CSS } from "../../src/export/deck-runtime";
import type { TextBox, RGBA } from "./craft";
import type { DriveAction, DriveOutcome } from "./judge";

declare const document: any;
declare const window: any;
declare const getComputedStyle: any;
declare const Image: any;
declare const CSS: any;

const W = 1280;
const H = 720;

export interface DeckParts { themeCss: string; title: string; slides: DeckSlide[] }

/** Split a sealed deck into its theme CSS (deck chrome removed) and per-slide fragments. */
export function deckParts(deckHtml: string): DeckParts {
  const head = deckHtml.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const css = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const themeCss = css.replace(DECK_CSS, "");
  const title = head.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  return { themeCss, title, slides: extractSlides(deckHtml) };
}

/** Same page shell as fit-check.ts's pageHtml (not exported there), plus an eval-only freeze hook. */
export function slidePage(themeCss: string, fragment: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;}
    .stage{width:${W}px;height:${H}px;}
    .stage > section[data-slide-id]{width:${W}px;height:${H}px;aspect-ratio:auto;}
    ${themeCss}
  </style></head><body><div class="stage">${fragment}</div></body></html>`;
}

export interface Control { selector: string; tag: string; kind: string; label: string; box: [number, number, number, number] }

export interface RestCapture {
  png: Buffer;
  boxes: TextBox[];
  controls: Control[];
  text: string;            // the section's innerText (exact on-screen wording, for fidelity)
  gate: { overflowPx: number; consoleErrors: string[] };
}

const HIDE_TEXT_CSS = `*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important;}
svg text, svg tspan{fill:transparent!important;stroke:transparent!important;}
input::placeholder{color:transparent!important;}`;

export class SlideDriver {
  private browserP: Promise<Browser> | null = null;
  private gateRenderer: SlideRenderer;
  constructor(private themeCss: string) {
    this.gateRenderer = playwrightRenderer(themeCss);
  }

  private browser(): Promise<Browser> {
    if (!this.browserP) this.browserP = chromium.launch();
    return this.browserP;
  }

  private async open(fragment: string): Promise<{ page: Page; errors: string[] }> {
    const b = await this.browser();
    const page = await b.newPage({ viewport: { width: W, height: H } });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(slidePage(this.themeCss, fragment), { waitUntil: "networkidle" });
    await page.waitForTimeout(400); // let entrance transitions settle
    return { page, errors };
  }

  /** Resting screenshot + text boxes (with sampled backgrounds) + control inventory + gate numbers. */
  async rest(fragment: string): Promise<RestCapture> {
    const gate = await this.gateRenderer.render(fragment);
    const { page } = await this.open(fragment);
    try {
      const png = await page.screenshot({ type: "png" });
      const raw = await page.evaluate(collectBoxesInPage);
      const controls = (await page.evaluate(collectControlsInPage)) as Control[];
      const text = (await page.evaluate(() => document.querySelector("section[data-slide-id]")?.innerText ?? "")) as string;
      await page.addStyleTag({ content: HIDE_TEXT_CSS });
      await page.waitForTimeout(50);
      const bgPng = await page.screenshot({ type: "png" });
      const bgs = await sampleBackgrounds(page, bgPng, raw);
      const boxes: TextBox[] = raw.map((b: any, i: number) => ({ ...b, bg: bgs[i] }));
      return { png, boxes, controls, text, gate: { overflowPx: gate.overflowPx, consoleErrors: gate.consoleErrors } };
    } finally {
      await page.close();
    }
  }

  /** Replay `actions` from the resting state; one screenshot after each action. */
  async drive(fragment: string, actions: DriveAction[]): Promise<DriveOutcome> {
    const { page, errors } = await this.open(fragment);
    const shots: Buffer[] = [];
    const notes: string[] = [];
    try {
      for (const [i, a] of actions.entries()) {
        try {
          if ("click" in a) await page.click(a.click, { timeout: 2000 });
          else if ("clickAt" in a) await page.mouse.click(a.clickAt[0], a.clickAt[1]);
          else if ("press" in a) await page.keyboard.press(a.press);
          else if ("drag" in a) {
            const { from, to, steps } = a.drag;
            await page.mouse.move(from[0], from[1]);
            await page.mouse.down();
            await page.mouse.move(to[0], to[1], { steps: steps ?? 12 });
            await page.mouse.up();
          } else if ("hold" in a) {
            await page.mouse.move(a.hold.at[0], a.hold.at[1]);
            await page.mouse.down();
            await page.waitForTimeout(Math.min(a.hold.ms, 8000));
            shots.push(await page.screenshot({ type: "png" })); // the held state, before release
            await page.mouse.up();
          } else if ("hover" in a) await page.mouse.move(a.hover[0], a.hover[1]);
          else if ("type" in a) await page.keyboard.type(a.type, { delay: 20 });
          else if ("wait" in a) await page.waitForTimeout(Math.min(a.wait, 4000));
          notes.push(`step ${i + 1} ${JSON.stringify(a)}: ok`);
        } catch (e) {
          notes.push(`step ${i + 1} ${JSON.stringify(a)}: FAILED — ${(e as Error).message.split("\n")[0]}`);
        }
        if (!("wait" in a)) await page.waitForTimeout(350);
        shots.push(await page.screenshot({ type: "png" }));
      }
      if (errors.length) notes.push(`console errors: ${errors.slice(0, 3).join(" | ")}`);
      return { shots, notes };
    } finally {
      await page.close();
    }
  }

  async dispose(): Promise<void> {
    await this.gateRenderer.dispose();
    if (this.browserP) { const b = await this.browserP; this.browserP = null; await b.close(); }
  }
}

/** A labelled 2×N grid of PNGs (for coherence contact sheets), rendered in Chromium. */
export async function contactSheet(pngs: Buffer[], labels: string[], cols = 3): Promise<Buffer> {
  const b = await chromium.launch();
  try {
    const cellW = 426;
    const cellH = 240;
    const rows = Math.ceil(pngs.length / cols);
    const page = await b.newPage({ viewport: { width: cols * cellW + (cols + 1) * 8, height: rows * (cellH + 22) + (rows + 1) * 8 } });
    const cells = pngs.map((p, i) => `<figure><img src="data:image/png;base64,${p.toString("base64")}"><figcaption>${labels[i] ?? ""}</figcaption></figure>`).join("");
    await page.setContent(`<html><body style="margin:0;padding:8px;background:#777;display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;font:12px monospace">
      <style>figure{margin:0}img{width:${cellW}px;height:${cellH}px;display:block}figcaption{height:22px;color:#fff;line-height:22px}</style>${cells}</body></html>`);
    return await page.screenshot({ type: "png", fullPage: true });
  } finally {
    await b.close();
  }
}

// ——— in-page collectors (serialized into the browser; keep them self-contained) ———

function collectBoxesInPage(): any[] {
  const section = document.querySelector("section[data-slide-id]");
  if (!section) return [];
  const ids = new Map<any, number>();
  const out: any[] = [];
  const all = [section, ...Array.from(section.querySelectorAll("*"))] as any[];
  const parseRgba = (s: string) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 1 };
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const opacityChain = (el: any) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity || "1");
    return o;
  };
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style") continue;
    const textNodes = Array.from(el.childNodes).filter((n: any) => n.nodeType === 3 && n.textContent.trim()) as any[];
    if (!textNodes.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const op = opacityChain(el);
    if (op < 0.05) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of textNodes) {
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const rc of Array.from(r.getClientRects()) as any[]) {
        if (rc.width < 1 || rc.height < 1) continue;
        x0 = Math.min(x0, rc.left); y0 = Math.min(y0, rc.top); x1 = Math.max(x1, rc.right); y1 = Math.max(y1, rc.bottom);
      }
    }
    if (!Number.isFinite(x0)) continue;
    // Clip by ancestors that hide overflow (below the section — clipping BY the section frame is
    // exactly the "text outside the frame" defect, so it is not applied) and skip sr-only/clipped text.
    let hidden = false;
    for (let p = el; p && p !== section; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if ((ps.clipPath && ps.clipPath !== "none") || (ps.clip && ps.clip !== "auto")) { hidden = true; break; }
      if (p !== el && (ps.overflowX !== "visible" || ps.overflowY !== "visible")) {
        const r = p.getBoundingClientRect();
        x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom);
      }
    }
    if (hidden || x1 - x0 < 2 || y1 - y0 < 2) continue;
    const id = ids.size;
    ids.set(el, id);
    const ancestors: number[] = [];
    for (let p = el.parentElement; p; p = p.parentElement) if (ids.has(p)) ancestors.push(ids.get(p)!);
    const isSvgText = el.namespaceURI === "http://www.w3.org/2000/svg";
    const c = parseRgba(isSvgText && cs.fill && cs.fill.startsWith("rgb") ? cs.fill : cs.color);
    c.a *= op;
    const fontPx = parseFloat(cs.fontSize) || 16;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    out.push({
      id, ancestors,
      x: x0, y: y0, w: x1 - x0, h: y1 - y0,
      text: textNodes.map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim().slice(0, 60),
      color: c, fontPx, bold,
    });
  }
  return out;
}

function collectControlsInPage(): any[] {
  const section = document.querySelector("section[data-slide-id]");
  if (!section) return [];
  const sel = "button,input,select,textarea,a[href],[role=button],[role=slider],[role=tab],[role=switch],[role=checkbox],[role=radio],[tabindex],[onclick],[draggable=true],[data-action],[data-step],[data-value]";
  const cursors = new Set(["pointer", "grab", "grabbing", "ew-resize", "ns-resize", "col-resize", "row-resize", "move", "crosshair"]);
  const pathOf = (el: any): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    for (let e = el; e && e !== section; e = e.parentElement) {
      if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      const tag = e.tagName.toLowerCase();
      const sib = Array.from(e.parentElement?.children ?? []).filter((s: any) => s.tagName === e.tagName);
      parts.unshift(sib.length > 1 ? `${tag}:nth-of-type(${sib.indexOf(e) + 1})` : tag);
    }
    return parts[0]?.startsWith("#") ? parts.join(" > ") : `section[data-slide-id] > ${parts.join(" > ")}`;
  };
  const seen = new Set<any>();
  const out: any[] = [];
  for (const el of Array.from(section.querySelectorAll("*")) as any[]) {
    const cs = getComputedStyle(el);
    const interactive = el.matches(sel) || (cursors.has(cs.cursor) && !(el.parentElement && cursors.has(getComputedStyle(el.parentElement).cursor)));
    if (!interactive || seen.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || cs.visibility === "hidden" || cs.display === "none") continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    const kind = el.getAttribute("role") || (tag === "input" ? `input[${el.type}]` : tag === "button" ? "button" : cs.cursor !== "auto" ? `cursor:${cs.cursor}` : tag);
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 50);
    out.push({ selector: pathOf(el), tag, kind, label, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    if (out.length >= 40) break;
  }
  return out;
}

/** Sample the text-hidden screenshot under each box → median opaque background color. */
async function sampleBackgrounds(page: Page, bgPng: Buffer, boxes: any[]): Promise<(RGBA | undefined)[]> {
  if (!boxes.length) return [];
  // Runs in the slide page itself (after every capture is taken); the canvas is never attached.
  {
    return await page.evaluate(async ({ src, boxes }: { src: string; boxes: any[] }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      return boxes.map((b) => {
        const pts: number[][] = [];
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
          const x = Math.round(b.x + (b.w * (i + 0.5)) / 5);
          const y = Math.round(b.y + (b.h * (j + 0.5)) / 5);
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          const k = (y * c.width + x) * 4;
          pts.push([data[k], data[k + 1], data[k + 2]]);
        }
        if (!pts.length) return undefined;
        pts.sort((p, q) => (p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11) - (q[0] * 0.3 + q[1] * 0.59 + q[2] * 0.11));
        const m = pts[Math.floor(pts.length / 2)];
        return { r: m[0], g: m[1], b: m[2], a: 1 };
      });
    }, { src: `data:image/png;base64,${bgPng.toString("base64")}`, boxes });
  }
}
