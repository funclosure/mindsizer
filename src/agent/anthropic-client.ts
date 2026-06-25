import type { ZodType } from "zod";
import {
  type ModelClient,
  DigestSchema,
  DirectionsSchema,
  DraftDeckSchema,
} from "./model-client";
import { digestPrompt, directionPrompt, outlinePrompt } from "./prompts";
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
  };
}
