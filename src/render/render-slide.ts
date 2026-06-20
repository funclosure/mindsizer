import type { OutlineSlide } from "../outline/types";
import { extractSlots } from "./slots";
import { renderAnalogy } from "./layouts/analogy";
import { renderPlain } from "./layouts/plain";

/** Render one OutlineSlide into a themed HTML <section> fragment. */
export function renderSlide(slide: OutlineSlide): string {
  switch (slide.layout) {
    case "analogy":
      return renderAnalogy(extractSlots("analogy", slide.markdown), slide);
    case "plain":
      return renderPlain(extractSlots("plain", slide.markdown), slide);
    default:
      throw new Error(
        `slide ${slide.id} uses layout '${slide.layout}' — no static renderer yet`,
      );
  }
}
