import type { Outline } from "./types";

/** Serialize the canonical Outline model back to Marp-style outline.md. */
export function serializeOutline(o: Outline): string {
  const frontmatter = [
    "---",
    `title: ${o.meta.title}`,
    `purpose: ${o.meta.purpose}`,
    `theme: ${o.meta.theme}`,
    "---",
  ].join("\n");

  const body = o.slides
    .map((s) => {
      const layoutAttr = s.layout ? ` layout=${s.layout}` : "";
      const head = `<!-- slide id=${s.id}${layoutAttr} -->`;
      const parts = [head, `# ${s.title}`];
      if (s.markdown.trim().length > 0) {
        parts.push("", s.markdown.trim());
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `${frontmatter}\n\n${body}\n`;
}
