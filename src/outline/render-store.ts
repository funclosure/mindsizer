import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Write a slide render fragment to `<dir>/<id>.html`. */
export async function writeSlide(
  dir: string,
  id: string,
  html: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.html`), html, "utf8");
}

/**
 * Read a slide render fragment by id. Throws if the file is missing —
 * reading a specific expected slide that is absent is an error (unlike
 * `listSlideIds`, which treats a missing directory as simply empty).
 */
export async function readSlide(dir: string, id: string): Promise<string> {
  return readFile(join(dir, `${id}.html`), "utf8");
}

/** List slide ids present as `<id>.html` files, sorted. Missing dir → []. */
export async function listSlideIds(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();
}

/** Delete render files whose id is not in `keepIds`. Returns removed ids. */
export async function gcOrphans(
  dir: string,
  keepIds: string[],
): Promise<string[]> {
  const keep = new Set(keepIds);
  const removed: string[] = [];
  for (const id of await listSlideIds(dir)) {
    if (!keep.has(id)) {
      await rm(join(dir, `${id}.html`));
      removed.push(id);
    }
  }
  return removed;
}
