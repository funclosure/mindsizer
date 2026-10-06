#!/usr/bin/env python3
"""Run the mindsizer benchmark: build each topic's page with the skill, then evaluate it.

Per topic, every role is a separate headless `claude -p` session that sees only what it needs:
  builder   the skill + the sources        -> page/<topic>.html
  states    scripts/states.sh               -> look-alike states, tiny phone text, handwriting, first-read words
  answerer  the page only                   -> answers to the frozen quiz (quizzes/<topic>.json)
  grader    the quiz + the answers          -> correct / partial / wrong / not-covered
  judge     the page + the sources          -> fidelity errors, rubric, rule checks, top problems
  newcomer  the page only                   -> explain-back, confusion, confidence
Then it writes scorecard.json / scorecard.md for the run and compares against bench/baseline.json.

Usage:
  python3 bench/run.py commons                 # one topic (the quick check)
  python3 bench/run.py --all                   # every topic
  python3 bench/run.py --all --save-baseline   # ...and make this run the new baseline
  python3 bench/run.py commons --reuse bench/runs/<run>   # re-evaluate pages from an earlier run, no rebuild
Options: --model claude-opus-5-5  --jobs 2 (topics in parallel)
Needs: the claude CLI, logged in; run `python3 bench/fetch.py` first.
"""
import argparse, concurrent.futures as cf, datetime, json, pathlib, shutil, string, subprocess, sys, time

BENCH = pathlib.Path(__file__).resolve().parent
SKILL = BENCH.parent / ".claude" / "skills" / "mindsizer"
TOPICS = {t["id"]: t for t in json.loads((BENCH / "topics.json").read_text())["topics"]}


def prompt(name, **kw):
    return string.Template((BENCH / "prompts" / f"{name}.md").read_text()).safe_substitute(**kw)


def claude(role, text, cwd, tools, model, logs, add_dirs=(), timeout=1800):
    """One headless session. Returns {ok, seconds, cost, result}."""
    cmd = ["claude", "-p", text, "--model", model, "--output-format", "json", "--no-session-persistence",
           "--permission-mode", "dontAsk", "--allowedTools", *tools]
    for d in add_dirs: cmd += ["--add-dir", str(d)]
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        out = json.loads(p.stdout) if p.stdout.strip().startswith("{") else {"result": p.stdout, "is_error": True}
    except subprocess.TimeoutExpired:
        out = {"result": f"timed out after {timeout}s", "is_error": True}
    secs = round(time.time() - t0)
    (logs / f"{role}.json").write_text(json.dumps(out, indent=1))
    return {"ok": not out.get("is_error"), "seconds": secs, "cost": out.get("total_cost_usd") or 0, "result": out.get("result", "")}


def ensure_json(path, model, logs):
    """Roles write JSON by hand and sometimes break it (an unescaped quote). Ask once for a syntax-only repair."""
    path = pathlib.Path(path)
    if not path.exists(): return False
    try: json.loads(path.read_text()); return True
    except json.JSONDecodeError as e: err = str(e)
    claude("repair-" + path.stem, f"The file {path} is not valid JSON ({err}). Fix only the JSON syntax (escape quotes, "
           f"add missing commas or brackets); keep every value and the structure exactly as they are. Write it back to {path}. Reply 'fixed'.",
           cwd=path.parent, tools=["Read", "Write", "Edit"], model=model, logs=logs, timeout=600)
    try: json.loads(path.read_text()); return True
    except json.JSONDecodeError: return False


def load(path, default=None):
    try: return json.loads(pathlib.Path(path).read_text())
    except Exception: return default


def source_list(t, src):
    return "\n".join(f"   - {src / s['file']}" + (f" ({s['url']})" if s.get("url") else "") + (f": {s['hint']}" if s.get("hint") else "") for s in t["sources"])


