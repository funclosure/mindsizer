# eval/ — measuring deck quality

The rubric is in [RUBRIC.md](RUBRIC.md). The latest baseline is in `results/<run>/REPORT.md`.

**Source texts are never committed** (the repo is public). They are fetched into `eval/.cache/`,
which is gitignored. Decks, screenshots, scores and reports are committed: they contain only
short quotations.

## Rerun

```sh
bun install && bunx playwright install chromium

# 1. fetch sources → eval/.cache/<id>.txt + manifest.json (unavailable sources are recorded, not substituted)
bun run eval:fetch                 # --force to refetch, or pass ids

# 2. plan + build every fetchable source with the CURRENT harness, then score, noise, report, calibration
bun run eval:baseline              # --run <name> --only dont-scale --jobs 2 --noise 2 --no-build --no-score

# score one deck by hand
bun run eval:score <deck.html> --plan <plan.md> --source eval/.cache/<id>.txt --source-id <id> --out <dir>
bun run eval:score examples/dont-scale.deck.html --outline examples/dont-scale.outline.md --source eval/.cache/dont-scale.txt

# regenerate derived files
bun run eval:noise --run <run>     # needs results/<run>/scores-r2/
bun run eval:report --run <run>
bun run eval:calibration --run <run>
```

`eval:baseline` defaults every harness role to `claude-opus-5-5`. To use another model, set
`MINDSIZER_MODEL` and `MINDSIZER_{INGEST,AUTHOR,JUDGE,REVIEW}_MODEL`. The eval judges use
`EVAL_JUDGE_MODEL` (default `claude-opus-5-5`) and `EVAL_JUDGE_EFFORT` (default `medium`).
`EVAL_CONCURRENCY` caps concurrent judge sessions per scorer process (default 6).

`eval/clean-env.sh` (used by the `eval:score` / `eval:baseline` scripts) strips this machine's Claude
Code session variables, so the Agent SDK's child sessions don't attach to a parent Claude Code session.
It is a no-op elsewhere.

## Layout

| path | what |
|---|---|
| `sources.json` | the 11 eval sources (genre and stress noted per source) |
| `fetch.ts` | source → plain text (HTML article extraction, PDF via unpdf, YouTube auto-captions via yt-dlp) |
| `score.ts` | the scorer → `scores.json`, `shots/`, `contact-sheet.png` |
| `lib/criteria.ts` | judge prompts and anchors (the rubric in code) |
| `lib/judge.ts` | isolated SDK judge calls with images; the agentic `drive` judge |
| `lib/driver.ts` | Chromium slide driver: rest capture, text boxes, background sampling, controls, drive actions |
| `lib/craft.ts` | deterministic craft checks (contrast, overlap, cut-off, frame) |
| `lib/aggregate.ts` | means, distributions, the key question, noise, quiz score |
| `questions/<id>.json` | cached quiz (Call A) per source — commit these so runs stay comparable |
| `calibration.html` | human calibration sheet (open it from a checkout so the screenshot paths resolve) |
| `results/<run>/` | decks, plans, `progress.jsonl`, build logs, `scores/`, `scores-r2/`, `noise.json`, `REPORT.md` |

Unit tests for the deterministic parts are in `tests/eval/`.
