# PRD v2: Engineering

> Scope: how v2 is built and deployed. The build pipeline (`build_static.py`), the JSON tree layout, the client-side filtering implementation, the custom radial chart, the asset pipeline, the Render deploy.
> Companion docs: `PRD-v2-overview.md` anchors the suite, `PRD-v2-feature-spec.md` defines behavior, `PRD-v2-mobile-design.md` defines design, `PRD-v2-pwa-shell.md` defines the manifest + SW.
> Reading order: this doc → phasing.

This is the implementation reference. A new contributor — human or Claude — should be able to take this doc and execute v2 from it without needing to invent architecture decisions. Where the doc says "see code below," there's code below. Where it says "engineering decision: X," that decision is final.

A guiding principle: **the Flask app from v1 is preserved as a build-time tool.** Nothing about `data_processor.py` or `app.py` is rewritten. The build script calls them, harvests their JSON output, writes it to disk, and that's all the runtime needs. The runtime is a static site.

---

## 1. Architecture

### 1.1 The big picture

```
┌─────────────────────┐
│   Source repo       │
│  ─────────────────  │
│  app.py (Flask)     │     build time
│  data_processor.py  │  ──────────────►  ┌──────────────┐
│  templates/         │   build_static.py │  /dist       │
│  static/            │                   │  (output)    │
│  datasets/*.csv     │                   │              │
└─────────────────────┘                   │  index.html  │
                                          │  manifest    │
                                          │  /static/    │
                                          │  /api/       │     deploy
                                          │   student/   │  ─────────► Render
                                          │   young-pro/ │   (static
                                          │  /icons/     │    site)
                                          │  /splash/    │
                                          │  sw.js       │
                                          └──────────────┘
```

### 1.2 What changes from v1

| Layer | v1 | v2 |
|---|---|---|
| Backend at runtime | Flask + pandas serving JSON on every request | **Gone.** No backend at runtime. |
| Frontend hits | `fetch('/api/summary?level=all&...')` | `fetch('/api/student/summary-all.json')` |
| Persona switch | `POST /api/datasets/active` + page reload | Frontend state change; re-fetches from a different folder |
| Filtering | Server-side via pandas + request params | Client-side via JS, against pre-loaded JSON |
| Pagination | Server-side, 50 rows/page | Client-side, grouped by month, "Load older" |
| Charts | Plotly | Chart.js + hand-rolled SVG radial |
| Hosting | Procfile + gunicorn (Render web service) | Static site (Render static site) |

### 1.3 What stays from v1

- **`data_processor.py`**: every function that builds DataFrames or returns dict-shaped responses is preserved. The Flask routes still wrap them. The build script calls them.
- **`app.py`**: the Flask routes themselves are preserved. The build script either calls them via the Flask test client OR imports `data_processor` directly. We use the latter (§3.2) — fewer moving parts.
- **`datasets/*.csv`**: same CSV files.
- **`requirements.txt`**: Flask + pandas still needed for the build, but they're build-time deps, not runtime.
- **The category palette, emoji map, and design tokens** (§9 of mobile design): all preserved.

---

## 2. Repo layout

```
moneyhabits/
├── app.py                      # Flask routes — unchanged from v1; used only at build time
├── data_processor.py           # Business logic — unchanged from v1
├── build_static.py             # NEW — the build orchestrator (§3)
├── build_assets.py             # NEW — icons + splash screen generation (§5)
├── requirements.txt            # + cairosvg or similar for SVG → PNG
│
├── datasets/                   # CSVs, unchanged from v1
│   ├── student.csv
│   └── young-pro.csv
│
├── templates/
│   └── base.html               # Modified — see §6 for new head meta, manifest link
│
├── static/                     # Source assets (NOT served directly; copied into /dist)
│   ├── css/
│   │   ├── style.css           # Modified — iOS-tuned gray tokens, new component classes
│   │   ├── tailwind.css        # Rebuilt from tailwind.input.css
│   │   └── tailwind.input.css
│   ├── js/
│   │   ├── app.js              # Heavy modifications — see §4
│   │   ├── ios.js              # NEW — sheets, flyouts, swipe, large-title scroll (§4.4)
│   │   ├── radial.js           # NEW — hand-rolled SVG radial chart (§7)
│   │   └── chart.umd.min.js    # NEW — Chart.js 4.x local copy (~200KB)
│   ├── icons/
│   │   └── source.svg          # Source for all PNG icons
│   └── splash/
│       └── source.svg          # Source for all iOS splash screens
│
├── service-worker.template.js  # NEW — SW source with __BUILD_HASH__ placeholder (§8.2)
├── manifest.template.json      # NEW — manifest source with __BUILD_HASH__ placeholder
│
├── dist/                       # NEW — build output. Gitignored. Served as static site by Render.
│   └── (generated; see §3.4)
│
├── tailwind.config.js
├── Procfile                    # DELETED — no runtime server
├── render.yaml                 # NEW — Render static site config (§10)
├── .gitignore                  # Modified — adds /dist
│
├── README.md                   # Updated for v2 quick-start
├── CLAUDE.md                   # Updated — points future Claude at the build pipeline
├── DESIGN-SYSTEM.md            # Updated with v2 token changes
├── DATA-PIPELINE.md            # Unchanged (still describes how the data layer works)
└── PRD-v2-*.md                 # All v2 PRDs in repo
```

`.gitignore` gains:
```
/dist
__pycache__
*.pyc
.active-dataset                 # v1 file no longer needed; can also be removed entirely
```

---

## 3. The build pipeline (`build_static.py`)

This is the core of v2 architecture. A single Python script that produces the entire `/dist` tree.

### 3.1 What the build does, end to end

```
1. Wipe /dist (if it exists).
2. Copy static assets into /dist:
   - /dist/static/ from /static/ (recursive)
   - /dist/icons/ from /static/icons/ (after running build_assets.py)
   - /dist/splash/ from /static/splash/ (after running build_assets.py)
3. Compute BUILD_HASH (git short SHA or timestamp).
4. Substitute BUILD_HASH and DEPLOY_URL into templated files:
   - manifest.template.json → /dist/manifest.json
   - service-worker.template.js → /dist/sw.js
5. Render index.html from base.html (single page, no Jinja runtime).
   - Substitute DEPLOY_URL into og:image, og:url
   - Substitute BUILD_HASH where needed (asset paths, SW URL)
   - Write to /dist/index.html
6. For each persona in DATASETS:
   - set_active_dataset(persona_key)
   - Drop cached DataFrames
   - Pre-compute every API response for this persona
   - Write each response as a JSON file under /dist/api/{persona_key}/
7. Write /dist/api/personas.json listing both personas (key, label).
8. Print build summary (file count, total bytes, time elapsed).
```

