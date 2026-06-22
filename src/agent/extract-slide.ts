/**
 * Pull just the slide markup out of an agentic author's raw reply.
 * The model sometimes wraps the HTML in markdown fences and/or surrounds it with
 * commentary ("Here is the final slide.") despite the brief. We keep everything from
 * the first <style>/<section> to the last </section>/</script>, dropping the rest.
 */
export function extractSlideHtml(raw: string): string {
  const t = raw.replace(/```[a-z]*\n?/gi, "").trim();

  const starts = ["<style", "<section"]
    .map((m) => t.indexOf(m))
    .filter((i) => i >= 0);
  if (starts.length === 0) return t; // nothing recognizable — return as-is for the validator to flag

  const start = Math.min(...starts);
  const ends = ["</section>", "</script>"]
    .map((m) => {
      const i = t.lastIndexOf(m);
      return i >= 0 ? i + m.length : -1;
    })
    .filter((i) => i >= 0);
  const end = ends.length ? Math.max(...ends) : t.length;

  return t.slice(start, end).trim();
}
