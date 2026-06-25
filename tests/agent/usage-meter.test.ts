import { describe, it, expect, beforeEach } from "vitest";
import { recordUsage, snapshotUsage, resetUsage } from "../../src/agent/usage-meter";

const u = (input: number, output: number, cacheRead = 0, cacheCreate = 0) => ({ input, output, cacheRead, cacheCreate });

describe("usage-meter", () => {
  beforeEach(() => resetUsage());
  it("accumulates per model across calls", () => {
    recordUsage("opus", u(10, 1));
    recordUsage("opus", u(20, 2));
    recordUsage("haiku", u(5, 1));
    expect(snapshotUsage()).toEqual({ opus: u(30, 3), haiku: u(5, 1) });
  });
  it("resetUsage clears the meter", () => {
    recordUsage("opus", u(10, 1));
    resetUsage();
    expect(snapshotUsage()).toEqual({});
  });
});
