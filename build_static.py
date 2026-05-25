#!/usr/bin/env python3
"""build_static.py — M2: per-persona JSON pre-computation.

Generates the full /dist/api/{persona}/ tree by calling data_processor
functions directly (engineering doc §3.2 decision). The Flask routes
in app.py are not involved.

M3 scope: every persona in dp.DATASETS, plus /api/personas.json.
M5 replaces the placeholder index.html with the templated PWA shell.
"""

import json
import re
import shutil
import time
import unicodedata
from pathlib import Path
from typing import Optional

import data_processor as dp

ROOT = Path(__file__).parent
DIST = ROOT / "dist"

# Timeframes that drive /api/summary's avg_start/avg_end. Mirrors the
# v1 frontend's dateRangeFor() helper.
TIMEFRAME_PRESETS = ["last-3-months", "last-6-months", "last-12-months", "ytd", "all-time"]


PLACEHOLDER_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MoneyHabits</title>
  <style>
    body { font: 16px -apple-system, system-ui, sans-serif; margin: 2rem; color: #1c1c1e; max-width: 32rem; }
    h1 { font-weight: 600; }
    code { background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    #months { color: #636366; }
  </style>
</head>
<body>
  <h1>MoneyHabits</h1>
  <p>v2 build — M2 (per-persona JSON pre-computation).</p>
  <p>The real frontend lands at M8+. Until then, this page just confirms the JSON tree is reachable.</p>
  <p>Months available for <code>student</code>: <span id="months">loading...</span></p>
  <script>
    fetch('/api/student/months.json')
      .then(r => r.json())
      .then(months => {
        const el = document.getElementById('months');
        el.textContent = months.length
          ? `${months.length} months, ${months[0]} → ${months[months.length - 1]}`
          : '(none)';
      })
      .catch(err => { document.getElementById('months').textContent = 'fetch failed: ' + err.message; });
  </script>
</body>
</html>
"""


def main():
    start = time.time()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()

    (DIST / "index.html").write_text(PLACEHOLDER_INDEX_HTML)
    api_root = DIST / "api"
    api_root.mkdir()

    # personas.json — the frontend's source of truth for the dataset switcher.
    # No `active` field; v2 tracks the active persona in localStorage.
    write_json(api_root / "personas.json",
               [{"key": k, "label": v["label"]} for k, v in dp.DATASETS.items()])

    # set_active_dataset() persists the choice to .active-dataset. Restore the
    # original at the end so running the build locally doesn't silently swap
    # the dev server's active persona.
    original_dataset = dp.get_active_dataset()
    try:
        for persona_key in dp.DATASETS.keys():
            print(f"  → Pre-computing {persona_key}...")
            dp.set_active_dataset(persona_key)
            precompute_persona(persona_key, api_root)
    finally:
        dp.set_active_dataset(original_dataset)

    verify(api_root)

    total_files = sum(1 for _ in DIST.rglob("*") if _.is_file())
    total_bytes = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    elapsed = time.time() - start
    print(f"\n✓ build complete — {total_files} files, {total_bytes:,} bytes, {elapsed:.1f}s")


def precompute_persona(persona_key: str, api_root: Path) -> None:
    out = api_root / persona_key
    out.mkdir(parents=True, exist_ok=True)

    months = sorted(dp.get_months_list(), reverse=True)   # newest first
    categories = dp.get_categories_list()
    meta_raw = dp.get_category_meta()                     # one row per leaf

    parents = sorted({m["parent"] for m in meta_raw if m["parent"]})
    leaves = list(categories)
    scopes = [("all", "")] + [("parent", p) for p in parents] + [("leaf", l) for l in leaves]
    print(f"    {len(months)} months · {len(parents)} parents · {len(leaves)} leaves · {len(scopes)} scopes")

    # ── singletons ────────────────────────────────────────────────────────
    write_json(out / "categories.json", categories)
    write_json(out / "months.json", months)

    # category-meta with the v2-extended slug field; also include explicit
    # parent rows (parent: null) so the frontend can resolve parent slugs
    # without a second lookup.
    meta_with_slug = [
        {"category": m["category"], "parent": m["parent"], "slug": scope_slug("leaf", m["category"])}
        for m in meta_raw
    ] + [
        {"category": p, "parent": None, "slug": scope_slug("parent", p)}
        for p in parents
    ]
    write_json(out / "category-meta.json", meta_with_slug)

    write_json(out / "category-hierarchy.json",
               {"months": {m: dp.get_category_hierarchy(m) for m in months}})

    write_json(out / "transactions.json", {"rows": dp.transactions_all()})

    write_json(out / "overview-snapshot.json",
               {"months": {m: dp.get_overview_snapshot(m) for m in months}})

    write_json(out / "top-categories-none.json",
               {"exclude": [], "months": {m: dp.get_top_categories(m) for m in months}})
    write_json(out / "top-categories-default.json",
               {"exclude": ["Rent"], "months": {m: dp.get_top_categories(m, ["Rent"]) for m in months}})

    # ── summary: one file per (scope × timeframe), all months keyed inside ─
    for (level, category) in scopes:
        slug = scope_slug(level, category)
        for timeframe in TIMEFRAME_PRESETS:
            avg_start, avg_end = derive_avg_range(timeframe, months)
            payload = {
                "timeframe": timeframe,
                "months": {
                    m: dp.get_summary_stats(
                        level=level,
                        category=category or None,
                        year_month=m,
                        avg_start=avg_start,
                        avg_end=avg_end,
                    )
                    for m in months
                },
            }
            write_json(out / f"summary-{slug}-{timeframe}.json", payload)

    # ── monthly: one file per (scope × granularity), plus one by-parent at all-scope ──
    for (level, category) in scopes:
        slug = scope_slug(level, category)
        for granularity in ["day", "week", "month"]:
            payload = {
                "granularity": granularity,
                "periods": monthly_for_scope(level, category, granularity),
            }
            write_json(out / f"monthly-{slug}-{granularity}.json", payload)

    write_json(out / "monthly-all-month-by-parent.json", {
        "granularity": "month",
        "group_by": "parent",
        "periods": monthly_for_scope("all", "", "month", group_by="parent"),
    })

    # ── category-detail: one file per scope, all months keyed inside ───────
    for (level, category) in scopes:
        slug = scope_slug(level, category)
        payload = {
            "level": level,
            "category": category,
            "months": {
                m: dp.get_category_detail(category or "", m, level=level)
                for m in months
            },
        }
        write_json(out / f"category-detail-{slug}.json", payload)

    # ── radial: one file per scope ─────────────────────────────────────────
    for (level, category) in scopes:
        slug = scope_slug(level, category)
        write_json(out / f"radial-{slug}.json",
                   {"years": dp.radial(level, category or None)})


# ── helpers ───────────────────────────────────────────────────────────────


def monthly_for_scope(level: str, category: str, granularity: str,
                      group_by: Optional[str] = None) -> list:
    """Translate the (level, category) build-script signature to v1's
    get_monthly_totals(categories, parent, ...) signature."""
    if level == "parent":
        return dp.get_monthly_totals(None, granularity=granularity,
                                     parent=category, group_by=group_by)
    if level == "leaf":
        return dp.get_monthly_totals([category], granularity=granularity,
                                     group_by=group_by)
    return dp.get_monthly_totals(None, granularity=granularity, group_by=group_by)


def scope_slug(level: str, category: str) -> str:
    """URL-safe lowercase slug for a (level, category) pair.

    Examples:
      ("all", "")               → "all"
      ("parent", "Food & Drink") → "parent-food-and-drink"
      ("leaf", "Cafés")          → "leaf-cafes"
    """
    if level == "all":
        return "all"
    # Transliterate accents: "Cafés" → "Cafes"
    s = unicodedata.normalize("NFKD", category).encode("ascii", "ignore").decode("ascii")
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)   # any run of non-alphanum → single dash
    s = s.strip("-")
    return f"{level}-{s}"


def derive_avg_range(timeframe: str, months_desc: list[str]) -> tuple[str, str]:
    """Map a timeframe preset to (avg_start, avg_end) as YYYY-MM-DD strings.
    Mirrors the v1 frontend's dateRangeFor() helper.

    months_desc is sorted newest-first (e.g. ["2026-05", "2026-04", ...]).
    """
    if not months_desc:
        return ("", "")
    newest = months_desc[0]    # e.g. "2026-05"
    oldest = months_desc[-1]   # e.g. "2022-08"
    y, m = (int(x) for x in newest.split("-"))
    end = f"{newest}-28"   # backend normalizes to month-end via the inclusive day window

    if timeframe == "last-3-months":
        return (_shift_ymd(y, m, -2), end)
    if timeframe == "last-6-months":
        return (_shift_ymd(y, m, -5), end)
    if timeframe == "last-12-months":
        return (_shift_ymd(y, m, -11), end)
    if timeframe == "ytd":
        return (f"{y:04d}-01-01", end)
    if timeframe == "all-time":
        return (f"{oldest}-01", end)
    raise ValueError(f"Unknown timeframe: {timeframe}")


def _shift_ymd(year: int, month: int, delta_months: int) -> str:
    """Return YYYY-MM-01 for (year, month) shifted by delta_months."""
    total = (year * 12 + (month - 1)) + delta_months
    y, m = divmod(total, 12)
    return f"{y:04d}-{m + 1:02d}-01"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"), default=_json_default)


def _json_default(o):
    # pandas Timestamps / NaT slip through occasionally; coerce.
    if hasattr(o, "isoformat"):
        return o.isoformat()
    if o is None:
        return None
    raise TypeError(f"Not JSON-serializable: {type(o).__name__}")


# ── verification ──────────────────────────────────────────────────────────


def verify(api_root: Path) -> None:
    assert (api_root / "personas.json").exists(), "Missing: personas.json"
    for persona_key in dp.DATASETS.keys():
        out = api_root / persona_key
        singletons = [
            "categories.json", "months.json", "category-meta.json",
            "category-hierarchy.json", "transactions.json",
            "overview-snapshot.json",
            "top-categories-none.json", "top-categories-default.json",
        ]
        for r in singletons:
            assert (out / r).exists(), f"Missing: {persona_key}/{r}"
        # Sanity check the all-scope scoped files exist for each type
        for r in ["summary-all-last-3-months.json", "monthly-all-month.json",
                  "monthly-all-month-by-parent.json",
                  "category-detail-all.json", "radial-all.json"]:
            assert (out / r).exists(), f"Missing: {persona_key}/{r}"
    print("  verify: all expected files present")


if __name__ == "__main__":
    main()