### 3.2 How to call the v1 endpoint logic

Two options:
- **Use Flask's test client** (`app.test_client().get('/api/summary?...')`) — true integration with the routing layer
- **Import `data_processor` directly** — call the functions that v1 routes wrap

**Decision: import `data_processor` directly.**

Reasoning: the test-client approach involves spinning up Flask, going through routing, then unwrapping JSON. The direct-import approach is `dp.summary(level=..., category=..., year_month=...)` and you get a dict. Same data, simpler call. The Flask routes in v1 are thin wrappers (per `CLAUDE.md`) — there's no validation or transformation that lives only in the route layer.

What this means: every endpoint function in `data_processor.py` becomes a callable from the build script. If a function name doesn't match an endpoint exactly, we add a small wrapper in the build script.

### 3.3 What gets pre-computed, per endpoint

The "minimize file count by emitting bigger files the frontend slices" rule from earlier. Per-endpoint:

#### `/api/summary` → multi-month files per scope

v1 shape: `{this_month, last_month, monthly_avg, top}` for one month.

v2 shape: one file per `(persona, level, category, timeframe)` containing **all months** as a dict.

```json
// /api/student/summary-all-last12.json
{
  "timeframe": "last-12-months",
  "months": {
    "2026-05": { "this_month": ..., "last_month": ..., "monthly_avg": ..., "top": {...} },
    "2026-04": { ... },
    ...
  }
}
```

The frontend picks the month it needs from `months[lensMonth]`.

File count: `(3 levels × ~34 categories × 5 timeframes × 2 personas) = ~1000 files`.

This is the largest file count of any endpoint. Acceptable — each file is small (a few KB).

#### `/api/monthly` → per-scope, multi-period

v1 shape: period-bucketed totals for a scope, parameterized by `granularity`, `start`, `end`, `categories`, `parent`, `group_by`.

v2 shape: one file per `(persona, scope, granularity, group_by)` containing the full date range. The frontend slices to the timeframe it wants.

```json
// /api/student/monthly-all-month.json
{
  "granularity": "month",
  "periods": [
    { "period": "2022-08", "total": 1234.56 },
    { "period": "2022-09", "total": 2345.67 },
    ...
  ]
}
```

For `group_by=parent`, the `total` field becomes `totals: { food: 234, personal: 567, ... }`.

File count: scopes (~34) × granularities (3: day/week/month) × group_by variations (~3) × 2 personas ≈ 600 files.

#### `/api/transactions` → ONE file per persona

The big one. v1 paginates server-side with filtering; v2 ships **all** transactions and the frontend filters.

```json
// /api/student/transactions.json
{
  "rows": [
    { "date": "2026-05-24", "name": "Starbucks", "amount": 7.45, "category": "Cafés", "parent": "Food & Drink", "account": "Chase", "day_of_week": "Sunday" },
    ...
  ]
}
```

Per persona: ~3,600 rows × ~200 bytes = ~700KB raw, ~150KB gzipped. Acceptable single-file payload.

File count: 2 (one per persona).

#### `/api/category-detail` → per-scope, multi-month

Same shape philosophy as `/api/summary`. One file per `(persona, level, category)` with all months keyed.

```json
// /api/student/category-detail-leaf-cafes.json     ← slug from scope_slug("leaf", "Cafés")
{
  "level": "leaf",
  "category": "Cafés",                              ← preserves original name in payload
  "months": {
    "2026-05": { "total": 98, "pct_of_total": 5.6, "transaction_count": 14, "avg_transaction": 7.00, "most_frequent_dow": "Saturday", "top_locations": [...], "cumulative_spend": [...], "transactions": [...] },
    "2026-04": { ... },
    ...
  }
}
```

Important: the `transactions` array for each month is a **subset** of the persona's `transactions.json`. We could de-dup by reference, but JSON doesn't support references natively. We accept the duplication — total disk cost is bounded (~2× the transactions.json size) and the SW caches everything.

File count: ~34 categories × 3 levels × 2 personas ≈ 200 files.

#### `/api/radial` → per-scope (decided in earlier session)

One file per `(persona, scope)`. Contains all years × all months.

```json
// /api/student/radial-all.json
{
  "years": {
    "2026": [123, 234, 345, 456, ...12 months],
    "2025": [...],
    ...
  }
}
```

File count: ~34 scopes × 2 personas ≈ 70 files.

#### `/api/category-hierarchy` → one per persona, multi-month

```json
// /api/student/category-hierarchy.json
{
  "months": {
    "2026-05": { "all_total": 1750, "nodes": [...] },
    ...
  }
}
```

File count: 2.

#### `/api/category-meta` → one per persona, includes slug

Extended in v2 from v1: each entry now includes the URL slug produced by `scope_slug()`, so the frontend doesn't need its own copy of the slug logic. This is the single source of truth for category → slug mapping.

```json
// /api/student/category-meta.json
[
  { "category": "Cafés",        "parent": "Food & Drink",  "slug": "leaf-cafes" },
  { "category": "Restaurants",  "parent": "Food & Drink",  "slug": "leaf-restaurants" },
  { "category": "Food & Drink", "parent": null,            "slug": "parent-food-and-drink" },
  ...
]
```

Frontend usage: on Habits tab init, load `category-meta.json`, build a `Map<category_name, slug>` once, then use it whenever computing an API URL:

```js
const slugFor = new Map(catMeta.map(c => [c.category, c.slug]));
const url = apiUrl(`category-detail-${slugFor.get(activeCategory)}.json`);
```

File count: 2.

#### `/api/categories/list` → one per persona

```json
// /api/student/categories.json   (replaces v1's /api/categories/list)
[ "Cafés", "Groceries", "Restaurants", ... ]
```

File count: 2.

#### `/api/months/list` → one per persona

```json
// /api/student/months.json
[ "2026-05", "2026-04", "2026-03", ... ]
```

File count: 2.

#### `/api/top-categories` → per-month, per-exclusion-set

This one needs care. v1 accepts arbitrary `exclude` lists. For static export, we lock to a small set of exclusion presets:

- `none` — no exclusions
- `default` — `["Rent"]` (the Overview default)

Two presets × all months × 2 personas. Per-persona: one file containing all months for each preset.

```json
// /api/student/top-categories-default.json
{
  "exclude": ["Rent"],
  "months": {
    "2026-05": [ { "category": "Restaurants", "total": 312 }, ... ],
    ...
  }
}
```

File count: 4.

