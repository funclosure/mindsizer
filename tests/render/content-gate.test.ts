import { describe, it, expect } from "vitest";
import { slideText, heuristicDud, MIN_SLIDE_CHARS, CONTENT_DUD } from "../../src/render/content-gate";

const long = "Real on-topic teaching content about lossy compression and why detail gets dropped. ".repeat(2);

describe("slideText", () => {
  it("strips tags and <script>/<style> text", () => {
    expect(slideText(`<section><b>A</b><style>z{}</style><script>zzz()</script> B</section>`)).toBe("A B");
  });
});

describe("heuristicDud", () => {
  it("flags a near-empty slide with the char count", () => {
    expect(heuristicDud(`<section data-slide-id="s">LEFT RIGHT</section>`)).toMatch(/chars of content/);
  });
  it("flags a probe scaffold even when long enough", () => {
    const probe = `<section data-slide-id="s">PROBE early rule A B C JS RAN plus enough padding words to clear the minimum length easily</section>`;
    expect(heuristicDud(probe)).toMatch(/probe/i);
  });
  it("returns null for a real slide", () => {
    expect(heuristicDud(`<section data-slide-id="s">${long}</section>`)).toBeNull();
  });
  it("ignores <script> text when measuring length", () => {
    expect(heuristicDud(`<section data-slide-id="s">Hi<script>${"x".repeat(300)}</script></section>`)).toMatch(/chars/);
  });
});

describe("constants", () => {
  it("exports the threshold + the dud marker", () => {
    expect(MIN_SLIDE_CHARS).toBe(60);
    expect(CONTENT_DUD).toBe("content-dud:");
  });
});
