import { describe, it, expect } from "vitest";
import { loadTheme, listThemes } from "../../src/theme/load";

describe("loadTheme", () => {
  it("loads field from disk", () => {
    const t = loadTheme("field");
    expect(t.name).toBe("field");
    expect(t.css).toContain("section[data-slide-id]");
    expect(t.fontFaceCss).toContain("@font-face");
    expect(t.fontFaceCss).toContain("base64,");
    expect(t.brief).toContain("## Aesthetic");
  });
  it("loads paper from disk (light palette)", () => {
    const t = loadTheme("paper");
    expect(t.css).toContain("#faf7f0");
    expect(t.brief).toMatch(/paper|editorial/i);
  });
  it("lists available themes", () => {
    expect(listThemes().sort()).toEqual(expect.arrayContaining(["field", "paper"]));
  });
  it("throws on unknown theme with the available list", () => {
    expect(() => loadTheme("nope")).toThrow(/unknown theme 'nope'.*field/i);
  });
});
