# PRD v2: Feature spec

> Scope: per-surface behavior for v2. What each tab does, what changes from v1, what gets cut, what stays.
> Companion docs: `PRD-v2-overview.md` (anchors the suite), `PRD-v2-mobile-design.md` (visual + interaction details), `PRD-v2-engineering.md` (static-export pipeline, client-side filtering).
> Reading order: this doc → mobile design → PWA shell → engineering → phasing.

This document is the source of truth for what v2 does. The mobile-design doc takes these decisions and turns them into pixel-level specs (layout, type scale, spacing, animation curves). This doc is one level above that — it tells you what each surface is *for*.

A guiding principle worth stating up front: **v2 collapses the desktop and mobile experiences into a single, unified layout wherever possible.** When a phone constraint forces a different pattern (search bar + filter sheet vs. inline filter row), the pattern is called out explicitly. The default is "one layout, scales up."

---

## 1. Cross-cutting changes

These touch every tab and so don't belong in any single section.

### 1.1 Navigation pattern

The v1 secondary nav (top bar under the brand header) is removed. v2 uses two navigation surfaces that swap at the `md:` (768px) breakpoint:

- **Mobile (<768px): bottom tab bar.** Three tabs in fixed order — **Overview · Habits · Transactions**. Always visible above the safe-area inset. Thumb-reachable. The mobile design doc §2.1 specs the visual treatment.
- **Desktop (≥768px): left side rail.** Same three tabs as icon-with-label cells. Always visible. Body content offsets 64pt to the right. The mobile design doc §2.2 specs the visual treatment.

One nav component, two visual shapes at different breakpoints. Both reference the same active-tab state.

The brand wordmark from v1 (which acted as a "return to Overview" affordance) is **removed in v2**. The bottom tab bar and side rail are the canonical "go home" affordances — tapping the Overview tab from anywhere is the way back. The app's identity is communicated via the home-screen icon (PWA), the page title, and the persona caption on Overview.

### 1.2 The gear icon

A gear icon (`⚙`) provides access to the Settings sheet (§5). Its placement differs by viewport:

- **Mobile**: top-right of the sticky page header. 24×24pt icon, 44×44pt tap target.
- **Desktop**: bottom of the side rail, below the three tab cells.

On both viewports, tapping the gear opens the Settings sheet. The Settings sheet contains the persona switcher and the About footer.

### 1.3 Page headers (the secondary nav goes away)

In v1, the "secondary nav" under the brand bar owned page titling — Overview, Habits, and Transactions each injected their own title and subtitle into shared `#page-title` / `#page-subtitle` elements. With the bottom tab bar / side rail taking over navigation, the secondary nav element is **removed entirely**.

Each tab now owns its own page header inside its content area. Format is consistent across tabs, using the iOS large-title pattern (mobile design doc §3):

```
[Eyebrow line — small, neutral-500. On Overview, includes persona context.]
[H1 — page title. May include an inline interactive control like the month picker.]
```

Headers are NOT fixed bars — they scroll with content. The large-title pattern shrinks them into a thin sticky header on scroll. The sticky header shows only the tab name (e.g., `Overview`) plus the gear icon on mobile. Embedded controls (Overview's month picker, Habits' scope chip) live in the large-title block and are not accessible when scrolled — to use them, scroll back to the top.

### 1.4 Persona indicator

The active persona name is shown in the eyebrow of the **Overview tab only** as a quiet, persistent caption — not a greeting. The format folds the persona into the eyebrow line with a dot separator:

```
Overview · NYC Student
Your Spending Snapshot for May 2026 ▾
```

Other tabs do not show the persona name in their eyebrow. If the user wants to verify the active persona, they go to Overview or open the Settings sheet via the gear icon.

The persona name in the eyebrow is `text-sm text-neutral-500` (mobile design §1.3). It is **not** interactive — tapping it does not open the Settings sheet. To switch personas, the user uses the gear icon.

### 1.5 Cross-tab linkouts

The existing `window.moneyHabitsNav` handoff pattern is **preserved**. Source tab sets it, destination tab reads it on activation, applies the implied filters or scope, then nulls the state. The destinations in v2:

