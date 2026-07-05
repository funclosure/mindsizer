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
}, 30000); // chromium teardown can exceed vitest's 10s default under a heavier suite

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

  it("returns a non-empty PNG screenshot", async () => {
    const r = await checker.check(
      `<section data-slide-id="c"><h2 class="s-title">Shot</h2><p class="s-body">x</p></section>`,
    );
    expect(r.png).toBeDefined();
    expect((r.png as Buffer).length).toBeGreaterThan(0);
  }, 30000);
});

describe("render — resting-authoritative interaction overflow", () => {
  // resting fits; clicking expands a child but stays inside the 720 frame → must still fit
  const within = `<section data-slide-id="w"><div id="x" style="height:200px"></div><button id="go" onclick="document.getElementById('x').style.height='500px'">go</button></section>`;
  // resting fits; clicking grows the child past the frame → must be flagged
  const beyond = `<section data-slide-id="y"><div id="x" style="height:400px"></div><button id="go" onclick="document.getElementById('x').style.height='1200px'">go</button></section>`;
  // spills horizontally at rest → flagged
  const horiz = `<section data-slide-id="h"><div style="width:1400px;height:80px;background:#000"></div></section>`;

  it("ignores a within-frame expansion — still fits", async () => {
    const r = await checker.render(within, [{ click: "#go", wait: 60 }]);
    expect(r.fits).toBe(true);
  }, 30000);
  it("flags an expansion that grows past the frame", async () => {
    const r = await checker.render(beyond, [{ click: "#go", wait: 60 }]);
    expect(r.fits).toBe(false);
    expect(r.overflowPx).toBeGreaterThan(2);
  }, 30000);
  it("flags resting horizontal spill", async () => {
    const r = await checker.render(horiz);
    expect(r.fits).toBe(false);
  }, 30000);
});
