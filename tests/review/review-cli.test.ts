import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer review CLI (pre-LLM paths)", () => {
  it("errors with usage when no outline is given", () => {
    const r = runCli(["review"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer review");
  });

  it("errors on a missing outline file", () => {
    const r = runCli(["review", "/no/such/file.md"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });

  it("rejects an unknown review option", () => {
    const r = runCli(["review", "x.md", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });

  it("rejects a bad --concurrency value", () => {
    const r = runCli(["review", "x.md", "--concurrency", "0"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--concurrency requires an integer");
  });
});