#### `/api/overview/snapshot` → per-persona, multi-month

```json
// /api/student/overview-snapshot.json
{
  "months": {
    "2026-05": { "month": "2026-05", "is_partial": true, "through_day": 24, "this_month_total": 1750, "last_month_mtd": 1989, ..., "cumulative_this": [...], "cumulative_last": [...] },
    ...
  }
}
```

File count: 2.

#### `/api/overview/budget*` — NOT pre-computed

These are dormant in v1. They stay dormant in v2. No files generated.

#### `/api/datasets` → REPLACED by `/api/personas.json`

```json
// /api/personas.json
[
  { "key": "student",   "label": "NYC Student" },
  { "key": "young-pro", "label": "NYC Young Professional" }
]
```

No `active` field — the frontend tracks active persona in `localStorage`. The user picks one; the app remembers it.

#### `POST /api/datasets/active` — GONE

Replaced by frontend state. No file generated.

### 3.4 Total file budget

Rough count:

| Endpoint | Files per persona | Both personas |
|---|---|---|
| summary | ~500 | ~1000 |
| monthly | ~300 | ~600 |
| transactions | 1 | 2 |
| category-detail | ~100 | ~200 |
| radial | ~34 | ~70 |
| category-hierarchy | 1 | 2 |
| category-meta | 1 | 2 |
| categories | 1 | 2 |
| months | 1 | 2 |
| top-categories | 2 | 4 |
| overview-snapshot | 1 | 2 |
| **Total** | **~940** | **~1900** |
| personas.json | — | 1 |
| Static assets | — | ~30 |
| **Grand total** | — | **~1900 files** |

Total disk: roughly 10–20MB uncompressed across all files for both personas. Render serves static sites with gzip enabled automatically; over the wire, the SW caches what the user actually loads.

The user only fetches what they need: one persona's data at a time, lazily loaded as the user navigates between scopes and months.

### 3.5 Build script skeleton

This is the implementation Claude will write. Full skeleton:

```python
#!/usr/bin/env python3
"""build_static.py — pre-compute all API responses to static JSON, build the deploy tree."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import data_processor as dp

# Configuration
ROOT = Path(__file__).parent
DIST = ROOT / "dist"
STATIC_SRC = ROOT / "static"
TEMPLATES_SRC = ROOT / "templates"

# Build identity
BUILD_HASH = (
    subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    if (ROOT / ".git").exists()
    else "dev"
)
DEPLOY_URL = os.environ.get("DEPLOY_URL", "https://moneyhabits.onrender.com")

# Timeframes that drive /api/summary's avg_start/avg_end
TIMEFRAME_PRESETS = ["last-3-months", "last-6-months", "last-12-months", "ytd", "all-time"]

def main():
    print(f"Building MoneyHabits v2 — BUILD_HASH={BUILD_HASH}, DEPLOY_URL={DEPLOY_URL}")

    # 1. Wipe /dist
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    # 2. Generate icons + splash screens
    subprocess.run([sys.executable, "build_assets.py"], check=True)

    # 3. Copy static assets
    shutil.copytree(STATIC_SRC, DIST / "static")

    # 4. Render templates
    render_index_html()
    render_manifest_json()
    render_service_worker()

    # 5. Generate /api/personas.json
    personas = [{"key": k, "label": v["label"]} for k, v in dp.DATASETS.items()]
    write_json(DIST / "api" / "personas.json", personas)

    # 6. Per-persona pre-computation
    for persona_key in dp.DATASETS.keys():
        print(f"  → Pre-computing {persona_key}...")
        precompute_persona(persona_key)

    print(f"\n✓ Build complete. Wrote {file_count(DIST)} files, {byte_count(DIST)} bytes.")

def precompute_persona(persona_key):
    dp.set_active_dataset(persona_key)

    out = DIST / "api" / persona_key
    out.mkdir(parents=True, exist_ok=True)

    # Discover what categories and months exist for this persona
    months = sorted(dp.months_list(), reverse=True)        # newest first
    categories = dp.categories_list()
    hierarchy = dp.category_hierarchy()                    # for parent/leaf level info

    # Build the per-scope iteration set
    scopes = [("all", "")] + \
             [("parent", p) for p in hierarchy.parents] + \
             [("leaf", l) for l in hierarchy.leaves]

    # /api/{persona}/categories.json, months.json, category-meta.json, category-hierarchy.json
    write_json(out / "categories.json", categories)
    write_json(out / "months.json", months)
    write_json(out / "category-meta.json", dp.category_meta())
    write_json(out / "category-hierarchy.json", {"months": {m: dp.category_hierarchy(m) for m in months}})

    # /api/{persona}/transactions.json — all rows
    write_json(out / "transactions.json", {"rows": dp.transactions_all()})

    # /api/{persona}/overview-snapshot.json — multi-month
    write_json(out / "overview-snapshot.json",
               {"months": {m: dp.overview_snapshot(m) for m in months}})

    # /api/{persona}/top-categories-*.json
    write_json(out / "top-categories-none.json",
               {"exclude": [], "months": {m: dp.top_categories(m) for m in months}})
    write_json(out / "top-categories-default.json",
               {"exclude": ["Rent"], "months": {m: dp.top_categories(m, exclude=["Rent"]) for m in months}})

    # /api/{persona}/summary-{level}-{category}-{timeframe}.json
    for (level, category) in scopes:
        for timeframe in TIMEFRAME_PRESETS:
            avg_start, avg_end = derive_avg_range(timeframe, months)
            payload = {
                "timeframe": timeframe,
                "months": {m: dp.summary(level, category, m, avg_start, avg_end) for m in months}
            }
            slug = scope_slug(level, category)
            write_json(out / f"summary-{slug}-{timeframe}.json", payload)

    # /api/{persona}/monthly-{scope}-{granularity}[-{group_by}].json
    for (level, category) in scopes:
        for granularity in ["day", "week", "month"]:
            payload = {"granularity": granularity, "periods": dp.monthly(level, category, granularity)}
            slug = scope_slug(level, category)
            write_json(out / f"monthly-{slug}-{granularity}.json", payload)

        # group_by=parent variant (only at all-scope)
        if level == "all":
            for granularity in ["month"]:
                payload = {"granularity": granularity, "group_by": "parent",
                           "periods": dp.monthly("all", "", granularity, group_by="parent")}
                write_json(out / f"monthly-all-{granularity}-by-parent.json", payload)

    # /api/{persona}/category-detail-{scope}.json
    for (level, category) in scopes:
        payload = {
            "level": level,
            "category": category,
            "months": {m: dp.category_detail(level, category, m) for m in months}
        }
        slug = scope_slug(level, category)
        write_json(out / f"category-detail-{slug}.json", payload)

    # /api/{persona}/radial-{scope}.json
    for (level, category) in scopes:
        slug = scope_slug(level, category)
        write_json(out / f"radial-{slug}.json", {"years": dp.radial(level, category)})

def scope_slug(level, category):
    """URL-safe lowercase slug for a (level, category) pair.

    Examples:
      ("all", "") → "all"
      ("parent", "Food & Drink") → "parent-food-drink"
      ("leaf", "Cafés") → "leaf-cafes"     # transliterates accent
    """
    if level == "all":
        return "all"
    import re, unicodedata
    # Transliterate accents: "Cafés" → "Cafes" (NFKD splits é into e + combining mark, then strip non-ASCII)
    s = unicodedata.normalize("NFKD", category).encode("ascii", "ignore").decode("ascii")
    s = s.lower().replace(" ", "-").replace("&", "and")
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")   # collapse + trim dashes
    return f"{level}-{s}"

def derive_avg_range(timeframe, all_months):
    """Map a timeframe preset to concrete avg_start, avg_end (YYYY-MM-DD).
    Mirrors the v1 frontend's dateRangeFor() helper.

    all_months is sorted newest-first, format 'YYYY-MM'. The earliest month
    determines all-time / ytd start; the latest determines end.
    """
    from datetime import date
    if not all_months:
        return ("", "")
    newest = all_months[0]    # e.g. "2026-05"
    oldest = all_months[-1]   # e.g. "2022-08"
    newest_year, newest_month = map(int, newest.split("-"))
    end = f"{newest}-28"      # end-of-period sentinel; backend snaps to actual month-end

    if timeframe == "last-3-months":
        m = newest_month - 2
        y = newest_year
        if m <= 0:
            m += 12
            y -= 1
        return (f"{y:04d}-{m:02d}-01", end)
    if timeframe == "last-6-months":
        m = newest_month - 5
        y = newest_year
        while m <= 0:
            m += 12
            y -= 1
        return (f"{y:04d}-{m:02d}-01", end)
    if timeframe == "last-12-months":
        m = newest_month - 11
        y = newest_year
        while m <= 0:
            m += 12
            y -= 1
        return (f"{y:04d}-{m:02d}-01", end)
    if timeframe == "ytd":
        return (f"{newest_year:04d}-01-01", end)
    if timeframe == "all-time":
        return (f"{oldest}-01", end)
    raise ValueError(f"Unknown timeframe: {timeframe}")

def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))  # compact, no whitespace

def render_index_html():
    """Render templates/index.html (which extends base.html) via Jinja, substituting BUILD_HASH and DEPLOY_URL. Writes /dist/index.html."""
    from jinja2 import Environment, FileSystemLoader
    env = Environment(loader=FileSystemLoader(TEMPLATES_SRC))
    tmpl = env.get_template("index.html")
    html = tmpl.render(BUILD_HASH=BUILD_HASH, DEPLOY_URL=DEPLOY_URL)
    (DIST / "index.html").write_text(html)

def render_manifest_json():
    """Manifest is JSON, not Jinja — use simple string substitution."""
    src = (ROOT / "manifest.template.json").read_text()
    src = src.replace("__BUILD_HASH__", BUILD_HASH)
    (DIST / "manifest.json").write_text(src)

def render_service_worker():
    """SW is JS, not Jinja — use simple string substitution."""
    src = (ROOT / "service-worker.template.js").read_text()
    src = src.replace("__BUILD_HASH__", BUILD_HASH)
    (DIST / "sw.js").write_text(src)

def file_count(p): return sum(1 for _ in p.rglob("*") if _.is_file())
def byte_count(p): return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())

if __name__ == "__main__":
    main()
```

