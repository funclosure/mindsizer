import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("theme/field.css", () => {
  it("defines the Field tokens and the slide frame + analogy classes", () => {
    const css = readFileSync(
      join(process.cwd(), "theme", "field.css"),
      "utf8",
    );
    expect(css).toContain("--s-cyan");
    expect(css).toContain("#4DD9E0"); // the cyan accent
    expect(css).toContain("section[data-slide-id]"); // the frame selector
    expect(css).toContain("aspect-ratio"); // 16:9 frame
    expect(css).toContain(".s-analogy");
    expect(css).toContain("Fraunces");
  });
});
