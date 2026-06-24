import { describe, it, expect } from "vitest";
import { mapPool } from "../../src/render/pool";

describe("mapPool", () => {
  it("returns [] for empty input", async () => {
    expect(await mapPool([], 3, async () => 1)).toEqual([]);
  });

  it("maps every item, preserving input order, as ok results", async () => {
    const r = await mapPool([1, 2, 3], 2, async (n) => n * 10);
    expect(r).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it("passes the index to fn", async () => {
    const r = await mapPool(["a", "b"], 2, async (_x, i) => i);
    expect(r).toEqual([{ ok: true, value: 0 }, { ok: true, value: 1 }]);
  });

  it("isolates a throwing task without rejecting the batch", async () => {
    const r = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(r[0]).toEqual({ ok: true, value: 1 });
    expect(r[1].ok).toBe(false);
    expect((r[1] as { ok: false; error: unknown }).error).toBeInstanceOf(Error);
    expect(r[2]).toEqual({ ok: true, value: 3 });
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    });
    expect(peak).toBe(2);
  });

  it("clamps a concurrency below 1 up to 1", async () => {
    let active = 0;
    let peak = 0;
    await mapPool([1, 2, 3], 0, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    });
    expect(peak).toBe(1);
  });
});
