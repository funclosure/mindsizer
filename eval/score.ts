#!/usr/bin/env bun
// eval/score.ts — score one deck against the rubric (eval/RUBRIC.md) → <out>/scores.json + screenshots.
//
//   bun run eval:score <deck.html> (--plan <plan.md> | --outline <outline.md>) --source <source.txt>
//        [--source-id <id>] [--out <dir>] [--slides id,id] [--skip-quiz]
//
// Per slide: claim_at_rest (2 calls), mechanism_shown, device_works (instrument slides; the judge
// drives the slide), fidelity, craft (deterministic checks + judge), not_generic. Per deck:
// coherence (contact sheet) and the comprehension quiz (A: questions from source, cached in
// eval/questions/<id>.json; B: answers from deck screenshots only; C: grading).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOutline } from "../src/outline/parse";
import type { OutlineSlide, Outline } from "../src/outline/types";
import { deckParts, SlideDriver, contactSheet, type RestCapture } from "./lib/driver";
import {
  judgeJson, judgeAgentic, extractJson, text, image, judgeUsage, judgeCostUsd, JUDGE_MODEL, JUDGE_EFFORT, type Block, type DriveAction,
} from "./lib/judge";
import {
  CLAIM_READ_SYSTEM, ClaimReadSchema, CLAIM_COMPARE_SYSTEM, VerdictSchema, MECHANISM_SYSTEM, DEVICE_SYSTEM, DeviceVerdictSchema,
  FIDELITY_SYSTEM, FidelitySchema, CRAFT_SYSTEM, notGenericSystem, NotGenericSchema, COHERENCE_SYSTEM, CoherenceSchema,
  QUIZ_A_SYSTEM, QuizASchema, QUIZ_B_SYSTEM, QuizBSchema, QUIZ_C_SYSTEM, QuizCSchema, intentText, type SlideIntent, type QuizQuestions,
} from "./lib/criteria";
import { computeCraft, craftCap } from "./lib/craft";
import { toScore, applyCap, summarize, quizScore, type SlideScore, type CriterionResult, type DeckScores, type QuizResult } from "./lib/aggregate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function safe<T extends CriterionResult>(label: string, fn: () => Promise<T>): Promise<T | CriterionResult> {
  try {
    return await fn();
  } catch (e) {
    console.error(`  ✗ ${label}: ${(e as Error).message.slice(0, 300)}`);
    return { score: null, error: (e as Error).message.slice(0, 500) };
  }
}

function intentOf(s: OutlineSlide): SlideIntent {
  const p = s.plan;
  if (!p) return { title: s.title, markdown: s.markdown };
  return {
    title: s.title, claim: p.claim, mechanism: p.mechanism, kind: p.device.kind,
    operate: p.device.operate, changes: p.device.changes, aha: p.aha, resting: p.device.resting,
  };
}

function controlsText(c: RestCapture["controls"]): string {
  if (!c.length) return "Control inventory: (none detected — the slide may still respond to keys or clicks on drawn elements)";
  return "Control inventory (CSS selector · kind · label · box [x,y,w,h]):\n" +
    c.map((k) => `- ${k.selector} · ${k.kind} · "${k.label}" · [${k.box.join(",")}]`).join("\n");
}

function craftText(m: ReturnType<typeof computeCraft>): string {
  return [
    `overflow: ${m.overflowPx}px`,
    `console errors: ${m.consoleErrors.length}`,
    `text boxes: ${m.textBoxes}`,
    `overlapping text pairs: ${m.overlaps.length}${m.overlaps.length ? " — " + m.overlaps.slice(0, 4).map((o) => `"${o.a}" × "${o.b}"`).join("; ") : ""}`,
    `text outside 1280×720: ${m.outsideFrame.length}`,
    `text cut off by its container: ${m.clipped.length}${m.clipped.length ? " — " + m.clipped.slice(0, 4).map((c) => `"${c.text}" ${Math.round(c.hiddenFrac * 100)}% hidden`).join("; ") : ""}`,
    `WCAG AA contrast failures: ${m.contrast.fails.length} of ${m.contrast.checked} (min ratio ${m.contrast.minRatio ?? "n/a"})${m.contrast.fails.length ? " — " + m.contrast.fails.slice(0, 4).map((f) => `"${f.text}" ${f.ratio}:1 @${f.fontPx}px`).join("; ") : ""}`,
  ].join("\n");
}

export interface ScoreOptions {
  deckPath: string;
  planPath?: string;
  outlinePath?: string;
  sourcePath: string;
  sourceId: string;
  outDir: string;
  onlySlides?: string[];
  skipQuiz?: boolean;
}

