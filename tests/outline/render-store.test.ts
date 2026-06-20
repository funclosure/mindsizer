import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeSlide,
  readSlide,
  listSlideIds,
  gcOrphans,
} from "../../src/outline/render-store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mindsizer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("render-store", () => {
  it("writes and reads a slide render by id", async () => {
    await writeSlide(dir, "s_a", "<section data-slide-id=\"s_a\"></section>");
    expect(await readSlide(dir, "s_a")).toContain('data-slide-id="s_a"');
  });

  it("lists slide ids from .html filenames, sorted", async () => {
    await writeSlide(dir, "s_b", "<section></section>");
    await writeSlide(dir, "s_a", "<section></section>");
    expect(await listSlideIds(dir)).toEqual(["s_a", "s_b"]);
  });

  it("returns an empty list for a nonexistent directory", async () => {
    expect(await listSlideIds(join(dir, "nope"))).toEqual([]);
  });

  it("garbage-collects render files whose id is not kept", async () => {
    await writeSlide(dir, "s_keep", "<section></section>");
    await writeSlide(dir, "s_drop", "<section></section>");
    const removed = await gcOrphans(dir, ["s_keep"]);
    expect(removed).toEqual(["s_drop"]);
    expect(await listSlideIds(dir)).toEqual(["s_keep"]);
  });
});
