# Deferred / Next Up

Items queued during a session but not yet scheduled. The full design plan
for each lives in `~/.claude/plans/purrfect-strolling-muffin.md`
(`Deferred / future` section).

| Added | Item | Notes |
|---|---|---|

*(empty — all queued items shipped on 2026-06-01)*

## Shipped 2026-06-01

- **Transactions: month-header total** — filtered sum on the right of each `April 2026 · 4 transactions` header.
- **Lingering tooltips bug** — added `hideAllTooltips()` helper + plugged the strand points (chart teardown, flyout open/close/expand/dismiss, chart-type switch, tab switch, page blur/visibility/scroll).
- **PWA home-screen icon not in brand purple** — `base.html` was missing every PWA meta tag; added `<link rel="manifest">`, `<meta name="theme-color" content="#4338ca">`, `apple-touch-icon` × 4 sizes, the `apple-mobile-web-app-*` flags, and favicon links. (Existing home-screen installs need to be re-added to pick up the new tile.)
- **Transaction metadata: `spend_type` + `budget_bucket`** — `CATEGORY_TAGS` map in `data_processor.py`; tags ride on every `transactions.json` row and on leaf-scope `category-detail-*.json` payloads; drill-down chip pair + two new Transactions tab filters wired.
