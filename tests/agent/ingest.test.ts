import { describe, it, expect } from "vitest";
import { ingest } from "../../src/agent/ingest";
import { fixedPrompter } from "../../src/agent/prompter";
import { parseOutline } from "../../src/outline/index";
import type { ModelClient } from "../../src/agent/model-client";

const digest = {
  title: "Eventual Consistency",
  keyPoints: ["a", "b", "c"],
  sourceCharacter: "technical spec",
};
const directions = [
  { id: "mental-model", label: "mental model", description: "why" },
  { id: "build", label: "build", description: "how" },
];
const draft = {
  title: "EC",
  slides: [
    {
      title: "Eventual consistency",
      layout: "analogy" as const,
      markdown: "Every copy agrees.\n\n> Like **office gossip**.",
    },
    { title: "Trade-off", layout: "plain" as const, markdown: "- a\n- b" },
  ],
};

function fakeModel(): { client: ModelClient; seenAngle: () => string } {
  let seen = "";
  return {
    seenAngle: () => seen,
    client: {
      digest: async () => digest,
      proposeDirections: async () => directions,
      generateOutline: async (_d, a) => {
        seen = a.id;
        return draft;
      },
    },
  };
}

describe("ingest", () => {
  it("runs the pipeline and returns a valid, round-trippable outline", async () => {
    const m = fakeModel();
    const res = await ingest("some source text", {
      model: m.client,
      prompter: fixedPrompter("build"),
    });
    expect(res.angle.id).toBe("build");
    expect(m.seenAngle()).toBe("build");
    expect(res.pointCount).toBe(3);

    const parsed = parseOutline(res.outlineMarkdown);
    expect(parsed.meta.purpose).toBe("teach");
    expect(parsed.meta.theme).toBe("field");
    expect(parsed.slides).toHaveLength(2);
    expect(parsed.slides[0].id).toMatch(/^s_[0-9a-z]{8}$/);
    expect(parsed.slides[0].layout).toBe("analogy");
    expect(parsed.slides[0].markdown).toContain("office gossip");
  });

  it("defaults to the first proposed angle", async () => {
    const res = await ingest("text", {
      model: fakeModel().client,
      prompter: fixedPrompter(),
    });
    expect(res.angle.id).toBe("mental-model");
  });

  it("invokes onDigest with the digest", async () => {
    let n = 0;
    await ingest("text", {
      model: fakeModel().client,
      prompter: fixedPrompter(),
      onDigest: (d) => {
        n = d.keyPoints.length;
      },
    });
    expect(n).toBe(3);
  });

  it("throws on empty source", async () => {
    await expect(
      ingest("   ", { model: fakeModel().client, prompter: fixedPrompter() }),
    ).rejects.toThrow(/empty/);
  });

  it("throws for an unknown angle id", async () => {
    await expect(
      ingest("text", { model: fakeModel().client, prompter: fixedPrompter("nope") }),
    ).rejects.toThrow(/unknown angle/);
  });

  it("falls back to the digest title when the draft title is empty", async () => {
    const model: ModelClient = {
      digest: async () => ({ title: "Digest Title", keyPoints: ["a"], sourceCharacter: "x" }),
      proposeDirections: async () => [{ id: "only", label: "L", description: "d" }],
      generateOutline: async () => ({
        title: "",
        slides: [{ title: "S", layout: "plain" as const, markdown: "b" }],
      }),
    };
    const res = await ingest("text", { model, prompter: fixedPrompter() });
    expect(res.outlineMarkdown).toContain("title: Digest Title");
  });

  it("throws when the generated outline fails validation", async () => {
    const model: ModelClient = {
      digest: async () => ({ title: "T", keyPoints: ["a"], sourceCharacter: "x" }),
      proposeDirections: async () => [{ id: "only", label: "L", description: "d" }],
      generateOutline: async () => ({
        title: "T",
        // empty slide title → validateOutline flags "slide missing title"
        slides: [{ title: "", layout: "plain" as const, markdown: "b" }],
      }),
    };
    await expect(
      ingest("text", { model, prompter: fixedPrompter() }),
    ).rejects.toThrow(/generated outline invalid/);
  });
});

describe("ingest digest passthrough", () => {
  it("returns the digest key-points for sidecar persistence", async () => {
    const fakeModel: ModelClient = {
      digest: async () => ({ title: "T", keyPoints: ["k1", "k2", "k3"], sourceCharacter: "x" }),
      proposeDirections: async () => [{ id: "d1", label: "L", description: "b" }],
      generateOutline: async () => ({
        title: "T",
        slides: [{ layout: "plain" as const, title: "A", markdown: "a" }],
      }),
    };
    const r = await ingest("source text", { model: fakeModel, prompter: fixedPrompter("d1") });
    expect(r.digest).toEqual(["k1", "k2", "k3"]);
  });
});
