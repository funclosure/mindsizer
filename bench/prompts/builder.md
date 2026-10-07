You are building one explainer web page using the mindsizer skill. Follow the skill exactly; it is the thing being tested.

1. Read the skill first: $skill/SKILL.md, then the files it tells you to read. Use its scripts (scripts/new-page.sh, scripts/check.sh, scripts/states.sh) from $skill.

2. The user's request, verbatim: "$request"$style_line$level_line

3. Sources, in $src (read all of them; rely on them, not on memory):
$source_list
$notes

4. Write the page to $page. Do NOT publish it anywhere, do not edit the skill, and write nothing outside $workdir (states.sh may install Playwright into ~/.cache/mindsizer; that is expected).

5. Do the skill's quick check at that level (check.sh, and states.sh with --level where the level calls for it, output into $workdir/page) and its fidelity pass, once each.

6. Reply with: the level you built at, the map and spine (with the source sentence next to each heading, and each "so" line where the level asks), each interaction and why you chose it, your figure-review lines if the level asks for them (one per state), what is illustrative, what you folded (if anything), states.sh's summary if you ran it, anything in the skill that was unclear or that you had to work around.
