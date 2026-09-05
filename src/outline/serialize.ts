import matter from "gray-matter";
import * as yaml from "js-yaml";
import type { Outline } from "./types";

/** Serialize the canonical Outline model back to Marp-style outline.md (plan.md when plans are present). */
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
      if (s.plan) {
        // lineWidth -1: never fold long strings, so parse(serialize(x)) is byte-stable
        const y = yaml.dump(s.plan, { lineWidth: -1, noRefs: true }).trimEnd();
        parts.push("", "```plan", y, "```");
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  // matter.stringify YAML-escapes values (e.g. a title containing a colon),
  // keeping parse and serialize symmetric.
  const src = o.meta.source;
  return matter.stringify(`\n${body}\n`, {
    title: o.meta.title,
    purpose: o.meta.purpose,
    theme: o.meta.theme,
    ...(src && {
      source: {
        ...(src.label && { label: src.label }),
        ...(src.url && { url: src.url }),
      },
    }),
    ...(o.meta.direction && { direction: { ...o.meta.direction } }),
  });
}
