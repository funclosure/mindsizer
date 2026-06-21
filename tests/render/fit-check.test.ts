import { describe, it, expect, afterAll } from "vitest";
import { playwrightFitChecker } from "../../src/render/fit-check";

const theme = `
  section[data-slide-id]{box-sizing:border-box;padding:40px;font-family:sans-serif;overflow:hidden;}
  .s-title{font-size:40px;margin:0 0 20px;}
  .s-body{font-size:16px;line-height:1.5;}
`;
const checker = playwrightFitChecker(theme);
afterAll(async () => {
  await checker.dispose();
});

describe("playwrightFitChecker", () => {
  it("reports a small slide as fitting", async () => {
    const r = await checker.check(
      `<section data-slide-id="a"><h2 class="s-title">Hi</h2><p class="s-body">One tidy line.</p></section>`,
    );
    expect(r.fits).toBe(true);
    expect(r.overflowPx).toBeLessThanOrEqual(2);
  }, 30000);

  it("reports a tall slide as overflowing, with a positive overflowPx", async () => {
    const many = Array.from(
      { length: 50 },
      (_, i) => `<p class="s-body">Line ${i}: lorem ipsum dolor sit amet consectetur adipiscing.</p>`,
    ).join("");
    const r = await checker.check(
      `<section data-slide-id="b"><h2 class="s-title">Tall</h2>${many}</section>`,
    );
    expect(r.fits).toBe(false);
    expect(r.overflowPx).toBeGreaterThan(0);
  }, 30000);
});
