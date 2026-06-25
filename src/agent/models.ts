export type Role = "author" | "ingest" | "judge";
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelChoice { model: string; effort: EffortLevel; }

const DEFAULTS: Record<Role, ModelChoice> = {
  author: { model: "claude-opus-4-8", effort: "medium" },
  ingest: { model: "claude-sonnet-4-6", effort: "medium" },
  judge: { model: "claude-haiku-4-5-20251001", effort: "low" },
};
const ROLE_KEY: Record<Role, string> = { author: "AUTHOR", ingest: "INGEST", judge: "JUDGE" };
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Resolve (model, effort) for a role: per-role env > legacy MINDSIZER_MODEL > role default. */
export function modelFor(role: Role, env: Record<string, string | undefined> = process.env): ModelChoice {
  const d = DEFAULTS[role];
  const key = ROLE_KEY[role];
  const model = env[`MINDSIZER_${key}_MODEL`] || env.MINDSIZER_MODEL || d.model;
  const e = env[`MINDSIZER_${key}_EFFORT`];
  const effort = e && (EFFORTS as string[]).includes(e) ? (e as EffortLevel) : d.effort;
  return { model, effort };
}