export async function scoreDeck(o: ScoreOptions): Promise<DeckScores> {
  const t0 = Date.now();
  const deckHtml = readFileSync(o.deckPath, "utf8");
  const source = readFileSync(o.sourcePath, "utf8");
  const outline: Outline | undefined = o.planPath ? parseOutline(readFileSync(o.planPath, "utf8"))
    : o.outlinePath ? parseOutline(readFileSync(o.outlinePath, "utf8")) : undefined;
  const parts = deckParts(deckHtml);
  const shotsDir = join(o.outDir, "shots");
  mkdirSync(shotsDir, { recursive: true });
  const driver = new SlideDriver(parts.themeCss);
  const byId = new Map((outline?.slides ?? []).map((s) => [s.id, s]));
  let slides = parts.slides;
  if (o.onlySlides) slides = slides.filter((s) => o.onlySlides!.includes(s.id));
  const hasPlan = !!o.planPath;
  const themeBriefPath = join(ROOT, "themes", outline?.meta.theme ?? "field", "brief.md");
  const themeBrief = existsSync(themeBriefPath) ? readFileSync(themeBriefPath, "utf8").trim() : undefined;
  console.log(`scoring ${basename(o.deckPath)}: ${slides.length} slides, judge ${JUDGE_MODEL} (${JUDGE_EFFORT})`);

  const rests = new Map<string, RestCapture>();
  const interactedShots = new Map<string, Buffer[]>();

  async function scoreSlide(ds: { id: string; fragment: string }, idx: number): Promise<SlideScore> {
    const os = byId.get(ds.id);
    const intent: SlideIntent = os ? intentOf(os) : { title: ds.id, markdown: "(slide not found in outline)" };
    const rest = await driver.rest(ds.fragment);
    rests.set(ds.id, rest);
    const restRel = `shots/${ds.id}.rest.png`;
    writeFileSync(join(o.outDir, restRel), rest.png);
    const metrics = computeCraft(rest.boxes, rest.gate.overflowPx, rest.gate.consoleErrors);
    const gatePassed = rest.gate.overflowPx <= 2 && rest.gate.consoleErrors.length === 0;
    const instrument = hasPlan ? intent.kind === "instrument" : rest.controls.length > 0;
    const label = `[${idx + 1}] ${ds.id}`;
    console.log(`${label} rest captured · ${rest.controls.length} controls · gate ${gatePassed ? "pass" : "FAIL"}`);

    // device_works first: its interacted screenshots feed mechanism, fidelity and the quiz.
    const interacted: Buffer[] = [];
    const device: CriterionResult = !instrument
      ? { score: null, na: true, reason: hasPlan ? `device kind is ${intent.kind}` : "no controls detected" }
      : await safe("device_works", async () => {
          const drives: DriveAction[][] = [];
          const r = await judgeAgentic(DEVICE_SYSTEM, [
            text(intentText(intent) + (hasPlan ? "" : "\n(No plan exists: infer the intended operation from the slide content and controls.)")),
            text(controlsText(rest.controls)),
            text("Resting screenshot:"),
            image(rest.png),
          ], async (actions) => {
            drives.push(actions);
            const out = await driver.drive(ds.fragment, actions);
            if (out.shots.length) interacted.push(out.shots[out.shots.length - 1]);
            return out;
          });
          const v = DeviceVerdictSchema.parse(extractJson(r.text));
          return { score: toScore(v.score), judged: toScore(v.score), evidence: v.evidence, reasoning: v.reasoning, aha_reached: v.aha_reached, drives };
        });
    const interRel: string[] = [];
    interacted.slice(0, 6).forEach((png, i) => {
      const rel = `shots/${ds.id}.i${i + 1}.png`;
      writeFileSync(join(o.outDir, rel), png);
      interRel.push(rel);
    });
    interactedShots.set(ds.id, interacted.slice(0, 6));
    const interBlocks: Block[] = interacted.slice(-3).flatMap((png, i) => [text(`After interaction ${i + 1}:`), image(png)]);

    const [claim, mechanism, fidelity, craft, notGeneric] = await Promise.all([
      safe("claim_at_rest", async () => {
        const read = await judgeJson(CLAIM_READ_SYSTEM, [image(rest.png)], ClaimReadSchema);
        const intended = intent.claim ?? `${intent.title}\n${intent.markdown ?? ""}`;
        const v = await judgeJson(CLAIM_COMPARE_SYSTEM, [
          text(`INTENDED claim${intent.claim ? "" : " (no plan: the slide's title + content stand in for it)"}:\n${intended}\n\nCLAIM THE READER TOOK FROM THE RESTING SLIDE:\n${read.claim}\n(reader's evidence: ${read.evidence.join(" | ")}; confidence ${read.confidence})`),
        ], VerdictSchema);
        return { score: toScore(v.score), judged: toScore(v.score), read_claim: read.claim, read_evidence: read.evidence, evidence: v.evidence, reasoning: v.reasoning };
      }),
      safe("mechanism_shown", async () => {
        const v = await judgeJson(MECHANISM_SYSTEM, [
          text(intent.mechanism ? `The slide's intended mechanism: ${intent.mechanism}` : `The slide's content (no plan):\n${intent.markdown}`),
          text("Resting screenshot:"), image(rest.png), ...interBlocks,
        ], VerdictSchema);
        return { score: toScore(v.score), judged: toScore(v.score), evidence: v.evidence, reasoning: v.reasoning };
      }),
      safe("fidelity", async () => {
        const v = await judgeJson(FIDELITY_SYSTEM, [
          text(`SOURCE TEXT:\n<<<\n${source}\n>>>`),
          text(`SLIDE'S EXTRACTED ON-SCREEN TEXT (at rest):\n${rest.text.slice(0, 6000)}`),
          text("Resting screenshot:"), image(rest.png), ...interBlocks,
        ], FidelitySchema);
        const judged = toScore(v.score);
        const score = v.fabrications.length ? applyCap(judged, 2) : judged;
        return { score, judged, capped: v.fabrications.length && judged !== score ? ["fabrication"] : undefined, fabrications: v.fabrications, distortions: v.distortions, evidence: v.evidence, reasoning: v.reasoning };
      }),
      safe("craft", async () => {
        const v = await judgeJson(CRAFT_SYSTEM, [text(`Deterministic checks:\n${craftText(metrics)}`), text("Resting screenshot:"), image(rest.png)], VerdictSchema);
        const judged = toScore(v.score);
        const cap = craftCap(metrics);
        const score = applyCap(judged, cap.cap);
        return { score, judged, capped: score !== judged ? cap.reasons : undefined, evidence: v.evidence, reasoning: v.reasoning };
      }),
      safe("not_generic", async () => {
        const v = await judgeJson(notGenericSystem(undefined, themeBrief), [text("Resting screenshot:"), image(rest.png)], NotGenericSchema);
        return { score: toScore(v.score), judged: toScore(v.score), present: v.present, evidence: v.evidence, reasoning: v.reasoning };
      }),
    ]);
    const fmt = (r: CriterionResult) => (r.na ? "n/a" : r.score ?? "?");
    console.log(`${label} claim ${fmt(claim)} · mech ${fmt(mechanism)} · device ${fmt(device)} · fid ${fmt(fidelity)} · craft ${fmt(craft)} · generic ${fmt(notGeneric)}`);
    return {
      id: ds.id,
      title: intent.title,
      kind: intent.kind ?? (hasPlan ? "unknown" : "outline"),
      instrument,
      gate: { overflowPx: rest.gate.overflowPx, consoleErrors: rest.gate.consoleErrors.length, passed: gatePassed },
      craftMetrics: metrics,
      controls: rest.controls.length,
      intent,
      criteria: { claim_at_rest: claim, mechanism_shown: mechanism, device_works: device, fidelity, craft, not_generic: notGeneric },
      shots: { rest: restRel, interacted: interRel },
    };
  }

  // Score slides with bounded parallelism (judge sessions are globally capped in judge.ts).
  const results: SlideScore[] = new Array(slides.length);
  const queue = slides.map((s, i) => ({ s, i }));
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const { s, i } = queue.shift()!;
      results[i] = await scoreSlide(s, i);
    }
  }));

  // ——— deck: coherence ———
  const labels = slides.map((s, i) => `${i + 1}. ${byId.get(s.id)?.title ?? s.id}`.slice(0, 60));
  const sheet = await contactSheet(slides.map((s) => rests.get(s.id)!.png), labels);
  writeFileSync(join(o.outDir, "contact-sheet.png"), sheet);
  const dir = outline?.meta.direction;
  const coherence = await safe("coherence", async () => {
    const v = await judgeJson(COHERENCE_SYSTEM, [
      text(dir ? `Stated direction:\nConceit: ${dir.conceit}\nMotif: ${dir.motif}\nArc: ${dir.arc}` : "No stated direction (outline-only deck): judge visual coherence; for the motif, look for any recurring visual idea."),
      text("Contact sheet (slides in order, left→right, top→bottom):"), image(sheet),
    ], CoherenceSchema);
    return { score: toScore(v.score), judged: toScore(v.score), evidence: v.evidence, reasoning: v.reasoning, motif_slides: v.motif_slides };
  });
  console.log(`deck coherence ${coherence.score ?? "?"}`);

  // ——— deck: comprehension quiz ———
  let quiz: QuizResult | undefined;
  if (!o.skipQuiz) {
    try {
      const questions = await quizQuestions(o.sourceId, source);
      const deckBlocks: Block[] = [];
      slides.forEach((s, i) => {
        deckBlocks.push(text(`Slide ${i + 1} at rest:`), image(rests.get(s.id)!.png));
        const inter = interactedShots.get(s.id) ?? [];
        // at least one interacted state per instrument: the first and the last drive outcome
        const pick = inter.length > 1 ? [inter[0], inter[inter.length - 1]] : inter;
        pick.forEach((png, k) => deckBlocks.push(text(`Slide ${i + 1} after operating its controls (${k + 1}):`), image(png)));
      });
      const qList = questions.questions.map((q) => `${q.id}: ${q.q}`).join("\n");
      const b = await judgeJson(QUIZ_B_SYSTEM, [...deckBlocks, text(`QUESTIONS:\n${qList}`)], QuizBSchema);
      const ansById = new Map(b.answers.map((a) => [a.id, a]));
      const c = await judgeJson(QUIZ_C_SYSTEM, [text(questions.questions.map((q) =>
        `${q.id}\nQuestion: ${q.q}\nReference answer: ${q.ref}\nReader's answer: ${ansById.get(q.id)?.answer ?? "not covered"}`).join("\n\n"))], QuizCSchema);
      const qs = quizScore(c.grades, questions.questions.length);
      quiz = {
        ...qs,
        items: questions.questions.map((q) => ({
          id: q.id, q: q.q, kind: q.kind, ref: q.ref, answer: ansById.get(q.id)?.answer, from: ansById.get(q.id)?.from,
          grade: c.grades.find((g) => g.id === q.id)?.grade, why: c.grades.find((g) => g.id === q.id)?.why,
        })),
      };
      console.log(`quiz ${qs.correct}/${qs.total} correct (+${qs.partial} partial)`);
    } catch (e) {
      console.error(`  ✗ quiz: ${(e as Error).message.slice(0, 300)}`);
      quiz = { score: null, correct: 0, partial: 0, total: 8, error: (e as Error).message.slice(0, 500) };
    }
  }
  await driver.dispose();

  const out: DeckScores = {
    deck: relative(ROOT, o.deckPath),
    plan: o.planPath ? relative(ROOT, o.planPath) : undefined,
    outline: o.outlinePath ? relative(ROOT, o.outlinePath) : undefined,
    sourceId: o.sourceId,
    deckTitle: parts.title,
    direction: dir,
    judge: { model: JUDGE_MODEL, effort: JUDGE_EFFORT },
    scoredAt: new Date().toISOString(),
    slides: results,
    deckCriteria: { coherence, quiz },
  };
  out.summary = summarize(out);
  out.evalCost = { judgeCalls: judgeUsage.calls, usage: judgeUsage.usage, usd: Math.round(judgeCostUsd() * 100) / 100, wallMs: Date.now() - t0 };
  writeFileSync(join(o.outDir, "scores.json"), JSON.stringify(out, null, 2));
  console.log(`✓ wrote ${relative(ROOT, join(o.outDir, "scores.json"))} · ${judgeUsage.calls} judge calls · ~$${judgeCostUsd().toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)}s`);
  return out;
}

