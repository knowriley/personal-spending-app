#!/usr/bin/env python3
"""build_static.py — M0 walking skeleton.

Wipes /dist and writes the simplest possible page that proves the deploy
pipeline end-to-end: an HTML page that fetches one JSON file.

M1+ replaces this with the real per-persona pre-computation pipeline
(see docs/PRD-v2-engineering.md §3).
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "dist"


INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MoneyHabits</title>
  <style>
    body { font: 16px -apple-system, system-ui, sans-serif; margin: 2rem; color: #1c1c1e; }
    h1 { font-weight: 600; }
    code { background: #f2f2f7; padding: 2px 6px; border-radius: 4px; }
    #payload { color: #636366; }
  </style>
</head>
<body>
  <h1>Hello MoneyHabits</h1>
  <p>v2 walking skeleton — M0.</p>
  <p>Payload from <code>/api/hello.json</code>: <span id="payload">loading...</span></p>
  <script>
    fetch('/api/hello.json')
      .then(r => r.json())
      .then(data => { document.getElementById('payload').textContent = data.message; })
      .catch(err => { document.getElementById('payload').textContent = 'fetch failed: ' + err.message; });
  </script>
</body>
</html>
"""


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    (DIST / "index.html").write_text(INDEX_HTML)

    api_dir = DIST / "api"
    api_dir.mkdir()
    with open(api_dir / "hello.json", "w") as f:
        json.dump({"message": "the pipeline works"}, f)

    files = sum(1 for _ in DIST.rglob("*") if _.is_file())
    print(f"build complete — {files} files written to {DIST}")


if __name__ == "__main__":
    main()
