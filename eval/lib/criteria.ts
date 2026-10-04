// eval/lib/criteria.ts — judge prompts + anchors for every rubric criterion (see eval/RUBRIC.md).
// One isolated judge call per criterion. Every judge: sees rendered screenshots, may answer
// "unknown", must quote evidence, and is told to be skeptical (merely tidy = 2, not 3).
import { z } from "zod";

export const CRITERIA = ["claim_at_rest", "mechanism_shown", "device_works", "fidelity", "craft", "not_generic"] as const;
export type Criterion = (typeof CRITERIA)[number];
export const DECK_CRITERIA = ["coherence"] as const;

/** 1–4, or null for an explicit "unknown". */
export const ScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal("unknown")]);
export const VerdictSchema = z.object({
  evidence: z.array(z.string()).min(1),
  reasoning: z.string(),
  score: ScoreSchema,
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const ANCHORS: Record<Criterion | "coherence", Record<1 | 2 | 3 | 4, string>> = {
  claim_at_rest: {
    4: "The claim read from the resting slide states the intended claim's full assertion — including its causal or relational part — with nothing important missing or added.",
    3: "Same core assertion as intended; a secondary nuance or qualifier is lost.",
    2: "Right topic, wrong or missing point: the reader names the subject but not the assertion, or reads a weaker / different claim.",
    1: "No claim, a contradictory claim, or the slide is unreadable at rest.",
  },
  mechanism_shown: {
    4: "The mechanism is DRAWN: a viewer can trace inputs → relation → output in the figure itself, without needing the sentences.",
    3: "The mechanism is depicted with real visual structure (axes, arrows, flows, linked states); one link is only stated in text.",
    2: "Mostly text. Any figure is decorative, or just lays out labelled boxes / components without showing how one drives the other. Tidy boxes-with-words are a 2.",
    1: "The mechanism is absent, or only named in a sentence.",
  },
  device_works: {
    4: "Doing the planned operation produces the planned change immediately and legibly; the control is discoverable at rest; the 'aha' is reachable by a first-time viewer.",
    3: "Works: the planned change happens and is visible. Minor issues — weak affordance, small or subtle change, only part of the planned range.",
    2: "Something responds, but not the planned change: the effect is cosmetic (a highlight, a label swap), hard to see, or the 'aha' is not reachable.",
    1: "No control, a control that does nothing, or it breaks the slide.",
  },
  fidelity: {
    4: "Every number, name, quote and claim on the slide traces to the source; framing is faithful, nothing distorted.",
    3: "Faithful. Minor simplification or paraphrase the source's author would accept; any illustrative values are clearly marked as illustrative.",
    2: "At least one fabricated number, name, quote or claim, OR a material distortion of the source. (Any fabrication caps the score at 2.)",
    1: "The core claim contradicts the source, or there are multiple fabrications.",
  },
  craft: {
    4: "A clear single entry point and deliberate hierarchy; space is used on purpose; nothing cramped, tiny, or stranded. Would hold up printed as a poster.",
    3: "Clear hierarchy and balanced layout; at most one minor issue (a cramped corner, one small label).",
    2: "Tidy but flat (everything the same weight), or large dead zones, cramped clusters, small/low-contrast text, awkward alignment.",
    1: "Broken: overlapping or cut-off text, illegible, chaotic.",
  },
  not_generic: {
    4: "No named defaults. The visual form is specific to this idea — you could not swap in another topic's text.",
    3: "At most one minor default (e.g. a small eyebrow label) that does not define the layout.",
    2: "The layout is defined by a default (card grid, hero tagline, stat tiles), or 2+ named defaults are present.",
    1: "A template slide: 3+ defaults, content interchangeable.",
  },
  coherence: {
    4: "Reads as one authored piece: a shared visual grammar and control/figure kit; the stated motif is visibly present and develops across most slides.",
    3: "A consistent kit; the motif is present on several slides; one or two outliers.",
    2: "Consistent palette (from the theme) but each slide speaks its own idiom; the motif is rare or only verbal.",
    1: "A pile of unrelated slides; clashing idioms.",
  },
};

/** Named generic defaults the not_generic judge must look for (extended after the baseline run). */
export const GENERIC_PATTERNS = [
  "hero-tagline layout (big centered headline + subtitle, little else)",
  "uniform rounded-card grid (2–4 same-size cards with title + blurb)",
  "numbered eyebrow labels (01 / 02 / 03, 'STEP 1', 'PART II') used as decoration",
  "decorative gradients, glows, or blurred blobs that encode nothing",
  "emoji",
  "filler icons (generic pictograms beside text that add no information)",
  // added after reviewing the baseline decks (see eval/RUBRIC.md § not_generic):
  // (a first draft also listed mono kicker labels, a dot-grid background and italic-serif accents —
  // all three are prescribed by the `field` theme brief, so they now go to the judge as theme context)
  "the default explainer split — a prose column on the left and a figure panel on the right — used regardless of the idea's shape",
  "a paragraph of body copy that restates what the figure already shows",
  "a row of small segmented/pill buttons as the only control, detached from the thing being manipulated",
  "a 'readout' line or panel that restates the control's value or state in words",
  "stat tiles (giant number + tiny caption) not tied to the mechanism",
] as const;

const SKEPTIC = `You are a skeptical evaluator of a single slide from an explanatory slide deck. You grade the rendered ARTIFACT you are shown — not the effort, not the intent, not the process that made it.
Be hard to impress. A slide that is merely clean and tidy is a 2, not a 3. A 3 must earn it with something specific; a 4 is rare and exceptional. When the screenshots do not let you decide, answer "unknown" rather than guessing.
Always quote evidence: what you actually saw (exact on-screen text in quotes, and where it is).`;

function anchorText(c: keyof typeof ANCHORS): string {
  const a = ANCHORS[c];
  return `Score anchors:\n4 = ${a[4]}\n3 = ${a[3]}\n2 = ${a[2]}\n1 = ${a[1]}\n"unknown" = the screenshots do not let you judge this.`;
}

const VERDICT_FORMAT = `Reply with ONLY a JSON object: {"evidence": ["<what you saw, quoted>", ...], "reasoning": "<2–4 sentences>", "score": 1|2|3|4|"unknown"}`;

export interface SlideIntent {
  title: string;
  claim?: string;          // plan claim (plan.md decks)
  mechanism?: string;      // plan mechanism
  kind?: string;           // plan device kind
  operate?: string;
  changes?: string;
  aha?: string;
  resting?: string;
  markdown?: string;       // outline-only decks: slide body markdown stands in for the plan
}

export function intentText(i: SlideIntent): string {
  if (i.claim) {
    return [`Title: ${i.title}`, `Intended claim: ${i.claim}`, i.mechanism && `Intended mechanism: ${i.mechanism}`, i.kind && `Device kind: ${i.kind}`,
      i.operate && `Operate: ${i.operate}`, i.changes && `Changes: ${i.changes}`, i.aha && `Aha: ${i.aha}`].filter(Boolean).join("\n");
  }
  return `Title: ${i.title}\nSlide content (no plan exists for this deck; this is the intended content):\n${i.markdown ?? ""}`;
}

// ——— claim_at_rest: two calls ———
export const CLAIM_READ_SYSTEM = `${SKEPTIC}
You are shown ONE screenshot of a slide at rest (nobody has touched it). You know nothing else about it.
Write the single claim this slide makes, as one sentence in your own words — what a first-time viewer would take away in ~10 seconds. If no claim can be read (only a topic, or nothing legible), say so.
Reply with ONLY JSON: {"claim": "<one sentence, or 'NO CLAIM'>", "evidence": ["<on-screen text you based it on, quoted>"], "confidence": "low"|"medium"|"high"}`;
export const ClaimReadSchema = z.object({ claim: z.string(), evidence: z.array(z.string()), confidence: z.enum(["low", "medium", "high"]) });

export const CLAIM_COMPARE_SYSTEM = `You compare two statements. You do NOT see the slide. A reader looked only at a slide's resting screenshot and wrote the claim they took away. Compare it with the claim the slide was supposed to make.
Be strict: matching TOPIC is not matching CLAIM. The relational/causal part of the intended claim must be present for a 3 or 4.
${anchorText("claim_at_rest")}
${VERDICT_FORMAT}`;

// ——— mechanism_shown ———
export const MECHANISM_SYSTEM = `${SKEPTIC}
Question: is the slide's mechanism DEPICTED (a drawn relation: inputs → relation → output, visible in the figure) or only NAMED in text?
You see the resting screenshot first, then (if any) screenshots after someone operated the slide's controls. Test yourself: cover the sentences mentally — could a viewer still read the relation from the figure?
${anchorText("mechanism_shown")}
${VERDICT_FORMAT}`;

// ——— device_works (agentic) ———
export const DEVICE_SYSTEM = `${SKEPTIC}
You are testing an interactive slide by DRIVING it. You have a tool, \`drive\`, that reloads the slide at rest, performs actions (click, press keys, drag, hover, type, wait) and returns a screenshot after each action. Use coordinates from the resting screenshot (1280×720, origin top-left) or the CSS selectors in the control inventory.
Procedure: (1) find the control a first-time viewer would use; (2) perform the planned operation, and at least one variation (e.g. drag further, click a different option); (3) compare the screenshots with the planned change. Use 2–5 drive calls. If an action fails or nothing changes, try one sensible alternative before concluding the control does nothing.
${anchorText("device_works")}
When done, ${VERDICT_FORMAT.replace("Reply with", "reply with")} — add a field "aha_reached": true|false.`;
export const DeviceVerdictSchema = VerdictSchema.extend({ aha_reached: z.boolean().optional() });

// ——— fidelity ———
export const FIDELITY_SYSTEM = `${SKEPTIC}
Question: is the slide FAITHFUL to the source text? Check every number, name, date, quote and claim visible on the slide (screenshots, plus the slide's extracted text for exact reading) against the source.
- A fabrication = a specific number, name, quote, or factual claim presented as coming from the source/world that the source does not support. Illustrative values clearly marked as illustrative (or obviously a toy control range) are not fabrications. An analogy or metaphor is not a fabrication unless it misstates the source.
- A distortion = the slide says something the source does not mean (overstated, reversed, missing a key condition).
Any fabrication caps the score at 2.
${anchorText("fidelity")}
Reply with ONLY JSON: {"evidence": ["..."], "fabrications": ["<exact slide text> — why it is not in the source", ...], "distortions": ["..."], "reasoning": "...", "score": 1|2|3|4|"unknown"}`;
export const FidelitySchema = VerdictSchema.extend({ fabrications: z.array(z.string()), distortions: z.array(z.string()) });

// ——— craft ———
export const CRAFT_SYSTEM = `${SKEPTIC}
Question: visual craft — hierarchy and use of space. Deterministic checks (overflow, overlapping text, text outside the frame, WCAG contrast, console errors) were already computed in code and are listed for you; they cap the final score separately, so focus on what code cannot see:
- HIERARCHY: is there one clear entry point? 2–3 deliberate levels? Or is everything the same weight?
- DEAD SPACE: are there large empty zones that serve nothing, or cramped clusters? Is the frame used on purpose?
- LEGIBILITY at presentation distance: text too small (< ~14px) or too faint?
${anchorText("craft")}
${VERDICT_FORMAT}`;

// ——— not_generic ———
export function notGenericSystem(patterns: readonly string[] = GENERIC_PATTERNS, themeBrief?: string): string {
  return `${SKEPTIC}
Question: does this slide fall back on GENERIC DEFAULTS? Do not grade "AI slop" vaguely — check this specific list of named defaults and report which are present, with evidence:
${patterns.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}
A pattern counts only if it is clearly present. Then judge whether the slide's visual form is specific to its idea.
${themeBrief ? `The deck's THEME prescribes the house style below. Whatever the theme prescribes (palette, fonts, micro-label style, background texture, accent treatment) is the deck's chosen identity — do NOT count it as a generic default; judge only what the slide author chose on top of it.\nTHEME BRIEF: ${themeBrief}\n` : ""}${anchorText("not_generic")}
Reply with ONLY JSON: {"present": ["<pattern name> — <where/what>", ...], "evidence": ["..."], "reasoning": "...", "score": 1|2|3|4|"unknown"}`;
}
export const NotGenericSchema = VerdictSchema.extend({ present: z.array(z.string()) });

// ——— coherence (deck) ———
export const COHERENCE_SYSTEM = `You are a skeptical evaluator of a whole explanatory slide deck. You see a contact sheet of every slide at rest (in order, labelled) and the deck's stated direction (conceit / motif / arc) if it has one.
Question: is this ONE authored piece, or a pile of individually good slides? Look for a consistent control and figure kit (same way of drawing a dial, a flow, a label), a shared layout grammar, and whether the stated motif is actually visible — not just mentioned in words.
A shared theme palette alone is NOT coherence (the theme supplies it for free). Be hard to impress: a 3 must earn it.
${anchorText("coherence")}
${VERDICT_FORMAT.replace('"score"', '"motif_slides": ["<slide labels where the motif is visible>"], "score"')}`;
export const CoherenceSchema = VerdictSchema.extend({ motif_slides: z.array(z.string()).optional() });

// ——— comprehension quiz ———
export const QUIZ_A_SYSTEM = `You write a comprehension quiz for a source text. You see ONLY the source.
Write exactly 8 questions that test whether someone understood the source's CORE ideas — prefer mechanisms (why/how X leads to Y) and relations (how A differs from / depends on B) over trivia (names, dates, exact numbers). Each question must be answerable in 1–2 sentences by someone who understood the source, and each must have a reference answer drawn from the source.
Spread the questions across the whole source, not just the opening.
Reply with ONLY JSON: {"questions": [{"id": "q1", "q": "...", "ref": "<reference answer, 1–2 sentences>", "kind": "mechanism"|"relation"|"fact"}, ... 8 items]}`;
export const QuizASchema = z.object({
  questions: z.array(z.object({ id: z.string(), q: z.string(), ref: z.string(), kind: z.enum(["mechanism", "relation", "fact"]) })).length(8),
});
export type QuizQuestions = z.infer<typeof QuizASchema>;

export const QUIZ_B_SYSTEM = `You are a reader who has ONLY seen the slide deck in these screenshots (each slide at rest, plus some states after its controls were operated). You have not read any source text, and you must not use outside knowledge about the topic — answer only from what the deck shows.
For each question, answer in 1–2 sentences, or say exactly "not covered" if the deck does not let you answer it.
Reply with ONLY JSON: {"answers": [{"id": "q1", "answer": "...", "from": "<which slide(s) you used>"}, ...]}`;
export const QuizBSchema = z.object({ answers: z.array(z.object({ id: z.string(), answer: z.string(), from: z.string().optional() })) });

export const QUIZ_C_SYSTEM = `You grade quiz answers against reference answers. You see the question, the reference answer, and the reader's answer. Be strict but fair: "correct" means the reader's answer contains the reference's key idea (wording may differ); "partial" means part of the key idea; "incorrect" means wrong, vague, or "not covered".
Reply with ONLY JSON: {"grades": [{"id": "q1", "grade": "correct"|"partial"|"incorrect", "why": "<one line>"}, ...]}`;
export const QuizCSchema = z.object({ grades: z.array(z.object({ id: z.string(), grade: z.enum(["correct", "partial", "incorrect"]), why: z.string() })) });
