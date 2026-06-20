import { describe, it, expect } from "vitest";
import { ingest, fixedPrompter, anthropicClient, extractJson } from "../../src/agent/index";

describe("agent barrel", () => {
  it("re-exports the public agent API", () => {
    expect(typeof ingest).toBe("function");
    expect(typeof fixedPrompter).toBe("function");
    expect(typeof anthropicClient).toBe("function");
    expect(typeof extractJson).toBe("function");
  });
});
