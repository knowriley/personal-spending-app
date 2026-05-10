# PRD: Category Spending Deep-Dive Page

> Build target: Flask + Plotly.js + Tailwind (no build step). Vanilla JS, no frameworks.  
> Replaces: existing "Categories" tab (`#tab-categories` in `index.html`)  
> Figma reference: `sKsfVzo7lUWmuSgubqJ73V` node `5:1128`

---

## 1. Overview

This page gives the user a two-level view of their spending for a selected month:

1. **Top row** — 3 category KPI cards showing the highest-spending categories (user-configurable)
2. **Drill-down panel** — full analytics for whichever card is selected, covering share of total, quick stats, cumulative spend, top merchants, a bubble scatter chart, and a raw transaction table

The two levels are **live-linked**: clicking a category card swaps out the entire drill-down panel without a page reload.

---

## 2. Page Layout

```
┌─────────────────────────────────────────────────────────┐
│ HEADER: "Category Spending"  [Month ▾]  [Compare ▾]     │
├─────────────────────────────────────────────────────────┤
│ SECTION A — TOP CATEGORIES ROW                          │
│  "Top Categories [Month]"  [excludes...]  [⋮]           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │GROCERIES │  │● CAFÉS   │  │  TRAIN   │              │
│  │  $406    │  │  $59     │  │  $223    │              │
│  └──────────┘  └──────────┘  └──────────┘              │
├─────────────────────────────────────────────────────────┤
│ SECTION B — DRILL-DOWN (scoped to selected category)    │
│  ● Cafés Overview                                       │
│                                                         │
│  B1: [Pie chart — % of total]  [3× Quick-stat cards]   │
│  B2: [Cumulative spend line]   [Top Locations list]     │
│  B3: [Bubble scatter — transactions over month]         │
│  B4: [Transaction table]                                │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Tab Navigation Change

- Rename nav button from `"Categories"` → `"Category Spending"` in `base.html`
- `data-tab` value stays `"categories"` (preserves existing routing logic)

---

## 4. Section A — Top Categories Row

### 4.1 Header controls

| Control | Behavior |
|---|---|
| Title | `"Top Categories [month label]"` when showing auto top-3; `"Selected Categories"` when user has custom-selected |
| `[excludes ...]` pill | Opens a small popover listing all categories as checkboxes. Checked = excluded from ranking and from totals. Persisted to `localStorage` key `"cat_excludes"`. Default: `["Rent"]`. Label text = `"excludes " + joinedNames` or `"no exclusions"` if empty |
| `[⋮]` three-dot icon button | Opens a category-picker modal. User selects exactly 3 categories. Confirming sets `customCategoryMode = true` and overrides auto-top-3 logic. Cancelling restores auto mode |
| Month selector | Dropdown of all YYYY-MM values (same data as other tabs). Defaults to most recent month |
| Compare dropdown | `"Not comparing"` (default) + list of all available months except the selected one. Selecting a month enables comparison mode (see §7) |

### 4.2 Category card

Each card is ~1/3 width of the container.

```
┌─────────────────────────────┐
│ GROCERIES              [↗]  │  ← category label (uppercase, neutral/500, 12px semibold)
│ $406                        │  ← Kode Mono Bold, 33px, neutral/950
└─────────────────────────────┘
```

**Selected state**: thick left-border (4px) in the category's color + a small filled color dot before the category label.

**In comparison mode**, a second line appears below the dollar amount:
```
  $406
  ↑ 12% vs Mar 2026           ← trend icon + % change + "vs [prev month]"
