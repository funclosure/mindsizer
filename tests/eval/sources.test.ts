import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSources, parseManifest, fetchableSources, sourceLabel } from "../../eval/lib/sources";
import { extractJson } from "../../eval/lib/judge";
import { vttToText, htmlToText } from "../../eval/fetch";

describe("sources manifest", () => {
  it("parses the committed eval/sources.json", () => {
    const { sources } = parseSources(readFileSync(join(__dirname, "..", "..", "eval", "sources.json"), "utf8"));
    expect(sources.length).toBe(11);
    expect(sources.filter((s) => s.kind === "video")).toHaveLength(2);
    expect(sources.find((s) => s.id === "dont-scale")!.local).toBe("examples/dont-scale.txt");
    expect(sourceLabel(sources[0])).toBe("Paul Graham — Do Things That Don't Scale");
  });
  it("rejects duplicate ids and bad kinds", () => {
    const one = { id: "a", title: "t", author: "x", kind: "text", url: "https://e.com" };
    expect(() => parseSources(JSON.stringify({ sources: [one, one] }))).toThrow(/duplicate/);
    expect(() => parseSources(JSON.stringify({ sources: [{ ...one, kind: "podcast" }] }))).toThrow();
  });
  it("parses the fetch manifest and filters fetchable sources", () => {
    const { sources } = parseSources(JSON.stringify({ sources: [
      { id: "a", title: "t", author: "x", kind: "text", url: "https://e.com" },
      { id: "b", title: "t", author: "x", kind: "video", url: "https://e.com/v" },
      { id: "c", title: "t", author: "x", kind: "text", url: "https://e.com/c" },
    ] }));
    const m = parseManifest(JSON.stringify({ sources: {
      a: { status: "ok", from: "x", chars: 10, words: 2, fetchedAt: "now" },
      b: { status: "unavailable", reason: "403", fetchedAt: "now" },
    } }));
    expect(fetchableSources(sources, m).map((s) => s.id)).toEqual(["a"]);
    expect(() => parseManifest(JSON.stringify({ sources: { a: { status: "ok" } } }))).toThrow();
  });
});

describe("fetch text extraction", () => {
  it("strips VTT timestamps and rolling-caption duplicates", () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
so the brain is

00:00:02.000 --> 00:00:04.000
so the brain is <00:00:02.500><c>a prediction</c>

00:00:04.000 --> 00:00:06.000
a prediction machine
`;
    expect(vttToText(vtt).trim()).toBe("so the brain is a prediction machine");
  });
  it("extracts an article body and drops chrome", () => {
    const body = "<p>" + "Real paragraph text. ".repeat(100) + "</p>";
    const html = `<html><body><nav>Menu Home About</nav><article><h1>Title</h1>${body}<p>Second.</p><p>Third.</p><p>Fourth.</p><p>Fifth.</p><script>x()</script></article><footer>© footer</footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Title");
    expect(t).toContain("Real paragraph text.");
    expect(t).not.toContain("Menu Home");
    expect(t).not.toContain("x()");
  });
});

describe("extractJson", () => {
  it("takes the fenced or last balanced JSON object", () => {
    expect(extractJson('blah\n```json\n{"score": 3}\n```')).toEqual({ score: 3 });
    expect(extractJson('I think {"a": 1} then finally {"score": "unknown", "evidence": ["x}"]}')).toEqual({ score: "unknown", evidence: ["x}"] });
    expect(() => extractJson("no json here")).toThrow();
  });
});
