import type { OutlineSlide } from "../../outline/types";
import { escapeHtml } from "../html";

/** The fallback layout: title + a single body region. */
export function renderPlain(
  slots: Record<string, string>,
  slide: OutlineSlide,
): string {
  return `<section data-slide-id="${slide.id}" data-layout="plain">
  <h2 class="s-title" data-bind="title">${escapeHtml(slide.title)}</h2>
  <div class="s-body" data-bind="body">${slots.body ?? ""}</div>
</section>`;
}
