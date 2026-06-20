import type { Outline } from "./types";
import { KNOWN_LAYOUTS } from "./types";

export interface ValidationIssue {
  slideId?: string;
  message: string;
}

const KNOWN = new Set<string>(KNOWN_LAYOUTS);

/** Structural validation of the outline itself (§9 of the design spec). */
export function validateOutline(o: Outline): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!o.meta.title) issues.push({ message: "deck title is empty" });

  const seen = new Set<string>();
  for (const s of o.slides) {
    if (!s.id) {
      issues.push({ message: "slide missing id" });
    } else if (seen.has(s.id)) {
      issues.push({ slideId: s.id, message: "duplicate slide id" });
    } else {
      seen.add(s.id);
    }
    if (!s.title) {
      issues.push({ slideId: s.id, message: "slide missing title (#) heading" });
    }
    if (s.layout && !KNOWN.has(s.layout)) {
      issues.push({ slideId: s.id, message: `unknown layout: ${s.layout}` });
    }
  }
  return issues;
}

/** Cross-check the outline against the render files present on disk. */
export function crossValidate(o: Outline, renderIds: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const outlineIds = new Set(o.slides.map((s) => s.id));
  const renderSet = new Set(renderIds);

  for (const s of o.slides) {
    if (!renderSet.has(s.id)) {
      issues.push({ slideId: s.id, message: "missing render file" });
    }
  }
  for (const r of renderIds) {
    if (!outlineIds.has(r)) {
      issues.push({
        slideId: r,
        message: "orphan render file (id not in outline)",
      });
    }
  }
  return issues;
}