def run_topic(tid, run_dir, model, reuse):
    t, d = TOPICS[tid], run_dir / tid
    src, page_dir, logs = d / "src", d / "page", d / "logs"
    for x in (src, page_dir, logs): x.mkdir(parents=True, exist_ok=True)
    cache = BENCH / ".cache" / tid
    for s in t["sources"]:
        f = cache / s["file"]
        if not f.exists(): raise SystemExit(f"missing source {f}; run python3 bench/fetch.py {tid}")
        shutil.copy(f, src / s["file"])
    page = page_dir / f"{tid}.html"
    style_line = f", in the {t['style']} style." if t.get("style") else ""
    card = {"topic": tid, "style": t.get("style") or "default", "confounded": bool(t.get("confounded")), "cost": 0}

    # 1. build
    if reuse:
        shutil.copy(pathlib.Path(reuse) / tid / "page" / f"{tid}.html", page); card["build"] = {"reused": str(reuse)}
    else:
        r = claude("builder", prompt("builder", skill=SKILL, request=t["request"], style_line=style_line, src=src,
                                     source_list=source_list(t, src), notes=("   " + t["notes"]) if t.get("notes") else "",
                                     page=page, workdir=d),
                   cwd=d, tools=["Read", "Write", "Edit", "Glob", "Grep", "Bash"], model=model, logs=logs, add_dirs=[SKILL], timeout=3600)
        card["build"] = {"ok": r["ok"] and page.exists(), "seconds": r["seconds"], "cost": r["cost"]}; card["cost"] += r["cost"]
        (d / "builder-report.md").write_text(r["result"])
    if not page.exists():
        card["error"] = "no page"; return card

    # 2. states.sh
    st_dir = d / "states"
    subprocess.run([str(SKILL / "scripts" / "states.sh"), str(page), str(st_dir)], capture_output=True, text=True, timeout=900)

    # 3. readers, in parallel, each in its own folder with its own copy of the page
    quiz = BENCH / "quizzes" / f"{tid}.json"
    dirs = {r: d / r for r in ("answerer", "judge", "newcomer")}
    for r, x in dirs.items():
        x.mkdir(exist_ok=True); shutil.copy(page, x / "page.html")
    (dirs["answerer"] / "questions.json").write_text(json.dumps([{"id": q["id"], "question": q["question"]} for q in load(quiz)["questions"]], indent=1))
    jobs = {
        "answerer": (prompt("answerer", page=dirs["answerer"] / "page.html", questions=dirs["answerer"] / "questions.json", out=dirs["answerer"] / "answers.json"),
                     dirs["answerer"], ["Read", "Write"], []),
        "judge": (prompt("judge", page=dirs["judge"] / "page.html", src=src, source_list=source_list(t, src), request=t["request"],
                         style_line=style_line, skill=SKILL, out=dirs["judge"] / "report.json"), d, ["Read", "Write", "Glob", "Grep"], [SKILL]),
        "newcomer": (prompt("newcomer", page=dirs["newcomer"] / "page.html", out=dirs["newcomer"] / "newcomer.json"), dirs["newcomer"], ["Read", "Write"], []),
    }
    with cf.ThreadPoolExecutor(3) as ex:
        futs = {r: ex.submit(claude, r, p, cwd, tools, model, logs, adds) for r, (p, cwd, tools, adds) in jobs.items()}
        res = {r: f.result() for r, f in futs.items()}
    for r in res.values(): card["cost"] += r["cost"]
    for f in (dirs["answerer"] / "answers.json", dirs["judge"] / "report.json", dirs["newcomer"] / "newcomer.json"):
        ensure_json(f, model, logs)

    # 4. grader
    g = claude("grader", prompt("grader", quiz=quiz, answers=dirs["answerer"] / "answers.json", out=d / "grades.json"),
               cwd=d, tools=["Read", "Write"], model=model, logs=logs, add_dirs=[BENCH / "quizzes"])
    card["cost"] += g["cost"]
    ensure_json(d / "grades.json", model, logs)
    card["cost"] = round(card["cost"], 2)
    return score(d, tid, card)


