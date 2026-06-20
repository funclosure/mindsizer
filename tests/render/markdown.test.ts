import { describe, it, expect } from "vitest";
import { blocks, inline, block } from "../../src/render/markdown";

describe("markdown wrapper", () => {
  it("splits a body into typed block tokens", () => {
    const toks = blocks("para one\n\n> a quote\n\n- a\n- b");
    const types = toks.map((t) => t.type);
    expect(types).toContain("paragraph");
    expect(types).toContain("blockquote");
    expect(types).toContain("list");
  });

  it("renders inline markdown (bold)", () => {
    expect(inline("**x**")).toContain("<strong>x</strong>");
  });

  it("renders block markdown (list items)", () => {
    expect(block("- a\n- b")).toContain("<li>a</li>");
  });
});
