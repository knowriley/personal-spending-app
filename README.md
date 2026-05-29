# MoneyHabits

A personal-finance PWA that turns a Copilot CSV export into an interactive view of where your money goes — month over month, year over year, by category, by merchant. The v2 build is a **static, offline-capable PWA**: a Python build step pre-computes the entire view tree into JSON, and the runtime is pure HTML/CSS/JS — no Python at runtime, no backend.

Two synthetic personas ship out of the box (NYC Student, NYC Young Professional) so the app can be opened against real-shaped data without exposing personal financial history.

---

## Quick start

```bash
pip install -r requirements.txt
python build_static.py
cd dist && python -m http.server 5001
```

Open `http://localhost:5001`.

For mobile testing over HTTPS (PWA install + service-worker on a real iPhone), use the included `dev.sh` — it builds, serves `dist/`, and opens a Cloudflare quick-tunnel:

```bash
./dev.sh
# → iPhone URL: https://<random>.trycloudflare.com
```

Requires `cloudflared` (`brew install cloudflared`).

---

## What's in the app

Three top-level tabs:

- **Overview** — month-at-a-glance snapshot card (big value + smart message like "46% less than April") + cumulative line chart with an "overlay last month" toggle + top categories.
- **Habits** — scope-aware trend chart (bar or year-over-year radial), with a side-by-side month drill-down on wide screens (chart left, drill-down right) and a flyout below 1024px. Scope is set via the page-header chip; drill-down opens on bar click.
- **Transactions** — month-grouped list, loaded once from `transactions.json` and filtered client-side. Search debounces at 100ms; "Load older" appends a month at a time.

Navigation is a left side rail at ≥768px and a bottom tab bar below. The active persona lives in the top-left of the rail (Notion-style); switching persona re-renders the app in place against the new persona's JSON tree — no page reload.

---

## Architecture

```
┌──────────────────────────────┐
│ build time (Python)          │
│  data_processor.py           │
│  + build_static.py           │
│   ├── reads datasets/*.csv   │
│   └── emits dist/            │
│        ├── index.html        │  ← real app shell (Jinja-rendered)
│        ├── manifest.json     │
│        ├── sw.js             │
│        ├── static/…          │  ← JS, CSS, icons, splash, vendored libs
│        └── api/              │
│             ├── personas.json
│             └── {persona}/   │  ← per-persona JSON tree
│                  ├── transactions.json
│                  ├── overview-snapshot.json
│                  ├── monthly-…-…json
│                  ├── category-detail-…json
│                  ├── radial-…json
│                  └── … (~300 files / persona)
└──────────────────────────────┘
              │
              ▼
┌──────────────────────────────┐
│ runtime (browser)            │
│  static HTML / JS / CSS      │
│  + service worker (offline)  │
│  + per-device localStorage   │
│    (active persona)          │
└──────────────────────────────┘
```

**No Python at runtime.** The v1 Flask backend (`archive/app-flask-v1.py`) is kept as a historical reference only. All data the UI ever shows is pre-computed by the build into `dist/api/`. The frontend reads `/api/{active-persona}/<file>.json` via `fetchJsonCached()` in `static/js/app.js`.

The service worker caches the shell on install (cache-first) and the JSON tree stale-while-revalidate, so after the first visit the app loads instantly and works offline (the "Subway test").

## Project layout

```
.
├── data_processor.py       # CSV → DataFrames + every pre-compute function (build-time only)
├── build_static.py         # Orchestrates the build: emits dist/ + the api/ tree
├── datasets/               # Persona CSVs (gitignored by default)
│   ├── student.csv
│   └── young-pro.csv
├── templates/
│   ├── base.html           # Shell (nav, rail, sticky header, tooltips, scripts)
│   └── index.html          # Tab sections (Overview / Habits / Transactions)
├── static/
│   ├── js/
│   │   ├── app.js          # Vanilla JS, no build step
│   │   ├── radial.js       # Hand-rolled SVG radial chart (M9)
│   │   ├── ios.js          # Bottom sheet, right flyout, large-title scroll (M7)
│   │   ├── chart.umd.min.js                 # Chart.js 4.x (vendored)
│   │   └── chartjs-plugin-datalabels.min.js
│   └── css/
│       ├── style.css       # Hand-written tokens + custom rules
│       ├── tailwind.css    # Pre-built Tailwind output
│       └── tailwind.input.css
├── manifest.template.json  # PWA manifest (BUILD_HASH templated in)
├── service-worker.template.js
├── tailwind.config.js
├── requirements.txt
├── render.yaml             # Render Blueprint — Static Site type
├── tests/                  # Dev playgrounds (charts, iOS primitives)
├── archive/                # Pre-v2 reference (Flask backend)
└── docs/                   # PRD-v2 planning suite (phasing, design, engineering, …)
```

## Deploy

Render Static Site on the `v2` branch:

- Build command: `pip install -r requirements.txt && python build_static.py`
- Publish directory: `dist`
- No runtime — free static plan, instant cold start, full offline support.
