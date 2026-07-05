// tests/review/deck-review.test.ts
import { describe, it, expect, vi } from "vitest";

let reply: string;
const seen: { system: string; user: string }[] = [];

vi.mock("../../src/agent/query", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/agent/query")>();
  return { ...mod, runQuery: vi.fn(async (system: string, user: string) => { seen.push({ system, user }); return reply; }) };
});

import { reviewDeckCoherence } from "../../src/review/deck-review";

const slides = [
  { id: "s_a", title: "A", text: "alpha body text" },
  { id: "s_b", title: "B", text: "beta body text" },
];

describe("reviewDeckCoherence", () => {
  it("sends every slide's title+text and returns parsed findings", async () => {
    seen.length = 0;
    reply = JSON.stringify({ findings: [{ slideId: "s_b", check: "coherence", severity: "low", summary: "dup", detail: "repeats A", suggestion: "merge" }] });
    const out = await reviewDeckCoherence("Deck", "angle", slides);
    expect(seen[0].user).toContain("alpha body text");
    expect(seen[0].user).toContain("beta body text");
    expect(out).toHaveLength(1);
    expect(out[0].slideId).toBe("s_b");
  });

  it("accepts deck-level findings (slideId null) and empty lists", async () => {
    reply = JSON.stringify({ findings: [{ slideId: null, check: "coherence", severity: "medium", summary: "s", detail: "d", suggestion: "x" }] });
    expect((await reviewDeckCoherence("D", "a", slides))[0].slideId).toBeNull();
    reply = JSON.stringify({ findings: [] });
    expect(await reviewDeckCoherence("D", "a", slides)).toEqual([]);
  });

  it("fails open (returns []) when the model reply is unparseable", async () => {
    reply = "not json";
    expect(await reviewDeckCoherence("D", "a", slides)).toEqual([]);
  });
});

describe("reviewDeckCoherence — controlling metaphor", () => {
  it("threads the conceit + motif into the coherence prompt when a direction is given", async () => {
    reply = JSON.stringify({ findings: [] });
    await reviewDeckCoherence("D", "a", slides, { conceit: "a ledger", motif: "ruled lines" });
    const last = seen[seen.length - 1];
    expect(last.user).toContain("a ledger");
    expect(last.user).toContain("ruled lines");
    expect(last.user).toMatch(/one controlling metaphor/i);
  });
  it("omits the metaphor line when no direction is given", async () => {
    reply = JSON.stringify({ findings: [] });
    await reviewDeckCoherence("D", "a", slides);
    expect(seen[seen.length - 1].user).not.toMatch(/one controlling metaphor/i);
  });
});
