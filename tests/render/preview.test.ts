import { describe, it, expect } from "vitest";
import { renderPreviewPage } from "../../src/render/preview";

describe("renderPreviewPage", () => {
  it("wraps a fragment into a full 16:9 page with theme + fonts inlined", () => {
    const page = renderPreviewPage('<section data-slide-id="s_x"></section>');
    expect(page).toContain("<!DOCTYPE html>");
    expect(page).toContain('data-slide-id="s_x"'); // the fragment
    expect(page).toContain("fonts.googleapis.com"); // fonts linked
    expect(page).toContain("--s-cyan"); // theme css inlined
    expect(page).toContain('name="viewport"');
  });
});
