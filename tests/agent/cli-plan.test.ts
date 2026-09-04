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

describe("mindsizer plan CLI (pre-LLM paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["plan"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer plan");
  });
  it("errors on a missing input file", () => {
    const r = runCli(["plan", "/no/such/file.txt"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });
  it("rejects an unknown option", () => {
    const r = runCli(["plan", "x.txt", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });
});
