// eval/lib/judge.ts — isolated model-judge calls for the eval scorer (Claude Agent SDK).
// Every call is a fresh SDK session: no shared context between criteria. Images go in as
// base64 PNG content blocks so judges grade the RENDERED artifact, not its code.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { fromSdkUsage, ZERO_USAGE, addUsage, type TokenUsage } from "../../src/agent/usage";
import { costUsd } from "../../src/agent/pricing";

export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "claude-opus-5-5";
export const JUDGE_EFFORT = (process.env.EVAL_JUDGE_EFFORT || "medium") as "low" | "medium" | "high";
const IDLE_MS = 300_000;

/** Global cap on concurrent judge sessions (each one is a child `claude` process). */
const MAX_CONCURRENT = Number(process.env.EVAL_CONCURRENCY || 6);
let active = 0;
const waiters: (() => void)[] = [];
export async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

export const text = (t: string): Block => ({ type: "text", text: t });
export const image = (png: Buffer): Block => ({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });

/** Running usage across every judge call in this process (for the report's eval-cost line). */
export const judgeUsage = { usage: ZERO_USAGE as TokenUsage, calls: 0 };
export function judgeCostUsd(): number { return costUsd(judgeUsage.usage, JUDGE_MODEL); }

const NO_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "Task", "WebFetch", "WebSearch", "NotebookEdit", "TodoWrite", "Skill", "ToolSearch"];

async function* oneMessage(blocks: Block[]) {
  yield { type: "user" as const, message: { role: "user" as const, content: blocks }, parent_tool_use_id: null, session_id: "" };
}

interface DrainResult { text: string; usage: TokenUsage }

async function drain(q: AsyncIterable<any>, ac: AbortController): Promise<DrainResult> {
  let last = "";
  let streamed = "";
  let usage: TokenUsage = ZERO_USAGE;
  let timer = setTimeout(() => ac.abort(), IDLE_MS);
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), IDLE_MS); };
  let resultError: string | undefined;
  try {
    for await (const msg of q) {
      kick();
      if (msg.type === "stream_event" && msg.event?.type === "content_block_delta" && msg.event.delta?.type === "text_delta") {
        streamed += msg.event.delta.text ?? "";
      }
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        const t = msg.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (t.trim()) last = t;
      }
      if (msg.type === "result") {
        usage = fromSdkUsage(msg.usage);
        if (msg.is_error) resultError = String(msg.result ?? msg.subtype);
        break;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (ac.signal.aborted) throw new Error(`judge call idle > ${IDLE_MS / 1000}s`);
  judgeUsage.usage = addUsage(judgeUsage.usage, usage);
  judgeUsage.calls++;
  const out = last || streamed;
  if (!out.trim()) throw new Error(`judge returned no text${resultError ? `: ${resultError}` : ""}`);
  return { text: out, usage };
}

/** One isolated, tool-less judge call → raw text. Retries once on a transport/empty failure. */
export async function judgeCall(system: string, blocks: Block[]): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    try {
      return await limited(async () => {
      const q = query({
        prompt: oneMessage(blocks) as any,
        options: {
          systemPrompt: system,
          model: JUDGE_MODEL,
          effort: JUDGE_EFFORT,
          permissionMode: "bypassPermissions",
          allowedTools: [],
          disallowedTools: NO_TOOLS,
          includePartialMessages: true,
          maxTurns: 1,
          abortController: ac,
        } as any,
      });
      return (await drain(q as any, ac)).text;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Pull the last JSON object out of a reply (tolerates code fences and prose around it). */
export function extractJson(s: string): any {
  const fenced = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const c of fenced.reverse()) { try { return JSON.parse(c); } catch { /* try next */ } }
  // scan for the last balanced {...}
  for (let end = s.lastIndexOf("}"); end >= 0; end = s.lastIndexOf("}", end - 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = end; i >= 0; i--) {
      const ch = s[i];
      if (ch === '"' && s[i - 1] !== "\\") inStr = !inStr;
      if (inStr) continue;
      if (ch === "}") depth++;
      if (ch === "{") depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(i, end + 1)); } catch { break; }
      }
    }
  }
  throw new Error(`no JSON object in judge reply: ${s.slice(0, 300)}`);
}

