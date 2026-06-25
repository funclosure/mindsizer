import { parse } from "node-html-parser";

export const MIN_SLIDE_CHARS = 60;
// Case-SENSITIVE on purpose: real debug scaffolds shout in caps (PROBE / JS RAN / FLEX 1 /
// LEFT…RIGHT boxes), so this won't false-flag legitimate prose about "space probes", a "flex 1"
// CSS tip, or "scan left, right". The lowercase placeholder phrases are matched as-is.
export const PROBE_MARKERS = /\bPROBE\b|JS RAN|\bFLEX \d|LEFT\s+RIGHT|if this box is|lorem ipsum/;
export const CONTENT_DUD = "content-dud:";

/** The slide's visible text — tags stripped, <script>/<style> removed, whitespace collapsed. */
export function slideText(html: string): string {
  const root = parse(html);
  root.querySelectorAll("script, style").forEach((n) => n.remove());
  return root.text.replace(/\s+/g, " ").trim();
}

/** A reason string if the slide is an obvious dud (too short / probe scaffold), else null. */
export function heuristicDud(html: string): string | null {
  const t = slideText(html);
  if (t.length < MIN_SLIDE_CHARS) return `only ${t.length} chars of content`;
  if (PROBE_MARKERS.test(t)) return "looks like a debug/probe scaffold";
  return null;
}
