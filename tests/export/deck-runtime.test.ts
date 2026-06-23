import { describe, it, expect } from "vitest";
import { DECK_CSS, NAV_JS } from "../../src/export/deck-runtime";

describe("deck runtime", () => {
  it("DECK_CSS targets the active slide and the deck sections", () => {
    expect(DECK_CSS).toContain("section[data-slide-id]");
    expect(DECK_CSS).toContain(".is-active");
    expect(DECK_CSS).toContain(".deck-progress");
  });

  it("hides non-active slides with !important so bespoke inline styles can't override", () => {
    expect(DECK_CSS).toContain("display: none !important");
    expect(DECK_CSS).toContain("display: flex !important");
  });

  it("forces every slide to a fixed 1280x720 stage scaled to fit (uniform size, WYSIWYG)", () => {
    expect(DECK_CSS).toContain("width: 1280px !important");
    expect(DECK_CSS).toContain("height: 720px !important");
    expect(DECK_CSS).toContain("transform: scale(var(--deck-scale");
    // position/inset forced too, so an authored position:absolute can't escape the stage
    expect(DECK_CSS).toContain("position: relative !important");
  });

  it("NAV_JS recomputes the scale on load and resize", () => {
    expect(NAV_JS).toContain("--deck-scale");
    expect(NAV_JS).toContain("resize");
  });

  it("NAV_JS handles arrow keys and updates counter + progress", () => {
    expect(NAV_JS).toContain("ArrowRight");
    expect(NAV_JS).toContain("ArrowLeft");
    expect(NAV_JS).toContain("deck-counter");
    expect(NAV_JS).toContain("deck-progress");
  });
});
