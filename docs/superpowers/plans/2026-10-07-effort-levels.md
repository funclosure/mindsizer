# Effort Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mindsizer skill build a page at low, medium (default) or high effort, per `docs/superpowers/specs/2026-10-07-effort-levels-design.md`.

**Architecture:** One recipe in `skills/mindsizer/SKILL.md` with a level table and inline level tags (approach A). `states.sh` learns a `--level` flag that sets the first-read target it reports against. The benchmark gets a `--level` flag (default `high`) that reaches the builder, the judge, `states.sh` and the baseline comparison.

**Tech Stack:** Markdown (the skill), bash + Node/Playwright (`states.sh` / `states.mjs`), Python 3 stdlib (`bench/run.py`, tests with `unittest`).

## Global Constraints

- Levels are exactly `low`, `medium`, `high`. Default when unnamed: `medium`. The benchmark's default: `high`.
- First-read targets: low about 500 words, medium about 900, high about 1,200 (fold more past 1,500).
- Sections (excluding hero and close): low 3 (one per map step), medium 4–5, high 4–8. Map steps: low 3, medium 3–5, high 3–6. Interactions: low 1, medium 2–3, high 3–5.
- Kept at every level: whole source read, map + path kickers, one claim per section, traceable numbers/quotes and "illustrative" labels, safety in the first read, interaction rules for every interaction built, `<ruby>` glosses on translated pages, footer.
- No level is inferred from the source's size. No level above high.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Skill prose style: plain, short, active sentences, matching the surrounding SKILL.md.

---

### Task 1: Commit the pending `<ruby>` gloss change

The working tree already holds an approved, unrelated change (original-language glosses). Commit it first so later diffs stay clean.

**Files:**
- Modify (already modified): `skills/mindsizer/SKILL.md`, `skills/mindsizer/references/style.md`, `skills/mindsizer/assets/template.html`

- [ ] **Step 1: Confirm the diff is only the gloss change**

Run: `git diff --stat`
Expected: exactly these 3 files, 12 insertions, and `git diff | grep -c ruby` ≥ 4.

- [ ] **Step 2: Commit**

```bash
git add skills/mindsizer/SKILL.md skills/mindsizer/references/style.md skills/mindsizer/assets/template.html
git commit -m "skill: gloss translated key terms with <ruby> at first use

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `states.sh --level`

**Files:**
- Modify: `skills/mindsizer/scripts/states.sh`
- Modify: `skills/mindsizer/scripts/states.mjs:10` (argv) and `:117` (first-read line)

**Interfaces:**
- Produces: `states.sh [--level low|medium|high] <page.html> [out-dir]` (default `medium`). Prints `first read: N words (medium: aim for about 900)`, plus `; over the medium budget, cut or fold` when N > 1.25 × target. `states.json` gains `words.level` and `words.target`.

- [ ] **Step 1: Write the failing check**

Run (any existing page works; the example is in the repo):
```bash
skills/mindsizer/scripts/states.sh --level low skills/mindsizer/examples/vervaeke.html /tmp/ms-lv | grep '^first read'
```
Expected now: FAIL. `states.sh` takes `--level` as the page path and errors (`no such file` or a Node error).

- [ ] **Step 2: Parse the flag in `states.sh`**

Replace the line `page="$1"; out="${2:-$(dirname "$page")/states}"` and the usage comment with:

```bash
# Usage: states.sh [--level low|medium|high] <page.html> [out-dir]   (installs playwright once into ~/.cache/mindsizer)
set -euo pipefail
level=medium
if [ "${1:-}" = "--level" ]; then level="${2:?--level needs low, medium or high}"; shift 2; fi
case "$level" in low|medium|high) ;; *) echo "unknown level '$level' (low, medium, high)" >&2; exit 1;; esac
page="$1"; out="${2:-$(dirname "$page")/states}"
```

(Delete the old `# Usage:` line and the old `set -euo pipefail` so each appears once.) Change the last line to pass the level:

```bash
PLAYWRIGHT_MODULE="$cache/node_modules/playwright" node "$(dirname "$0")/states.mjs" "$page" "$out" "$level"
```

- [ ] **Step 3: Use the level in `states.mjs`**

Line 10 becomes:
```js
const [pageFile, out, level = 'medium'] = process.argv.slice(2);
const TARGET = { low: 500, medium: 900, high: 1200 }[level] || 900;
```

