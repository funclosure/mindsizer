import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer brief", () => {
  it("prints the author identity brief with the Field aesthetic by default", () => {
    const r = runCli(["brief"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Aesthetic — Field");
    expect(r.stdout).toContain("1280x720");
    expect(r.stdout).toContain("data-slide-id");
  });
  it("honours --theme", () => {
    const r = runCli(["brief", "--theme", "paper"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("Aesthetic — Field");
  });
  it("fails on an unknown theme", () => {
    const r = runCli(["brief", "--theme", "nope"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("unknown theme");
  });
});
