// eval/lib/aggregate.ts — score aggregation (pure; unit-tested).
import { CRITERIA, type Criterion } from "./criteria";

export type Score = 1 | 2 | 3 | 4 | null; // null = judge said "unknown" / not applicable / errored

export interface CriterionResult {
  score: Score;
  judged?: Score;         // the judge's own score before deterministic caps
  capped?: string[];      // why the score was capped
  na?: boolean;           // not applicable (e.g. device_works on a non-instrument)
  error?: string;
  [k: string]: unknown;   // evidence, reasoning, etc.
}

export interface SlideScore {
  id: string;
  title: string;
  kind: string;                                     // plan device kind, or "outline"
  instrument: boolean;
  gate: { overflowPx: number; consoleErrors: number; passed: boolean };
  criteria: Partial<Record<Criterion, CriterionResult>>;
  shots: { rest: string; interacted: string[] };
  [k: string]: unknown;
}

export interface DeckScores {
  deck: string;
  sourceId: string;
  slides: SlideScore[];
  deckCriteria: { coherence?: CriterionResult; quiz?: QuizResult };
  summary?: Summary;
  [k: string]: unknown;
}

export interface QuizResult { score: number | null; correct: number; partial: number; total: number; error?: string; [k: string]: unknown }

export const PASS = 3;

/** Normalize a judge score ("unknown" → null). */
export function toScore(v: unknown): Score {
  return v === 1 || v === 2 || v === 3 || v === 4 ? v : null;
}

/** Apply a deterministic cap: the final score is min(judged, cap); unknown stays unknown. */
export function applyCap(judged: Score, cap: number): Score {
  if (judged === null) return null;
  return Math.min(judged, cap) as Score;
}

export function mean(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
}

export function scoresOf(slides: SlideScore[], c: Criterion): number[] {
  return slides.map((s) => s.criteria[c]?.score).filter((v): v is 1 | 2 | 3 | 4 => v !== null && v !== undefined);
}

export interface Summary {
  slides: number;
  means: Record<Criterion, number | null>;
  passRate: Record<Criterion, number | null>;   // fraction of judged slides scoring ≥ 3
  unknown: Record<Criterion, number>;            // count of unknown/errored (excluding n/a)
  coherence: number | null;
  quiz: number | null;
  gatePassed: number;
  keyQuestion: KeyQuestion;
}

export function summarize(d: DeckScores): Summary {
  const means = {} as Record<Criterion, number | null>;
  const passRate = {} as Record<Criterion, number | null>;
  const unknown = {} as Record<Criterion, number>;
  for (const c of CRITERIA) {
    const xs = scoresOf(d.slides, c);
    means[c] = mean(xs);
    passRate[c] = xs.length ? Math.round((xs.filter((x) => x >= PASS).length / xs.length) * 100) / 100 : null;
    unknown[c] = d.slides.filter((s) => s.criteria[c] && !s.criteria[c]!.na && s.criteria[c]!.score === null).length;
  }
  return {
    slides: d.slides.length,
    means,
    passRate,
    unknown,
    coherence: d.deckCriteria.coherence?.score ?? null,
    quiz: d.deckCriteria.quiz?.score ?? null,
    gatePassed: d.slides.filter((s) => s.gate.passed).length,
    keyQuestion: keyQuestion(d.slides),
  };
}

/** The criteria the evaluator redesign targets. */
export const KEY_CRITERIA: Criterion[] = ["claim_at_rest", "mechanism_shown", "device_works"];

export interface KeyQuestion {
  gatePassed: number;          // slides with 0 overflow + 0 console errors
  failedKey: number;           // …of which scored < 3 on ANY key criterion
  rate: number | null;         // failedKey / gatePassed
  byCriterion: Record<string, number>; // gate-passed slides failing each key criterion
  slideIds: string[];
}

/** How often did a slide pass the harness's mechanical gate yet score < 3 on a key criterion? */
export function keyQuestion(slides: SlideScore[]): KeyQuestion {
  const passed = slides.filter((s) => s.gate.passed);
  const byCriterion: Record<string, number> = {};
  const failing: string[] = [];
  for (const s of passed) {
    let fail = false;
    for (const c of KEY_CRITERIA) {
      const v = s.criteria[c]?.score;
      if (v !== null && v !== undefined && v < PASS) {
        byCriterion[c] = (byCriterion[c] ?? 0) + 1;
        fail = true;
      }
    }
    if (fail) failing.push(s.id);
  }
  return {
    gatePassed: passed.length,
    failedKey: failing.length,
    rate: passed.length ? Math.round((failing.length / passed.length) * 1000) / 1000 : null,
    byCriterion,
    slideIds: failing,
  };
}

