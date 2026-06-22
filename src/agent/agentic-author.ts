// src/agent/agentic-author.ts
import { runAgentic } from "./query";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor } from "../render/build-slide";
import type { SlideRenderer } from "../render/fit-check";

/** Strip accidental markdown fences the model may add. */
function stripFences(s: string): string {
  return s.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

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
      return stripFences(text);
    },
  };
}
