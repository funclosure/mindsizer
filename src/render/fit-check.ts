import { chromium, type Browser } from "playwright";

// `document` exists only inside the page.evaluate() callback (browser context).
// Declared module-locally so we don't need the DOM lib repo-wide.
declare const document: { querySelector(selector: string): null | Record<string, number> };

export interface FitResult {
  fits: boolean;
  overflowPx: number;
  detail: string;
}

export interface FitChecker {
  check(sectionHtml: string): Promise<FitResult>;
  dispose(): Promise<void>;
}

const W = 1280;
const H = 720;

/** Headless-chromium fit checker: renders a <section> at 16:9 and measures overflow. */
export function playwrightFitChecker(themeCss: string): FitChecker {
  let browser: Browser | null = null;
  async function getBrowser(): Promise<Browser> {
    if (!browser) browser = await chromium.launch();
    return browser;
  }
  return {
    async check(sectionHtml: string): Promise<FitResult> {
      const b = await getBrowser();
      const page = await b.newPage({ viewport: { width: W, height: H } });
      try {
        await page.setContent(
          `<!DOCTYPE html><html><head><style>
            html,body{margin:0;}
            .stage{width:${W}px;height:${H}px;}
            .stage > section[data-slide-id]{width:${W}px;height:${H}px;aspect-ratio:auto;}
            ${themeCss}
          </style></head><body><div class="stage">${sectionHtml}</div></body></html>`,
          { waitUntil: "networkidle" },
        );
        const m = await page.evaluate(() => {
          const s = document.querySelector("section[data-slide-id]");
          if (!s) return null;
          return { sh: s.scrollHeight, ch: s.clientHeight, sw: s.scrollWidth, cw: s.clientWidth };
        });
        if (!m) return { fits: false, overflowPx: 0, detail: "no <section data-slide-id> found" };
        const overflowPx = Math.max(0, m.sh - m.ch, m.sw - m.cw);
        return {
          fits: overflowPx <= 2,
          overflowPx,
          detail:
            overflowPx <= 2
              ? "fits the 16:9 frame"
              : `content overflows the 16:9 frame by ${overflowPx}px`,
        };
      } finally {
        await page.close();
      }
    },
    async dispose(): Promise<void> {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