Line 117 (the `first read:` console.log) becomes:
```js
const over = report.words.firstRead > TARGET * 1.25;
report.words.level = level; report.words.target = TARGET;
console.log(`first read: ${report.words.firstRead} words (${level}: aim for about ${TARGET})` + (over ? `; over the ${level} budget, cut or fold` : '') + (report.words.longProse.length ? `; prose over 110 words in: ${report.words.longProse.map(s => s.id + ' (' + s.prose + ')').join(', ')}` : ''));
```

Move the `fs.writeFileSync(path.join(out, 'states.json'), …)` line (line 114) to just after this console.log so `level` and `target` are saved.

- [ ] **Step 4: Run the checks**

```bash
skills/mindsizer/scripts/states.sh --level low skills/mindsizer/examples/vervaeke.html /tmp/ms-lv | grep '^first read'
skills/mindsizer/scripts/states.sh skills/mindsizer/examples/vervaeke.html /tmp/ms-lv2 | grep '^first read'
skills/mindsizer/scripts/states.sh --level huge x.html 2>&1 | head -1
python3 -c "import json;w=json.load(open('/tmp/ms-lv/states.json'))['words'];print(w['level'],w['target'])"
```
Expected, in order: `first read: <N> words (low: aim for about 500); over the low budget, cut or fold` (the high example is well over 625); `first read: <N> words (medium: aim for about 900)…`; `unknown level 'huge' (low, medium, high)`; `low 500`.

- [ ] **Step 5: Commit**

```bash
git add skills/mindsizer/scripts/states.sh skills/mindsizer/scripts/states.mjs
git commit -m "states.sh: --level sets the first-read target it reports against (default medium)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The skill — level table and level tags

**Files:**
- Modify: `skills/mindsizer/SKILL.md`
- Modify: `skills/mindsizer/references/patterns.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `states.sh --level <level>` from Task 2.
- Produces: the level vocabulary `low` / `medium` / `high` that the bench prompts (Task 4) reference as "the skill's level table".

- [ ] **Step 1: Write the failing check**

```bash
grep -c 'Effort: low, medium, high' skills/mindsizer/SKILL.md
grep -n '1,200 words\|Aim for 3–5 interactive\|Then choose 4–8' skills/mindsizer/SKILL.md
```
Expected now: `0`, and three hits for the old fixed budgets.

- [ ] **Step 2: Add the Effort section**

Insert right before the line `## What makes a page easy to take in`:

```markdown
## Effort: low, medium, high

Build at the level the user names; with none named, build **medium**. "Quick", "rough" or
"just the gist" means low; "deep", "thorough" or "full" means high. Don't infer a level from
the size of the source: a long paper at medium is still a medium page. The reference page
(`examples/vervaeke.html`) is high.

| | **low** | **medium** (default) | **high** |
|---|---|---|---|
| Map steps | 3 | 3–5 | 3–6 |
| Sections (not counting hero and close) | 3, one per map step | 4–5 | 4–8 |
| Interactions | 1, for the central mechanism | 2–3 | 3–5 |
| First read (`states.sh` count) | about 500 words | about 900 | about 1,200; fold more past 1,500 |
| Detail beyond the first read | cut, not folded | folded where a section needs it | folded per section |
| Spine notes | the source line for each heading | + the source line for each "so" line | + the facts list, attributions and links |
| Checks | `check.sh` | + `states.sh` | + figure review sheets and one redraw pass |
| Fidelity pass | numbers, quotes, headings | + quantifiers and hedges | all of it |
| Close | one line or a landing quote | a quote or a table | a table, one row per map step |

**Every level keeps:** reading the whole source; the map and path kickers; one claim per
section; every number and quote traceable, and anything made up labelled "illustrative";
safety in the first read; the interaction rules for every interaction you build (a lower
level builds fewer, not sloppier); `<ruby>` glosses on translated pages; the footer.

**Low** is a page you can read in about three minutes. Its footer adds one line, in the page's
language: "This is the high-level version; ask for medium or high for more depth."

**Going deeper:** when the user asks for more depth, rebuild one level up and reuse the
page's map and spine. Keep the map unless a new section needs a step it doesn't have.

Steps below marked "(medium, high)" or "(high)" are skipped at the levels not named.
```

