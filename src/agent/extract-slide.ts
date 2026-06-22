/**
 * Pull just the slide markup out of an agentic author's raw reply.
 * The model sometimes wraps the HTML in markdown fences and/or surrounds it with
 * commentary ("Here is the final slide.") despite the brief. We keep everything from
 * the first <style>/<section> up to the section's own </section> (plus an optional
 * scoped <script> immediately after it), dropping any surrounding prose.
 *
 * The end is anchored to the FIRST </section> after the opening (a slide has exactly one
 * section), so trailing commentary that happens to mention a closing tag cannot extend
 * the slice.
 */
export function extractSlideHtml(raw: string): string {
  const t = raw.replace(/```[a-z]*\n?/gi, "").trim();

  const starts = ["<style", "<section"]
    .map((m) => t.indexOf(m))
    .filter((i) => i >= 0);
  if (starts.length === 0) return t; // nothing recognizable — let the validator flag it

  const start = Math.min(...starts);
  const close = t.indexOf("</section>", start);
  if (close === -1) return t.slice(start).trim(); // unterminated — hand back what we have

  let end = close + "</section>".length;
  // include a scoped <script>…</script> that immediately follows the section
  const trailingScript = t.slice(end).match(/^\s*<script\b[\s\S]*?<\/script>/i);
  if (trailingScript) end += trailingScript[0].length;

  return t.slice(start, end).trim();
}
