import { parse } from "node-html-parser";

export const MIN_SLIDE_CHARS = 60;
export const PROBE_MARKERS = /\bPROBE\b|JS RAN|if this box|FLEX \d|LEFT\s+RIGHT|lorem ipsum/i;
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
