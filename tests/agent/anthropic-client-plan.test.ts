import { describe, it, expect, vi, beforeEach } from "vitest";

const runQuery = vi.fn();
vi.mock("../../src/agent/query", () => ({ runQuery: (...a: unknown[]) => runQuery(...a) }));

import { anthropicClient, PlanParseError } from "../../src/agent/anthropic-client";

const input = {
  sourceText: "src",
  digest: { title: "T", keyPoints: ["k"], sourceCharacter: "essay" },
  angle: { id: "a", label: "A", description: "d" },
  slides: [{ title: "One", markdown: "m1" }, { title: "Two", markdown: "m2" }],
};
const slide = { claim: "c", mechanism: "m", device: { kind: "static", resting: "r" } };
const good = JSON.stringify({ direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide, slide] });

describe("anthropicClient.planDeck", () => {
  beforeEach(() => runQuery.mockReset());

  it("returns the parsed plan on a clean reply", async () => {
    runQuery.mockResolvedValueOnce(good);
    const p = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input);
    expect(p.slides).toHaveLength(2);
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("retries once with the schema error in the prompt, then succeeds", async () => {
    const short = JSON.stringify({ direction: { conceit: "a", motif: "b", arc: "c" }, slides: [slide] });
    runQuery.mockResolvedValueOnce(short).mockResolvedValueOnce(good);
    const p = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input);
    expect(p.slides).toHaveLength(2);
    expect(runQuery).toHaveBeenCalledTimes(2);
    const retryUser = runQuery.mock.calls[1][1] as string;
    expect(retryUser).toMatch(/expected exactly 2 slides/);
  });

  it("throws PlanParseError carrying the raw reply after the second failure", async () => {
    runQuery.mockResolvedValueOnce("not json").mockResolvedValueOnce("still not json");
    const err = await anthropicClient({ model: "m", effort: "low" }).planDeck!(input).catch((e) => e);
    expect(err).toBeInstanceOf(PlanParseError);
    expect((err as PlanParseError).raw).toBe("still not json");
  });
});
