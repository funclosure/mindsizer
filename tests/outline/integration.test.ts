import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOutline,
  serializeOutline,
  validateOutline,
  crossValidate,
  readBoundRegions,
  writeSlide,
  listSlideIds,
} from "../../src/outline/index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mindsizer-int-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const MD = `---
title: Demo
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy agrees eventually.
`;

describe("outline library end-to-end", () => {
  it("parses, validates, persists a render, and reconciles", async () => {
    const outline = parseOutline(MD);
    expect(validateOutline(outline)).toEqual([]);

    // serialize round-trips
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);

    // author a render for the one slide, keyed by stable id
    const slide = outline.slides[0];
    await writeSlide(
      dir,
      slide.id,
      `<section data-slide-id="${slide.id}" data-layout="${slide.layout}">` +
        `<h3 data-bind="title">${slide.title}</h3></section>`,
    );

    // cross-validation now passes
    const ids = await listSlideIds(dir);
    expect(crossValidate(outline, ids)).toEqual([]);

    // the render's bound title traces to the outline
    const regions = readBoundRegions(await import("node:fs/promises").then((fs) =>
      fs.readFile(join(dir, `${slide.id}.html`), "utf8"),
    ));
    expect(regions.title).toBe(slide.title);
  });
});
