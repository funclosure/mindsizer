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

/**
 * Ensure the slide's <section data-slide-id="X"> also carries id="X" so the author's
 * `#X{…}` CSS/JS selectors actually match. String surgery on the opening tag only —
 * never reserializes the body, so <style>/<script> content is untouched. Idempotent.
 */
export function ensureSectionId(html: string, expectedId: string): string {
  const open = html.match(/<section\b[^>]*\bdata-slide-id=("|')[^"']+\1[^>]*>/i);
  if (!open) return html;
  const tag = open[0];
  const withoutDsid = tag.replace(/\bdata-slide-id=("|')[^"']*\1/i, "");
  // a REAL standalone id attribute starts at a tag/word boundary (after whitespace), not after a
  // hyphen — so `data-id="…"` / `aria-…` don't count as "already has an id".
  if (/(^|\s)id=("|')/i.test(withoutDsid)) return html;
  const fixed = tag.replace(/<section\b/i, `<section id="${expectedId}"`);
  return html.replace(tag, fixed);
}

/** True iff html has exactly one <section data-slide-id> whose id === expectedId. */
export function hasUsableSection(html: string, expectedId: string): boolean {
  const sections = parseHtml(html).querySelectorAll("section[data-slide-id]");
  return sections.length === 1 && sections[0].getAttribute("data-slide-id") === expectedId;
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
