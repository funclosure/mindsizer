import matter from "gray-matter";
import type { Outline } from "./types";

/** Serialize the canonical Outline model back to Marp-style outline.md. */
export function serializeOutline(o: Outline): string {
  const body = o.slides
    .map((s) => {
      // Omit `layout=` for the bespoke/absent case to preserve author intent;
      // parseOutline defaults a missing layout back to "bespoke".
      const layoutAttr =
        s.layout && s.layout !== "bespoke" ? ` layout=${s.layout}` : "";
      const head = `<!-- slide id=${s.id}${layoutAttr} -->`;
      const parts = [head, `# ${s.title}`];
      if (s.markdown.trim().length > 0) {
        parts.push("", s.markdown.trim());
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  // matter.stringify YAML-escapes values (e.g. a title containing a colon),
  // keeping parse and serialize symmetric.
  return matter.stringify(`\n${body}\n`, {
    title: o.meta.title,
    purpose: o.meta.purpose,
    theme: o.meta.theme,
  });
}
