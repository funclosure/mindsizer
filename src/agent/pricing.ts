import type { TokenUsage } from "./usage";

export interface Rate { input: number; output: number; cacheRead: number; cacheCreate: number; } // $/M tokens

const DEFAULTS: Record<"opus" | "sonnet" | "haiku", Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1.0 },
};

type Family = keyof typeof DEFAULTS;
function family(model: string): Family {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
  return "opus";
}

function rateFor(model: string, env: Record<string, string | undefined>): Rate {
  const f = family(model);
  const o = env[`MINDSIZER_PRICE_${f.toUpperCase()}`];
  if (o) {
    const p = o.split(",").map(Number);
    if (p.length === 4 && p.every((x) => Number.isFinite(x))) {
      return { input: p[0], output: p[1], cacheRead: p[2], cacheCreate: p[3] };
    }
  }
  return DEFAULTS[f];
}

/** API-equivalent USD cost of a usage at a model's rates ($/M, env-overridable). */
export function costUsd(u: TokenUsage, model: string, env: Record<string, string | undefined> = process.env): number {
  const r = rateFor(model, env);
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheCreate * r.cacheCreate) / 1_000_000;
}

/** "$31.39" when ≥ $1, else "$0.180". */
export function fmtUsd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}