/** Merge several decks' key-question counts into one pooled number. */
export function poolKeyQuestion(ks: KeyQuestion[]): KeyQuestion {
  const byCriterion: Record<string, number> = {};
  for (const k of ks) for (const [c, n] of Object.entries(k.byCriterion)) byCriterion[c] = (byCriterion[c] ?? 0) + n;
  const gatePassed = ks.reduce((a, k) => a + k.gatePassed, 0);
  const failedKey = ks.reduce((a, k) => a + k.failedKey, 0);
  return {
    gatePassed,
    failedKey,
    rate: gatePassed ? Math.round((failedKey / gatePassed) * 1000) / 1000 : null,
    byCriterion,
    slideIds: ks.flatMap((k) => k.slideIds),
  };
}

/** Histogram of 1–4 (+ unknown) for a criterion across slides. */
export function distribution(slides: SlideScore[], c: Criterion): Record<"1" | "2" | "3" | "4" | "unknown" | "n/a", number> {
  const h = { "1": 0, "2": 0, "3": 0, "4": 0, unknown: 0, "n/a": 0 };
  for (const s of slides) {
    const r = s.criteria[c];
    if (!r || r.na) h["n/a"]++;
    else if (r.score === null) h.unknown++;
    else h[String(r.score) as "1"]++;
  }
  return h;
}

export interface NoiseRow {
  criterion: string;
  pairs: number;           // slides judged (non-null) in both runs
  exact: number;           // same score
  flip1: number;           // |Δ| = 1
  flip2plus: number;       // |Δ| ≥ 2
  passFlip: number;        // crossed the pass threshold (≥3 vs <3)
  meanAbsDelta: number | null;
  flipRate: number | null; // fraction with |Δ| ≥ 1
  trustworthy: boolean;    // flipRate < 0.34 and no |Δ| ≥ 2
}

/** Per-criterion disagreement between two independent scorings of the same deck(s). */
export function noise(a: SlideScore[], b: SlideScore[]): NoiseRow[] {
  const byId = new Map(b.map((s) => [s.id, s]));
  return CRITERIA.map((c) => {
    let pairs = 0, exact = 0, flip1 = 0, flip2plus = 0, passFlip = 0, absSum = 0;
    for (const s of a) {
      const t = byId.get(s.id);
      const x = s.criteria[c]?.score;
      const y = t?.criteria[c]?.score;
      if (x == null || y == null) continue;
      pairs++;
      const d = Math.abs(x - y);
      absSum += d;
      if (d === 0) exact++;
      else if (d === 1) flip1++;
      else flip2plus++;
      if ((x >= PASS) !== (y >= PASS)) passFlip++;
    }
    const flipRate = pairs ? Math.round(((flip1 + flip2plus) / pairs) * 100) / 100 : null;
    return {
      criterion: c,
      pairs,
      exact,
      flip1,
      flip2plus,
      passFlip,
      meanAbsDelta: pairs ? Math.round((absSum / pairs) * 100) / 100 : null,
      flipRate,
      trustworthy: pairs > 0 && (flipRate ?? 1) < 0.34 && flip2plus === 0,
    };
  });
}

/** Quiz score from C's grades: strict = correct / total; partial reported separately. */
export function quizScore(grades: { grade: "correct" | "partial" | "incorrect" }[], total = 8): { score: number; correct: number; partial: number; total: number; lenient: number } {
  const correct = grades.filter((g) => g.grade === "correct").length;
  const partial = grades.filter((g) => g.grade === "partial").length;
  return {
    score: Math.round((correct / total) * 1000) / 1000,
    correct,
    partial,
    total,
    lenient: Math.round(((correct + partial * 0.5) / total) * 1000) / 1000,
  };
}

/** Lowest-scoring slides across decks (sum of the six criteria, unknown counts as 2.5). */
export function worstSlides(decks: DeckScores[], n = 5): { deck: string; slide: SlideScore; total: number }[] {
  const all = decks.flatMap((d) => d.slides.map((s) => ({
    deck: d.sourceId,
    slide: s,
    total: CRITERIA.reduce((a, c) => {
      const r = s.criteria[c];
      if (!r || r.na) return a + 2.5;
      return a + (r.score ?? 2.5);
    }, 0),
  })));
  return all.sort((x, y) => x.total - y.total).slice(0, n);
}
