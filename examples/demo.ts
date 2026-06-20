/**
 * Hands-on demo of the outline core library.
 * Run: `bun run examples/demo.ts`
 *
 * Shows the seam working end-to-end: a Marp-style outline.md is parsed into the
 * canonical model, validated, round-tripped through the serializer, and then a
 * slide render's `data-bind` regions are read and content-edited — all without
 * any agent or browser (those are later build-order steps).
 */
import {
  parseOutline,
  serializeOutline,
  validateOutline,
  readBoundRegions,
  updateBoundRegions,
  validateSlideSection,
} from "../src/outline/index";

const line = (s: string) => console.log(`\n\x1b[36m── ${s} ${"─".repeat(Math.max(0, 50 - s.length))}\x1b[0m`);

// 1. A canonical outline.md (what the agent will author in Step 4)
const OUTLINE_MD = `---
title: Eventual Consistency Explained
purpose: teach
theme: field
---

<!-- slide id=s_intro layout=analogy -->
# Eventual consistency

Every copy of the data agrees — eventually. A read can lag for a
moment right after a write.

> Like office gossip — everyone hears the news eventually, just not
> at the same instant.

---

<!-- slide id=s_tradeoff layout=build-up -->
# The trade-off: availability over instant accuracy

- A distributed store can't be both instantly-consistent and always-available
- Eventual consistency deliberately picks availability
- Staleness is bounded: it converges once writes stop
`;

line("1. INPUT: a Marp-style outline.md (the canonical asset)");
console.log(OUTLINE_MD);

// 2. Parse into the canonical model
const outline = parseOutline(OUTLINE_MD);
line("2. PARSED into the Outline model");
console.log("meta:", outline.meta);
console.log(
  "slides:",
  outline.slides.map((s) => ({ id: s.id, layout: s.layout, title: s.title })),
);

// 3. Validate
line("3. VALIDATE");
const issues = validateOutline(outline);
console.log(issues.length === 0 ? "✅ no issues" : issues);

// 4. Serialize back + prove round-trip
const back = serializeOutline(outline);
const roundTrips = JSON.stringify(parseOutline(back)) === JSON.stringify(outline);
line("4. SERIALIZE → round-trip");
console.log(`parse(serialize(outline)) === outline ?  ${roundTrips ? "✅ yes" : "❌ no"}`);

// 5. The data-bind seam: a slide render keyed to s_intro
const slideHtml = `<section data-slide-id="s_intro" data-layout="analogy">
  <h3 class="s-title" data-bind="title">Eventual consistency</h3>
  <p class="s-body" data-bind="concept">Every copy of the data agrees — eventually.</p>
  <p class="s-analogy" data-bind="analogy"><b>Office gossip</b> — everyone hears eventually.</p>
  <div class="s-label">think of it like</div>
</section>`;

line("5. THE data-bind SEAM (this slide's render)");
console.log("bound content regions read from the HTML:");
console.log(readBoundRegions(slideHtml));
console.log("\nsection id matches outline slide?", validateSlideSection(slideHtml, "s_intro").length === 0 ? "✅" : "❌");

// 6. A CONTENT edit — rewrite only the bound 'title' region, design untouched
line("6. CONTENT EDIT → updates only the bound region, design preserved");
const edited = updateBoundRegions(slideHtml, {
  title: "Eventual consistency, explained",
});
console.log(edited);
console.log(
  "\ndesign (non-bound) preserved?",
  edited.includes('class="s-label">think of it like') && edited.includes('data-layout="analogy"')
    ? "✅ yes — the 'think of it like' label and layout class are byte-intact"
    : "❌ no",
);
