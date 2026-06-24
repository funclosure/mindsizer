export type StepCategory = "author" | "revise" | "render" | "finalize";

export interface PassTiming {
  pass: number;          // 1-based render pass
  modelMs: number;       // model time before this render (author for pass 1, revise after)
  renderMs: number;      // chromium render + screenshot
  overflowPx: number;    // from the render result — visibility into convergence
  consoleErrors: number;
}

export interface SlideTiming {
  totalMs: number;
  passes: PassTiming[];
  byCategory: Record<StepCategory, number>; // sums to totalMs
}

export type ProgressEvent =
  | { type: "slide_start"; at: number; index: number; total: number; id: string; title: string }
  | { type: "render_pass"; at: number; index: number; id: string; pass: number;
      modelMs: number; renderMs: number; overflowPx: number; consoleErrors: number }
  | { type: "slide_done"; at: number; index: number; id: string; html: string;
      timing: SlideTiming; warnings: string[] }
  | { type: "slide_failed"; at: number; index: number; id: string; reason: string }
  | { type: "slide_retry"; at: number; index: number; id: string; attempt: number; reason: string }
  | { type: "slide_reused"; at: number; index: number; id: string; html: string }
  | { type: "deck_done"; at: number; slides: number; totalMs: number;
      byCategory: Record<StepCategory, number> };

export interface ProgressSink {
  emit(e: ProgressEvent): void;
}

export const NOOP_SINK: ProgressSink = { emit() {} };

export const ZERO_TIMING: SlideTiming = {
  totalMs: 0,
  passes: [],
  byCategory: { author: 0, revise: 0, render: 0, finalize: 0 },
};

/** Derive the category breakdown from the render-call boundaries. Sums to totalMs. */
export function computeSlideTiming(
  startMs: number,
  passes: PassTiming[],
  endMs: number,
): SlideTiming {
  const totalMs = endMs - startMs;
  const render = passes.reduce((a, p) => a + p.renderMs, 0);
  const author = passes.length ? passes[0].modelMs : totalMs;
  const revise = passes.slice(1).reduce((a, p) => a + p.modelMs, 0);
  // Date.now() is wall-clock, not monotonic; a backward NTP step could make this negative.
  const finalize = Math.max(0, totalMs - author - revise - render);
  return { totalMs, passes, byCategory: { author, revise, render, finalize } };
}
