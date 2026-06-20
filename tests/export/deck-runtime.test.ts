import { describe, it, expect } from "vitest";
import { DECK_CSS, NAV_JS } from "../../src/export/deck-runtime";

describe("deck runtime", () => {
  it("DECK_CSS targets the active slide and the deck sections", () => {
    expect(DECK_CSS).toContain("section[data-slide-id]");
    expect(DECK_CSS).toContain(".is-active");
    expect(DECK_CSS).toContain(".deck-progress");
  });

  it("NAV_JS handles arrow keys and updates counter + progress", () => {
    expect(NAV_JS).toContain("ArrowRight");
    expect(NAV_JS).toContain("ArrowLeft");
    expect(NAV_JS).toContain("deck-counter");
    expect(NAV_JS).toContain("deck-progress");
  });
});
