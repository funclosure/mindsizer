import { describe, it, expect } from "vitest";
import { applyEdits, resolveRenderInput } from "../../src/agent/edit-ops";

const BASE = `<style>#s .t{font-size:28px}</style><section id="s"><h1>Title</h1><p>Body text</p></section>`;

describe("applyEdits", () => {
  it("applies a single unique edit", () => {
    const r = applyEdits(BASE, [{ old: "font-size:28px", new: "font-size:24px" }]);
    expect(r).toEqual({ ok: true, html: BASE.replace("font-size:28px", "font-size:24px") });
  });

  it("applies edits sequentially, later edits seeing earlier results", () => {
    const r = applyEdits("aaa-bbb", [
      { old: "bbb", new: "ccc" },
      { old: "aaa-ccc", new: "done" },
    ]);
    expect(r).toEqual({ ok: true, html: "done" });
  });

  it("fails when old is not found, naming the edit", () => {
    const r = applyEdits(BASE, [{ old: "nope", new: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/edit #1.*not found/);
  });

  it("fails when old is not unique, naming the edit", () => {
    const bad = applyEdits("dup dup", [{ old: "dup", new: "x" }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/edit #1.*more than once/);
  });

  it("fails on an empty old string", () => {
    const r = applyEdits(BASE, [{ old: "", new: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/edit #1.*empty/);
  });

  it("no edits → base unchanged", () => {
    expect(applyEdits(BASE, [])).toEqual({ ok: true, html: BASE });
  });
});

describe("resolveRenderInput", () => {
  it("full html wins and is returned as-is", () => {
    const r = resolveRenderInput("old", { html: "<section>new</section>" });
    expect(r).toEqual({ ok: true, html: "<section>new</section>" });
  });

  it("edits apply against the last html", () => {
    const r = resolveRenderInput("<p>a</p>", { edits: [{ old: "a", new: "b" }] });
    expect(r).toEqual({ ok: true, html: "<p>b</p>" });
  });

  it("edits before any render → helpful error", () => {
    const r = resolveRenderInput(undefined, { edits: [{ old: "a", new: "b" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no previous render/);
  });

  it("neither html nor edits → helpful error", () => {
    const r = resolveRenderInput("<p>a</p>", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/provide `html`.*or `edits`/);
  });
});
