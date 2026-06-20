import type { Tokens } from "marked";
import { blocks, block } from "./markdown";

/** Map a slide's markdown body into a layout's named slots (agent-free). */
export function extractSlots(layout: string, body: string): Record<string, string> {
  if (layout === "analogy") return analogySlots(body);
  if (layout === "plain") return plainSlots(body);
  throw new Error(`no slot mapping for layout: ${layout}`);
}

/**
 * analogy layout convention: the FIRST blockquote becomes the analogy slot
 * (rendered block-aware so any content degrades gracefully); every other
 * non-space block becomes the concept (a second blockquote falls into the
 * concept). No blockquote → empty analogy. Slot HTML is trusted: it is
 * marked output over author-controlled markdown.
 */
function analogySlots(body: string): Record<string, string> {
  const toks = blocks(body);
  const firstBq = toks.find((t) => t.type === "blockquote") as
    | Tokens.Blockquote
    | undefined;

  const analogy = firstBq ? block(firstBq.text).trim() : "";
  const concept = toks
    .filter((t) => t !== firstBq && t.type !== "space")
    .map((t) => block(t.raw).trim())
    .join("\n");

  return { concept, analogy };
}

function plainSlots(body: string): Record<string, string> {
  return { body: block(body).trim() };
}
