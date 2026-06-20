/**
 * Visual proof for the static render path (PRD §17 step 2).
 * Run: `bun run examples/render-demo.ts` then open the printed preview files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOutline } from "../src/outline/index";
import { renderSlide, renderPreviewPage } from "../src/render/index";

const OUTLINE_MD = `---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually. A read can lag for a
moment right after a write.

> Like **office gossip** — everyone hears the news eventually, just
> not at the same instant.

---

<!-- slide id=s_tradeoff layout=plain -->
# The trade-off: availability over instant accuracy

- A distributed store can't be both instantly-consistent and always-available
- Eventual consistency deliberately picks availability
- Staleness is bounded: it converges once writes stop
`;

const outDir = join(process.cwd(), "examples", "out");
mkdirSync(outDir, { recursive: true });

const outline = parseOutline(OUTLINE_MD);
const written: string[] = [];

for (const slide of outline.slides) {
  const fragment = renderSlide(slide);
  const page = renderPreviewPage(fragment);
  const file = join(outDir, `${slide.id}.html`);
  writeFileSync(file, page, "utf8");
  written.push(file);
}

console.log("Rendered preview pages — open these in a browser:");
for (const f of written) console.log("  " + f);
