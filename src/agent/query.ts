import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ModelChoice } from "./models";
import { startWatchdog, IDLE_TIMEOUT_MS } from "./timeout";
import { fromSdkUsage, ZERO_USAGE, type TokenUsage } from "./usage";
import { recordUsage } from "./usage-meter";
import { resolveRenderInput, type RenderEdit } from "./edit-ops";

const MODEL = process.env.MINDSIZER_MODEL || "claude-opus-4-8";

/** The model produced no assistant text at all — usually an unavailable/misspelled model id. */
export class EmptyReplyError extends Error {
  constructor(public readonly model: string) {
    super(
      `model "${model}" returned no output — is that model available to your session? ` +
        `Check the id, or override it for the failing role with MINDSIZER_<ROLE>_MODEL ` +
        `(ROLE = INGEST | AUTHOR | JUDGE | REVIEW), e.g. MINDSIZER_INGEST_MODEL=claude-opus-4-8.`,
    );
    this.name = "EmptyReplyError";
  }
}

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

/** One isolated single-shot text turn → full assistant text. Aborts on a 180s idle stall. */
export async function runQuery(systemPrompt: string, userPrompt: string, choice?: ModelChoice): Promise<string> {
  const ac = new AbortController();
  const q = query({ prompt: userPrompt as any, options: { ...options(systemPrompt, choice), abortController: ac } as any }) as any;
  const w = startWatchdog(IDLE_TIMEOUT_MS, () => ac.abort());
  const timeoutMsg = `model-call timed out — idle ${IDLE_TIMEOUT_MS / 1000}s`;
  let text = "";
  let usage: TokenUsage = ZERO_USAGE;
  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      w.kick();
      if (
        msg.type === "stream_event" &&
        msg.event?.type === "content_block_delta" &&
        msg.event.delta?.type === "text_delta" &&
        msg.event.delta.text
      ) {
        text += msg.event.delta.text;
      }
      if (msg.type === "result") { usage = fromSdkUsage((msg as any).usage); break; }
    }
  } catch (e) {
    if (w.fired) throw new Error(timeoutMsg);
    throw e;
  } finally {
    w.stop();
  }
  if (w.fired) throw new Error(timeoutMsg);
  recordUsage(choice?.model ?? MODEL, usage);
  if (!text.trim()) throw new EmptyReplyError(choice?.model ?? MODEL);
  return text;
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
  opts?: { initialHtml?: string },
): Promise<{ text: string; usage: TokenUsage }> {
  let lastHtml: string | undefined = opts?.initialHtml;
  const renderTool = tool(
    "render",
    "Render the slide at 1280x720 and return screenshots. Pass full `html` on the FIRST call; for revisions prefer `edits` — exact find/replace patches applied to your last-rendered html (each `old` must appear exactly once) — or call with neither to re-render the current html as-is. Optionally pass interaction steps to inspect interactive states.",
    {
      html: z.string().optional(),
      edits: z.array(z.object({ old: z.string(), new: z.string() })).optional(),
      interactions: z
        .array(z.object({ click: z.string().optional(), press: z.string().optional(), wait: z.number().optional() }))
        .optional(),
    },
    async (args: { html?: string; edits?: RenderEdit[]; interactions?: { click?: string; press?: string; wait?: number }[] }) => {
      const resolved = resolveRenderInput(lastHtml, args);
      if (!resolved.ok) {
        return { content: [{ type: "text" as const, text: `⚠ ${resolved.error}` }] };
      }
      lastHtml = resolved.html;
      const out = await tools.render(resolved.html, args.interactions);
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

  const ac = new AbortController();
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
      abortController: ac,
    } as any,
  }) as any;

  // A tool session emits several assistant turns ("let me render…" → tool → final HTML →
  // maybe a trailing "done!"). Prefer the LAST assistant turn that actually contains a
  // slide; fall back to the last assistant turn, then to streamed deltas. extractSlideHtml
  // is the final safety net, but the drain should already pick the right turn.
  const w = startWatchdog(IDLE_TIMEOUT_MS, () => ac.abort());
  const timeoutMsg = `model-call timed out — idle ${IDLE_TIMEOUT_MS / 1000}s`;
  let lastTurn = "";
  let lastSlideTurn = "";
  let streamed = "";
  let usage: TokenUsage = ZERO_USAGE;
  try {
    for await (const msg of q as AsyncIterable<any>) {
      w.kick();
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
      if (msg.type === "result") { usage = fromSdkUsage((msg as any).usage); break; }
    }
  } catch (e) {
    if (w.fired) throw new Error(timeoutMsg);
    throw e;
  } finally {
    w.stop();
  }
  if (w.fired) throw new Error(timeoutMsg);
  recordUsage(choice?.model ?? (process.env.MINDSIZER_MODEL || "claude-opus-4-8"), usage);
  return { text: lastSlideTurn || lastTurn || streamed, usage };
}
