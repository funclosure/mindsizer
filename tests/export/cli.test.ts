import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_a layout=analogy -->
# A

concept here

> the **analogy**

---

<!-- slide id=s_b layout=plain -->
# B

- x
`;

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("mindsizer CLI", () => {
  it("seals a deck file end-to-end", () => {
    dir = mkdtempSync(join(tmpdir(), "mindsizer-cli-"));
    const mdPath = join(dir, "deck.md");
    writeFileSync(mdPath, SAMPLE);
    const outPath = join(dir, "deck.html");
    execFileSync("bun", ["run", "src/cli.ts", mdPath, "-o", outPath], {
      cwd: process.cwd(),
    });
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain('data-slide-id="s_a"');
    expect(html).toContain('data-slide-id="s_b"');
    expect(html).toContain("data:font/woff2;base64,");
  });

  it("exits non-zero for a missing input file", () => {
    expect(() =>
      execFileSync("bun", ["run", "src/cli.ts", "/no/such/file.md"], {
        cwd: process.cwd(),
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("reports invalid-outline errors on stderr and exits non-zero", () => {
    dir = mkdtempSync(join(tmpdir(), "mindsizer-cli-"));
    const mdPath = join(dir, "bad.md");
    // valid frontmatter but a slide missing its # heading → validateOutline fails
    writeFileSync(
      mdPath,
      "---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_a layout=plain -->\n\nbody only, no heading\n",
    );
    let stderr = "";
    try {
      execFileSync("bun", ["run", "src/cli.ts", mdPath], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e: any) {
      stderr = String(e.stderr ?? "");
    }
    expect(stderr).toContain("invalid outline");
  });

  it("names the slide + layout for an unsupported layout on stderr", () => {
    dir = mkdtempSync(join(tmpdir(), "mindsizer-cli-"));
    const mdPath = join(dir, "bespoke.md");
    writeFileSync(
      mdPath,
      "---\ntitle: T\npurpose: teach\ntheme: field\n---\n\n<!-- slide id=s_x layout=bespoke -->\n# X\n\nbody\n",
    );
    let stderr = "";
    try {
      execFileSync("bun", ["run", "src/cli.ts", mdPath], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
      throw new Error("expected non-zero exit");
    } catch (e: any) {
      stderr = String(e.stderr ?? "");
    }
    expect(stderr).toContain("slide s_x uses layout 'bespoke'");
    expect(stderr).toContain("no static renderer yet");
  });
});
