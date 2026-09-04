import { describe, it, expect, vi, beforeEach } from "vitest";

const runQuery = vi.fn();
vi.mock("../../src/agent/query", () => ({
  runQuery: (...a: unknown[]) => runQuery(...a),
  EmptyReplyError: class EmptyReplyError extends Error {
    constructor(public readonly model: string) {
      super(`model "${model}" returned no output`);
      this.name = "EmptyReplyError";
    }
  },
}));

import { anthropicClient } from "../../src/agent/anthropic-client";
import { EmptyReplyError } from "../../src/agent/query";

const good = JSON.stringify({ title: "T", keyPoints: ["k"], sourceCharacter: "essay" });

describe("anthropicClient.digest (via ask)", () => {
  beforeEach(() => runQuery.mockReset());

  it("returns the parsed digest on a clean reply", async () => {
    runQuery.mockResolvedValueOnce(good);
    const d = await anthropicClient({ model: "m", effort: "low" }).digest("src");
    expect(d.title).toBe("T");
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("retries once on a normal parse failure, then succeeds (regression guard)", async () => {
    runQuery.mockResolvedValueOnce("not json").mockResolvedValueOnce(good);
    const d = await anthropicClient({ model: "m", effort: "low" }).digest("src");
    expect(d.title).toBe("T");
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("throws a generic parse error after two normal failures (regression guard)", async () => {
    runQuery.mockResolvedValueOnce("not json").mockResolvedValueOnce("still not json");
    const err = await anthropicClient({ model: "m", effort: "low" })
      .digest("src")
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/could not parse digest output/);
  });

  it("propagates EmptyReplyError without retrying", async () => {
    const emptyErr = new EmptyReplyError("claude-fable-5-1");
    runQuery.mockRejectedValueOnce(emptyErr);
    const err = await anthropicClient({ model: "m", effort: "low" })
      .digest("src")
      .catch((e) => e);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(err).toBe(emptyErr);
    expect(err).toBeInstanceOf(EmptyReplyError);
  });
});
