import { describe, it, expect } from "vitest";
import { fontFaceCss } from "../../src/export/fonts";

describe("fontFaceCss", () => {
  it("emits base64 @font-face rules for the Field families", () => {
    const css = fontFaceCss();
    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"Fraunces"');
    expect(css).toContain('font-family:"Geist"');
    expect(css).toContain('font-family:"Geist Mono"');
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain("font-style:italic"); // Fraunces italic face
  });
});
