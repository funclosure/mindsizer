import { describe, it, expect } from "vitest";
import { serializeOutline } from "../../src/outline/serialize";
import { parseOutline } from "../../src/outline/parse";
import type { Outline } from "../../src/outline/types";

const OUTLINE: Outline = {
  meta: { title: "Demo Deck", purpose: "teach", theme: "field" },
  slides: [
    {
      id: "s_intro",
      layout: "analogy",
      title: "Eventual consistency",
      markdown: "Every copy agrees — eventually.\n\n> Like office gossip.",
    },
    {
      id: "s_tradeoff",
      layout: "build-up",
      title: "The trade-off",
      markdown: "- A\n- B",
    },
  ],
};

describe("serializeOutline", () => {
  it("emits frontmatter and per-slide meta comments", () => {
    const md = serializeOutline(OUTLINE);
    expect(md).toContain("title: Demo Deck");
    expect(md).toContain("<!-- slide id=s_intro layout=analogy -->");
    expect(md).toContain("# Eventual consistency");
  });

  it("round-trips: parse(serialize(outline)) equals the model", () => {
    const md = serializeOutline(OUTLINE);
    const back = parseOutline(md);
    expect(back).toEqual(OUTLINE);
  });
});

describe("serializeOutline — robustness", () => {
  it("round-trips a title containing a colon", () => {
    const o: Outline = {
      meta: { title: "Consistency: A Primer", purpose: "teach", theme: "field" },
      slides: [{ id: "s_a", layout: "plain", title: "H", markdown: "body" }],
    };
    expect(parseOutline(serializeOutline(o))).toEqual(o);
  });

  it("omits layout for bespoke slides and still round-trips", () => {
    const o: Outline = {
      meta: { title: "T", purpose: "teach", theme: "field" },
      slides: [{ id: "s_a", layout: "bespoke", title: "H", markdown: "body" }],
    };
    const md = serializeOutline(o);
    expect(md).not.toContain("layout=bespoke");
    expect(parseOutline(md)).toEqual(o);
  });
});

describe("serializeOutline — source attribution", () => {
  const SLIDES = [
    { id: "s_a", layout: "plain", title: "H", markdown: "body" },
  ];

  it("round-trips a full source attribution", () => {
    const o: Outline = {
      meta: {
        title: "T",
        purpose: "teach",
        theme: "field",
        source: {
          label: "Phil Chen (@philhchen) on X",
          url: "https://x.com/philhchen/status/2072793818945167475",
        },
      },
      slides: SLIDES,
    };
    const md = serializeOutline(o);
    expect(md).toContain("source:");
    expect(parseOutline(md)).toEqual(o);
  });

  it("round-trips a url-only source without writing a label key", () => {
    const o: Outline = {
      meta: {
        title: "T",
        purpose: "teach",
        theme: "field",
        source: { url: "https://example.com/post" },
      },
      slides: SLIDES,
    };
    const md = serializeOutline(o);
    expect(md).not.toContain("label");
    expect(parseOutline(md)).toEqual(o);
  });

  it("omits the source key entirely when unset", () => {
    expect(serializeOutline(OUTLINE)).not.toContain("source:");
  });
});
