import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

function options(systemPrompt: string) {
  return {
    systemPrompt,
    model: MODEL,
    permissionMode: "bypassPermissions",
    allowedTools: [],
    disallowedTools: [
      "Bash", "Read", "Write", "Edit", "Glob", "Grep",
      "Agent", "WebFetch", "WebSearch", "NotebookEdit",
    ],
    includePartialMessages: true,
  };
}

async function drain(q: AsyncIterable<SDKMessage>): Promise<string> {
  let text = "";
  for await (const msg of q) {
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

/** One isolated single-shot text turn → full assistant text. */
export async function runQuery(systemPrompt: string, userPrompt: string): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}

/** One isolated single-shot turn with an attached image (vision) → full assistant text. */
export async function runVisionQuery(
  systemPrompt: string,
  userText: string,
  pngBase64: string,
): Promise<string> {
  async function* gen() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
          { type: "text", text: userText },
        ],
      },
      parent_tool_use_id: null,
      session_id: "mindsizer",
    };
  }
  const q = query({ prompt: gen() as any, options: options(systemPrompt) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}