```
The percent change is `(this_month - prev_month) / prev_month * 100`, rounded to 1 decimal. Show `↑` (green) for increase, `↓` (red) for decrease, `→` (neutral/400) for 0%.

**Hover**: slight background lift (`bg-gray-50`), cursor pointer.

**Click**: selects this card, re-renders Section B for the new category.

### 4.3 Auto top-3 logic

Sort all categories by total spend in the selected month (descending), after removing excluded categories. Take top 3. If fewer than 3 categories exist with spend, show however many exist.

### 4.4 Custom category mode

When user picks 3 categories via the `[⋮]` picker:
- `customCategoryMode = true`, `customCategories = [...]`
- The `[excludes]` pill is hidden (exclusions don't apply in custom mode)
- Title changes to `"Selected Categories"`
- A `×` reset icon appears next to the title, clicking it restores auto mode

---

## 5. Section B — Drill-Down Panel

The panel has a colored dot + title: `"● [Category] Overview"` where the dot uses the category's color.

Scoped to: `selectedCategory` × `selectedMonth`.

### 5.1 Row B1 — Share + Quick Stats (2-col)

**Left: Pie/donut chart (40% width)**

- Title: `"[Category] % of Total Spending"`
- Plotly donut chart
- One slice = selected category (colored with category's color)
- All other spending = single neutral grey slice (`#e5e5e5`)
- Center label: percentage value (e.g. `"8.3%"`)
- No legend, no interactivity, `hoverinfo: 'none'`
- Height: ~280px

**Right: 3 stacked quick-stat cards (60% width)**

Each card: white, border, rounded-lg, `p-6`, flex row with big number on the left and label on the right.

| Card | Value | Label |
|---|---|---|
| 1 | Avg transaction size | `"Average transaction size in [Category] in [Month]"` |
| 2 | Transaction count | `"Total transactions in [Category] in [Month]"` |
| 3 | Most frequent day of week | `"Most frequent spend day for [Category] in [Month]"` |

**In comparison mode**, each card gains a trend badge in the top-right corner:
- `↑ 14%` in green text, or `↓ 8%` in red text, vs previous month
- The "previous month" is always 1 calendar month before the selected month (not the comparison month dropdown — that only affects the cumulative chart line)

---

### 5.2 Row B2 — Cumulative Spend + Top Locations (2-col)

**Left: Cumulative Spend Line Chart (60% width)**

- Title: `"[Category] Spend over [Month]"`
- Plotly line chart
- X axis: calendar days of the selected month (1 → last day). Fixed range, labeled with day numbers. No rangeslider.
- Y axis: cumulative running total in dollars. Dollar-formatted ticks.
- Line: category color, `width: 2`
- Fill: `tozeroy` with `opacity: 0.08`
- **In comparison mode**: second line added for the comparison month's cumulative spend. Color: neutral/300 (`#d4d4d4`), dashed (`dash: 'dash'`). Legend shows both months.
- Markers: none (clean line only)
- Height: ~220px

**Right: Top Locations (40% width)**

- Title: `"Top Locations"`
- List of top merchants ranked by total spend for the selected category × month
- Show top 4 merchants by name, "Other" as a catch-all remainder if more exist
- Each row: merchant name (left, medium weight) + monospace amount (right, bold)
- No chart — plain HTML list, matching existing table styling

---

### 5.3 Row B3 — Bubble Scatter Chart (full width)

Title: `"[Category] Transactions over [Month]"`

This is the most novel visualization on the page.

**Concept**: Every transaction in the selected category × month is a bubble. X = date, bubble size = dollar amount. Multiple transactions on the same date stack vertically so they don't overlap.

**Stacking algorithm** (run in JS before building traces):
```js
// Group transactions by date string
// For each date group, sort by amount desc
// Assign y values: y[0] = radius[0], y[i] = y[i-1] + radius[i-1] + radius[i] + GAP
// where radius = pixelSize / 2, GAP = 4px, pixelSize = sizeFromAmount(amount)
// This ensures bubbles sit on a baseline (y=0) and stack upward without overlap
```

**Amount → pixel size mapping**:
```js
function sizeFromAmount(amount) {
  const MIN_PX = 12, MAX_PX = 48;
  const allAmounts = transactions.map(t => t.amount);
  const minA = Math.min(...allAmounts), maxA = Math.max(...allAmounts);
  if (maxA === minA) return (MIN_PX + MAX_PX) / 2;
  return MIN_PX + (amount - minA) / (maxA - minA) * (MAX_PX - MIN_PX);
}
```

