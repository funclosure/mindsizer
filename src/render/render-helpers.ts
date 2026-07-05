export interface FrameMetrics {
  sh: number; // scrollHeight
  ch: number; // clientHeight
  sw: number; // scrollWidth
  cw: number; // clientWidth
}

/** Largest overflow (px) past the 16:9 frame; 0 if content fits. */
export function computeOverflow(m: FrameMetrics): number {
  return Math.max(0, m.sh - m.ch, m.sw - m.cw);
}

/** Overflow past the 2px tolerance is a real fit problem. Single source of truth. */
export const OVERFLOW_TOLERANCE_PX = 2;

/** Horizontal overflow (px) past the frame; 0 if it fits. */
export function horizontalOverflow(m: FrameMetrics): number {
  return Math.max(0, m.sw - m.cw);
}

export interface OverflowInput {
  resting: FrameMetrics;          // metrics BEFORE any interaction
  expandedHoriz: number[];        // per-interaction horizontal overflow (sw-cw)
  expandedBeyondFrame: number[];  // per-interaction vertical growth past the 720 frame (sh-H)
}
export interface OverflowResult {
  overflowPx: number;
  axis: "resting" | "expanded-horizontal" | "expanded-vertical" | "none";
  detail: string;
}

/**
 * Resolve a slide's authoritative overflow. The RESTING frame is graded normally; an interaction's
 * expanded state only counts if it spills horizontally or grows the section BEYOND the frame — a
 * within-frame transient (an accordion that opens but stays inside 720px) is ignored, so we stop
 * chasing phantom overflow, while a genuinely broken reveal that blows past the frame is still caught.
 */
export function resolveOverflow(inp: OverflowInput): OverflowResult {
  const restingPx = computeOverflow(inp.resting);
  const eh = Math.max(0, ...inp.expandedHoriz, 0);
  const ev = Math.max(0, ...inp.expandedBeyondFrame, 0);
  const overflowPx = Math.max(restingPx, eh, ev);
  if (overflowPx <= 0) return { overflowPx: 0, axis: "none", detail: "fits the 16:9 frame" };
  const axis = restingPx === overflowPx ? "resting"
    : eh === overflowPx ? "expanded-horizontal"
    : "expanded-vertical";
  const where = axis === "resting" ? "at rest"
    : axis === "expanded-horizontal" ? "when an interaction spills horizontally"
    : "when an interaction expands past the frame";
  return { overflowPx, axis, detail: `content overflows the 16:9 frame by ${overflowPx}px ${where}` };
}