### 3.6 Required new helpers in `data_processor.py`

Some v1 endpoint logic lives inside route functions in `app.py` rather than as `data_processor` exports. The build script needs everything as a callable. Refactor needed:

- Move `top_categories(year_month, exclude=None)` from `app.py` to `data_processor.py`
- Move `transactions_all()` (or rename from internal helper) so it returns the full transaction list without server-side filtering
- Move `radial(level, category)` so it returns `{year_str: [12 floats]}` directly without going through the request layer
- Anywhere a v1 route calls `request.args.get(...)`, that logic moves into the `data_processor` function signature

This is mechanical — the actual computation logic is already in `data_processor.py`. The work is plumbing argument-passing through the function call chain instead of through HTTP.

### 3.7 Build performance

Expected build duration: 30–90 seconds for both personas. Most time goes to `category-detail` (lots of files, each with `transactions` arrays). Two optimizations if needed:

1. **Parallelize per-persona** — both personas can be computed in parallel processes. ~2× speedup.
2. **Reuse the DataFrame across requests within a persona** — `data_processor` already caches; just don't drop the cache between calls within the same persona.

We'll measure first and optimize only if needed.

---

## 4. Frontend changes

### 4.1 New module structure

`/static/js/` gets three modules instead of one:

```
app.js          — main app logic, tab routing, all tab implementations
ios.js          — sheets, flyouts, swipe, large-title scroll, body scroll lock
radial.js       — hand-rolled SVG radial chart (see §7)
chart.umd.min.js — Chart.js local copy
```

All are vanilla JS, no build step. Loaded as classic `<script>` tags in dependency order:

```html
<script src="/static/js/chart.umd.min.js"></script>
<script src="/static/js/ios.js"></script>
<script src="/static/js/radial.js"></script>
<script src="/static/js/app.js"></script>
```

`ios.js` and `radial.js` expose their public functions as globals (e.g., `window.MoneyHabitsIOS.openBottomSheet(...)`, `window.MoneyHabitsRadial.render(...)`). Not modules, no imports. Matches v1's "no build step" constraint.

### 4.2 Active persona state

```js
// Top of app.js
const PERSONA_KEY = 'mh-active-persona';

function getActivePersona() {
  return localStorage.getItem(PERSONA_KEY) || 'student';  // default
}

function setActivePersona(key) {
  localStorage.setItem(PERSONA_KEY, key);
  // Re-fetch and re-render everything for the new persona
  resetAndReload();
}

function apiUrl(path) {
  return `/api/${getActivePersona()}/${path}`;
}
```

`apiUrl('summary-all-last-12-months.json')` returns `/api/student/summary-all-last-12-months.json`.

### 4.3 Data fetching pattern

Per the SW strategy from the PWA shell doc, all `/api/*.json` fetches go through stale-while-revalidate. The frontend doesn't know or care — it just `fetch()`s.

