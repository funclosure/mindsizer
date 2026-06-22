// src/agent/agentic-author.ts
import { runAgentic } from "./query";
import { extractSlideHtml } from "./extract-slide";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";

/**
 * Live agentic author: hands the model the materials + identity brief and a bounded
 * `render` tool, lets it self-iterate on its own screenshots, returns the final slide HTML.
 */
export function agenticAuthor(renderer: SlideRenderer): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest): Promise<string> {
      const { system, user } = slideAuthorPrompt(req);
      const text = await runAgentic(system, user, {
        render: async (html, interactions) => (await renderer.render(html, interactions)).shots,
      });
      // The model sometimes wraps the HTML in fences or prose despite the brief —
      // keep only the slide markup so stray text never leaks into the sealed deck.
      return extractSlideHtml(text);
    },
  };
}
