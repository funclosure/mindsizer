import matter from "gray-matter";
import type { DeckMeta, Outline, OutlineSlide } from "./types";

const SLIDE_META_RE = /<!--\s*slide\s+([^>]*?)\s*-->/;
const HEADING_RE = /^#\s+(.+?)\s*$/m;

/** Parse `key=value` / `key="quoted value"` attribute pairs. */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)=("([^"]*)"|(\S+))/g)) {
    out[m[1]] = m[3] ?? m[4];
  }
  return out;
}

/** Normalize the frontmatter `source` value: `url` string shorthand or {label, url} object. */
function parseSource(raw: unknown): DeckMeta["source"] {
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { url } : undefined;
  }
  if (raw && typeof raw === "object") {
    const pick = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const label = pick((raw as Record<string, unknown>).label);
    const url = pick((raw as Record<string, unknown>).url);
    if (label || url) return { ...(label && { label }), ...(url && { url }) };
  }
  return undefined;
}

/** Parse a Marp-style outline.md into the canonical Outline model. */
export function parseOutline(md: string): Outline {
  const { data, content } = matter(md);
  const source = parseSource(data.source);
  const meta: DeckMeta = {
    title: String(data.title ?? ""),
    purpose: "teach",
    theme: String(data.theme ?? "field"),
    ...(source && { source }),
  };

  // gray-matter has stripped the leading frontmatter, so remaining
  // `---` lines are slide separators — but only when immediately followed
  // by a slide comment. A `---` thematic break inside a body is preserved.
  const blocks = content
    .split(/\n[ \t]*-{3,}[ \t]*\n(?=\s*<!--\s*slide\b)/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const slides: OutlineSlide[] = blocks.map((block) => {
    const metaMatch = block.match(SLIDE_META_RE);
    const attrs = metaMatch ? parseAttrs(metaMatch[1]) : {};
    const id = attrs.id ?? "";
    const layout = attrs.layout ?? "bespoke";

    const afterMeta = metaMatch
      ? block.slice(metaMatch.index! + metaMatch[0].length)
      : block;

    const headingMatch = afterMeta.match(HEADING_RE);
    const title = headingMatch ? headingMatch[1].trim() : "";
    const body = headingMatch
      ? afterMeta.slice(headingMatch.index! + headingMatch[0].length)
      : afterMeta;

    return { id, layout, title, markdown: body.trim() };
  });

  return { meta, slides };
}
