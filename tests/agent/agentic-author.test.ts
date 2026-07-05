// tests/agent/agentic-author.test.ts
import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import type { AgenticTools } from "../../src/agent/query";
import { FINALIZE_CLEAN } from "../../src/render/converge";
import type { AuthorRequest } from "../../src/render/design-brief";
import type { SlideRenderer, RenderResult } from "../../src/render/fit-check";

// Simulated model script: what the fake runAgentic does with the tools it receives.
let script: (tools: AgenticTools) => Promise<string>;

vi.mock("../../src/agent/query", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/agent/query")>();
  return {
    ...mod,
    runAgentic: vi.fn(async (_system: string, _user: string, tools: AgenticTools) => {
      const text = await script(tools);
      return { text, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } };
    }),
  };
});

const { agenticAuthor } = await import("../../src/agent/agentic-author");

const req: AuthorRequest = {
  slide: { id: "s_t", layout: "bespoke", title: "T", markdown: "m" },
  deck: { title: "D", slideTitles: ["T"] },
  materials: { digest: [], angle: "", neighborTitles: [] },
};

const CLEAN_HTML = `<section data-slide-id="s_t" data-layout="bespoke">real content</section>`;

function cleanRenderer(): SlideRenderer {
  return {
    render: async (): Promise<RenderResult> =>
      ({ shots: [Buffer.from("png")], overflowPx: 0, fits: true, consoleErrors: [] }),
    check: async () => ({ fits: true, overflowPx: 0, detail: "fits" }),
    dispose: async () => {},
  };
}

describe("agenticAuthor sealing", () => {
  it("seals the best rendered candidate and discards the model's final DONE text", async () => {
    script = async (tools) => {
      const out = await tools.render(CLEAN_HTML);
      expect(out).toEqual({ text: FINALIZE_CLEAN }); // clean render → finalize message, no screenshots
      return "DONE";
    };
    const author = agenticAuthor(cleanRenderer());
    const slide = await author.authorSlide(req);
    expect(slide.html).toContain("real content");
    expect(slide.html).not.toBe("DONE");
  });

  it("falls back to the model's text when it never rendered", async () => {
    script = async () => `<section data-slide-id="s_t" data-layout="bespoke">typed, never rendered</section>`;
    const author = agenticAuthor(cleanRenderer());
    const slide = await author.authorSlide(req);
    expect(slide.html).toContain("typed, never rendered");
  });

  it("short-circuits post-seal renders — renderer runs once, post-seal replies are finalize text", async () => {
    const renderSpy = vi.fn(async (): Promise<RenderResult> =>
      ({ shots: [Buffer.from("png")], overflowPx: 0, fits: true, consoleErrors: [] }));
    const renderer: SlideRenderer = {
      render: renderSpy,
      check: async () => ({ fits: true, overflowPx: 0, detail: "fits" }),
      dispose: async () => {},
    };
    script = async (tools) => {
      const first = await tools.render(CLEAN_HTML); // pass 1 → clean → seals
      const a = await tools.render(CLEAN_HTML);      // post-seal → short-circuit, no render
      const b = await tools.render(CLEAN_HTML);      // post-seal → short-circuit, no render
      expect(first).toEqual({ text: FINALIZE_CLEAN });
      expect("text" in a && "text" in b).toBe(true);
      return "DONE";
    };
    const slide = await agenticAuthor(renderer).authorSlide(req);
    expect(renderSpy).toHaveBeenCalledTimes(1); // only the pre-seal render actually ran
    expect(slide.html).toContain("real content"); // sealed = the first clean candidate
  });
});
