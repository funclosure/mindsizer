import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

/** One isolated single-shot turn → full assistant text (loupe's query() pattern). */
export async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({
    prompt: userPrompt as any,
    options: {
      systemPrompt,
      model: MODEL,
      permissionMode: "bypassPermissions",
      allowedTools: [],
      disallowedTools: [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
        "Agent", "WebFetch", "WebSearch", "NotebookEdit",
      ],
      includePartialMessages: true,
    },
  }) as any;

  let text = "";
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (
      msg.type === "stream_event" &&
      msg.event?.type === "content_block_delta" &&
      msg.event.delta?.type === "text_delta" &&
      msg.event.delta.text
    ) {
      text += msg.event.delta.text;
    }
    if (msg.type === "result") break;
  }
  return text;
}
