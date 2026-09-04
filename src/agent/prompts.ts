import type { DigestResult, Direction, PlanInput } from "./model-client";

export interface Prompt {
  system: string;
  user: string;
}

export function digestPrompt(sourceText: string): Prompt {
  return {
    system:
      "You are mindsizer's digest stage. Extract the spine of a source for a learner: a working title, the ordered key claims/points, and a one-line characterization of the source. Respond with JSON only — no prose, no code fence: " +
      '{"title": string, "keyPoints": string[], "sourceCharacter": string}.',
    user: `Source:\n\n${sourceText}`,
  };
}

export function directionPrompt(digest: DigestResult): Prompt {
  return {
    system:
      "You are mindsizer's direction stage. Propose 2-3 distinct TEACH angles tailored to this specific source — the way a tutor asks 'do you want the mental model, or the build steps?'. Each angle aims how the explanation is framed. Respond with JSON only — an array of " +
      '{"id": kebab-case string, "label": short string, "description": one phrase}.',
    user: digestText(digest),
  };
}

export function outlinePrompt(digest: DigestResult, angle: Direction): Prompt {
  return {
    system: [
      "You are mindsizer's outline stage. Turn the digest into a comprehension-first slide outline that makes the idea CLICK, aimed by the chosen angle.",
      "Rules: one idea per slide; generous and low cognitive load; build understanding up.",
      "Each slide uses one of two layouts:",
      '- "analogy": a two-column comprehension frame. Its markdown MUST contain a concept explanation AND a blockquote (a line starting with >) giving a concrete analogy with a **bolded** source, e.g. > Like **office gossip** — everyone hears eventually.',
      '- "plain": a title plus body (paragraphs or a bullet list).',
      'Respond with JSON only: {"title": string, "slides": [{"title": string, "layout": "analogy"|"plain", "markdown": string}]}.',
    ].join("\n"),
    user: `Angle: ${angle.label} — ${angle.description}\n\n${digestText(digest)}`,
  };
}

export function artDirectionPrompt(digest: DigestResult, angle: Direction, titles: string[]): Prompt {
  return {
    system: [
      "You are mindsizer's ART-DIRECTION stage. Give the WHOLE deck one coherent identity so its slides read as one authored piece, not a pile of good slides.",
      "Choose: (1) conceit — a single controlling metaphor the whole deck can lean on (e.g. 'a ledger', 'a courtroom', 'a flight checklist'); (2) motif — a shared visual through-line; and per slide: (3) role — its distinct job so no two slides repeat the same point ('introduce the tension', 'formalize it', 'the counter-case'); (4) instrument — one interaction from the fixed palette, VARIED across slides.",
      'Instrument palette (use these exact strings): "slider","toggle","stepper","chart","dial","reveal","map","none".',
      'Respond with JSON only: {"conceit": string, "motif": string, "slides": [{"role": string, "instrument": <palette>}]} — the slides array MUST be the same length and order as the titles given.',
    ].join("\n"),
    user: `Angle: ${angle.label} — ${angle.description}\n\n${digestText(digest)}\n\nSlide titles (in order):\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
  };
}

export function planPrompt(input: PlanInput): Prompt {
  const system = [
    "You are mindsizer's PLANNING stage — the layer that decides what each slide must make the reader understand and HOW, before any visual design happens. A separate visual designer will implement your plan; it decides composition, typography, and how figures are drawn. You decide everything else.",
    "",
    "For EVERY slide, in the order given, produce:",
    "- claim: the one thing the reader should believe after this slide (one sentence).",
    "- mechanism: what actually moves — inputs, the relation, the output. Depict the mechanism, not its name: the picture must be able to show this.",
    "- device: { kind, operate?, changes?, resting }. kind is one of \"instrument\" (the reader operates a control and watches the concept respond), \"figure\" (a static diagram of the mechanism), \"comparison\" (two options side by side, the difference visible), \"sequence\" (a staged build or state progression), \"static\" (words and hierarchy only). For an instrument, operate = what the reader moves, changes = what visibly responds. resting = the state that must read alone with NO interaction, always.",
    "- aha: the specific moment or contrast the device exists to produce (required for an instrument).",
    "- data: when the mechanism is quantitative, the formula or the actual numbers to draw from — so the designer never invents.",
    "- source: the short source excerpt this slide is faithful to.",
    "Vary the device kinds across the deck; do not make every slide an instrument. Interaction must change understanding, never decorate.",
    "",
    "Also restate the deck's direction: conceit (one controlling metaphor), motif (a shared visual through-line), arc (one line: how the argument moves slide to slide).",
    "",
    'Respond with JSON only — no prose, no code fence: {"direction": {"conceit": string, "motif": string, "arc": string}, "slides": [{"claim": string, "mechanism": string, "device": {"kind": string, "operate"?: string, "changes"?: string, "resting": string}, "aha"?: string, "data"?: string, "source"?: string}]}. The slides array MUST be the same length and order as the slides given.',
  ].join("\n");
  const slides = input.slides
    .map((s, i) => `${i + 1}. ${s.title}\n${s.markdown}`)
    .join("\n\n");
  const user =
    `Angle: ${input.angle.label} — ${input.angle.description}\n\n` +
    digestText(input.digest) +
    (input.art ? `\n\nArt direction so far (advisory): conceit = ${input.art.conceit}; motif = ${input.art.motif}` : "") +
    `\n\nSlides (in order):\n\n${slides}\n\n` +
    `Full source text:\n\n${input.sourceText}`;
  return { system, user };
}

function digestText(d: DigestResult): string {
  return (
    `Digest:\ntitle: ${d.title}\ncharacter: ${d.sourceCharacter}\nkey points:\n` +
    d.keyPoints.map((p) => `- ${p}`).join("\n")
  );
}
