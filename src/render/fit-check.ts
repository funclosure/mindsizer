// src/render/fit-check.ts
import { chromium, type Browser } from "playwright";
import { computeOverflow } from "./render-helpers";

// `document` exists only inside page.evaluate() (browser context); typed loosely on purpose.
declare const document: any;

export interface FitResult {
  fits: boolean;
  overflowPx: number;
  detail: string;
  png?: Buffer;
}

/** One scripted interaction the agent can request between screenshots. */
export interface Interaction {
  click?: string; // CSS selector to click
  press?: string; // keyboard key to press
  wait?: number;  // ms to wait
}

export interface RenderResult {
  shots: Buffer[];        // resting frame first, then one PNG after each interaction
  overflowPx: number;
  fits: boolean;
  consoleErrors: string[];
}

export interface SlideRenderer {
  render(html: string, interactions?: Interaction[]): Promise<RenderResult>;
  check(sectionHtml: string): Promise<FitResult>; // resting-frame fit-check (shell uses this)
  dispose(): Promise<void>;
}

// Back-compat alias for the resting-frame interface used by older call sites.
export type FitChecker = SlideRenderer;

const W = 1280;
const H = 720;

function pageHtml(themeCss: string, sectionHtml: string): string {
  return `<!DOCTYPE html><html><head><style>
    html,body{margin:0;}
    .stage{width:${W}px;height:${H}px;}
    .stage > section[data-slide-id]{width:${W}px;height:${H}px;aspect-ratio:auto;}
    ${themeCss}
  </style></head><body><div class="stage">${sectionHtml}</div></body></html>`;
}

/** Headless-chromium renderer: 16:9 frame, optional scripted interactions, overflow + console capture. */
export function playwrightRenderer(themeCss: string): SlideRenderer {
  let browserP: Promise<Browser> | null = null;
  function getBrowser(): Promise<Browser> {
    if (!browserP) browserP = chromium.launch();
    return browserP;
  }

  async function render(html: string, interactions: Interaction[] = []): Promise<RenderResult> {
    const b = await getBrowser();
    const page = await b.newPage({ viewport: { width: W, height: H } });
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    try {
      await page.setContent(pageHtml(themeCss, html), { waitUntil: "networkidle" });
      const shots: Buffer[] = [await page.screenshot({ type: "png" })];
      for (const step of interactions) {
        if (step.click) await page.click(step.click, { timeout: 2000 }).catch(() => {});
        if (step.press) await page.keyboard.press(step.press).catch(() => {});
        if (step.wait) await page.waitForTimeout(step.wait);
        shots.push(await page.screenshot({ type: "png" }));
      }
      const m = await page.evaluate(() => {
        const s = document.querySelector("section[data-slide-id]");
        if (!s) return null;
        return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
      });
      const overflowPx = m ? computeOverflow(m) : 0;
      return { shots, overflowPx, fits: overflowPx <= 2, consoleErrors };
    } finally {
      await page.close();
    }
  }

  return {
    render,
    async check(sectionHtml: string): Promise<FitResult> {
      const r = await render(sectionHtml);
      return {
        fits: r.fits,
        overflowPx: r.overflowPx,
        detail: r.fits ? "fits the 16:9 frame" : `content overflows the 16:9 frame by ${r.overflowPx}px`,
        png: r.shots[0],
      };
    },
    async dispose(): Promise<void> {
      if (browserP) { const b = browserP; browserP = null; await (await b).close(); }
    },
  };
}

/** @deprecated use playwrightRenderer */
export const playwrightFitChecker = playwrightRenderer;

export interface DeckCheck {
  sectionCount: number;
  consoleErrors: string[];
  looseText: string[]; // non-whitespace text nodes that are direct children of .deck (prose leak)
}

/** Load a sealed deck once headless and report structural problems for the whole-deck gate. */
export async function verifyDeck(html: string): Promise<DeckCheck> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.setContent(html, { waitUntil: "networkidle" });
    const data = await page.evaluate(() => {
      const deck = document.querySelector(".deck");
      const sectionCount = document.querySelectorAll(".deck section[data-slide-id]").length;
      const looseText: string[] = [];
      if (deck) {
        for (const n of Array.from(deck.childNodes) as any[]) {
          if (n.nodeType === 3 && n.textContent && n.textContent.trim()) {
            looseText.push(String(n.textContent).trim().slice(0, 80));
          }
        }
      }
      return { sectionCount, looseText };
    });
    return { sectionCount: data.sectionCount, consoleErrors, looseText: data.looseText };
  } finally {
    await browser.close();
  }
}
