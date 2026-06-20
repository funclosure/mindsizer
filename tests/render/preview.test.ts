import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("honors an explicit cssPath override", () => {
    const tmp = join(tmpdir(), `field-${Date.now()}.css`);
    writeFileSync(tmp, ".s-test{color:red}", "utf8");
    try {
      const page = renderPreviewPage('<section data-slide-id="s_x"></section>', {
        cssPath: tmp,
      });
      expect(page).toContain(".s-test{color:red}");
    } finally {
      rmSync(tmp);
    }
  });
});
