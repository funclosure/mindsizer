import { ZodError, type ZodType } from "zod";
import {
  type ModelClient,
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
  ArtDirectionSchema,
  deckPlanSchema,
  type DeckPlan,
  type PlanInput,
} from "./model-client";
import { digestPrompt, directionPrompt, outlinePrompt, artDirectionPrompt, planPrompt } from "./prompts";
import { parseValidated } from "./json";
import { runQuery } from "./query";
import { modelFor, type ModelChoice } from "./models";

/** Run a prompt, parse+validate; on a parse failure, retry once, then throw. */
async function ask<T>(
  system: string,
  user: string,
  schema: ZodType<T>,
  label: string,
  choice: ModelChoice,
): Promise<T> {
  try {
    return parseValidated(await runQuery(system, user, choice), schema);
  } catch {
    const retry = await runQuery(
      system,
      user + "\n\nReturn valid JSON only — no prose, no code fence.",
      choice,
    );
    try {
      return parseValidated(retry, schema);
    } catch {
      throw new Error(`could not parse ${label} output`);
    }
  }
}

/** The planner reply could not be parsed/validated twice; `raw` is the last reply, for inspection. */
export class PlanParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "PlanParseError";
  }
}

function issueText(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return (e as Error).message;
}

/** One planning call: on a schema/parse failure retry ONCE with the error spelled out, then throw PlanParseError. */
async function askPlan(input: PlanInput, choice: ModelChoice): Promise<DeckPlan> {
  const p = planPrompt(input);
  const schema = deckPlanSchema(input.slides.length);
  const first = await runQuery(p.system, p.user, choice);
  try {
    return parseValidated(first, schema);
  } catch (e) {
    const retry = await runQuery(
      p.system,
      p.user + `\n\nYour previous reply was rejected: ${issueText(e)}. Return valid JSON only — no prose, no code fence.`,
      choice,
    );
    try {
      return parseValidated(retry, schema);
    } catch (e2) {
      throw new PlanParseError(`could not parse plan output: ${issueText(e2)}`, retry);
    }
  }
}

/** Real ModelClient over the Claude Agent SDK (auth: Claude Code session / ANTHROPIC_API_KEY). */
export function anthropicClient(choice: ModelChoice = modelFor("ingest")): ModelClient {
  return {
    async digest(sourceText) {
      const p = digestPrompt(sourceText);
      return ask(p.system, p.user, DigestSchema, "digest", choice);
    },
    async proposeDirections(digest) {
      const p = directionPrompt(digest);
      return ask(p.system, p.user, DirectionsSchema, "direction", choice);
    },
    async generateOutline(digest, angle) {
      const p = outlinePrompt(digest, angle);
      return ask(p.system, p.user, DraftDeckSchema, "outline", choice);
    },
    async directArt(digest, angle, titles) {
      const p = artDirectionPrompt(digest, angle, titles);
      return ask(p.system, p.user, ArtDirectionSchema, "art-direction", choice);
    },
    async planDeck(input) {
      return askPlan(input, choice);
    },
  };
}
