You are a strict judge in an evaluation of an explainer page built by the mindsizer skill. Page: $page (read the HTML, including script strings and folded sections). Sources it must be faithful to, in $src:
$source_list
The user's request was: "$request"$style_line
Judge against the sources, not your own memory. You may read $skill/SKILL.md and $skill/references/*.md for section 5 only.

1. Fidelity. Check every line the page writes itself first (dek, map, each h2, each "so" line, every verdict string, every figure label and note, set items, table cells), then quotes, attributions and "so/because/therefore" links. Severity: high = misstates the source or takes a side it doesn't take; medium = invented claim or connective presented as sourced, misattribution, unlabelled illustration, a quantifier stronger than the source; low = imprecise wording. Count the self-written lines you checked.
2. Balance and coverage: does the page present positions as the source does? What does a newcomer most need that is missing or folded away?
3. Rubric, 1-4 per section (hero, each section, close): claim_at_rest, mechanism_shown (the figure or interaction shows why; changes of colour, dashing or label alone score at most 2), device_works (clear; every option changes something meaningful), fidelity, craft, calm.
4. First read: estimate the words visible without opening a fold.
5. Did the skill's rules hold? For each, "held", "partly" or "failed", with one line: spine_grounded (headings and "so" lines rest on source sentences), thesis_visible, figure_default_is_source_lead, labels_traced_or_marked, switch_off_shows_consequence (n/a if none), map_links_and_paths, close_uses_only_page_material, first_read_budget, handwriting_only_asides, use_cases_distinct (n/a if none requested).
6. Top 5 problems, each with a page fix and, where the skill's instructions caused it, a concrete skill edit.

Write JSON to $out with exactly this shape (numbers as numbers):
{"fidelity":{"self_written_checked":0,"errors":[{"severity":"high|medium|low","page":"…","source":"…","why":"…"}]},
 "balance":"…","coverage_gaps":["…"],
 "rubric":{"sections":[{"id":"…","claim_at_rest":0,"mechanism_shown":0,"device_works":0,"fidelity":0,"craft":0,"calm":0}],
           "means":{"claim_at_rest":0,"mechanism_shown":0,"device_works":0,"fidelity":0,"craft":0,"calm":0,"overall":0}},
 "first_read_words":0,
 "rules":{"spine_grounded":{"verdict":"…","why":"…"}},
 "top5":[{"problem":"…","page_fix":"…","skill_edit":"…"}]}
Reply with a summary under 300 words.