| Source | Action | Destination behavior |
|---|---|---|
| Overview snapshot card → "See transactions" | Filter Transactions tab to the focused month | Same as v1 |
| Overview snapshot card → "this time last month" | Filter Transactions tab to last month, day-range bounded | Same as v1 |
| Overview top-categories card → "Open in Habits" | Habits tab, scope set to that category, drill-down auto-opens for the focused month | **New behavior** — see §3.5 |

---

## 2. Overview tab

### 2.1 Vision

A single scrollable surface that answers "how am I doing this month, at a glance?" in three vertically stacked sections. No more four-card grid. One layout on every screen.

### 2.2 Layout

```
┌───────────────────────────────────────┐
│ Overview · NYC Student                │  ← condensed eyebrow (persona + tab name)
│ Your Spending Snapshot for May 2026 ▾ │  ← H1 with month picker
├───────────────────────────────────────┤
│                                       │
│  Spent so far in May                  │
│  $1,750                               │  ← combined snapshot card
│  ↓ 12% less than April                │
│                                       │
│  [ See transactions → ]               │
├───────────────────────────────────────┤
│                                       │
│  Cumulative spend in May              │  ← chart card
│      ╱───────                         │
│     ╱     ╱                           │
│    ╱     ╱                            │
│  ──────                               │
│                                       │
│  [+ Overlay April]                    │  ← toggle, off by default
├───────────────────────────────────────┤
│                                       │
│  Top Categories in May                │  ← top-categories card
│  🍔 Restaurants     $312              │
│  🛒 Groceries       $245              │
│  ☕ Cafés           $98               │
│                                       │
│  [ Open in Habits → ]                 │
└───────────────────────────────────────┘
```

Three cards, full-width, stacked vertically with `gap-4` (matching the existing design system spacing). Single column on every screen.

### 2.3 Card 1: Combined snapshot

Replaces v1's separate "this month" (card 1) and "last month" (card 2). The 3-month average card (v1 card 3) is **deleted entirely**.

| Element | v2 behavior |
|---|---|
| Label | `Spent so far in [Month]` (partial) or `Spent in [Month]` (complete). Unchanged from v1 card 1. |
| Value | The month total. Unchanged from v1 card 1. |
| Smart message | The existing computed smart message (`"12% less than April"` / `"On pace with April"` etc.) is kept exactly as today. **Does not** add the raw last-month dollar value. |
| Link button | `See transactions →` — opens Transactions filtered to the focused month. Unchanged from v1. |

The MTD-prorated comparison logic that v1 card 2 used to display its own value is **kept inside the smart message computation** but no longer surfaces a separate value on screen. The user sees the comparison ("12% less than April"); the raw $1,989 from v1 card 2 is gone.

### 2.4 Card 2: Cumulative chart

| Element | v2 behavior |
|---|---|
| Default state | Single line — this month only |
| Toggle | A small inline toggle below the chart: `[+ Overlay April]`. Tap to add the prior month as a dashed neutral line. Tap again to remove. Off by default. |
| Header | `Cumulative spend in [Month]` (or `Cumulative spend through Apr 24` for partial months) — matches existing label logic. |

The dual-line-by-default behavior of v1 is reversed. A user who wants the comparison taps for it; the default state is the cleaner single line.

### 2.5 Card 3: Top categories

Moved from v1 card 4 (top-right of the four-card grid) to the new bottom-of-Overview position. Otherwise **unchanged**:

- Chip list with emoji + category color (existing `catChipStyle` + `catLabelHtml`)
- Excludes the default `["Rent"]` from ranking (configurable in Habits, per v1 behavior)
- Top 3 categories for the focused month
- `Open in Habits →` link button at the bottom

### 2.6 Month picker behavior

- **Desktop**: existing dropdown panel anchored to the underlined month in the H1. Unchanged from v1.
- **Mobile**: tapping the underlined month opens a **bottom sheet** that slides up from the bottom of the viewport. The sheet contains the same list of months (newest first, active month highlighted). Tapping a month re-renders the Overview and dismisses the sheet.
- The sheet pattern is iOS-native (UISheetPresentationController-equivalent). The desktop dropdown stays put — sheets on a wide desktop screen feel out of place.

