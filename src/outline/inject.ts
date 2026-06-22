import { parse as parseHtml } from "node-html-parser";

/** Read every data-bind region's inner HTML, keyed by slot name. */
export function readBoundRegions(html: string): Record<string, string> {
  const root = parseHtml(html);
  const out: Record<string, string> = {};
  for (const el of root.querySelectorAll("[data-bind]")) {
    const slot = el.getAttribute("data-bind");
    if (slot) out[slot] = el.innerHTML;
  }
  return out;
}

/**
 * Replace the inner content of named data-bind regions only.
 * Slots absent from `bindings` are left untouched; non-bound design
 * (classes, structure, other elements) is preserved.
 *
 * Binding values are treated as inner HTML and are NOT escaped — callers
 * pass HTML, not raw untrusted text.
 */
export function updateBoundRegions(
  html: string,
  bindings: Record<string, string>,
): string {
  const root = parseHtml(html);
  for (const el of root.querySelectorAll("[data-bind]")) {
    const slot = el.getAttribute("data-bind");
    if (slot && slot in bindings) {
      el.set_content(bindings[slot]);
    }
  }
  return root.toString();
}

export interface SlideSectionIssue {
  message: string;
}

/** Validate a slide fragment: exactly one section with the expected id; optional scoped <script>. */
export function validateSlideSection(
  html: string,
  expectedId: string,
): SlideSectionIssue[] {
  const root = parseHtml(html);
  const sections = root.querySelectorAll("section[data-slide-id]");
  if (sections.length !== 1) {
    return [{ message: `expected exactly one <section data-slide-id>, found ${sections.length}` }];
  }
  const id = sections[0].getAttribute("data-slide-id");
  if (id !== expectedId) {
    return [{ message: `data-slide-id "${id}" != expected "${expectedId}"` }];
  }
  const issues: SlideSectionIssue[] = [];
  for (const script of root.querySelectorAll("script")) {
    const src = script.innerHTML;
    if (src.trim() && !src.includes(expectedId)) {
      issues.push({
        message: `slide ${expectedId}: <script> does not reference the slide id — scope DOM queries under #${expectedId}`,
      });
    }
  }
  return issues;
}
