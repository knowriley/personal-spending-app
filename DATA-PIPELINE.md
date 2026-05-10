# Data pipeline

How a Copilot CSV export becomes the numbers you see in the app. Read alongside `data_processor.py` (the source of truth) and the `## Architecture` and `## CSV format` sections of `CLAUDE.md`.

---

## 1. Source CSV

Both persona datasets (`datasets/student.csv`, `datasets/young-pro.csv`) are exports from Copilot. They share the same 13 columns:

`date, name, amount, status, category, parent category, excluded, tags, type, account, account mask, note, recurring`

### Snapshot of the current student dataset (post 2026-05-10 refresh)

| Metric | Value |
|---|---|
| Rows | 4,635 |
| Date range | 2022-08-29 → 2026-05-10 |
| Distinct months | 46 |
| By `type` | regular 3,748 / internal transfer 666 / income 221 |
| By `status` | posted 4,623 / pending 12 / planned 0 |
| `excluded=true` | 926 rows |
| Blank `category` | 931 rows |
| Blank `parent category` | 1,611 rows |
| Distinct categories | 32 leaves under 4 parent groups |
| Amount range | −$9,578.00 → $6,000.00 (negatives = income/transfers) |
| Effective rows in `_df` (spending frame) | 3,624 after filters |

(For comparison, the previous student CSV had 4,586 rows ending 2026-05-01 — this refresh added 49 rows over 9 days, mostly regular spending. Schema and category taxonomy are unchanged.)

---

## 2. Two cached frames

`data_processor.py` builds two module-level DataFrames lazily on first use and reuses them across requests. Both are dropped (set to `None`) when `set_active_dataset(key)` runs, so the dataset switcher in the header always reads from a fresh frame.

### `_df` — the "spending only" frame

Used by every tab today (Habits, Transactions, and the Overview cumulative chart).

Built by `load_data()` (`data_processor.py:53`). Keeps rows where:

```
excluded != true
AND type   == "regular"
AND status != "planned"
AND amount  > 0
```

That removes Copilot's "excluded" rows, all internal transfers, all income, all forward-dated/planned rows, and any zero or negative amounts. ~3,624 rows survive on the current dataset.

### `_df_full` — spending + income (for the Overview budget bars)

Built by `load_full_data()` (`data_processor.py:86`). Keeps rows where:

```
type == "income"                          (regardless of `excluded`)
OR (type == "regular" AND excluded != true)
```

Internal transfers are always dropped. The deliberate quirk: **the `excluded` filter is bypassed for income rows** because Copilot flags every income row `excluded=true` by convention — without this carve-out, the Overview tab would never show income.

---

## 3. Common typing pass

Both loaders run the same coercion before filtering:

| Step | What it does | Why |
|---|---|---|
| `pd.read_csv(..., dtype=str)` | Reads every column as a string | Defers type coercion so blanks survive instead of becoming `NaN` too early |
| `raw.columns.str.strip().str.strip('"')` | Cleans header quotes/whitespace | The Copilot export quotes headers; this normalizes to `date`, `parent category`, etc. |
| `pd.to_numeric(amount, errors="coerce")` | `amount` → float | Bad strings become `NaN` rather than raising |
| `pd.to_datetime(date, errors="coerce")` | `date` → Timestamp | Same NaN-on-fail behavior |
| `excluded.str.lower().str.strip() == "true"` | `excluded` → bool | Treats blanks/typos as `False` (safer than truthy parsing) |

---

## 4. Computed / derived columns

These are the columns added on top of the raw CSV before anything reaches the API or the UI. Each section gives the mechanical formula plus a plain-language explanation of why it exists.

### `status_norm`

- **Source**: `status` (raw)
- **Formula**: `status.fillna("").str.lower().str.strip()`
- **Plain language**: A cleaned-up copy of `status`. The CSV usually says `"posted"`, but a stray `"Posted"` or `" planned "` would otherwise slip past a filter. We do the cleanup once, store it, and reuse it everywhere.

### `type_norm` (in `_df_full` only)

- **Source**: `type` (raw)
- **Formula**: `type.fillna("").str.lower().str.strip()`
- **Plain language**: Same idea as `status_norm` — a defensive lowercased copy of the `type` column so the income/spending split logic doesn't break if the export ever changes capitalization.

### `parent_category`

- **Source**: `parent category` (the raw column with a space)
- **Formula**: `raw["parent category"].str.strip()`
- **Plain language**: Just a snake_case rename of the raw column with whitespace trimmed. Pandas can't cleanly access `df["parent category"]` in some patterns and most of the codebase prefers snake_case, so we mirror the value into a friendlier name.