**Plotly config**:
- `type: 'scatter'`, `mode: 'markers'`
- `x`: array of date strings (`YYYY-MM-DD`)
- `y`: computed stacking positions
- `marker.size`: pixel sizes (computed above)
- `marker.color`: category color
- `marker.opacity`: 0.75
- `marker.line`: `{ color: 'white', width: 1.5 }`
- X axis: `range` = `[firstDayOfMonth - 0.5, lastDayOfMonth + 0.5]`, `tickformat: '%b %d'`, show every 7 days
- Y axis: `visible: false`, `range: [0, maxYStack + 10]`
- `hovertemplate`: `'<b>%{customdata[0]}</b><br>$%{customdata[1]:.2f}<br>%{x|%b %d}<extra></extra>'`
- No click behavior — hover only
- `showlegend: false`
- Height: auto-sized based on max stack height, minimum 160px
- `responsive: true`

---

### 5.4 Row B4 — Transaction Table (full width)

Title: `"[Category] Transactions [Month]"`

Columns:
| Column | Source field | Notes |
|---|---|---|
| Date | `date` | `MMM D` format (e.g. "Apr 30") |
| Merchant | `name` | Left-aligned |
| Amount | `amount` | Monospace, right-aligned, `$X.XX` |
| Account | `account` | Muted, hidden on small screens |

- No pagination (all transactions for a single category in a single month fit on one screen — max ~30 rows observed)
- Sorted by date descending
- No action column
- **Bi-directional link with bubble chart**: hovering a table row applies a highlight (enlarged marker, opacity 1.0) to the corresponding bubble via `Plotly.restyle`. Mouseleave restores default state.
- The bubble chart hover similarly applies a `bg-accent-50` highlight to the corresponding table row.
- Linkage key: shared transaction index (position in the sorted-by-date array)

---

## 6. Color-to-Category Mapping

Every category needs a deterministic, stable color. Use the existing `RADIAL_COLORS` array, assigned by sorted position:

```js
// In app.js — add this once, near RADIAL_COLORS definition
let _categoryColorMap = null;
function getCategoryColorMap(allCategories) {
  if (_categoryColorMap) return _categoryColorMap;
  const sorted = [...allCategories].sort();
  _categoryColorMap = {};
  sorted.forEach((cat, i) => {
    _categoryColorMap[cat] = RADIAL_COLORS[i % RADIAL_COLORS.length];
  });
  return _categoryColorMap;
}
```

This map is computed once from `/api/categories/list` (already fetched on tab init). The same color appears in: the card left-border, the card dot, the drill-down title dot, the pie slice, the cumulative line, and the bubble markers.

---

## 7. Comparison Mode

Triggered when user selects a month from the "Compare" dropdown. The comparison period is always **that chosen month** — the "previous month" in quick-stat trend badges is always 1 calendar month before the selected (primary) month, regardless of what the compare dropdown says.

| Element | Comparison behavior |
|---|---|
| Category cards | Show `↑/↓ X%` delta line vs 1 month prior |
| Quick-stat cards | Show `↑/↓ X%` badge in top-right vs 1 month prior |
| Cumulative chart | Add second dashed line for the comparison month |
| All other elements | No change (pie, bubble, table, locations all stay primary month only) |

---

## 8. Data Layer Changes

### 8.1 New function: `get_category_detail(category, year_month)`

Add to `data_processor.py`:

