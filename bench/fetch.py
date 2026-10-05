#!/usr/bin/env python3
"""Fetch each benchmark topic's sources into bench/.cache/<topic>/ (git-ignored: they are copyrighted).

Usage: python3 bench/fetch.py [topic ...] [--force]
Needs: curl; gh (for GitHub issues); yt-dlp (for YouTube captions).
"""
import html.parser, json, pathlib, re, subprocess, sys, urllib.request, urllib.parse

BENCH = pathlib.Path(__file__).resolve().parent
UA = {"User-Agent": "mindsizer-bench/1.0 (https://github.com/funclosure/mindsizer)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


class Text(html.parser.HTMLParser):
    """Visible text of a page's <article> (or <main>, or <body>), skipping chrome."""
    SKIP = {"script", "style", "nav", "header", "footer", "aside", "form", "svg", "noscript", "button"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "blockquote", "section", "article"}

    def __init__(self):
        super().__init__()
        self.parts, self.skip, self.depth = {"article": [], "main": [], "body": []}, 0, {"article": 0, "main": 0, "body": 0}

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        if tag in self.depth: self.depth[tag] += 1
        if tag in self.BLOCK: self._add("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip: self.skip -= 1
        if tag in self.depth and self.depth[tag]: self.depth[tag] -= 1
        if tag in self.BLOCK: self._add("\n")

    def handle_data(self, data):
        if not self.skip: self._add(data)

    def _add(self, s):
        for k in self.parts:
            if self.depth[k]: self.parts[k].append(s)

    def text(self):
        for k in ("article", "main", "body"):
            t = "".join(self.parts[k])
            if len(t.split()) > 200: break
        lines = [re.sub(r"\s+", " ", l).strip() for l in t.splitlines()]
        return "\n".join(l for l in lines if l)


def fetch(src, out):
    kind = src["type"]
    if kind == "raw":
        out.write_text(get(src["url"]))
    elif kind == "html":
        p = Text(); p.feed(get(src["url"])); out.write_text(src["url"] + "\n\n" + p.text())
    elif kind == "wikipedia":
        q = urllib.parse.urlencode({"action": "query", "prop": "extracts", "explaintext": 1, "format": "json", "titles": src["title"], "redirects": 1})
        page = next(iter(json.loads(get("https://en.wikipedia.org/w/api.php?" + q))["query"]["pages"].values()))
        out.write_text(f"{page['title']} (Wikipedia, CC BY-SA 4.0)\nhttps://en.wikipedia.org/wiki/{src['title']}\n\n{page['extract']}")
    elif kind == "gh-issue":
        jq = '"# "+.title+"\\n\\n"+.body+"\\n\\n"+([.comments[]|"--- "+.author.login+" ("+.createdAt+"):\\n"+.body]|join("\\n\\n"))'
        text = subprocess.check_output(["gh", "issue", "view", str(src["number"]), "-R", src["repo"], "--json", "title,body,comments", "-q", jq], text=True)
        out.write_text(f"https://github.com/{src['repo']}/issues/{src['number']}\n\n{text}")
    elif kind == "youtube":
        tmp = out.parent / "_yt"
        tmp.mkdir(exist_ok=True)
        subprocess.run(["yt-dlp", "--skip-download", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "vtt", "-o", str(tmp / "v"), src["url"]], check=True, capture_output=True)
        vtt = next(tmp.glob("*.vtt")).read_text()
        lines, prev = [], None
        for l in vtt.splitlines():
            if not l.strip() or "-->" in l or l.startswith(("WEBVTT", "Kind:", "Language:")): continue
            l = re.sub(r"<[^>]+>", "", l).strip()
            if l and l != prev: lines.append(l); prev = l
        out.write_text(f"{src.get('title', '')}\n{src['url']}\n(auto-generated captions)\n\n" + " ".join(lines))
        for f in tmp.iterdir(): f.unlink()
        tmp.rmdir()
    else:
        raise ValueError(f"unknown source type {kind}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    topics = json.loads((BENCH / "topics.json").read_text())["topics"]
    for t in topics:
        if args and t["id"] not in args: continue
        d = BENCH / ".cache" / t["id"]; d.mkdir(parents=True, exist_ok=True)
        for s in t["sources"]:
            out = d / s["file"]
            if out.exists() and out.stat().st_size > 500 and not force:
                print(f"{t['id']}/{s['file']}: cached ({len(out.read_text().split())} words)"); continue
            try:
                fetch(s, out); print(f"{t['id']}/{s['file']}: fetched ({len(out.read_text().split())} words)")
            except Exception as e:
                print(f"{t['id']}/{s['file']}: FAILED: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