### `category_norm` ★

- **Source**: `category` ➜ `parent_category` ➜ `"Uncategorized"`
- **Formula**: use `category` if present; otherwise fall back to `parent_category`; otherwise `"Uncategorized"`.
- **Plain language**: **This is the column the entire frontend joins on.** The raw CSV is messy: ~931 rows have a blank `category`, and 1,611 have a blank `parent category`. Some rows have neither. `category_norm` is the "best label we can produce per row" — a leaf category if Copilot gave us one, otherwise the parent group name as a stand-in, otherwise the literal string `"Uncategorized"`. Every aggregation (KPIs, charts, drill-downs, color-mapping) runs on this column instead of the raw `category` so blanks never produce empty buckets.

### `year_month` ★

- **Source**: `date`
- **Formula**: `date.dt.to_period("M").astype(str)` → `"2026-05"`
- **Plain language**: A pre-bucketed month label. Almost every chart in the app aggregates by month, and asking pandas to derive the month string thousands of times per request gets expensive. Computing it once during load means every "what did I spend in May 2026?" question is a fast equality check.

### `pos_amount` (in `_df_full` only) ★

- **Source**: `amount`
- **Formula**: `abs(amount)`
- **Plain language**: The signed-corrected amount. Copilot uses an accounting convention where money flowing in is **negative** (income looks like `-3000`) and money flowing out is positive. The Overview budget bars need to draw income on the same scale as spending, so we precompute the positive magnitude. We only need this for `_df_full` because `_df` already excludes all income/transfer rows, leaving only positive spending values.

★ = the derived columns the frontend depends on most heavily.

---

## 5. Per-request derivations (not stored on the frame)

Each API endpoint computes additional values on the fly. These are derivations that are too request-specific to cache:

| Endpoint | File:Line | What it derives |
|---|---|---|
| `/api/transactions` | `data_processor.py:242` | Adds `day_of_week` (`%A` formatted), reformats `date` to `YYYY-MM-DD` strings, paginates 50/page |
| `/api/summary` | `data_processor.py:280` | `this_month`, `last_month`, `monthly_avg` (range-bounded or 3-month trailing fallback), and a contextual `top` block whose `level` flips between `parent` / `leaf` / `merchant` depending on scope |
| `/api/radial` | `data_processor.py:385` | Pivots into `{year_str: [12 monthly floats]}` for the year-over-year radial chart |
| `/api/category-detail` | `data_processor.py:423` | `pct_of_total`, `transaction_count`, `avg_transaction`, `most_frequent_dow`, top-N merchants with an `"Other"` tail rollup, a per-day cumulative-spend array padded to the full calendar month, and (at parent/all scopes) `by_child` / `by_parent` rollups |
| `/api/category-meta` | `data_processor.py:574` | For each `category_norm`, the **modal** `parent_category` it appears under — so leaves inherit their parent's color in the frontend even if a stray row miscategorized them |
| `/api/overview/snapshot` | `data_processor.py:718` | MTD totals, prior-month MTD-prorated comparisons (`through_day` is bounded by today's day-of-month), trailing 3-month full + MTD averages, per-day cumulative arrays for both the active and the prior month |
| `/api/overview/budget` | `data_processor.py:835` | Splits `_df_full` into income items (per row, by `name`) and spending items: paid (top-N categories by `category_norm`, rest collapsed into `"Other"`) plus planned rows (per row, by `name`). Statuses are normalized to `"received"` / `"paid"` / `"planned"` |

---

## 6. What the loader does **not** do

Worth calling out — these are common assumptions that don't hold:

- **No deduplication.** Duplicate rows in the export are double-counted.
- **No merchant normalization.** `name` is used raw — `"Gdp*baby Cobra Yoga"` is shown verbatim and grouped on as-is.
- **No timezone handling.** Dates are naive calendar dates from Copilot — fine for monthly buckets, not appropriate for sub-day analysis.
- **No currency normalization.** Everything is assumed USD.

---

## 7. Refreshing data

To swap in new data for a persona:

1. Overwrite the CSV in `datasets/<persona>.csv`.
2. Either restart `python app.py` **or** POST `/api/datasets/active` with the same key (`{"key": "student"}`) to drop the lazy caches.
3. Smoke-test:
   ```bash
   curl -s http://localhost:5001/api/months/list | jq '.[-3:]'
   curl -s http://localhost:5001/api/summary | jq '.this_month, .current_month'
   ```

The dataset switcher in the header does the cache reset + a full page reload automatically; it's the simplest path when you're swapping between personas rather than refreshing one in place.
