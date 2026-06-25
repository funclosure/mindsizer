import { ZERO_USAGE, addUsage, type TokenUsage } from "./usage";

const meter = new Map<string, TokenUsage>();

/** Accumulate token usage under a model id (called after every model call). */
export function recordUsage(model: string, u: TokenUsage): void {
  meter.set(model, addUsage(meter.get(model) ?? ZERO_USAGE, u));
}

/** Per-model summed usage since the last reset. */
export function snapshotUsage(): Record<string, TokenUsage> {
  return Object.fromEntries(meter);
}

/** Clear the meter (call at the start of each command). */
export function resetUsage(): void {
  meter.clear();
}
