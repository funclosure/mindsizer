import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ModelChoice } from "./models";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

type SDKMessage = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
};

function options(systemPrompt: string, choice?: ModelChoice) {
  return {
    systemPrompt,
    model: choice?.model ?? MODEL,
    ...(choice?.effort ? { effort: choice.effort } : {}),
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
export async function runQuery(systemPrompt: string, userPrompt: string, choice?: ModelChoice): Promise<string> {
  const q = query({ prompt: userPrompt as any, options: options(systemPrompt, choice) as any }) as any;
  return drain(q as AsyncIterable<SDKMessage>);
}

export type RenderToolResult = { images: Buffer[] } | { text: string };

export interface AgenticTools {
  render(html: string, interactions?: { click?: string; press?: string; wait?: number }[]): Promise<RenderToolResult>;
}

/**
 * Run a tool-using authoring session: the model may call `render` to SEE its slide,
 * iterate, and finishes by emitting the final slide HTML as its last text.
 * Bounded: the ONLY tool is `render` (no fs, no Bash, no network).
 */
export async function runAgentic(
  systemPrompt: string,
  userPrompt: string,
  tools: AgenticTools,
  choice?: ModelChoice,
): Promise<string> {
  const renderTool = tool(
    "render",
    "Render the given slide HTML at 1280x720 and return screenshots. Optionally pass interaction steps to inspect interactive states.",
    {
      html: z.string(),
      interactions: z
        .array(z.object({ click: z.string().optional(), press: z.string().optional(), wait: z.number().optional() }))
        .optional(),
    },
    async (args: { html: string; interactions?: { click?: string; press?: string; wait?: number }[] }) => {
      const out = await tools.render(args.html, args.interactions);
      if ("text" in out) {
        return { content: [{ type: "text" as const, text: out.text }] };
      }
      return {
        content: out.images.map((png) => ({
          type: "image" as const,
          data: png.toString("base64"),
          mimeType: "image/png",
        })),
      };
    },
  );

  const server = createSdkMcpServer({ name: "mindsizer", version: "1.0.0", tools: [renderTool] });

  const q = query({
    prompt: userPrompt as any,
    options: {
      systemPrompt,
      model: choice?.model ?? (process.env.MINDSIZER_MODEL || "claude-opus-4-8"),
      ...(choice?.effort ? { effort: choice.effort } : {}),
      permissionMode: "bypassPermissions",
      mcpServers: { mindsizer: server },
      allowedTools: ["mcp__mindsizer__render"],
      disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "NotebookEdit", "Agent"],
      includePartialMessages: true,
    } as any,
  }) as any;

  // A tool session emits several assistant turns ("let me render…" → tool → final HTML →
  // maybe a trailing "done!"). Prefer the LAST assistant turn that actually contains a
  // slide; fall back to the last assistant turn, then to streamed deltas. extractSlideHtml
  // is the final safety net, but the drain should already pick the right turn.
  let lastTurn = "";
  let lastSlideTurn = "";
  let streamed = "";
  for await (const msg of q as AsyncIterable<any>) {
    if (
      msg.type === "stream_event" &&
      msg.event?.type === "content_block_delta" &&
      msg.event.delta?.type === "text_delta" &&
      msg.event.delta.text
    ) {
      streamed += msg.event.delta.text;
    }
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      const t = msg.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (t) {
        lastTurn = t;
        if (t.includes("<section")) lastSlideTurn = t;
      }
    }
    if (msg.type === "result") break;
  }
  return lastSlideTurn || lastTurn || streamed;
}