```python
def get_category_detail(category: str, year_month: str) -> dict:
    df = load_data()
    sub = df[(df['category_norm'] == category) & (df['year_month'] == year_month)]

    # Total spending for the month (for % of total)
    month_total = float(df[df['year_month'] == year_month]['amount'].sum())
    cat_total   = float(sub['amount'].sum())
    pct_of_total = round(cat_total / month_total * 100, 1) if month_total > 0 else 0.0

    # Quick stats
    txn_count  = len(sub)
    avg_txn    = round(cat_total / txn_count, 2) if txn_count > 0 else 0.0

    # Most frequent day of week
    if not sub.empty:
        dow_counts = sub['date'].dt.day_name().value_counts()
        most_freq_dow = dow_counts.index[0]
    else:
        most_freq_dow = '—'

    # Top locations (merchants)
    merchant_totals = (
        sub.groupby('name')['amount'].sum()
        .sort_values(ascending=False)
        .reset_index()
    )
    TOP_N = 4
    top_merchants = []
    for _, row in merchant_totals.head(TOP_N).iterrows():
        top_merchants.append({'name': row['name'], 'total': round(float(row['amount']), 2)})
    other_total = float(merchant_totals.iloc[TOP_N:]['amount'].sum()) if len(merchant_totals) > TOP_N else 0.0
    if other_total > 0:
        top_merchants.append({'name': 'Other', 'total': round(other_total, 2)})

    # Cumulative spend series — one entry per calendar day in the month
    import pandas as pd
    period   = pd.Period(year_month, freq='M')
    all_days = pd.date_range(start=period.start_time, end=period.end_time, freq='D')
    daily    = sub.groupby(sub['date'].dt.date)['amount'].sum()
    cum_rows = []
    running  = 0.0
    for day in all_days:
        d = day.date()
        running += float(daily.get(d, 0.0))
        cum_rows.append({'date': str(d), 'cumulative': round(running, 2)})

    # Raw transactions (for bubble chart + table)
    txns = sub[['date', 'name', 'amount', 'account']].copy()
    txns['date'] = txns['date'].dt.strftime('%Y-%m-%d')
    txns['amount'] = txns['amount'].round(2)
    txns = txns.sort_values('date').reset_index(drop=True)
    transactions = txns.to_dict(orient='records')

    return {
        'category':        category,
        'year_month':      year_month,
        'total':           round(cat_total, 2),
        'month_total':     round(month_total, 2),
        'pct_of_total':    pct_of_total,
        'transaction_count': txn_count,
        'avg_transaction': avg_txn,
        'most_frequent_dow': most_freq_dow,
        'top_locations':   top_merchants,
        'cumulative_spend': cum_rows,
        'transactions':    transactions,
    }
```

### 8.2 New function: `get_top_categories(year_month, exclude=None)`

```python
def get_top_categories(year_month: str, exclude: Optional[list] = None) -> list[dict]:
    df = load_data()
    sub = df[df['year_month'] == year_month]
    if exclude:
        sub = sub[~sub['category_norm'].isin(exclude)]
    totals = (
        sub.groupby('category_norm')['amount'].sum()
        .sort_values(ascending=False)
        .reset_index()
        .rename(columns={'category_norm': 'category', 'amount': 'total'})
    )
    totals['total'] = totals['total'].round(2)
    return totals.to_dict(orient='records')
```

### 8.3 New routes in `app.py`

```python
@app.route('/api/category-detail')
def api_category_detail():
    category   = request.args.get('category', '')
    year_month = request.args.get('year_month', '')
    if not category or not year_month:
        return jsonify({'error': 'category and year_month required'}), 400
    return jsonify(dp.get_category_detail(category, year_month))

@app.route('/api/top-categories')
def api_top_categories():
    year_month = request.args.get('year_month', '')
    exclude_raw = request.args.get('exclude', '')
    exclude = [c.strip() for c in exclude_raw.split(',') if c.strip()] if exclude_raw else []
    if not year_month:
        return jsonify({'error': 'year_month required'}), 400
    return jsonify(dp.get_top_categories(year_month, exclude or None))
```

---

## 9. Frontend State

All state lives in `app.js` inside an `initCategoriesTab()` function (called once, lazily, like other tabs).

```js
// categories tab state
let catSelectedMonth = null;     // YYYY-MM string
let catCompareMonth  = null;     // YYYY-MM string or null
let catExcludes      = JSON.parse(localStorage.getItem('cat_excludes') ?? '["Rent"]');
let catCustomMode    = false;    // true when user has hand-picked categories
let catCustomPicks   = [];       // array of 3 category strings
let catSelected      = null;     // currently selected category string
let catAllCategories = [];       // full list from /api/categories/list
let catColorMap      = {};       // category → hex color
let catTopData       = [];       // current top-3 response from /api/top-categories
let catDetailData    = null;     // current /api/category-detail response
let catPrevMonthData = null;     // /api/category-detail for prev month (for trend badges)
```

---

## 10. JS Rendering Functions

The following functions need to be implemented:

