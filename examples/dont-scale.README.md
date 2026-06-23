# Example: _Do Things that Don't Scale_

A complete, ready-to-run example built from Paul Graham's essay
[_Do Things that Don't Scale_](https://paulgraham.com/ds.html). Use it to see what
mindsizer produces — and to start without supplying your own text.

| File | What it is |
| --- | --- |
| `dont-scale.txt` | The source article (plain text). |
| `dont-scale.outline.md` | The canonical outline mindsizer produced from it — the deck's spine. |
| `dont-scale.outline.context.json` | The digest + chosen teaching angle (the "context sidecar" the author reads). |
| `dont-scale.deck.html` | The **prebuilt interactive deck** — open it directly, no install needed. |

## Three ways to use it

**1. Just look (zero setup).**

```bash
open examples/dont-scale.deck.html        # macOS — or open the file in any browser
```

Arrow keys (**← / →**) navigate; click and drag the controls on the interactive slides.
Also live at <https://funclosure.github.io/mindsizer/dont-scale/>.

**2. Rebuild the deck from the outline** (needs Bun + Claude auth — see the root README):

```bash
bun run example
# = mindsizer build examples/dont-scale.outline.md -o examples/dont-scale.deck.html --open
```

**3. Run the whole pipeline from the raw text:**

```bash
mindsizer ingest examples/dont-scale.txt --yes -o /tmp/dont-scale.outline.md
mindsizer build /tmp/dont-scale.outline.md --open
```
