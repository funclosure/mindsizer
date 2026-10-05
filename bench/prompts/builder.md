You are building one explainer web page using the mindsizer skill. Follow the skill exactly; it is the thing being tested.

1. Read the skill first: $skill/SKILL.md, then the files it tells you to read. Use its scripts (scripts/new-page.sh, scripts/check.sh, scripts/states.sh) from $skill.

2. The user's request, verbatim: "$request"$style_line

3. Sources, in $src (read all of them; rely on them, not on memory):
$source_list
$notes

4. Write the page to $page. Do NOT publish it anywhere, do not edit the skill, and write nothing outside $workdir (states.sh may install Playwright into ~/.cache/mindsizer; that is expected).

5. Do the skill's quick check (check.sh and states.sh, output into $workdir/page) and its fidelity pass, once each.

6. Reply with: the map and spine (with the source sentence next to each heading and "so" line), each interaction and why you chose it, what is illustrative, what you folded, states.sh's summary, anything in the skill that was unclear or that you had to work around.