/** Judge call whose reply must be JSON matching `schema`; one corrective retry. */
export async function judgeJson<T>(system: string, blocks: Block[], schema: z.ZodType<T>): Promise<T> {
  const first = await judgeCall(system, blocks);
  try {
    return schema.parse(extractJson(first));
  } catch (e) {
    const retry = await judgeCall(system, [...blocks, text(`\n\nYour previous reply could not be parsed (${(e as Error).message.slice(0, 300)}). Reply with ONLY the JSON object.`)]);
    return schema.parse(extractJson(retry));
  }
}

export type DriveAction =
  | { click: string }
  | { clickAt: [number, number] }
  | { press: string }
  | { drag: { from: [number, number]; to: [number, number]; steps?: number } }
  | { hover: [number, number] }
  | { hold: { at: [number, number]; ms: number } }
  | { type: string }
  | { wait: number };

export const DriveActionSchema = z.union([
  z.object({ click: z.string() }),
  z.object({ clickAt: z.tuple([z.number(), z.number()]) }),
  z.object({ press: z.string() }),
  z.object({ drag: z.object({ from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]), steps: z.number().optional() }) }),
  z.object({ hover: z.tuple([z.number(), z.number()]) }),
  z.object({ hold: z.object({ at: z.tuple([z.number(), z.number()]), ms: z.number() }) }),
  z.object({ type: z.string() }),
  z.object({ wait: z.number() }),
]);

export interface DriveOutcome { shots: Buffer[]; notes: string[] }

/**
 * An agentic judge that can DRIVE the slide through a `drive` tool (each call replays from the
 * resting state and returns a screenshot after every step). Returns the final text plus every
 * interacted screenshot it took (reused as the quiz's "interacted states").
 */
export async function judgeAgentic(
  system: string,
  blocks: Block[],
  drive: (actions: DriveAction[]) => Promise<DriveOutcome>,
  opts: { maxDrives?: number } = {},
): Promise<{ text: string; shots: Buffer[]; actions: DriveAction[][] }> {
  const maxDrives = opts.maxDrives ?? 6;
  const shots: Buffer[] = [];
  const actions: DriveAction[][] = [];
  const driveTool = tool(
    "drive",
    "Reload the slide at its resting state, perform the actions in order, and return one 1280x720 screenshot after EACH action. Coordinates are CSS px in the 1280x720 frame (origin top-left). Actions: {click: cssSelector} | {clickAt:[x,y]} | {press: key e.g. 'ArrowRight'} | {drag:{from:[x,y],to:[x,y],steps?}} | {hover:[x,y]} | {hold:{at:[x,y],ms}} (press-and-hold, screenshot taken just before release) | {type:'text'} | {wait: ms}. Max 6 actions per call.",
    { actions: z.array(DriveActionSchema).min(1).max(6) },
    async (args: { actions: DriveAction[] }) => {
      if (actions.length >= maxDrives) {
        return { content: [{ type: "text" as const, text: `Drive budget (${maxDrives} calls) used up. Give your final JSON verdict now.` }] };
      }
      actions.push(args.actions);
      const out = await drive(args.actions);
      shots.push(...out.shots);
      return {
        content: [
          { type: "text" as const, text: out.notes.join("\n") || "ok" },
          ...out.shots.map((png) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" })),
        ],
      };
    },
  );
  const server = createSdkMcpServer({ name: "evaldriver", version: "1.0.0", tools: [driveTool] });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    try {
      return await limited(async () => {
      const q = query({
        prompt: oneMessage(blocks) as any,
        options: {
          systemPrompt: system,
          model: JUDGE_MODEL,
          effort: JUDGE_EFFORT,
          permissionMode: "bypassPermissions",
          mcpServers: { evaldriver: server },
          allowedTools: ["mcp__evaldriver__drive"],
          disallowedTools: NO_TOOLS,
          includePartialMessages: true,
          maxTurns: maxDrives + 4,
          abortController: ac,
        } as any,
      });
      const r = await drain(q as any, ac);
      return { text: r.text, shots, actions };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export { addUsage };
