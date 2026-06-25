import { describe, it, expect } from "vitest";
import { startWatchdog } from "../../src/agent/timeout";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startWatchdog", () => {
  it("fires onIdle after ms with no kicks", async () => {
    let n = 0;
    const w = startWatchdog(20, () => n++);
    await wait(50);
    expect(n).toBe(1);
    expect(w.fired).toBe(true);
    w.stop();
  });
  it("does not fire while kicked", async () => {
    let n = 0;
    const w = startWatchdog(40, () => n++);
    for (let i = 0; i < 5; i++) { await wait(15); w.kick(); }
    expect(n).toBe(0);
    expect(w.fired).toBe(false);
    w.stop();
  });
  it("latches — does not fire twice", async () => {
    let n = 0;
    const w = startWatchdog(15, () => n++);
    await wait(60);
    expect(n).toBe(1);
    w.stop();
  });
  it("stop() prevents firing", async () => {
    let n = 0;
    const w = startWatchdog(20, () => n++);
    w.stop();
    await wait(40);
    expect(n).toBe(0);
  });
});
