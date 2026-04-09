# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
pip install -r requirements.txt
python app.py
```

The app runs at `http://localhost:5000` in debug mode.

## Architecture

**Flask backend (`app.py`)** — thin routing layer. All business logic lives in `data_processor.py`.

**Data layer (`data_processor.py`)** — loads `transactions.csv` once into a module-level `_df` global on first access (lazy singleton via `load_data()`). The CSV is filtered to rows where `type == "regular"`, `excluded != true`, and `amount > 0`. Category normalization: uses `category` if present, falls back to `parent category`, then `"Uncategorized"` — stored as `category_norm`.

**API endpoints** (`/api/summary`, `/api/monthly`, `/api/categories`, `/api/trends`, `/api/transactions`, `/api/categories/list`, `/api/months/list`) — all return JSON consumed by the frontend. `/api/transactions` supports server-side filtering and pagination (50 rows/page).

**Frontend (`static/js/app.js`)** — vanilla JS, no build step. Four tabs (Overview, Categories, Trends, Transactions) managed by `showTab()`. Each tab lazily initializes on first visit. Charts use Plotly.js (CDN). Clicking a monthly bar on Overview drills into the Categories tab for that month.

**Templates** — Jinja2 with `base.html` / `index.html`. Tailwind CSS via Play CDN (no build step). Custom accent color palette: `accent-{50,100,200,500,600,700}` maps to indigo.

## CSV format

Expected columns: `date`, `name`, `amount`, `status`, `category`, `parent category`, `excluded`, `tags`, `type`, `account`, `account mask`, `note`, `recurring`. The file is exported from a personal finance tool (Copilot). To refresh data, replace `transactions.csv` — the in-memory cache will reload on next server start (or restart the server).