### 2.7 What's removed

- Four-card grid layout (replaced by three stacked cards)
- 3-month average card and its `infoTooltip` explaining the range
- The raw last-month dollar value display

### 2.8 What's preserved

- Dynamic page title that names the focused month
- The smart message logic (anomaly detection, "On pace" / "% more" / "% less")
- The "See transactions" linkout pattern with day-range bounding for partial months
- The `OVERVIEW_DEFAULT_EXCLUDES = ['Rent']` constant for top-categories ranking

---

## 3. Habits tab

This is the largest restructure in v2. The current "KPI strip + chart card + always-rendered drill-down" three-section layout becomes a clean "Trends-only home view + drill-down flyout that opens on demand" pattern. Same change on desktop and mobile.

### 3.1 Vision

The Habits tab is for *trend analysis*. The drill-down is a *focused inspection of one month*. v1 conflated them by always showing both at once. v2 separates them: trends is the home, drill-down is a thing you open.

### 3.2 Default state (Trends view)

```
┌───────────────────────────────────────┐
│ Your Habits for [📊 All Spending ▾]   │  ← H1 with scope chip
├───────────────────────────────────────┤
│                                       │
│  [12-Month ▾] [Total ↔ Stacked]       │  ← chart controls
│           [📊 ↔ ⊙ Bar ↔ Radial]       │  ← desktop only
│                                       │
│  ┌─────────────────────────────────┐  │
│  │                                 │  │
│  │   Monthly bar chart             │  │
│  │                                 │  │
│  │   ▮ ▮ ▮ ▮ ▮ ▮ ▮ ▮ ▮ ▮ ▮ ▮       │  │
│  │                                 │  │
│  └─────────────────────────────────┘  │
│                                       │
└───────────────────────────────────────┘
```

That's it. One chart, with its existing controls. The scope chip in the page title is the primary navigation control for what data is shown.

### 3.3 What's removed from the default view

- **KPI strip** — gone entirely. The 4 KPI tiles (This Month / Last Month / 12-Mo Avg / Top Category) are removed from both desktop and mobile. The information they showed is either redundant with the chart, available in the drill-down, or shown elsewhere.
- **Always-rendered drill-down** — replaced by the flyout pattern (§3.4).
- **The two H2 section headings** ("Trends" and "Selected month in detail") — gone. The chart is the only content on the home view, so the H2s have nothing to disambiguate.

### 3.4 Drill-down flyout

Tapping a bar in the trend chart opens the drill-down as a flyout panel.

**Trigger:** click/tap a bar in the trend chart, or arrive at Habits via a cross-tab linkout from Overview with a focused month (§1.5).

