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

/** Parse a Marp-style outline.md into the canonical Outline model. */
export function parseOutline(md: string): Outline {
  const { data, content } = matter(md);
  const meta: DeckMeta = {
    title: String(data.title ?? ""),
    purpose: "teach",
    theme: String(data.theme ?? "field"),
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