- [ ] **Step 3: Point fixed budgets at the table**

Apply these exact replacements in `skills/mindsizer/SKILL.md`:

| old | new |
|---|---|
| `The hero shows the whole idea as a chain of 3–6 steps (chips` | `The hero shows the whole idea as a chain of steps (as many as the level allows; chips` |
| `Aim for about 1,200 words`<br>`   in the whole first read as \`scripts/states.sh\` counts it (headings, labels and tables`<br>`   included); past 1,500, fold more.` | `Aim for the level's first-read budget`<br>`   as \`scripts/states.sh\` counts it (headings, labels and tables included); it says when`<br>`   you are well over.` |
| `   foldable \`details.more\` at the end of the section, whose summary says what's inside.` | `   foldable \`details.more\` at the end of the section, whose summary says what's inside`<br>`   (at low, leave it out instead).` |
| `the detail, just fold it.` | `the detail (at medium and high), just fold it.` |
| `2. **Map and spine.** Write the 3–6 step map of the whole idea first. Then choose 4–8 sections` | `2. **Map and spine.** Write the map of the whole idea first, with the level's number of steps.`<br>`   Then choose the level's number of sections` |
| `a condition that matters is a **switch off**. Aim for 3–5 interactive sections. If two` | `a condition that matters is a **switch off**. Build the level's number of interactions; at`<br>`   low, the one interaction goes to the section that carries the central mechanism. If two` |
| `4. **Facts.** List the numbers, names and quotes you will use, each traceable to the source.`<br>`   For an argument, also list each` | `4. **Facts.** Every number, name and quote you use is traceable to the source. At high, write`<br>`   them down as a list, and for an argument also list each` |
| `In the spine, write`<br>`next to every heading and every "so" line the source sentence it rests on.` | `In the spine, write`<br>`next to every heading (and at medium and high, every "so" line) the source sentence it rests on.` |
| `bold takeaway line, then (if there's more) a` | `bold takeaway line, then (at medium and high, if there's more) a` |
| `  must be explained in the first read, not only in a fold. Then the footer:` | `  must be explained in the first read, not only in a fold. At low the close is one line or a`<br>`  landing quote; at medium, a quote or a table; at high, a table. Then the footer:` |
| `2. Run \`scripts/states.sh <page.html> [out-dir]\`. It clicks` | `2. (medium, high) Run \`scripts/states.sh --level <level> <page.html> [out-dir]\`. It clicks` |
| `3. **Figure review.** \`states.sh\` also writes` | `3. **Figure review** (high). \`states.sh\` also writes` |
| `5. **Fidelity pass.** Start with the lines you wrote yourself,` | `5. **Fidelity pass.** At low, check numbers, quotes and headings; at medium, add quantifiers`<br>`   and hedges; at high, all of the below. Start with the lines you wrote yourself,` |
| `- Reply in a few lines: what the page covers, the interactions, what is illustrative, and`<br>`  what you did NOT check.` | `- Reply in a few lines: the level you built at (and that the user can ask for one level up),`<br>`  what the page covers, the interactions, what is illustrative, and what you did NOT check.` |

If a line wraps differently in the file than shown, match the words, not the wrapping; keep lines under ~100 characters like the rest of the file.

- [ ] **Step 4: Frontmatter description and patterns.md**

In the frontmatter `description`, after `the user can name one.` insert ` Three effort levels: low (a quick, high-level page), medium (the default) and high.`

In `skills/mindsizer/references/patterns.md`, replace `A page with 3–5
interactions and some quiet sections reads better than eight widgets.` (match across the line break) with `A page with the
level's number of interactions (see the Effort table in SKILL.md) and some quiet sections reads
better than eight widgets.`

- [ ] **Step 5: README**

In `README.md`, after the line `Then just ask: "help me actually understand how RLHF works", or "make this paper click".` add:

```markdown

Pages come at three effort levels. **Medium** is the default. Say "quick" (or "low") for a
three-minute, high-level page that is cheaper and faster to build, or "go deep" (or "high") for
the full treatment: more sections and interactions, folded detail and a stricter check. Ask to
"go deeper" on a page to rebuild it one level up.
```

- [ ] **Step 6: Run the checks**