**Animation:**
- **Desktop**: slide from the right. Trends compresses to the left ~50% of the viewport, drill-down occupies the right ~50%. Both panes are interactive (the user can change the chart's timeframe in the compressed Trends view while the drill-down is open).
- **Mobile**: slide from the right as a full-screen sheet. Trends is no longer visible while the drill-down is open.

**Contents:** the existing drill-down sections, in the same order:
- B1: pie chart + 3 quick-stat cards (avg txn / txn count / most active day)
- B2: cumulative line chart + top locations list
- B3: bubble scatter
- B4: transaction table

These contents are **unchanged from v1** in terms of what they show and how they compute. The mobile-design doc will spec their phone-specific layouts (e.g., B1 stacks the pie above the quick stats on phone instead of side by side).

**Dismissal:**
- Tap outside the flyout (the dimmed/compressed Trends area on desktop, or — wait, on mobile there's no "outside" when it's full-screen. See note below.)
- Tap the `✕` button in the flyout header
- Swipe right anywhere in the flyout (mobile-native gesture)

**Note on "tap outside" on mobile**: at phone widths the flyout is full-screen, so there is no visible "outside" to tap. On phone, the dismissal options are the X button and the swipe-right gesture. On desktop, all three work. The mobile-design doc will spec the exact swipe threshold and the visual affordance for the X.

**No month chip inside the flyout.** The month shown in the flyout is whichever bar was tapped (or the month passed in by a cross-tab linkout). To see a different month, dismiss the flyout and tap a different bar. This is a deliberate simplification — the flyout is a "read mode," not a navigation surface.

### 3.5 Cross-tab arrival from Overview

When the user clicks `Open in Habits →` on Overview's top-categories card:

1. The Habits tab activates.
2. The scope chip is set to the category the user clicked (e.g., `🍔 Restaurants`).
3. The drill-down flyout **auto-opens** with the Overview's focused month already loaded.

This preserves the user's intent ("I want to see Restaurants for May"). The flyout opens immediately rather than requiring the user to tap a bar after arriving.

The 3-month-avg linkout from v1 (`Open in Habits` from the now-deleted average card) is removed alongside its source card.

### 3.6 Chart controls (the only controls in the home view)

| Control | Behavior | Where |
|---|---|---|
| Timeframe picker | Dropdown — `3-month / 6-month / 12-month / YTD / All-time`. Drives the chart's range. Unchanged from v1. | Every screen |
| Total ↔ Stacked toggle | Bar mode only. Inert at leaf scope. Unchanged from v1. | Every screen |
| Bar ↔ Radial chart-type toggle | Swaps between the monthly bar chart and the year-over-year radial chart. Unchanged from v1. | **Desktop only** (`hidden md:inline-flex`). Auto-falls back to bar at <768px. |
| Year multi-select | Visible only in radial mode (replaces the timeframe picker in that mode). | Desktop only, since radial is desktop-only |
| Scope chip | In the H1, opens a hierarchy dropdown. Unchanged. | Every screen |

### 3.7 What's preserved

- The bar↔radial chart-type toggle on desktop, including the `matchMedia` listener that flips back to bar when the viewport drops below 768px
- The `lensTimeframe` and `lensMonth` state model (the chart's timeframe and the focused month remain independent)
- The radial chart's year multi-select picker, year-color-by-recency palette mapping, and empty-state overlay
- The scope chip with its `catLabelHtml` rendering and the parent/leaf hierarchy dropdown (`#hc-chip-panel`)
- The smooth-scroll-to-drill-down behavior on bar click is **adapted** — it now triggers the flyout open animation instead of a smooth scroll, since the drill-down is no longer a contiguous region of the same page.

### 3.8 What's removed

- KPI strip (the four-tile row across the top)
- The two H2 section headings on the Habits tab
- The always-rendered drill-down section
- The drill-down's internal month chip (`#dd-month-btn`) and its associated `buildDrillDownMonthPanel()` function

---

## 4. Transactions tab

### 4.1 Vision

A scannable list of transactions grouped by month. Tap a filter to narrow the list. Tap "Load older" to see more history. One layout on every screen; the only mobile-specific affordance is that filters collapse behind a sheet at phone widths.

### 4.2 Layout

**Desktop:**

```
┌───────────────────────────────────────────────────────────┐
│ Transactions                                              │
│ All transactions                                          │  ← H1 + dynamic subtitle
├───────────────────────────────────────────────────────────┤
│ [🔍 Search]  [Category ▾]  [Month ▾]                       │  ← inline filter row
├───────────────────────────────────────────────────────────┤
│ ── May 2026 (32 transactions) ────────────────────────── │
│ │ Date │ Merchant │ Category │ Account │ Amount │        │  ← table header
│ │ May 24 │ Starbucks │ ☕ Cafés │ Chase │ −$7.45 │        │
│ │ May 24 │ Whole Foods │ 🛒 Groceries │ Amex │ −$84.20 │  │
│ │ … │                                                    │
│ ── April 2026 (47 transactions) ──────────────────────── │
│ │ … │                                                    │
│ ── March 2026 (38 transactions) ──────────────────────── │
│ │ … │                                                    │
│           [ Load February 2026 → ]                        │
└───────────────────────────────────────────────────────────┘
```

**Mobile:**

```
┌──────────────────────────────────────┐
│ Transactions                         │
│ All transactions                     │
├──────────────────────────────────────┤
│ [🔍 Search merchant…]   [ Filter ]   │  ← search + filter button
├──────────────────────────────────────┤
│ ── May 2026 (32 transactions) ────── │
│ ┌────────────────────────────────┐   │
│ │ Starbucks            −$7.45    │   │
│ │ ☕ Cafés             May 24    │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ Whole Foods         −$84.20    │   │
│ │ 🛒 Groceries         May 24    │   │
│ └────────────────────────────────┘   │
│ …                                    │
│ ── April 2026 (47 transactions) ──── │
│ …                                    │
│ ── March 2026 (38 transactions) ──── │
│ …                                    │
│       [ Load February 2026 → ]       │
└──────────────────────────────────────┘
              [Over][Habit][Txn]
```

### 4.3 Display

| Aspect | Desktop | Mobile |
|---|---|---|
| Row layout | 5-column table (Date / Merchant / Category / Account / Amount) | Stacked rows — merchant + amount on top line, category + date on bottom line. No account shown. |
| Row height | Single-line table row, ~40px | Two-line stacked card, ~64px |
| Category presentation | Chip with emoji in its own column | Chip with emoji inline on the second line |
| Account presentation | 4th column, muted text | Hidden on mobile |

The stacked-row pattern on mobile follows the Copilot iOS pattern. Tap targets are the entire row (full 44pt+ in height).

### 4.4 Grouping by month

- Transactions are **grouped by month on every screen** — desktop and mobile. The flat-pagination model of v1 is gone.
- Each group has a **static header** (`── May 2026 (32 transactions) ──`). Headers do not stick to the viewport top; they scroll with the content.
- Months are ordered newest first.
- Within a month, transactions are ordered by date descending (then by index in the source CSV for ties).

### 4.5 Initial load and "Load older"

- **Initial state**: the 3 most recent months with data are rendered immediately. With ~3,600 rows across 46 months, that's ~250 transactions on first paint — fine for the static-export approach (everything is in memory already; rendering is the only cost).
- **"Load older" button**: a single button at the bottom of the list, labeled with the next-older month explicitly: `[ Load February 2026 → ]`. Tapping it appends that month's group to the list and re-labels the button for the next-older month after it.
- The button disappears when there's no older data.
- "Load older" is an explicit user action — **no infinite scroll**, no auto-load on scroll proximity. The button is the discrete unit of navigation through history.

### 4.6 Filters

Three filters: search (merchant name), category, month. The set is **unchanged from v1** in terms of what's filterable.

| Filter | Desktop | Mobile |
|---|---|---|
| Search | Always-visible text input in the filter row | Always-visible at the top of the tab (above the list) |
| Category | Dropdown in the filter row | Inside the "Filter" sheet, opened by the Filter button |
| Month | `<input type="month">` in the filter row (native picker on iOS) | Inside the "Filter" sheet |

On mobile, the "Filter" button shows a count badge when filters are active (e.g., `[ Filter · 2 ]`) so the user can see filters are applied without opening the sheet.

### 4.7 Filtered view behavior

When any filter is active (search has text, or category/month has a value):

- The grouped-by-month structure is **preserved**, but only months with at least one matching transaction are shown.
- The "Load older" button now loads the next-older month **that has matches**, skipping empty months. Button label: `[ Load older matches → ]` (since the next month with matches may not be the calendar-adjacent one).
- Months may show different transaction counts in their headers from their unfiltered state — the header reflects the count *after* filtering: `── May 2026 (4 transactions matching "starbucks") ──`.

### 4.8 Search behavior

- Debounce: **100ms** (reduced from v1's 300ms). With static JSON and client-side filtering, there is no network cost and the lower debounce makes typing feel instant.
- Search matches merchant `name` (case-insensitive substring match). Unchanged scope from v1.
- Search results are highlighted in the rendered list? **No** — match highlighting is not a v2 feature. The user sees the filtered list, and the search term in the subtitle is the cue.

### 4.9 Subtitle

The existing dynamic subtitle pattern is **kept** (`Cat · May 2026 · matching "amazon"`), driven by the same `transactionsSubtitle()` function. On mobile, the subtitle sits below the H1 in the same eyebrow position as on desktop.

### 4.10 Pagination — what's removed

- The Prev / Next buttons at the bottom
- The "X–Y of Z transactions" count line
- The `txnPage` state variable and the page-based fetching logic in `loadTransactions()`
- The `per_page = 50` constant from v1

These are replaced by the grouped-month-with-Load-older pattern described above.

### 4.11 What's preserved

- The dynamic subtitle pattern (`transactionsSubtitle()`)
- The cross-tab linkout from Overview that sets `window.moneyHabitsNav` with `year_month` (and optionally `start_day` / `end_day`)
- The category chip with emoji rendering (`catChipStyle` + `catLabelHtml`)
- All filter values resetting on persona switch (currently achieved via full reload; in v2, achieved by re-rendering against the new dataset's JSON)

---

## 5. Settings

A new surface in v2. Replaces the desktop top-right dataset switcher.

### 5.1 Trigger

A gear icon (`⚙`) placed per §1.2:
- **Mobile**: top-right of the sticky page header.
- **Desktop**: bottom of the left side rail.

Tapping it opens the Settings sheet.

On desktop, the sheet appears as a centered modal with a backdrop. On mobile, it appears as a bottom sheet that slides up. Both dismiss via the X button, a backdrop tap, or (on mobile) a downward swipe.

### 5.2 Layout

```
┌───────────────────────────────────────┐
│ Settings                          ✕   │
├───────────────────────────────────────┤
│                                       │
│ ACTIVE PERSONA                        │  ← section header (eyebrow)
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ ✓  NYC Student                    │ │  ← active
│ ├───────────────────────────────────┤ │
│ │    NYC Young Professional         │ │
│ └───────────────────────────────────┘ │
│                                       │
│ ─────────────────────────────────────  │
│                                       │
│ ABOUT                                 │
│ MoneyHabits v2.0.0                    │
│ View source on GitHub →               │
│                                       │
└───────────────────────────────────────┘
```

### 5.3 Active persona

- Two rows, one per persona registered in the `DATASETS` registry. The active row shows a checkmark.
- **Tapping a row switches the persona and dismisses the sheet** in a single action. The frontend swaps the data source to the new persona's JSON folder and re-renders all tabs against the new data.
- The persona caption on Overview (§1.4) updates to reflect the new active persona.
- All in-app state resets implicitly when the data source changes — the user lands back on whatever tab they were on, but Overview is re-rendered for the new persona's most recent month, Habits scope resets to `all-spending`, Transactions filters clear.

### 5.4 About

- App name + version (sourced from a `version.json` or similar — engineering doc decides)
- One link to the source repo
- No other content in v2

### 5.5 What this replaces

- The top-right header dropdown that previously listed both personas (removed from base.html)
- The full-page reload on persona switch (replaced by an in-place re-render — see engineering doc)

---

## 6. Out of scope reminders

To prevent scope creep during build:

- **No new analytical surfaces.** Income-vs-spending, budgets, recurring detection, projections, net worth — all v3 or later.
- **No dark mode.** Light only in v2.
- **No localization.** USD assumed, English UI.
- **No CSV upload.** Personas are baked at build time.
- **No bank integration.** Static personas only.
- **No accounts or auth.** Single user, publicly reachable URL, synthetic data only.
- **No native code paths.** PWA only.
- **No new chart types.** Bar, radial, pie, cumulative line, bubble — same five vizes as v1.
- **No widget / Lock Screen / Shortcuts integration.** PWAs can't, and v2 doesn't try.

---

## 7. What happens next

Three docs follow this one, in order:

1. **`PRD-v2-mobile-design.md`** — translates these behavioral decisions into pixel-level specs: bottom tab bar styling, Habits flyout animation timing, Transactions stacked-row layout, type scale at phone widths, safe-area handling, the visual treatment for the persona caption, the gear icon's exact position and size, sheet presentation styles.
2. **`PRD-v2-pwa-shell.md`** — the manifest, icon set, splash screens, service worker strategy, offline behavior.
3. **`PRD-v2-engineering.md`** — the `build_static.py` pipeline (what gets pre-computed, the JSON file layout, how the dataset switcher works in a static-export world), the client-side filtering/pagination implementation for Transactions, Render deploy.

After those three, `PRD-v2-phasing.md` cuts the work into shippable milestones.
