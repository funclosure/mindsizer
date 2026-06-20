import type { OutlineSlide } from "../../outline/types";
import { escapeHtml } from "../html";

/** The hero comprehension layout: two columns, concept + analogy. */
export function renderAnalogy(
  slots: Record<string, string>,
  slide: OutlineSlide,
): string {
  // slot HTML is trusted (marked over author markdown); title is plain text → escaped
  return `<section data-slide-id="${slide.id}" data-layout="analogy">
  <h2 class="s-title" data-bind="title">${escapeHtml(slide.title)}</h2>
  <div class="s-cols">
    <div>
      <div class="s-col-label">what it means</div>
      <div class="s-body" data-bind="concept">${slots.concept ?? ""}</div>
    </div>
    <div class="s-analogy">
      <div class="s-col-label">think of it like</div>
      <div class="s-body" data-bind="analogy">${slots.analogy ?? ""}</div>
    </div>
  </div>
</section>`;
}
