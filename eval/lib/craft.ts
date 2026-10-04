// eval/lib/craft.ts — deterministic craft checks (pure; the browser only supplies raw boxes/colors).

export interface RGBA { r: number; g: number; b: number; a: number }
export interface Box { x: number; y: number; w: number; h: number }

/** One visible run of text in the rendered slide. `bg` is sampled from a text-hidden screenshot. */
export interface TextBox extends Box {
  id: number;            // element index (stable within one capture)
  ancestors: number[];   // element indexes of text-bearing ancestors (overlap ignores nesting)
  text: string;          // first ~60 chars
  color: RGBA;           // computed text color (alpha × opacity folded in)
  bg?: RGBA;             // effective background behind the box (opaque), if sampled
  fontPx: number;
  bold: boolean;
}

export const FRAME = { w: 1280, h: 720 };

/** Parse `rgb(…)`, `rgba(…)`, `#rgb`, `#rrggbb`, `#rrggbbaa`, CSS4 `rgb(r g b / a)`. undefined if unknown. */
export function parseColor(s: string): RGBA | undefined {
  const t = s.trim().toLowerCase();
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = h.split("").map((c) => parseInt(c + c, 16));
      return { r: v[0], g: v[1], b: v[2], a: h.length === 4 ? v[3] / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return { r: v[0], g: v[1], b: v[2], a: h.length === 8 ? v[3] / 255 : 1 };
    }
    return undefined;
  }
  m = t.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return undefined;
    const num = (p: string, max: number) => (p.endsWith("%") ? (parseFloat(p) / 100) * max : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    const a = parts[3] !== undefined ? num(parts[3], 1) : 1;
    if ([r, g, b, a].some((x) => !Number.isFinite(x))) return undefined;
    return { r, g, b, a };
  }
  return undefined;
}

/** Alpha-composite `fg` over an opaque `bg`. */
export function blend(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** WCAG 2.x relative luminance of an sRGB color (alpha ignored). */
export function luminance(c: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio (1–21). `fg` may be translucent; it is composited over the opaque `bg`. */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const f = fg.a < 1 ? blend(fg, bg) : fg;
  const l1 = luminance(f);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG "large text": ≥ 24px, or ≥ 18.66px (14pt) bold. */
export function isLargeText(fontPx: number, bold: boolean): boolean {
  return fontPx >= 24 || (bold && fontPx >= 18.66);
}

/** AA threshold for this text: 3:1 large, 4.5:1 otherwise. */
export function aaThreshold(fontPx: number, bold: boolean): number {
  return isLargeText(fontPx, bold) ? 3 : 4.5;
}

export function intersectArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface Overlap { a: string; b: string; areaPx: number; frac: number }

/**
 * Text boxes from DIFFERENT, non-nested elements that collide. A pair counts when the
 * intersection is ≥ `minFrac` of the smaller box and ≥ `minArea` px² (ignores hairline kerning
 * touches and descender/ascender grazes).
 */
export function findOverlaps(boxes: TextBox[], minFrac = 0.15, minArea = 40): Overlap[] {
  const out: Overlap[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.id === b.id || a.ancestors.includes(b.id) || b.ancestors.includes(a.id)) continue;
      const area = intersectArea(a, b);
      if (area < minArea) continue;
      const frac = area / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
      if (frac >= minFrac) out.push({ a: a.text, b: b.text, areaPx: Math.round(area), frac: Math.round(frac * 100) / 100 });
    }
  }
  return out;
}

/** Text boxes that extend past the 1280×720 frame by more than `tolPx`. */
export function outsideFrame(boxes: TextBox[], tolPx = 2): { text: string; px: number }[] {
  const out: { text: string; px: number }[] = [];
  for (const b of boxes) {
    const px = Math.max(-b.x, -b.y, b.x + b.w - FRAME.w, b.y + b.h - FRAME.h);
    if (px > tolPx) out.push({ text: b.text, px: Math.round(px) });
  }
  return out;
}

export interface ContrastFail { text: string; ratio: number; need: number; fontPx: number }

/** Per-box WCAG AA contrast; boxes without a sampled background are skipped. */
export function contrastFailures(boxes: TextBox[]): { fails: ContrastFail[]; checked: number; minRatio: number | null } {
  const fails: ContrastFail[] = [];
  let checked = 0;
  let minRatio: number | null = null;
  for (const b of boxes) {
    if (!b.bg) continue;
    checked++;
    const ratio = Math.round(contrastRatio(b.color, b.bg) * 100) / 100;
    minRatio = minRatio === null ? ratio : Math.min(minRatio, ratio);
    const need = aaThreshold(b.fontPx, b.bold);
    if (ratio < need) fails.push({ text: b.text, ratio, need, fontPx: Math.round(b.fontPx) });
  }
  return { fails, checked, minRatio };
}

export interface CraftMetrics {
  overflowPx: number;
  consoleErrors: string[];
  textBoxes: number;
  overlaps: Overlap[];
  outsideFrame: { text: string; px: number }[];
  contrast: { checked: number; minRatio: number | null; fails: ContrastFail[] };
}

export function computeCraft(boxes: TextBox[], overflowPx: number, consoleErrors: string[]): CraftMetrics {
  return {
    overflowPx,
    consoleErrors,
    textBoxes: boxes.length,
    overlaps: findOverlaps(boxes),
    outsideFrame: outsideFrame(boxes),
    contrast: contrastFailures(boxes),
  };
}

/**
 * Deterministic craft cap: hard defects bound the judged craft score no matter how the judge
 * feels about hierarchy. overflow/console errors/out-of-frame text → max 2; overlapping text or
 * ≥ 3 AA contrast failures → max 3 (one or two dim captions is a style choice, not a defect).
 */
export function craftCap(m: CraftMetrics): { cap: number; reasons: string[] } {
  const reasons: string[] = [];
  let cap = 4;
  if (m.overflowPx > 2) { cap = Math.min(cap, 2); reasons.push(`overflow ${m.overflowPx}px`); }
  if (m.consoleErrors.length) { cap = Math.min(cap, 2); reasons.push(`${m.consoleErrors.length} console error(s)`); }
  if (m.outsideFrame.length) { cap = Math.min(cap, 2); reasons.push(`${m.outsideFrame.length} text box(es) outside frame`); }
  if (m.overlaps.length) { cap = Math.min(cap, 3); reasons.push(`${m.overlaps.length} overlapping text pair(s)`); }
  if (m.contrast.fails.length >= 3) { cap = Math.min(cap, 3); reasons.push(`${m.contrast.fails.length} AA contrast failures`); }
  return { cap, reasons };
}
