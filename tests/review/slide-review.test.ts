// tests/review/slide-review.test.ts
import { describe, it, expect, vi } from "vitest";
import type { AgenticTools } from "../../src/agent/query";

let script: (tools: AgenticTools, opts?: { initialHtml?: string }) => Promise<string>;
const calls: { system: string; user: string; opts?: { initialHtml?: string } }[] = [];

vi.mock("../../src/agent/query", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/agent/query")>();
  return {
    ...mod,
    runAgentic: vi.fn(async (system: string, user: string, tools: AgenticTools, _choice: unknown, opts?: { initialHtml?: string }) => {
      calls.push({ system, user, opts });
      const text = await script(tools, opts);
      return { text, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } };
    }),
  };
});

import { slideReviewer, REVIEW_RENDER_CAP } from "../../src/review/slide-review";

const FRAGMENT = `<style>#s_t{color:red}</style><section data-slide-id="s_t">real body</section>`;
const req = { id: "s_t", title: "T", angle: "the angle", digest: ["p1"], sourceExcerpt: "the source", fragment: FRAGMENT };
const shot = { shots: [Buffer.from("png")], overflowPx: 0, fits: true, consoleErrors: [] };
const renderer = { render: vi.fn(async () => shot) };

describe("slideReviewer", () => {
  it("seeds the fragment, forwards interactions to the renderer, and returns parsed findings", async () => {
    calls.length = 0;
    script = async (tools) => {
      const r = await tools.render(FRAGMENT, [{ click: "#btn" }]);
      expect("images" in r).toBe(true);
      return JSON.stringify({ findings: [{ check: "visual", severity: "medium", summary: "dead space", detail: "band", suggestion: "tighten" }] });
    };
    const findings = await slideReviewer(renderer)(req);
    expect(calls[0].opts?.initialHtml).toBe(FRAGMENT);
    expect(calls[0].user).toContain("the source");
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("visual");
    expect(renderer.render).toHaveBeenCalledWith(FRAGMENT, [{ click: "#btn" }]);
  });

  it("renders the sealed fragment even if the model sends different html", async () => {
    const rc = { render: vi.fn(async () => shot) };
    script = async (tools) => {
      await tools.render("<section>a rewrite</section>");
      return JSON.stringify({ findings: [] });
    };
    await slideReviewer(rc)(req);
    expect(rc.render).toHaveBeenCalledWith(req.fragment, undefined);
    expect(rc.render).not.toHaveBeenCalledWith("<section>a rewrite</section>", undefined);
  });

  it("returns [] for an empty findings payload", async () => {
    script = async () => JSON.stringify({ findings: [] });
    expect(await slideReviewer(renderer)(req)).toEqual([]);
  });

  it("caps render calls and returns the budget message after the cap", async () => {
    script = async (tools) => {
      let budgetMsg = "";
      for (let i = 0; i < REVIEW_RENDER_CAP + 2; i++) {
        const r = await tools.render(FRAGMENT);
        if ("text" in r && /budget/i.test(r.text)) budgetMsg = r.text;
      }
      expect(budgetMsg).toMatch(/write your findings/i);
      return JSON.stringify({ findings: [] });
    };
    const rc = { render: vi.fn(async () => shot) };
    await slideReviewer(rc)(req);
    expect(rc.render).toHaveBeenCalledTimes(REVIEW_RENDER_CAP);
  });

  it("retries the session once when the final text is not valid findings JSON", async () => {
    let attempt = 0;
    script = async () => (++attempt === 1 ? "sorry, here are my thoughts…" : JSON.stringify({ findings: [] }));
    expect(await slideReviewer(renderer)(req)).toEqual([]);
    expect(attempt).toBe(2);
  });

  it("throws a combined error when both attempts fail", async () => {
    script = async () => "not json at all";
    await expect(slideReviewer(renderer)(req)).rejects.toThrow(/failed twice/);
  });
});
