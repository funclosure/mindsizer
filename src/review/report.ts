import type { SlideFinding, CoherenceFinding, Severity } from "./findings";

export interface SlideReviewResult { id: string; title: string; findings: SlideFinding[] }
export interface ReviewRun {
  meta: { deck: string; source: string | null; model: string; date: string };
  slides: SlideReviewResult[];
  deck: CoherenceFinding[];
}

const MARK: Record<Severity, string> = { high: "✗", medium: "⚠", low: "·" };
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const bySeverity = <F extends { severity: Severity }>(fs: F[]): F[] => [...fs].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

function tally(run: ReviewRun): Record<Severity, number> {
  const t: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const s of run.slides) for (const f of s.findings) t[f.severity]++;
  for (const f of run.deck) t[f.severity]++;
  return t;
}

/** True if any finding (per-slide or deck-level) is high severity. */
export function hasHigh(run: ReviewRun): boolean {
  return run.slides.some((s) => s.findings.some((f) => f.severity === "high")) || run.deck.some((f) => f.severity === "high");
}

export function terminalReport(run: ReviewRun): string {
  const lines: string[] = [];
  for (const s of run.slides) {
    if (!s.findings.length) { lines.push(`${s.id} — ${s.title}  ✓`); continue; }
    lines.push(`${s.id} — ${s.title}`);
    for (const f of bySeverity(s.findings)) lines.push(`  ${MARK[f.severity]} [${f.check}] ${f.summary} — ${f.detail}`);
  }
  if (run.deck.length) {
    lines.push("deck-level");
    for (const f of bySeverity(run.deck)) lines.push(`  ${MARK[f.severity]} [coherence${f.slideId ? ` · ${f.slideId}` : ""}] ${f.summary} — ${f.detail}`);
  }
  const t = tally(run);
  lines.push(`${t.high} high · ${t.medium} medium · ${t.low} low across ${run.slides.length} slides`);
  return lines.join("\n");
}

export function markdownReport(run: ReviewRun): string {
  const lines = [
    `# Deck review — ${run.meta.deck}`,
    "",
    `- date: ${run.meta.date}`,
    `- model: ${run.meta.model}`,
    `- source: ${run.meta.source ?? "(none — content fidelity skipped)"}`,
    "",
  ];
  for (const s of run.slides) {
    lines.push(`## ${s.title} (\`${s.id}\`)`, "");
    if (!s.findings.length) { lines.push("Passes.", ""); continue; }
    for (const f of bySeverity(s.findings)) lines.push(`- **${f.severity}** [${f.check}] ${f.summary}`, `  - ${f.detail}`, `  - fix: ${f.suggestion}`);
    lines.push("");
  }
  lines.push("## Deck-level", "");
  if (!run.deck.length) lines.push("Coherent.", "");
  else for (const f of bySeverity(run.deck)) lines.push(`- **${f.severity}**${f.slideId ? ` (${f.slideId})` : ""} ${f.summary}`, `  - ${f.detail}`, `  - fix: ${f.suggestion}`);
  const t = tally(run);
  lines.push("", `**${t.high} high · ${t.medium} medium · ${t.low} low**`);
  return lines.join("\n");
}

export function jsonReport(run: ReviewRun): string {
  return JSON.stringify(run, null, 2);
}
