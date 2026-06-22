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
