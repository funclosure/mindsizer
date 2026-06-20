import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stderr: string } {
  try {
    execFileSync("bun", ["run", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer ingest CLI (pre-LLM paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["ingest"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer ingest");
  });

  it("errors on a missing input file", () => {
    const r = runCli(["ingest", "/no/such/file.txt"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });

  it("rejects an unknown ingest option", () => {
    const r = runCli(["ingest", "x.txt", "--wat"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown option --wat");
  });
});