def score(d, tid, card):
    """Fill a topic's card from the files a run left in d (so a run can be re-scored without re-running)."""
    quiz = BENCH / "quizzes" / f"{tid}.json"
    s = load(d / "states" / "states.json", {}) or {}
    card["states"] = {"first_read_words": (s.get("words") or {}).get("firstRead"), "look_alike": len(s.get("same", [])),
                      "small_text": len(s.get("small", [])), "handwriting": len(s.get("handCode", [])),
                      "dup_keys": len(s.get("dupKeys", [])), "script_errors": len(s.get("errors", [])),
                      "close_new": len((s.get("close") or {}).get("fresh", [])) + (1 if (s.get("close") or {}).get("missing") else 0)}
    grades = load(d / "grades.json", []) or []
    count = lambda k: sum(1 for x in grades if x.get("grade") == k)
    card["quiz"] = {"correct": count("correct"), "partial": count("partial"), "wrong": count("wrong"), "not_covered": count("not-covered"),
                    "of": len(load(quiz)["questions"]), "score": count("correct") + 0.5 * count("partial")}

    j = load(d / "judge" / "report.json", {}) or {}
    card["judge_ok"] = bool(j)
    errs = (j.get("fidelity") or {}).get("errors", [])
    sev = lambda k: sum(1 for e in errs if e.get("severity") == k)
    rules = j.get("rules") or {}
    verdict = lambda v: (v.get("verdict") if isinstance(v, dict) else v) or ""
    card["fidelity"] = {"high": sev("high"), "medium": sev("medium"), "low": sev("low"), "checked": (j.get("fidelity") or {}).get("self_written_checked")}
    card["rubric"] = (j.get("rubric") or {}).get("means", {})
    card["rules"] = {k: verdict(v) for k, v in rules.items()}
    card["rules_failed"] = [k for k, v in card["rules"].items() if v.startswith("failed")]
    card["top5"] = [p.get("problem") for p in j.get("top5", [])]
    n = load(d / "newcomer" / "newcomer.json", {}) or {}
    card["newcomer"] = {"confidence": n.get("confidence"), "length": n.get("length")}
    return card


