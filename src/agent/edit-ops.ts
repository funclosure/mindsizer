export interface RenderEdit {
  old: string;
  new: string;
}

export type Resolved = { ok: true; html: string } | { ok: false; error: string };

/** Apply find/replace edits sequentially; each `old` must match EXACTLY ONCE in the current text. */
export function applyEdits(base: string, edits: RenderEdit[]): Resolved {
  let html = base;
  for (let i = 0; i < edits.length; i++) {
    const { old } = edits[i];
    if (!old) {
      return {
        ok: false,
        error: `edit #${i + 1}: \`old\` is empty — include the exact text to replace`,
      };
    }
    const first = html.indexOf(old);
    if (first === -1) {
      return {
        ok: false,
        error: `edit #${i + 1}: old string not found in the last-rendered html`,
      };
    }
    if (html.indexOf(old, first + 1) !== -1) {
      return {
        ok: false,
        error: `edit #${i + 1}: old string appears more than once — include more surrounding context to make it unique`,
      };
    }
    html = html.slice(0, first) + edits[i].new + html.slice(first + old.length);
  }
  return { ok: true, html };
}

/** Resolve a render call's input: full `html` wins; `edits` patch the last-rendered html; neither re-renders it as-is. */
export function resolveRenderInput(
  lastHtml: string | undefined,
  args: { html?: string; edits?: RenderEdit[] },
): Resolved {
  if (args.html) return { ok: true, html: args.html };
  if (args.edits?.length) {
    if (lastHtml === undefined) {
      return { ok: false, error: "no previous render to edit — send full `html` first" };
    }
    return applyEdits(lastHtml, args.edits);
  }
  if (lastHtml !== undefined) return { ok: true, html: lastHtml };
  return {
    ok: false,
    error: "provide `html` (full slide) or `edits` (find/replace on your last-rendered html)",
  };
}
