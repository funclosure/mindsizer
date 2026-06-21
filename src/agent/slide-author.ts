import { runQuery } from "./query";
import { slideAuthorPrompt, type AuthorRequest } from "../render/design-brief";
import type { SlideAuthor } from "../render/build-slide";

/** Strip a stray ```html code fence if the model wraps its output. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : t).trim();
}

/** Live SlideAuthor over the Claude Agent SDK (auth: Claude Code session). */
export function anthropicSlideAuthor(): SlideAuthor {
  return {
    async authorSlide(req: AuthorRequest) {
      const p = slideAuthorPrompt(req);
      return stripFences(await runQuery(p.system, p.user));
    },
  };
}