def num(x, nd=2):
    return "–" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def scorecard_md(cards, base):
    bmap = {c["topic"]: c for c in (base or {}).get("cards", [])}
    rows = ["| topic | style | quiz | high / med / low | rubric | mechanism | first read | states problems | newcomer | build | cost |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    flags = []
    for c in cards:
        if c.get("error"): rows.append(f"| {c['topic']} | {c['style']} | {c['error']} |||||||||"); continue
        q, f, r, s, b = c["quiz"], c["fidelity"], c["rubric"], c["states"], bmap.get(c["topic"])
        probs = sum(s[k] or 0 for k in ("look_alike", "small_text", "handwriting", "dup_keys", "script_errors", "close_new"))
        delta = lambda now, old: "" if old is None or now is None else f" ({now - old:+.2g})"
        rows.append(f"| {c['topic']}{' ⚠' if c['confounded'] else ''} | {c['style']} | {q['correct']}✓ {q['partial']}~ {q['wrong']}✗ of {q['of']}"
                    f"{delta(q['score'], b and b['quiz']['score'])} | {f['high']} / {f['medium']} / {f['low']} | {num(r.get('overall'))}"
                    f"{delta(r.get('overall'), b and b['rubric'].get('overall'))} | {num(r.get('mechanism_shown'))} | {num(s['first_read_words'])} | {probs} | "
                    f"{num(c['newcomer']['confidence'])}/5 | {num((c['build'] or {}).get('seconds'))}s | ${num(c['cost'])} |")
        if b:
            if q["score"] <= b["quiz"]["score"] - 1: flags.append(f"{c['topic']}: quiz fell {b['quiz']['score']} → {q['score']}")
            if f["high"] > b["fidelity"]["high"]: flags.append(f"{c['topic']}: high-severity errors rose {b['fidelity']['high']} → {f['high']}")
            if (r.get("overall") or 0) <= (b["rubric"].get("overall") or 0) - 0.3: flags.append(f"{c['topic']}: rubric fell {b['rubric'].get('overall')} → {r.get('overall')}")
        if not c.get("judge_ok", True): flags.append(f"{c['topic']}: the judge's report is missing or unreadable; its fidelity and rubric are blank, not zero")
        if probs: flags.append(f"{c['topic']}: states.sh found {probs} problem(s)")
        if c.get("rules_failed"): flags.append(f"{c['topic']}: rules failed: {', '.join(c['rules_failed'])}")
    out = "\n".join(rows)
    out += "\n\n⚠ = confounded topic (the skill's example is this topic); read as a ceiling.\n"
    out += ("\n**Flags**\n" + "\n".join(f"- {x}" for x in flags)) if flags else "\nNo flags."
    for c in cards:
        if c.get("top5"): out += f"\n\n**{c['topic']}: judge's top problems**\n" + "\n".join(f"{i}. {p}" for i, p in enumerate(c["top5"], 1))
    return out


def main():
    ap = argparse.ArgumentParser(description="mindsizer benchmark")
    ap.add_argument("topics", nargs="*"); ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default="claude-opus-5-5"); ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--reuse"); ap.add_argument("--save-baseline", action="store_true")
    ap.add_argument("--rescore", help="rebuild a run's scorecard from its saved files (repairs broken JSON first)")
    a = ap.parse_args()
    if a.rescore:
        run_dir = pathlib.Path(a.rescore); old = load(run_dir / "scorecard.json")
        cards = []
        for c in old["cards"]:
            d = run_dir / c["topic"]
            for f in (d / "answerer" / "answers.json", d / "judge" / "report.json", d / "newcomer" / "newcomer.json", d / "grades.json"):
                ensure_json(f, a.model, d / "logs")
            cards.append(score(d, c["topic"], {k: c[k] for k in ("topic", "style", "confounded", "cost", "build") if k in c}))
        old["cards"] = cards
        (run_dir / "scorecard.json").write_text(json.dumps(old, indent=1))
        md = f"# mindsizer benchmark {run_dir.name} (skill {old['skill_commit']}, {old['model']}), rescored\n\n" + scorecard_md(cards, load(BENCH / "baseline.json"))
        (run_dir / "scorecard.md").write_text(md); print(md)
        if a.save_baseline: shutil.copy(run_dir / "scorecard.json", BENCH / "baseline.json"); print(f"\nbaseline saved from {run_dir.name}")
        return
    ids = list(TOPICS) if a.all else a.topics
    if not ids or any(i not in TOPICS for i in ids): sys.exit(f"pick topics from: {', '.join(TOPICS)} (or --all)")
    run_dir = BENCH / "runs" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S"); run_dir.mkdir(parents=True)
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=BENCH, capture_output=True, text=True).stdout.strip()
    print(f"run {run_dir.name}: {', '.join(ids)} with {a.model} at skill {sha}", flush=True)
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(run_topic, i, run_dir, a.model, a.reuse): i for i in ids}
        cards = []
        for f in cf.as_completed(futs):
            try: c = f.result()
            except BaseException as e: c = {"topic": futs[f], "style": "", "error": f"crashed: {e}"}
            cards.append(c); print(f"done: {c['topic']}", flush=True)
    cards.sort(key=lambda c: ids.index(c["topic"]))
    result = {"run": run_dir.name, "skill_commit": sha, "model": a.model, "cards": cards,
              "total_cost": round(sum(c.get("cost", 0) for c in cards), 2)}
    (run_dir / "scorecard.json").write_text(json.dumps(result, indent=1))
    md = f"# mindsizer benchmark {run_dir.name} (skill {sha}, {a.model})\n\n" + scorecard_md(cards, load(BENCH / "baseline.json"))
    md += f"\n\nTotal cost: ${result['total_cost']}"
    (run_dir / "scorecard.md").write_text(md)
    print("\n" + md)
    if a.save_baseline:
        shutil.copy(run_dir / "scorecard.json", BENCH / "baseline.json"); print(f"\nbaseline saved from {run_dir.name}")


if __name__ == "__main__":
    main()