```js
async function fetchJson(path) {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`Fetch failed: ${path}`);
  return res.json();
}
```

A small in-memory cache layer above this avoids re-fetching the same file within a session:

```js
const _jsonCache = new Map();
async function fetchJsonCached(path) {
  const key = `${getActivePersona()}/${path}`;
  if (_jsonCache.has(key)) return _jsonCache.get(key);
  const data = await fetchJson(path);
  _jsonCache.set(key, data);
  return data;
}
```

On persona switch, `_jsonCache.clear()`.

### 4.4 The `ios.js` module — what it exports

```js
window.MoneyHabitsIOS = {
  // Bottom sheets
  openBottomSheet({ content, onDismiss, showHandle = true }),
  closeBottomSheet(),

  // Right flyout
  openRightFlyout({ content, title, onDismiss }),
  closeRightFlyout(),

  // Large title scroll
  initLargeTitleScroll(scrollContainer, options),

  // Swipe gestures
  wireSwipeDismiss(el, direction, threshold, onDismiss),

  // Body scroll lock
  lockBodyScroll(),
  unlockBodyScroll(),
};
```

Implementation details deferred to the actual coding phase. The mobile design doc §4 specifies the *behavior*; this module is just where the code lives.

### 4.5 Transactions: client-side filtering and grouping

The Transactions tab loads `/api/{persona}/transactions.json` once on first activation. Everything else is client-side.

```js
// Module-scoped state
let _allTransactions = null;     // populated from transactions.json
let _filterSearch = '';
let _filterCategory = '';
let _filterMonth = '';
let _loadedMonths = 3;            // how many monthly groups to render

async function initTransactionsTab() {
  if (!_allTransactions) {
    const data = await fetchJsonCached('transactions.json');
    _allTransactions = data.rows;
  }
  renderTransactions();
}

function getFilteredTransactions() {
  let rows = _allTransactions;
  if (_filterSearch) {
    const q = _filterSearch.toLowerCase();
    rows = rows.filter(t => t.name.toLowerCase().includes(q));
  }
  if (_filterCategory) {
    rows = rows.filter(t => t.category === _filterCategory);
  }
  if (_filterMonth) {
    rows = rows.filter(t => t.date.startsWith(_filterMonth));
  }
  return rows;
}

function groupByMonth(rows) {
  const groups = {};
  for (const t of rows) {
    const ym = t.date.slice(0, 7);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(t);
  }
  // Sort each group's rows by date desc
  for (const ym in groups) {
    groups[ym].sort((a, b) => b.date.localeCompare(a.date));
  }
  return groups;
}

function renderTransactions() {
  const filtered = getFilteredTransactions();
  const grouped = groupByMonth(filtered);
  const monthsWithMatches = Object.keys(grouped).sort().reverse();   // newest first
  const visibleMonths = monthsWithMatches.slice(0, _loadedMonths);
  // ...render each visible month group, then the "Load older" button if more exist
}

function loadOlder() {
  _loadedMonths += 1;
  renderTransactions();
}
```

The 100ms search debounce is wrapped around the input listener:

```js
const debounced = debounce(() => {
  _filterSearch = document.getElementById('txn-search').value;
  _loadedMonths = 3;     // reset on filter change
  renderTransactions();
}, 100);
```

### 4.6 Removed from app.js

- All POST requests (there's no backend to POST to)
- The `txnPage` / `loadTransactions(page)` paginated-fetch logic
- The `txnDayRange` / `start_day` / `end_day` URL param handling — replaced by client-side day-bounded filtering
- The `Plotly.newPlot` / `Plotly.restyle` calls — replaced by Chart.js or radial.js
- The `setChartA11y` Plotly accessibility shim — Chart.js handles aria via its `role` + `aria-label` config
- The custom tap-and-hold tooltip system from `tipCard()` — Chart.js handles touch natively (a stripped-down `tipCard` may still exist for the radial chart)

---

## 5. Asset pipeline (`build_assets.py`)

Generates all icon and splash screen PNGs from SVG sources.

### 5.1 Dependencies

```python
# Added to requirements.txt
cairosvg>=2.7.0      # SVG → PNG rasterization
```

Cairo's the standard choice for headless SVG-to-PNG in Python. Alternative is `wand` (ImageMagick binding) but `cairosvg` is simpler and has fewer system deps.

### 5.2 What it generates

The full list from PWA shell doc §2.5 and §3.3:

```python
ICONS = [
  ("source.svg", 120, "icon-120.png"),
  ("source.svg", 152, "icon-152.png"),
  ("source.svg", 167, "icon-167.png"),
  ("source.svg", 180, "icon-180.png"),
  ("source.svg", 192, "icon-192.png"),
  ("source.svg", 512, "icon-512.png"),
  ("source.svg", 192, "icon-192-maskable.png"),    # same source, different filename
  ("source.svg", 512, "icon-512-maskable.png"),
  ("source.svg", 32,  "favicon-32.png"),
  ("source.svg", 16,  "favicon-16.png"),
]

SPLASHES = [
  ("source.svg", 1290, 2796, "splash-1290x2796.png"),
  ("source.svg", 1206, 2622, "splash-1206x2622.png"),
  # ...all 9 from PWA shell doc §3.3
]
```

### 5.3 Script skeleton

```python
import cairosvg
from pathlib import Path

ROOT = Path(__file__).parent
ICONS_SRC = ROOT / "static" / "icons" / "source.svg"
SPLASH_SRC = ROOT / "static" / "splash" / "source.svg"
ICONS_OUT = ROOT / "static" / "icons"
SPLASH_OUT = ROOT / "static" / "splash"

def gen_icons():
    for _, size, fname in ICONS:
        cairosvg.svg2png(
            url=str(ICONS_SRC),
            output_width=size, output_height=size,
            write_to=str(ICONS_OUT / fname),
        )
    # Generate favicon.ico from favicon-32.png (multi-resolution ICO)
    # ... requires a separate lib (Pillow) for ICO assembly

def gen_splashes():
    for _, w, h, fname in SPLASHES:
        cairosvg.svg2png(
            url=str(SPLASH_SRC),
            output_width=w, output_height=h,
            write_to=str(SPLASH_OUT / fname),
        )

if __name__ == "__main__":
    gen_icons()
    gen_splashes()
```

`build_assets.py` is called by `build_static.py` (§3.1 step 2). It only runs if the source SVGs are newer than the generated PNGs — i.e., it's idempotent. A simple mtime check avoids re-rasterizing unchanged sources.

### 5.4 Why this is separate from build_static.py

The asset pipeline is slow (~10s for all 19 PNGs). It only changes when the source SVG changes. Separating it means iterating on the JSON pipeline doesn't pay the asset cost every build.

In Render's deploy environment, both scripts run as part of the build command. Locally, you can run `build_assets.py` once and then iterate on `build_static.py` repeatedly.

---

## 6. Templates (`templates/base.html`)

v1's `base.html` is heavily modified for v2. The full new shape:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>MoneyHabits</title>
  <meta name="description" content="A personal finance dashboard for tracking spending habits.">

  <!-- PWA: manifest, theme, OG, iOS specifics, icons, splash screens (§4 of PWA shell doc) -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#ffffff">
  <meta property="og:type" content="website">
  <meta property="og:title" content="MoneyHabits">
  <meta property="og:description" content="A personal finance dashboard for tracking spending habits.">
  <meta property="og:image" content="{{ DEPLOY_URL }}/static/icons/icon-512.png">
  <meta property="og:url" content="{{ DEPLOY_URL }}/">
  <!-- ... all iOS PWA tags, touch icons, splash screens, favicons per PWA shell doc §4 ... -->

  <!-- CSS -->
  <link rel="preload" as="style" href="/static/css/style.css?v={{ BUILD_HASH }}">
  <link rel="preload" as="style" href="/static/css/tailwind.css?v={{ BUILD_HASH }}">
  <link rel="stylesheet" href="/static/css/style.css?v={{ BUILD_HASH }}">
  <link rel="stylesheet" href="/static/css/tailwind.css?v={{ BUILD_HASH }}">
</head>
<body class="bg-neutral-50 text-neutral-900">
  <!-- Side rail (desktop only) -->
  <nav class="side-rail hidden md:flex">...</nav>

  <!-- Sticky page header (large-title sticky state) -->
  <header id="sticky-header" class="large-title-sticky">...</header>

  <!-- Main scroll container -->
  <main id="main-scroll" class="md:pl-16">
    <!-- Large-title block (per active tab) -->
    <div id="large-title-block">...</div>

    <!-- Tab content sections -->
    <section id="section-overview" class="tab-section">...</section>
    <section id="section-habits" class="tab-section hidden">...</section>
    <section id="section-transactions" class="tab-section hidden">...</section>
  </main>

  <!-- Bottom tab bar (mobile only) -->
  <nav class="tab-bar md:hidden">
    <a href="#overview" data-tab="overview">...</a>
    <a href="#habits" data-tab="habits">...</a>
    <a href="#transactions" data-tab="transactions">...</a>
  </nav>

  <!-- Sheet + flyout mount points (off-screen by default) -->
  <div id="sheet-mount"></div>
  <div id="flyout-mount"></div>

  <!-- Scripts -->
  <script src="/static/js/chart.umd.min.js?v={{ BUILD_HASH }}"></script>
  <script src="/static/js/ios.js?v={{ BUILD_HASH }}"></script>
  <script src="/static/js/radial.js?v={{ BUILD_HASH }}"></script>
  <script src="/static/js/app.js?v={{ BUILD_HASH }}"></script>

  <!-- SW registration -->
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
    }
  </script>
