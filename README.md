# MoneyHabits

A personal-finance dashboard that turns a Copilot CSV export into an interactive view of where your money goes — month over month, year over year, by category, by merchant. Flask + pandas on the back, vanilla JS + Plotly on the front, no build step.

Two synthetic personas ship out of the box (NYC Student, NYC Young Professional) so the app can be opened against real-shaped data without exposing personal financial history.

---

## Quick start

```bash
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5001`. The dev server uses `livereload` and watches `templates/`, `static/js/`, `static/css/`, and `data_processor.py` — edits trigger an automatic browser refresh.

---

## What's in the app

The UI has three top-level tabs, picked by the secondary nav under the title bar:

- **Overview** (default) — a month-at-a-glance summary: four equal-weight cards with this-month spend, last-month comparison, trailing 3-month average, and a budget bar showing income vs. spending. Plus a cumulative line chart that overlays this month against last month.
- **Habits** — the deep-dive surface. KPI strip + a scope-aware trend chart (bar or year-over-year radial) + a drill-down panel for the focused month. Scope can be all-spending, a parent group, or a single leaf category; switching scope re-renders KPIs, chart, and drill-down atomically. The trend chart's timeframe (3-month, 6-month, 12-month, YTD, all-time) is independent from the focused month, so you can pan the chart without losing your drill-down context.
- **Transactions** — a filterable, paginated transaction table with search, category, parent-group, and month filters. Cross-tab linkouts (e.g. clicking "this time last month" on Overview) pre-populate filters here.

The header has a **dataset switcher** (top right) for swapping between the bundled personas, and a **brand wordmark** (top left) that returns to the Overview tab from anywhere.

---

## Project layout

```
.
├── app.py                  # Flask routes — thin layer over data_processor
├── data_processor.py       # All business logic + caching
├── datasets/               # Persona CSVs (gitignored by default)
│   ├── student.csv
│   └── young-pro.csv
├── templates/              # Jinja2 (base.html + index.html)
├── static/
│   ├── js/app.js           # Vanilla JS, no build step
│   └── css/
│       ├── style.css       # Hand-written tokens + custom rules
│       ├── tailwind.css    # Pre-built Tailwind output
│       └── tailwind.input.css
├── tailwind.config.js
├── requirements.txt
├── Procfile                # Heroku-style entry: gunicorn app:app
├── CLAUDE.md               # Architecture + conventions (read first)
├── DESIGN-SYSTEM.md        # Tokens, components, layout rules
├── DATA-PIPELINE.md        # CSV → frame walkthrough
└── PRD-category-spending.md
```

---

## Architecture in one paragraph

`app.py` is a thin routing layer; every endpoint forwards to `data_processor.py`, which lazily builds two cached pandas DataFrames from the active dataset's CSV — `_df` (spending only) and `_df_full` (spending + income, for the budget bars). The frontend (`static/js/app.js`) calls those JSON endpoints, keeps lens state in module-scoped variables, and renders charts with Plotly using CSS custom properties as the color source (no hardcoded hex). Tabs are lazy-initialized on first activation.

Read **[`CLAUDE.md`](./CLAUDE.md)** before making non-trivial changes — it covers tab lifecycles, lens state, the category color/emoji system, cross-tab navigation, and Tailwind rebuild rules.

---

## Data

The app reads Copilot CSV exports with this schema:

`date, name, amount, status, category, parent category, excluded, tags, type, account, account mask, note, recurring`

Two cached frames feed the UI: a spending-only frame and a spending+income frame. The data layer adds derived columns like `category_norm` (the safe-fallback category label) and `year_month` (`"2026-05"` style). For the full pipeline — filters, derived columns, per-request derivations, and what the loader deliberately does *not* do — see **[`DATA-PIPELINE.md`](./DATA-PIPELINE.md)**.

To swap in new data for a persona:

1. Overwrite `datasets/<persona>.csv`.
2. Restart `python app.py`, or POST `/api/datasets/active` with the same key to drop the lazy caches.

---

## Design system

Typography scale, color tokens, component patterns, layout rules, and anti-patterns all live in **[`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md)**. Read it before building or modifying any UI surface.

The app must always be fully responsive at mobile, tablet, and desktop widths. Tailwind is pre-built — `static/css/tailwind.css` is compiled output. After introducing a new utility class, rebuild it:

```bash
npx -y tailwindcss@3.4.19 -i tailwind.input.css -o static/css/tailwind.css --minify
```

New classes silently no-op until this runs.

---

## Tech stack

- **Backend**: Flask 3 + pandas 2
- **Frontend**: Vanilla JS, Plotly.js (CDN), Tailwind CSS (pre-built)
- **Templating**: Jinja2
- **Dev server**: livereload (auto-refresh on file changes)
- **Production**: gunicorn (`Procfile` is set up for Heroku-style deploys)

---

## API reference

All endpoints return JSON. For request parameters and response shapes, see the inline docs in `data_processor.py` and the routing layer in `app.py`.

| Endpoint | Purpose |
|---|---|
| `GET /api/summary` | KPI strip — `this_month`, `last_month`, `monthly_avg`, contextual `top` block |
| `GET /api/monthly` | Period-bucketed totals (day / week / month), with optional category, parent, or `group_by=parent` stacking |
| `GET /api/categories` | Per-category totals for a month |
| `GET /api/category-detail` | Drill-down for a category × month — pct of total, txn count, top merchants, cumulative spend, transactions |
| `GET /api/category-hierarchy` | Parent → leaf tree for a month or date range |
| `GET /api/category-meta` | Each leaf's modal parent (used for color inheritance) |
| `GET /api/categories/list` | Flat list of leaf categories |
| `GET /api/months/list` | All months with data |
| `GET /api/top-categories` | Categories ranked by spend for a month |
| `GET /api/radial` | Year-over-year monthly spend, 12 floats per year |
| `GET /api/transactions` | Filterable, paginated transaction list (50/page) |
| `GET /api/overview/snapshot` | Overview tab — MTD totals, comparisons, cumulative arrays |
| `GET /api/overview/budget` | Income vs. spending bars for the Overview tab |
| `GET /api/overview/budget/months` | Months that have income or spending activity |
| `GET /api/datasets` | Available personas, with active flag |
| `POST /api/datasets/active` | Switch active dataset; clears caches |