| Function | Purpose |
|---|---|
| `initCategoriesTab()` | Entry point: fetch months, categories list, set defaults, render header controls, call `loadTopCategories()` |
| `loadTopCategories()` | Fetch `/api/top-categories`, render 3 category cards, auto-select first card |
| `renderCategoryCard(cat, total, isSelected, color, prevTotal)` | Returns HTML for one KPI card |
| `selectCategory(category)` | Update `catSelected`, re-render card selected states, call `loadCategoryDetail()` |
| `loadCategoryDetail()` | Fetch `/api/category-detail` (and prev month if compare mode), then call all 5 render functions |
| `renderDrillDownHeader()` | Title with color dot |
| `renderPieChart(detail)` | Plotly donut — category vs rest |
| `renderQuickStats(detail, prevDetail)` | 3 stat cards with optional trend badges |
| `renderCumulativeChart(detail, compareDetail)` | Plotly line chart with optional second line |
| `renderTopLocations(detail)` | Plain HTML merchant list |
| `renderBubbleChart(detail)` | Plotly scatter with stacking — includes hover↔table link setup |
| `renderTransactionTable(detail)` | HTML table with hover↔bubble link setup |
| `buildExcludePopover()` | Renders the exclude-category checklist and wires `localStorage` |
| `openCategoryPicker()` | Modal for custom 3-category selection |

---

## 11. Template Changes (`index.html`)

Replace the existing `#tab-categories` section entirely:

```html
<!-- ── CATEGORY SPENDING TAB ─────────────────────────────── -->
<section id="tab-categories" class="tab-section hidden">

  <!-- Section A: Top categories row -->
  <div id="cat-top-section" class="mb-0"></div>

  <!-- Section B: Drill-down panel -->
  <div id="cat-drilldown-section" class="px-0 pb-8"></div>

</section>
```

All content is injected by JS. No static HTML in the section — this avoids stale placeholder states.

---

## 12. Implementation Sequence

Execute in this order to validate incrementally:

1. **Data layer** — add `get_category_detail()` and `get_top_categories()` to `data_processor.py`, add routes to `app.py`, verify with `curl`
2. **Color map** — add `getCategoryColorMap()` to `app.js`, confirm colors are stable
3. **Section A** — `initCategoriesTab()` + `loadTopCategories()` + card rendering + month/compare/exclude controls
4. **Drill-down header + pie chart** (Row B1 left)
5. **Quick-stat cards** (Row B1 right), without comparison badges first
6. **Cumulative line chart** (Row B2 left), single line first
7. **Top locations list** (Row B2 right)
8. **Bubble scatter chart** (Row B3) — stacking algorithm first, then Plotly rendering
9. **Transaction table** (Row B4)
10. **Bi-directional hover linking** between bubble chart and table
11. **Comparison mode** — add second cumulative line, add trend badges to cards and quick-stats
12. **Exclude popover** — wire to `localStorage`, re-trigger `loadTopCategories()` on change
13. **Custom category picker** modal

---

## 13. Key Implementation Notes

**Data note — category name**: Real category is `"Cafés"` (with accent), not `"Cafes"`. Wherever category names pass through URL query params, use `encodeURIComponent`.

**Bubble chart Y axis**: Set `autorange: false` with explicit `range: [-(maxRadius + 4), maxYStack + maxRadius + 20]` to prevent Plotly from clipping the bottom or top bubbles.

**Comparison "previous month" derivation**:
```js
function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;
}
```
The trend badge is always against `prevMonth(catSelectedMonth)`, independently of the comparison dropdown.

**Exclude popover positioning**: Attach to the `[excludes ...]` button, open/close on click, close on outside-click (same pattern as the existing radial year dropdown).

**Responsive**: Section A cards use `grid grid-cols-3` (always 3 on all breakpoints — these are always exactly 3 cards). Row B splits use `grid grid-cols-1 md:grid-cols-[40%_60%]` etc. Bubble chart uses `responsive: true`.

**Kode Mono font**: Not loaded in `base.html`. Add `<link href="https://fonts.googleapis.com/css2?family=Kode+Mono:wght@700&display=swap" rel="stylesheet" />` to `base.html`. Use for the large dollar amounts in category cards and quick-stat values.
