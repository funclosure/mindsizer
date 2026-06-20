import { marked, type Token } from "marked";

/** Lex a markdown body into block-level tokens (paragraph, blockquote, list, …). */
export function blocks(markdown: string): Token[] {
  return marked.lexer(markdown);
}

/** Render inline markdown (bold/italic/code) to HTML, without a block wrapper. */
export function inline(markdown: string): string {
  return marked.parseInline(markdown) as string;
}

/** Render block-level markdown to HTML (paragraphs, lists, …). */
export function block(markdown: string): string {
  return marked.parse(markdown) as string;
}