/** Call A, cached per source in eval/questions/<id>.json so every run is graded on the same quiz. */
export async function quizQuestions(sourceId: string, source: string): Promise<QuizQuestions> {
  const path = join(ROOT, "eval", "questions", `${sourceId}.json`);
  if (existsSync(path)) return QuizASchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const q = await judgeJson(QUIZ_A_SYSTEM, [text(`SOURCE TEXT:\n<<<\n${source}\n>>>`)], QuizASchema);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ sourceId, model: JUDGE_MODEL, createdAt: new Date().toISOString(), ...q }, null, 2) + "\n");
  return q;
}

if ((import.meta as { main?: boolean }).main) {
  const deckPath = process.argv[2];
  if (!deckPath || deckPath.startsWith("--")) {
    console.error("usage: bun run eval:score <deck.html> (--plan <plan.md> | --outline <outline.md>) --source <source.txt> [--source-id <id>] [--out <dir>] [--slides id,id] [--skip-quiz]");
    process.exit(2);
  }
  const sourcePath = arg("source");
  if (!sourcePath) { console.error("--source <source.txt> is required"); process.exit(2); }
  const sourceId = arg("source-id") ?? basename(sourcePath).replace(/\.txt$/, "");
  const outDir = arg("out") ?? join(dirname(deckPath), "scores", basename(deckPath).replace(/\.deck\.html$|\.html$/, ""));
  await scoreDeck({
    deckPath, planPath: arg("plan"), outlinePath: arg("outline"), sourcePath, sourceId, outDir,
    onlySlides: arg("slides")?.split(","), skipQuiz: process.argv.includes("--skip-quiz"),
  });
  process.exit(0);
}
