import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", ["run", "src/cli.ts", ...args], { cwd: process.cwd(), stdio: "pipe" }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

describe("mindsizer fit (pre-browser paths)", () => {
  it("errors with usage when no file is given", () => {
    const r = runCli(["fit"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: mindsizer fit");
  });
  it("errors on a missing file", () => {
    const r = runCli(["fit", "/no/such/slide.html"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("cannot read");
  });
  it("exits 2 when the file has no usable <section data-slide-id>", () => {
    const dir = mkdtempSync(join(tmpdir(), "fit-"));
    const f = join(dir, "s_x.html");
    writeFileSync(f, "<div>not a slide</div>");
    const r = runCli(["fit", f]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no <section data-slide-id");
  });
  it("rejects malformed --steps JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "fit-"));
    const f = join(dir, "s_x.html");
    writeFileSync(f, '<section data-slide-id="s_x"></section>');
    const r = runCli(["fit", f, "--steps", "{nope"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--steps must be a JSON array");
  });
});
