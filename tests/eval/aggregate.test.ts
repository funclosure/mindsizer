import { describe, it, expect } from "vitest";
import {
  toScore, applyCap, mean, summarize, keyQuestion, poolKeyQuestion, distribution, noise, quizScore, worstSlides,
  type SlideScore, type DeckScores, type Score,
} from "../../eval/lib/aggregate";

function slide(id: string, s: Partial<Record<string, Score>>, gate = true, na: string[] = []): SlideScore {
  const criteria: SlideScore["criteria"] = {};
  for (const c of ["claim_at_rest", "mechanism_shown", "device_works", "fidelity", "craft", "not_generic"] as const) {
    criteria[c] = na.includes(c) ? { score: null, na: true } : { score: s[c] ?? null };
  }
  return { id, title: id, kind: "figure", instrument: !na.includes("device_works"), gate: { overflowPx: gate ? 0 : 40, consoleErrors: 0, passed: gate }, criteria, shots: { rest: "", interacted: [] } };
}

describe("score helpers", () => {
  it("normalizes unknown and applies caps", () => {
    expect(toScore("unknown")).toBeNull();
    expect(toScore(3)).toBe(3);
    expect(toScore(5)).toBeNull();
    expect(applyCap(4, 2)).toBe(2);
    expect(applyCap(1, 2)).toBe(1);
    expect(applyCap(null, 2)).toBeNull();
    expect(mean([1, 2, 4])).toBe(2.33);
    expect(mean([])).toBeNull();
  });
});

describe("summarize + key question", () => {
  const slides = [
    slide("a", { claim_at_rest: 4, mechanism_shown: 2, device_works: 3, fidelity: 3, craft: 2, not_generic: 2 }),
    slide("b", { claim_at_rest: 3, mechanism_shown: 3, fidelity: 4, craft: 3, not_generic: 3 }, true, ["device_works"]),
    slide("c", { claim_at_rest: 1, mechanism_shown: 1, device_works: 1, fidelity: 2, craft: 1, not_generic: 1 }, false),
    slide("d", { claim_at_rest: null, mechanism_shown: 3, device_works: 3, fidelity: 3, craft: 3, not_generic: 3 }),
  ];
  const deck: DeckScores = { deck: "x", sourceId: "x", slides, deckCriteria: { coherence: { score: 3 }, quiz: { score: 0.5, correct: 4, partial: 0, total: 8 } } };

  it("means ignore unknown and n/a", () => {
    const s = summarize(deck);
    expect(s.means.claim_at_rest).toBe(2.67); // (4+3+1)/3
    expect(s.means.device_works).toBe(2.33);  // (3+1+3)/3, b is n/a
    expect(s.unknown.claim_at_rest).toBe(1);
    expect(s.unknown.device_works).toBe(0);   // n/a is not unknown
    expect(s.passRate.mechanism_shown).toBe(0.5);
    expect(s.coherence).toBe(3);
    expect(s.quiz).toBe(0.5);
    expect(s.gatePassed).toBe(3);
  });

  it("counts gate-passed slides scoring < 3 on a key criterion", () => {
    const k = keyQuestion(slides);
    expect(k.gatePassed).toBe(3);       // c failed the gate
    expect(k.failedKey).toBe(1);        // only a (mechanism 2); d's unknown claim is not a failure
    expect(k.rate).toBe(0.333);
    expect(k.byCriterion).toEqual({ mechanism_shown: 1 });
    expect(k.slideIds).toEqual(["a"]);
    const pooled = poolKeyQuestion([k, k]);
    expect(pooled).toMatchObject({ gatePassed: 6, failedKey: 2, rate: 0.333, byCriterion: { mechanism_shown: 2 } });
  });

  it("builds per-criterion distributions", () => {
    expect(distribution(slides, "device_works")).toEqual({ "1": 1, "2": 0, "3": 2, "4": 0, unknown: 0, "n/a": 1 });
    expect(distribution(slides, "claim_at_rest")).toEqual({ "1": 1, "2": 0, "3": 1, "4": 1, unknown: 1, "n/a": 0 });
  });

  it("ranks the worst slides", () => {
    expect(worstSlides([deck], 1)[0].slide.id).toBe("c");
  });
});

describe("noise", () => {
  it("measures per-criterion flips between two scorings", () => {
    const a = [slide("a", { claim_at_rest: 3, craft: 2 }), slide("b", { claim_at_rest: 4, craft: 2 }), slide("c", { claim_at_rest: 2, craft: 4 })];
    const b = [slide("a", { claim_at_rest: 2, craft: 2 }), slide("b", { claim_at_rest: 4, craft: 2 }), slide("c", { claim_at_rest: 2, craft: 2 })];
    const rows = Object.fromEntries(noise(a, b).map((r) => [r.criterion, r]));
    expect(rows.claim_at_rest).toMatchObject({ pairs: 3, exact: 2, flip1: 1, flip2plus: 0, passFlip: 1, flipRate: 0.33, trustworthy: true });
    expect(rows.craft).toMatchObject({ pairs: 3, exact: 2, flip2plus: 1, trustworthy: false, meanAbsDelta: 0.67 });
    expect(rows.fidelity.pairs).toBe(0);
    expect(rows.fidelity.trustworthy).toBe(false);
  });
});

describe("quizScore", () => {
  it("scores strict correctness and reports partial credit separately", () => {
    const g = [
      ...Array(5).fill({ grade: "correct" }), { grade: "partial" }, { grade: "partial" }, { grade: "incorrect" },
    ] as { grade: "correct" | "partial" | "incorrect" }[];
    expect(quizScore(g)).toEqual({ score: 0.625, correct: 5, partial: 2, total: 8, lenient: 0.75 });
  });
});
