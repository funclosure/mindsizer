import type { DigestResult, Direction } from "./model-client";

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

function digestText(d: DigestResult): string {
  return (
    `Digest:\ntitle: ${d.title}\ncharacter: ${d.sourceCharacter}\nkey points:\n` +
    d.keyPoints.map((p) => `- ${p}`).join("\n")
  );
}