</body>
</html>
```

The `?v={{ BUILD_HASH }}` query strings on asset URLs (substituted to `?v=abc1234` at build time by Jinja) are belt-and-suspenders versioning — the SW handles cache invalidation by URL, and the hash in the query string ensures any HTTP cache also busts.

### 6.1 What templates/index.html becomes

v1's `templates/index.html` extends `base.html` via `{% extends %}` + `{% block content %}`. At build time, the build script uses Jinja's `Environment` (no Flask needed) to render the inheritance properly, substituting `BUILD_HASH` and `DEPLOY_URL` as template variables.

```python
from jinja2 import Environment, FileSystemLoader

def render_index_html():
    env = Environment(loader=FileSystemLoader(TEMPLATES_SRC))
    tmpl = env.get_template("index.html")
    html = tmpl.render(BUILD_HASH=BUILD_HASH, DEPLOY_URL=DEPLOY_URL)
    (DIST / "index.html").write_text(html)
```

Inside `base.html` and `index.html`, use Jinja syntax: `{{ BUILD_HASH }}`, `{{ DEPLOY_URL }}`. The HTML skeleton above (§6) uses this syntax throughout.

**The service worker and manifest are NOT Jinja templates** — they're JS and JSON respectively. They use the `__BUILD_HASH__` placeholder substituted via `.replace()` (see `render_manifest_json()` and `render_service_worker()` in §3.5). Two substitution mechanisms, used in different contexts, intentional.

---

## 7. The hand-rolled radial chart (`static/js/radial.js`)

Replaces Plotly's `scatterpolar` for the Habits trends radial chart (desktop only).

### 7.1 Data shape (input)

```js
{
  years: {
    "2026": [Jan, Feb, Mar, ..., Dec],   // 12 monthly floats
    "2025": [12 floats],
    "2024": [12 floats],
  }
}
```

### 7.2 SVG structure

```svg
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circles (gridlines) at quartile values -->
  <g class="grid">
    <circle cx="200" cy="200" r="40" />     <!-- 25% radius -->
    <circle cx="200" cy="200" r="80" />     <!-- 50% radius -->
    <circle cx="200" cy="200" r="120" />    <!-- 75% radius -->
    <circle cx="200" cy="200" r="160" />    <!-- 100% radius -->
  </g>

  <!-- Month spokes (12 radial lines) -->
  <g class="spokes">
    <!-- 12 lines from center to outer radius at 30° increments -->
  </g>

  <!-- Year rings (one path per visible year) -->
  <g class="rings">
    <path d="M ... Z" class="fill-2026" />
    <path d="M ... Z" class="fill-2025" />
    <!-- ... -->
  </g>

  <!-- Month labels around the outside -->
  <g class="labels">
    <text x="..." y="...">Jan</text>
    ...
  </g>

  <!-- Click targets (transparent rects, one per month sector, for hit-testing) -->
  <g class="hit-targets">
    <path d="..." class="hit-month" data-month="01" />
    ...
  </g>
</svg>
```

### 7.3 Math: data → path

For each year:

```js
function yearPath(monthlyTotals, maxValue, centerX = 200, centerY = 200, maxRadius = 160) {
  const points = monthlyTotals.map((value, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;  // start at top (Jan = 12 o'clock)
    const radius = (value / maxValue) * maxRadius;
    return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
  });
  // Close the path back to point[0]
  return `M ${points.map(([x, y]) => `${x},${y}`).join(' L ')} Z`;
}
```

The path is a closed polygon with 12 vertices. SVG `fill` makes it the year ring's color. `stroke` adds the outline.

### 7.4 Module exports

```js
window.MoneyHabitsRadial = {
  render(containerEl, data, options),
  destroy(containerEl),
};

