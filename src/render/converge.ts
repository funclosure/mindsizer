// src/render/converge.ts
export interface Candidate {
  html: string;       // the HTML the model passed to the render tool this pass
  overflowPx: number;
  consoleErrors: number;
}

/** Hard backstop on render passes per slide (the convergence nudge usually exits sooner). */
export const RENDER_PASS_CAP = 4;

/** A render with no overflow (≤2px tolerance) and no console errors is fit-complete. */
export function isCleanCandidate(c: Candidate): boolean {
  return c.overflowPx <= 2 && c.consoleErrors === 0;
}

/**
 * The pass to seal: fewest console errors, then least overflow; first-seen wins ties — so an
 * earlier clean pass beats a later regression. undefined if the model never rendered.
 */
export function pickBestCandidate(cands: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of cands) {
    if (
      !best ||
      c.consoleErrors < best.consoleErrors ||
      (c.consoleErrors === best.consoleErrors && c.overflowPx < best.overflowPx)
    ) {
      best = c;
    }
  }
  return best;
}