```bash
grep -c 'Effort: low, medium, high' skills/mindsizer/SKILL.md
grep -n '1,200 words\|Aim for 3–5 interactive\|Then choose 4–8\|3–5$' skills/mindsizer/SKILL.md skills/mindsizer/references/patterns.md
grep -c '(medium, high)\|(high)' skills/mindsizer/SKILL.md
grep -n 'three effort levels' README.md
```
Expected: `1`; no hits for the old budgets except inside the new table; at least 3; one README hit.

- [ ] **Step 7: Commit**

```bash
git add skills/mindsizer/SKILL.md skills/mindsizer/references/patterns.md README.md
git commit -m "skill: low / medium / high effort levels (medium by default), one recipe with a level table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Benchmark `--level`

**Files:**
- Modify: `bench/run.py` (`run_topic`, `rejudge`, `scorecard_md`, `main`)
- Modify: `bench/prompts/builder.md`, `bench/prompts/judge.md`, `bench/README.md`
- Create: `bench/test_run.py`

**Interfaces:**
- Consumes: `states.sh --level` (Task 2); "the skill's level table" (Task 3).
- Produces: `level_line(level) -> str`; `run_topic(tid, run_dir, model, reuse, k=0, level="high")`; `rejudge(d, tid, model, level="high")`; every card has `"level"`; `scorecard_md` compares a card only with baseline cards of the same level (a baseline card without `level` counts as `high`).

- [ ] **Step 1: Write the failing tests**

Create `bench/test_run.py`:

```python
import unittest
import run


def card(topic, level=None, score=6.0):
    c = {"topic": topic, "style": "ink", "confounded": False, "cost": 1, "build": {"seconds": 1},
         "quiz": {"correct": 6, "partial": 0, "wrong": 0, "of": 8, "score": score},
         "fidelity": {"high": 0, "medium": 0, "low": 0}, "rubric": {"overall": 3.0},
         "states": {k: 0 for k in ("first_read_words", "look_alike", "small_text", "handwriting", "dup_keys", "script_errors", "close_new")},
         "newcomer": {"confidence": 4}, "mechanism": {"mean": 3.0, "gaps": 0}}
    if level: c["level"] = level
    return c


class LevelTests(unittest.TestCase):
    def test_level_line(self):
        self.assertEqual(run.level_line("low"), " Build it at low effort.")
        self.assertEqual(run.level_line("high"), " Build it at high effort.")

    def test_baseline_without_level_counts_as_high(self):
        base = {"cards": [card("commons", score=8.0)]}
        md = run.scorecard_md([card("commons", "high", score=6.0)], base)
        self.assertIn("quiz fell", md)

    def test_low_card_not_compared_with_high_baseline(self):
        base = {"cards": [card("commons", score=8.0)]}
        md = run.scorecard_md([card("commons", "low", score=4.0)], base)
        self.assertNotIn("quiz fell", md)
        self.assertNotIn("(-4)", md)

    def test_scorecard_shows_level(self):
        md = run.scorecard_md([card("commons", "medium")], None)
        self.assertIn("| commons | medium |", md)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd bench && python3 -m unittest test_run -v`
Expected: FAIL. `AttributeError: module 'run' has no attribute 'level_line'`, and the scorecard tests fail on the missing level column / comparison.

- [ ] **Step 3: Implement in `bench/run.py`**

Add after `source_list`:

```python
LEVELS = ("low", "medium", "high")


def level_line(level):
    """What the builder's and judge's prompts say about effort: the user named this level."""
    return f" Build it at {level} effort."
```

In `run_topic`: signature `def run_topic(tid, run_dir, model, reuse, k=0, level="high"):`; add `"level": level` to the initial `card` dict; pass `level_line=level_line(level)` to both `prompt("builder", …)` and `prompt("judge", …)`; and change the states call to:

```python
    subprocess.run([str(SKILL / "scripts" / "states.sh"), "--level", level, str(page), str(st_dir)], capture_output=True, text=True, timeout=900)