// options: {
//   selectedYears: ["2026", "2025"],            // which years to draw
//   colorForYear: (year, index) => "#hex",       // color lookup
//   onMonthClick: (year, month) => {...},        // click handler
// }
```

`render` populates `containerEl` with the SVG. `destroy` removes the SVG and cleans up listeners.

### 7.5 Click handling

The `.hit-targets` group contains 12 transparent `<path>` elements (one per month sector — a pie slice from center to outer ring). Clicking one fires `onMonthClick(activeYear, monthIndex)`. The "active year" is the most-recent visible year unless a different year is "pinned" via click-on-its-ring.

### 7.6 Year-pinning behavior

To preserve v1's `radialHighlightYear` behavior: clicking on a year's ring (anywhere along its polygon) pins that year as the active source for month clicks. The pinned year's polygon gets a thicker stroke. Clicking the pinned year again unpins it.

### 7.7 Color resolution

The year color comes from the `--color-radial-0` through `--color-radial-5` CSS variables, indexed by recency. v1's logic: most-recent visible year → index 0, next-most-recent → index 1, etc. v2's `radial.js` mirrors this: the `colorForYear(year, index)` callback receives the index and returns the appropriate token.

### 7.8 Total size estimate

This module is ~150 LOC. SVG generation is ~50 LOC. Click handling is ~30 LOC. Color/state management is ~30 LOC. The rest is options handling, lifecycle, and a small bit of label positioning math.

---

## 8. Service worker (`service-worker.template.js`)

The full SW source. `__BUILD_HASH__` placeholder is substituted by `build_static.py` at build time.

```js
const BUILD_HASH = '__BUILD_HASH__';
const SHELL_CACHE = `moneyhabits-shell-${BUILD_HASH}`;
const DATA_CACHE  = `moneyhabits-data-${BUILD_HASH}`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/static/css/style.css?v=' + BUILD_HASH,
  '/static/css/tailwind.css?v=' + BUILD_HASH,
  '/static/js/chart.umd.min.js?v=' + BUILD_HASH,
  '/static/js/ios.js?v=' + BUILD_HASH,
  '/static/js/radial.js?v=' + BUILD_HASH,
  '/static/js/app.js?v=' + BUILD_HASH,
  '/static/icons/icon-180.png',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  // ... (all icons + splash screens enumerated at build time and substituted into this list)
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.endsWith(BUILD_HASH)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // /api/*.json → stale-while-revalidate
  if (url.pathname.startsWith('/api/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
    return;
  }

  // Shell asset (static, manifest, root) → cache-first
  if (url.pathname.startsWith('/static/') ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/' ||
      url.pathname === '/index.html') {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Navigation requests → cache-first to root
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('/').then(r => r || fetch(event.request)));
    return;
  }

  // Default: passthrough to network
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);   // fall back to cached if network fails
  return cached || networkFetch;
}
```

That's the entire SW. ~70 lines.

The `SHELL_URLS` list is enumerated at build time — the build script reads the actual filenames generated under `/dist/static/icons/` and `/dist/static/splash/` and injects them into the SW template before writing it to `/dist/sw.js`.

---

## 9. CSS changes (`static/css/style.css`)

Adjustments to the existing `:root` token block and additions for new components. The full diff isn't enumerated here — it lives in the design system update — but the key changes:

```css
:root {
  /* Existing tokens preserved */
  --color-white: #ffffff;
  --color-accent-500: #6366f1;
  --color-accent-700: #4338ca;
  --color-cat-food-bg: ...;
  /* ... etc. */

  /* iOS-tuned grays (v2 change — values shift slightly) */
  --color-gray-100: #f2f2f7;      /* iOS systemGray6 equivalent */
  --color-gray-200: #e5e5ea;      /* iOS systemGray5 */
  --color-gray-300: #d1d1d6;      /* iOS systemGray4 */
  --color-gray-400: #c7c7cc;      /* iOS systemGray3 */
  --color-gray-500: #aeaeb2;      /* iOS systemGray2 */
  --color-gray-600: #8e8e93;      /* iOS systemGray */
  --color-gray-700: #636366;      /* iOS secondaryLabel light */
  --color-gray-900: #1c1c1e;      /* iOS label */

  /* New v2 tokens */
  --ios-sheet-bg: var(--color-white);
  --ios-sheet-handle: var(--color-gray-300);
  --ios-backdrop: rgba(0, 0, 0, 0.4);
  --safe-bottom: env(safe-area-inset-bottom);
  --safe-top: env(safe-area-inset-top);
}

