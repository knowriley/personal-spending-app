# Deferred / Next Up

Items queued during a session but not yet scheduled. The full design plan
for each lives in `~/.claude/plans/purrfect-strolling-muffin.md`
(`Deferred / future` section).

| Added | Item | Notes |
|---|---|---|
| 2026-05-29 | **Transactions: month-header total (right-aligned)** | Sum of the (filtered) rows in each month group rendered on the right of the existing `April 2026 · 4 transactions matching …` header. Plan: aggregate from `getFilteredTransactions()` before `groupByMonth()`; flex layout in the header. |
| 2026-05-29 | **Lingering tooltips bug** | Chart.js + custom DOM tooltips don't reliably dismiss after pointer-leave / chart teardown / flyout open-close. Triage `hideCjsTip()` / `hideCustomTooltip()` call sites and missing pointerout/blur listeners. |
| 2026-05-29 | **PWA home-screen icon not in brand purple** | Installed PWA tile renders in default OS color instead of indigo. Inspect `manifest.json` (`theme_color`, `background_color`), maskable icon set, HTML `<meta name="theme-color">`, and iOS apple-touch-icon variants. |
| 2026-05-29 | **Transaction metadata: `spend_type` (fixed/variable) + `budget_bucket` (needs / wants / savings-loans)** | Two new per-transaction tags inherited from category. Proposed `CATEGORY_TAGS` mapping table is in the plan file with spend history per persona — awaiting user review before implementation. Build step would surface tags inside `transactions.json` + `category-detail-*.json`; drill-down headline gets a chip pair, Transactions tab gets matching filters. |