```

In `rejudge`: signature `def rejudge(d, tid, model, level="high"):` and pass `level_line=level_line(level)` to its `prompt("judge", …)`. In `main`'s `--rejudge` branch call `rejudge(run_dir / c.get("dir", c["topic"]), c["topic"], a.model, c.get("level", "high"))`. In the `--rescore` branch add `"level"` to the tuple of keys copied from the old card.

In `scorecard_md`, key the baseline by topic and level:

```python
    bmap = {}
    for t, lv in {(c["topic"], c.get("level", "high")) for c in (base or {}).get("cards", []) if c.get("quiz")}:
        cs = [c for c in base["cards"] if c["topic"] == t and c.get("level", "high") == lv and c.get("quiz") and c.get("judge_ok", True)]
        avg = lambda f: (lambda v: sum(v) / len(v) if v else None)([f(c) for c in cs if f(c) is not None])
        bmap[(t, lv)] = {"quiz": {"score": avg(lambda c: c["quiz"]["score"])}, "fidelity": {"high": avg(lambda c: c["fidelity"]["high"])},
                         "rubric": {"overall": avg(lambda c: c["rubric"].get("overall"))}, "n": len(cs)}
```

and in the loop use `b = bmap.get((c["topic"], c.get("level", "high")))`. Add a `level` column right after `topic`: header `| topic | level | style | quiz | …`, separator gains one `|---`, each row inserts `| {c.get('level', 'high')} ` after the topic cell, and the error row gets one more empty cell.

In `main`: add `ap.add_argument("--level", choices=LEVELS, default="high", help="effort level to build at (default high, so runs compare with the baseline)")`; pass `level=a.level` in the `ex.submit(run_topic, …)` call; put `"level": a.level` in `result`; and add `, {a.level} effort` to both scorecard titles (`# mindsizer benchmark …`), using `old.get('level', 'high')` in the rescore title.

- [ ] **Step 4: Prompts**

`bench/prompts/builder.md`, step 2 becomes:
```
2. The user's request, verbatim: "$request"$style_line$level_line
```
and step 5 becomes:
```
5. Do the skill's quick check at that level (check.sh, and states.sh with --level where the level calls for it, output into $workdir/page) and its fidelity pass, once each.
```

`bench/prompts/judge.md`: the request line becomes `The user's request was: "$request"$style_line$level_line`, and at the end of section 5's first sentence add: ` Judge first_read_budget, the number of sections and interactions, folds and the close against the row for the level the user asked for in the skill's Effort table, not against high.`

- [ ] **Step 5: Run the tests**

Run: `cd bench && python3 -m unittest test_run -v && python3 run.py --help | grep -A1 -- --level`
Expected: 4 tests OK; help shows `--level {low,medium,high}`.

- [ ] **Step 6: bench README**

In `bench/README.md`, under "Run it", add after the `--reuse` line:
```bash
python3 bench/run.py commons --level low        # build at another effort level (default high, like the baseline)
```
and after the Noise section add:
```markdown
**Levels.** Runs build at `high` by default, so they compare with the baseline. A `--level low`
or `--level medium` run is compared only with baseline cards of the same level (none yet), and
the judge scores its budgets against that level's row in the skill's Effort table. Expect lower
quiz scores at lower levels; high-severity errors should stay at 0.
```

- [ ] **Step 7: Commit**

```bash
git add bench/run.py bench/test_run.py bench/prompts/builder.md bench/prompts/judge.md bench/README.md
git commit -m "bench: --level (default high); builder, judge and states.sh get the level; baseline compares like with like

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verify with real builds (costs money: ask the user first)

Not automatic. Each topic build costs roughly $5–7 and 15–20 minutes (bench README).

- [ ] **Step 1: Ask the user** which runs to pay for. Recommended minimum: `python3 bench/run.py commons --level low` and `python3 bench/run.py commons --level medium` (one topic, to see time, cost and quiz at each level), plus `python3 bench/run.py commons --level high --repeat 3` to check high stays within noise of the baseline (mean quiz within ~0.7, rubric within ~0.2, mechanism within ~0.5, 0 confirmed high-severity errors).

- [ ] **Step 2: Run what the user approves** (`python3 bench/fetch.py commons` first if `bench/.cache/commons` is missing) and report the scorecards: per level, build seconds, cost, quiz score, high/medium errors, first-read words against the level's target.

- [ ] **Step 3: If low or medium shows a confirmed high-severity error or `states.sh` problems**, fix the skill text that caused it (the judge's top-5 `skill_edit` lines point at it), re-run that one topic once, and commit with a message naming the run.