/* New component styles */
.tab-bar { ... }
.side-rail { ... }
.large-title { ... }
.large-title-sticky { ... }
.ios-sheet { ... }
.ios-flyout-right { ... }
.txn-row-stacked { ... }
.month-group-header { ... }
.daily-totals-strip { ... }
```

Tailwind is rebuilt with `npx tailwindcss@3.4.19 -i tailwind.input.css -o static/css/tailwind.css --minify` after any new utility classes are introduced. Build script does NOT run Tailwind — the dev does it locally before pushing. (Render's build env doesn't have npm by default; adding it just for Tailwind is overkill when the rebuild is rare.)

---

## 10. Render deploy

### 10.1 `render.yaml`

```yaml
services:
  - type: web
    name: moneyhabits
    runtime: static
    buildCommand: |
      pip install -r requirements.txt
      python build_static.py
    staticPublishPath: ./dist
    pullRequestPreviewsEnabled: false
    envVars:
      - key: DEPLOY_URL
        value: https://moneyhabits.onrender.com
    headers:
      - path: /sw.js
        name: Cache-Control
        value: no-cache, no-store, must-revalidate
      - path: /manifest.json
        name: Content-Type
        value: application/manifest+json
      - path: /static/*
        name: Cache-Control
        value: public, max-age=31536000, immutable
      - path: /api/*
        name: Cache-Control
        value: public, max-age=3600, stale-while-revalidate=86400
```

### 10.2 Why these headers

- **`/sw.js`**: no-cache. Browsers re-fetch the SW on every navigation; we don't want HTTP-level caching to delay update detection.
- **`/manifest.json`**: must have the correct MIME type. Some browsers reject `text/plain` and refuse to install the PWA.
- **`/static/*`**: aggressive cache (1 year, immutable). The build hash on the URL ensures uniqueness; the SW handles invalidation; HTTP caches can hold these forever.
- **`/api/*`**: 1 hour fresh, then stale-while-revalidate for a day. Belt-and-suspenders with the SW — even outside the PWA (e.g., shared link in a desktop browser), users get reasonable freshness.

### 10.3 Deploy flow

1. Push to `main` on GitHub.
2. Render's webhook detects the push.
3. Render runs `pip install -r requirements.txt` and `python build_static.py`.
4. The resulting `/dist` tree is published to Render's CDN.
5. Live within 60–90 seconds.

The first deploy takes longer (~3 minutes) because pip needs to download dependencies. Subsequent deploys are faster (~60s) thanks to dependency caching.

### 10.4 Custom domain

Optional. If desired:
- Add a CNAME record from `moneyhabits.example.com` → `moneyhabits.onrender.com` at your DNS provider.
- Add the custom domain in Render's dashboard.
- Update `DEPLOY_URL` env var in `render.yaml`.
- Render auto-provisions Let's Encrypt SSL.

---

## 11. Local development

The dev story changes meaningfully from v1:

### 11.1 v1 dev flow

```
pip install -r requirements.txt
python app.py
# Open http://localhost:5001
# livereload watches for file changes
```

### 11.2 v2 dev flow

One mode: build then serve locally. The build is fast enough (~30–60 seconds for both personas) that re-running it after a change is acceptable for a solo project.

```bash
python build_static.py
cd dist && python -m http.server 8000
# Visit http://localhost:8000
# This is the actual /dist that Render serves.
```

For most UI work, you only need to re-run `build_static.py` when the JSON tree needs to change (e.g., adding a new endpoint, changing the `data_processor` output). For pure CSS / HTML / JS iteration, you can edit files in `dist/static/` directly and refresh — but those changes get overwritten on the next full build. Keep canonical edits in `/static/` and re-run the build to test them.

A lightweight watch-and-rebuild pattern, if iteration speed becomes painful:

```bash
# Watch static sources, rebuild on change. Requires a watcher tool like `entr`.
ls static/**/*.js static/**/*.css templates/*.html | entr -r python build_static.py
```

This is optional, not part of the deploy story. If you don't reach for it, plain `python build_static.py` after every meaningful change works fine.

**Why no "live Flask + v2 frontend" mode**: the v2 frontend fetches files like `/api/student/summary-all-last-12-months.json`, while v1's Flask exposes `/api/summary?persona=...`. The URL shapes don't overlap; making them compatible would require a substantial shim layer that gets rebuilt every time the build script changes endpoint slugs. Building once and serving statically sidesteps the problem.

### 11.3 The Tailwind rebuild

Unchanged from v1. After introducing a new utility class:

```bash
npx tailwindcss@3.4.19 -i tailwind.input.css -o static/css/tailwind.css --minify
```

This runs against `static/`, not `dist/`. The next `python build_static.py` picks up the rebuilt `tailwind.css` and copies it into `dist/static/`.

---

## 12. Testing

### 12.1 Build verification

The build script itself can run a self-check at the end:

```python
def verify():
    # Every persona has the expected files
    for persona_key in dp.DATASETS.keys():
        out = DIST / "api" / persona_key
        for required in REQUIRED_FILES_PER_PERSONA:
            assert (out / required).exists(), f"Missing: {persona_key}/{required}"
    # Index.html exists and references valid asset paths
    # Manifest is parseable JSON
    # SW is parseable JS (sanity check via subprocess to node -c if available)
```

### 12.2 Smoke test

Open `/dist/index.html` in a browser locally. Verify:
- Page loads, no console errors
- Each tab renders against the static JSON
- Persona switch works (loads from the other folder)
- All charts render

### 12.3 PWA verification

Use Lighthouse on the deployed Render URL:
- PWA score 100/100
- Installable: yes
- Manifest: valid
- Service worker: registered, scoped correctly
- HTTPS: yes (auto-provided by Render)

### 12.4 iOS device test

The non-negotiable test: open the deployed URL on a real iPhone in Safari, add to home screen, launch from home screen, verify:
- Splash screen renders (matches design)
- Launches in standalone (no Safari chrome)
- All tabs work
- Bottom tab bar respects the home indicator
- Large-title pattern animates correctly on scroll

No emulator. No "looks right in dev tools." Real device.

---

## 13. Migration from v1

This isn't a fresh build; it's a v1 → v2 migration. The migration order minimizes the "everything broken at once" window:

1. **Refactor `data_processor.py`** to expose all logic as importable functions. Add no new functions; just move the v1 route-internal logic into module-level functions. App still runs on v1 Flask afterward.
2. **Write `build_static.py`** against the refactored `data_processor`. Verify it produces a `/dist` tree that matches v1's API responses.
3. **Build v2 assets** (icons, splash screens, source SVGs). Verify with `build_assets.py`.
4. **Write `ios.js`** with the sheet/flyout/large-title scroll primitives. Test in isolation (a static HTML page with a button that opens a sheet).
5. **Replace Plotly with Chart.js** for each chart, in order: cumulative (simplest), then bar, then pie, then drill-down cumulative, then bubble. Verify each one renders correctly against v1 data.
6. **Write `radial.js`** as the last chart conversion. Verify against v1 data.
7. **Restructure `app.js`** to use the new bottom-tab-bar / side-rail navigation. Remove the secondary nav. Implement the gear icon and Settings sheet.
8. **Implement the Habits drill-down flyout** behavior. This is the biggest single behavioral change.
9. **Implement Transactions client-side filtering and grouping.**
10. **Implement Overview restructure** (three-card stack, removed cards).
11. **Add manifest.json + SW + head meta.** PWA-install-ability comes online here.
12. **Generate iOS splash screens.** Test on real device.
13. **Deploy to Render.** Verify the production build.
14. **Tear down v1** — remove `Procfile`, archive `app.py` as a build-time-only dependency, update README.

Each step is independently verifiable. The app is broken between step 5 and step 6 (charts swap individually), but other than that, each step leaves the app in a working state.

---

## 14. What's left for future work (not v2)

- Dark mode (v3+)
- Push notifications (requires iOS 16.4+ + installed PWA + permission flow)
- Real CSV upload (would re-introduce a runtime backend)
- Multiple users, accounts, auth
- New analytical surfaces (budget, recurring, income-vs-spending — the dormant `_df_full` work)
- The radial chart on mobile (currently desktop-only because viz density doesn't survive phone widths)
- Match highlighting in Transactions search
- Compare-month overlay in Habits drill-down (`lensCompare` is dormant in v1 too)

All deferred deliberately. Not in v2 scope.
