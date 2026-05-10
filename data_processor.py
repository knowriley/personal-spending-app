import pandas as pd
from pathlib import Path
from typing import Optional

DATASETS = {
    "student":   {"label": "NYC Student",            "path": "datasets/student.csv"},
    "young-pro": {"label": "NYC Young Professional", "path": "datasets/young-pro.csv"},
}
DEFAULT_DATASET = "student"
_ACTIVE_FILE = Path(__file__).parent / ".active-dataset"

_df: Optional[pd.DataFrame] = None
_df_full: Optional[pd.DataFrame] = None
_active_key: Optional[str] = None


def get_active_dataset() -> str:
    global _active_key
    if _active_key is not None:
        return _active_key
    try:
        key = _ACTIVE_FILE.read_text().strip()
    except (FileNotFoundError, OSError):
        key = ""
    if key not in DATASETS:
        key = DEFAULT_DATASET
    _active_key = key
    return _active_key


def set_active_dataset(key: str) -> None:
    global _df, _df_full, _active_key
    if key not in DATASETS:
        raise ValueError(f"unknown dataset key: {key!r}")
    _ACTIVE_FILE.write_text(key)
    _df = None
    _df_full = None
    _active_key = None


def list_datasets() -> list:
    active = get_active_dataset()
    return [
        {"key": k, "label": v["label"], "active": k == active}
        for k, v in DATASETS.items()
    ]


def _csv_path() -> Path:
    return Path(__file__).parent / DATASETS[get_active_dataset()]["path"]


def load_data() -> pd.DataFrame:
    global _df
    if _df is None:
        raw = pd.read_csv(_csv_path(), dtype=str)
        raw.columns = raw.columns.str.strip().str.strip('"')

        raw["amount"] = pd.to_numeric(raw["amount"], errors="coerce")
        raw["date"] = pd.to_datetime(raw["date"], errors="coerce")
        raw["excluded"] = raw["excluded"].str.lower().str.strip() == "true"
        raw["status_norm"] = raw["status"].fillna("").str.lower().str.strip()

        # spending rows only — exclude planned so future budget rows don't inflate historical views
        df = raw[
            (~raw["excluded"])
            & (raw["type"].str.strip().str.lower() == "regular")
            & (raw["status_norm"] != "planned")
            & (raw["amount"] > 0)
        ].copy()

        # normalize category
        df["category"] = df["category"].str.strip()
        df["parent_category"] = df["parent category"].str.strip()
        df["category_norm"] = df["category"].where(
            df["category"].notna() & (df["category"] != ""),
            df["parent_category"]
        ).fillna("Uncategorized")

        df["year_month"] = df["date"].dt.to_period("M").astype(str)
        _df = df

    return _df


def load_full_data() -> pd.DataFrame:
    """Frame including income + spending rows (excludes 'internal transfer' and excluded=true).

    Used by the Overview budget viz which needs both sides. Income amounts are stored
    as positive values in the `pos_amount` column.
    """
    global _df_full
    if _df_full is None:
        raw = pd.read_csv(_csv_path(), dtype=str)
        raw.columns = raw.columns.str.strip().str.strip('"')

        raw["amount"] = pd.to_numeric(raw["amount"], errors="coerce")
        raw["date"] = pd.to_datetime(raw["date"], errors="coerce")
        raw["excluded"] = raw["excluded"].str.lower().str.strip() == "true"
        raw["type_norm"]   = raw["type"].fillna("").str.lower().str.strip()
        raw["status_norm"] = raw["status"].fillna("").str.lower().str.strip()

        # Income rows are flagged excluded=true by Copilot's export, so don't apply the
        # `excluded` filter to them — only to regular spending rows.
        is_income  = raw["type_norm"] == "income"
        is_regular = raw["type_norm"] == "regular"
        df = raw[
            (is_income | (is_regular & ~raw["excluded"]))
        ].copy()

        df["category"] = df["category"].str.strip()
        df["parent_category"] = df["parent category"].str.strip()
        df["category_norm"] = df["category"].where(
            df["category"].notna() & (df["category"] != ""),
            df["parent_category"]
        ).fillna("Uncategorized")

        df["year_month"] = df["date"].dt.to_period("M").astype(str)
        df["pos_amount"] = df["amount"].abs()
        _df_full = df

    return _df_full


def get_monthly_totals(
    categories=None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    granularity: str = "month",
    parent: Optional[str] = None,
    group_by: Optional[str] = None,
) -> list[dict]:
    """Period-bucketed totals, with optional category / parent / stack grouping.

    `categories` filters to specific leaves (used in leaf scope).
    `parent` filters to all leaves under one parent group.
    `group_by="parent"` returns stacked output `[{period, totals: {key: amt}}]`:
      - default keys are parent groups (orphans rolled into "Other")
      - when `parent` is also set, keys are children (leaves) of that parent
    """
    df = load_data()
    if categories:
        df = df[df["category_norm"].isin(categories)]
    if parent:
        df = df[df["parent_category"] == parent]

    start_ts = pd.Timestamp(start) if start else None
    end_ts = pd.Timestamp(end) if end else None
    if start_ts is not None:
        df = df[df["date"] >= start_ts]
    if end_ts is not None:
        # treat `end` as inclusive across the whole calendar day
        df = df[df["date"] <= end_ts + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)]

    if granularity == "day":
        period_series = df["date"].dt.strftime("%Y-%m-%d")
        if start_ts is not None and end_ts is not None:
            full_index = [d.strftime("%Y-%m-%d") for d in pd.date_range(start_ts, end_ts, freq="D")]
        else:
            full_index = None
    elif granularity == "week":
        period_series = df["date"].dt.to_period("W-MON").apply(lambda p: p.start_time.strftime("%Y-%m-%d"))
        if start_ts is not None and end_ts is not None:
            week_starts = pd.period_range(start_ts.to_period("W-MON"), end_ts.to_period("W-MON"), freq="W-MON")
            full_index = [p.start_time.strftime("%Y-%m-%d") for p in week_starts]
        else:
            full_index = None
    else:  # month
        period_series = df["date"].dt.to_period("M").astype(str)
        if start_ts is not None and end_ts is not None:
            month_periods = pd.period_range(start_ts.to_period("M"), end_ts.to_period("M"), freq="M")
            full_index = [str(p) for p in month_periods]
        else:
            full_index = None

    df = df.assign(_period=period_series)

    if group_by == "parent":
        # Stack key: when a parent is already selected, group by leaves (no top-N
        # capping). Otherwise rank parents + orphan leaves as peers and keep only
        # the top 5 visible — everything else (including the literal "Other"
        # leaf) collapses into a synthetic "Other" stack.
        if parent:
            stack_key = df["category_norm"].fillna("Uncategorized")
            df = df.assign(_stack=stack_key)
        else:
            has_parent = df["parent_category"].notna() & (df["parent_category"] != "")
            stack_key = df["parent_category"].where(has_parent, df["category_norm"])
            df = df.assign(_stack=stack_key)

            # Rank top-level entities across the whole window. Drop any
            # "Other"-named entries before ranking — they always go to the
            # synthetic Other bucket regardless of size.
            totals_by_key = df.groupby("_stack")["amount"].sum()
            real = totals_by_key[totals_by_key.index.astype(str).str.lower() != "other"]
            top_keys = set(real.sort_values(ascending=False).head(5).index.astype(str))

            # Remap: anything not in top_keys → "Other".
            df["_stack"] = df["_stack"].where(df["_stack"].isin(top_keys), "Other")

        pivoted = (
            df.groupby(["_period", "_stack"])["amount"].sum()
            .unstack(fill_value=0.0)
        )
        if full_index is not None:
            pivoted = pivoted.reindex(full_index, fill_value=0.0)
        else:
            pivoted = pivoted.sort_index()

        rows = []
        for period, row in pivoted.iterrows():
            totals = {str(k): round(float(v), 2) for k, v in row.items() if float(v) != 0.0}
            rows.append({"period": str(period), "totals": totals})
        return rows

    grouped = df.groupby("_period")["amount"].sum()
    if full_index is not None:
        grouped = grouped.reindex(full_index, fill_value=0.0)
    else:
        grouped = grouped.sort_index()

    totals = grouped.round(2).reset_index()
    totals.columns = ["period", "total"]
    return totals.to_dict(orient="records")


def get_category_breakdown(year_month: Optional[str] = None) -> list[dict]:
    df = load_data()
    if year_month:
        df = df[df["year_month"] == year_month]
    totals = (
        df.groupby("category_norm")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"category_norm": "category", "amount": "total"})
        .sort_values("total", ascending=False)
    )
    totals["total"] = totals["total"].round(2)
    return totals.to_dict(orient="records")


def get_transactions(
    search: str = "",
    category: str = "",
    year_month: str = "",
    start_day: Optional[int] = None,
    end_day: Optional[int] = None,
    parent: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    df = load_data()

    if search:
        df = df[df["name"].str.contains(search, case=False, na=False)]
    if category:
        df = df[df["category_norm"] == category]
    if parent:
        df = df[df["parent_category"] == parent]
    if year_month:
        df = df[df["year_month"] == year_month]
    if start_day is not None:
        df = df[df["date"].dt.day >= start_day]
    if end_day is not None:
        df = df[df["date"].dt.day <= end_day]

    total = len(df)
    df = df.sort_values("date", ascending=False)
    df = df.iloc[(page - 1) * per_page : page * per_page]

    rows = df[["date", "name", "category_norm", "amount", "account"]].copy()
    rows["day_of_week"] = rows["date"].dt.strftime("%A")  # e.g. "Monday"
    rows["date"] = rows["date"].dt.strftime("%Y-%m-%d")
    rows["amount"] = rows["amount"].round(2)
    rows = rows.rename(columns={"category_norm": "category"})

    return {"total": total, "page": page, "per_page": per_page, "rows": rows.to_dict(orient="records")}


def get_summary_stats(
    level: str = "all",
    category: Optional[str] = None,
    year_month: Optional[str] = None,
    avg_start: Optional[str] = None,
    avg_end: Optional[str] = None,
) -> dict:
    """KPI strip values, scoped to `level` × `category` and pivoted around `year_month`.

    `year_month` is the active month the frontend has selected. "this month",
    "last month", and "top" calculations pivot on this month.

    `avg_start` / `avg_end` (YYYY-MM-DD) bound the Monthly-Avg KPI to the chart's
    range so it stays meaningful as the user changes the trend chart timeframe.
    When omitted, falls back to a 3-month rolling avg (the legacy behavior).
    `avg_months` in the response is the number of distinct months averaged over
    so the frontend can label the KPI dynamically.

    `top` swaps by scope:
      - level="all"   : top parent group in the active month (orphans → "Other")
      - level="parent": top child leaf of that parent
      - level="leaf"  : top merchant (`name`)
    """
    df = load_data()
    months = sorted(df["year_month"].unique())

    if not months:
        return {}

    # Active month = the user's selected month if present in the dataset, else
    # the latest month with data. Prior month is derived from the active month
    # (pd.Period subtraction) — NOT from the position in `months`, so gaps in
    # the dataset don't poison the comparison.
    active = year_month if year_month and year_month in months else months[-1]
    active_period = pd.Period(active, freq="M")
    prev = str(active_period - 1)

    # Filter the frame to the active scope before computing totals.
    if level == "parent" and category:
        scoped = df[df["parent_category"] == category]
    elif level == "leaf" and category:
        scoped = df[df["category_norm"] == category]
    else:
        scoped = df

    this_month = float(scoped[scoped["year_month"] == active]["amount"].sum())
    last_month = float(scoped[scoped["year_month"] == prev]["amount"].sum())

    # Monthly avg: prefer the chart's range when provided. Otherwise fall back
    # to the 3 calendar months immediately before `active` (legacy behavior).
    if avg_start or avg_end:
        avg_frame = scoped
        if avg_start:
            avg_frame = avg_frame[avg_frame["date"] >= pd.Timestamp(avg_start)]
        if avg_end:
            avg_frame = avg_frame[avg_frame["date"] <= pd.Timestamp(avg_end)]
        avg_months_seen = sorted(avg_frame["year_month"].unique())
        avg_months_count = len(avg_months_seen)
        avg = float(avg_frame["amount"].sum()) / avg_months_count if avg_months_count else 0.0
    else:
        recent_months = [str(active_period - n) for n in (1, 2, 3)]
        avg_months_count = len(recent_months)
        avg = float(scoped[scoped["year_month"].isin(recent_months)]["amount"].sum()) / avg_months_count if avg_months_count else this_month

    # Compute the contextual "Top X" — uses the same scoped frame for the active month.
    active_sub = scoped[scoped["year_month"] == active]
    # `top_level` reflects the scope so the frontend eyebrow is correct even when there's no data.
    top_level = {"all": "parent", "parent": "leaf", "leaf": "merchant"}.get(level, "parent")
    top_label = "—"
    top_value = 0.0

    if not active_sub.empty:
        if level == "all":
            # Rank parents + orphan leaves as peers; never accept an
            # "Other"-named entry as the Top Category (synthetic rollup OR the
            # literal "Other" leaf in the dataset).
            has_parent = active_sub["parent_category"].notna() & (active_sub["parent_category"] != "")
            stack_key = active_sub["parent_category"].where(has_parent, active_sub["category_norm"])
            grouped = active_sub.assign(_pg=stack_key).groupby("_pg")["amount"].sum()
            grouped = grouped[grouped.index.astype(str).str.lower() != "other"]
        elif level == "parent":
            grouped = active_sub.groupby("category_norm")["amount"].sum()
        else:  # leaf
            grouped = active_sub.groupby("name")["amount"].sum()

        if not grouped.empty:
            top_label = str(grouped.idxmax())
            top_value = float(grouped.max())

    return {
        "this_month": round(this_month, 2),
        "last_month": round(last_month, 2),
        "monthly_avg": round(avg, 2),
        "avg_months": avg_months_count,
        "top": {
            "label": top_label,
            "level": top_level,
            "value": round(top_value, 2),
        },
        "current_month": active,
        "date_range": {"start": months[0], "end": months[-1]},
        "scope": {"level": level, "category": category or "", "year_month": active},
    }


def get_radial_data(
    category: Optional[str] = None,
    parent: Optional[str] = None,
) -> dict:
    """Return monthly spending by calendar year for a radar chart.

    Returns {year_str: [jan, feb, ..., dec]} — 12 floats each, 0 where no data.

    `parent` filters to all leaves under one parent group (mirrors the
    /api/monthly param). `category` filters to a single leaf. `parent` wins
    when both are passed.
    """
    df = load_data()
    if parent:
        df = df[df["parent_category"] == parent]
    elif category:
        df = df[df["category_norm"] == category]

    df = df.copy()
    df["year"]  = df["date"].dt.year
    df["month"] = df["date"].dt.month

    grouped = (
        df.groupby(["year", "month"])["amount"]
        .sum()
        .reset_index()
    )

    result = {}
    for year, grp in grouped.groupby("year"):
        months = [0.0] * 12
        for _, row in grp.iterrows():
            months[int(row["month"]) - 1] = round(float(row["amount"]), 2)
        result[str(int(year))] = months

    return result


def get_category_detail(category: str, year_month: str, level: str = "leaf") -> dict:
    """Drill-down data for a month, scoped by `level`.

    - level="leaf"  : single leaf category (existing behavior).
    - level="parent": all leaves under one parent group.
    - level="all"   : the whole month (no category filter).
    """
    df = load_data()
    month_df = df[df['year_month'] == year_month]
    month_total = float(month_df['amount'].sum())

    if level == "all":
        sub = month_df
        scope_label = "All Spending"
    elif level == "parent":
        sub = month_df[month_df['parent_category'] == category]
        scope_label = category
    else:  # leaf
        sub = month_df[month_df['category_norm'] == category]
        scope_label = category

    cat_total   = float(sub['amount'].sum())
    pct_of_total = round(cat_total / month_total * 100, 1) if month_total > 0 else 0.0

    txn_count = len(sub)
    avg_txn   = round(cat_total / txn_count, 2) if txn_count > 0 else 0.0

    if not sub.empty:
        most_freq_dow = str(sub['date'].dt.day_name().value_counts().index[0])
    else:
        most_freq_dow = '—'

    TOP_N = 4

    # Top merchants — always available, scoped to `sub`.
    merchant_totals = (
        sub.groupby('name')['amount'].sum()
        .sort_values(ascending=False)
        .reset_index()
    )
    top_merchants: list[dict] = []
    for _, row in merchant_totals.head(TOP_N).iterrows():
        top_merchants.append({'name': str(row['name']), 'total': round(float(row['amount']), 2)})
    other_total = float(merchant_totals.iloc[TOP_N:]['amount'].sum()) if len(merchant_totals) > TOP_N else 0.0
    if other_total > 0:
        top_merchants.append({'name': 'Other', 'total': round(other_total, 2)})

    # Scope-aware breakdown for the pie + locations:
    #   - leaf  : top_locations = top_merchants (existing)
    #   - parent: by_child rolls up child leaves of this parent
    #   - all   : by_parent rolls up parent groups (orphans → "Other")
    by_child: list[dict] = []
    by_parent: list[dict] = []
    if level == "parent":
        child_totals = (
            sub.groupby('category_norm')['amount'].sum()
            .sort_values(ascending=False)
            .reset_index()
        )
        for _, row in child_totals.iterrows():
            by_child.append({'name': str(row['category_norm']), 'total': round(float(row['amount']), 2)})
    elif level == "all":
        # Rank parents + orphan leaves as peers. Top 5 explicit; everything
        # else (plus any "Other"-named entries) collapses into a synthetic
        # "Other" entry.
        has_parent = sub['parent_category'].notna() & (sub['parent_category'] != "")
        stack_key = sub['parent_category'].where(has_parent, sub['category_norm'])
        totals = (
            sub.assign(_pg=stack_key).groupby('_pg')['amount'].sum()
            .sort_values(ascending=False)
        )
        is_other = totals.index.astype(str).str.lower() == "other"
        real = totals[~is_other]
        top5 = real.head(5)
        other_total = float(totals[is_other].sum())
        if len(real) > 5:
            other_total += float(real.iloc[5:].sum())
        for name, amt in top5.items():
            by_parent.append({'name': str(name), 'total': round(float(amt), 2)})
        if other_total > 0:
            by_parent.append({'name': 'Other', 'total': round(other_total, 2)})

    # Pick the locations list shown in the right rail and pie:
    #   leaf → top merchants (with "Other" tail rollup, existing behavior)
    #   parent → all child leaves (no tail rollup; ~2-6 children typically)
    #   all → all parent groups (no tail rollup; ~5 groups; "Other" already means orphans)
    if level == "parent":
        top_locations = list(by_child)
    elif level == "all":
        top_locations = list(by_parent)
    else:
        top_locations = top_merchants

    # Cumulative spend by calendar day
    period   = pd.Period(year_month, freq='M')
    all_days = pd.date_range(start=period.start_time, end=period.end_time, freq='D')
    daily    = sub.groupby(sub['date'].dt.date)['amount'].sum()
    cum_rows: list[dict] = []
    running = 0.0
    for day in all_days:
        d = day.date()
        running += float(daily.get(d, 0.0))
        cum_rows.append({'date': str(d), 'cumulative': round(running, 2)})

    # Raw transactions (sorted by date asc for bubble + table)
    txns = sub[['date', 'name', 'amount', 'account', 'category_norm']].copy()
    txns = txns.sort_values('date').reset_index(drop=True)
    txns['date'] = txns['date'].dt.strftime('%Y-%m-%d')
    txns['amount'] = txns['amount'].round(2)
    txns = txns.rename(columns={'category_norm': 'category'})

    return {
        'category':          scope_label,
        'level':             level,
        'year_month':        year_month,
        'total':             round(cat_total, 2),
        'month_total':       round(month_total, 2),
        'pct_of_total':      pct_of_total,
        'transaction_count': txn_count,
        'avg_transaction':   avg_txn,
        'most_frequent_dow': most_freq_dow,
        'top_locations':     top_locations,
        'top_merchants':     top_merchants,
        'by_child':          by_child,
        'by_parent':         by_parent,
        'cumulative_spend':  cum_rows,
        'transactions':      txns.to_dict(orient='records'),
    }


def get_top_categories(year_month: str, exclude: Optional[list] = None) -> list[dict]:
    """All categories ranked by spend for a month, with optional exclusions."""
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


def get_categories_list() -> list[str]:
    df = load_data()
    return sorted(df["category_norm"].dropna().unique().tolist())


def get_category_meta() -> list[dict]:
    """For each unique category_norm, the parent_category it most often appears with.

    Returns rows of {category, parent} where parent is None when the leaf has
    no associated parent in the CSV (orphan categories). Used by the frontend
    color mapping so children can inherit their parent group's hue.
    """
    df = load_data()
    parent = df["parent_category"].where(
        df["parent_category"].notna() & (df["parent_category"] != "")
    )
    groups = df.assign(_parent=parent).groupby("category_norm")["_parent"]
    rows = []
    for cat, parents in groups:
        modes = parents.dropna().mode()
        rows.append({"category": cat, "parent": modes.iloc[0] if not modes.empty else None})
    rows.sort(key=lambda r: r["category"])
    return rows


def get_months_list() -> list[str]:
    df = load_data()
    return sorted(df["year_month"].unique().tolist())


def get_category_hierarchy(
    year_month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict:
    """Hierarchical category tree for the Habits-tab left rail.

    Returns parents (with children) and orphan leaves at the top level, all
    sorted by total spend descending.

    Filtering precedence:
      - `start`/`end`  → filter df.date to that inclusive day range (preferred,
                          used for multi-month timeframes like 'Year to date')
      - `year_month`   → filter to that single month (back-compat)
      - none           → full dataset
    """
    df = load_data()
    if start or end:
        if start:
            df = df[df["date"] >= pd.Timestamp(start)]
        if end:
            # treat `end` as inclusive across the whole calendar day
            df = df[df["date"] <= pd.Timestamp(end) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)]
    elif year_month:
        df = df[df["year_month"] == year_month]

    all_total = round(float(df["amount"].sum()), 2)

    has_parent = df["parent_category"].notna() & (df["parent_category"] != "")
    parented = df[has_parent]
    orphans = df[~has_parent]

    nodes: list[dict] = []

    # Parent groups with their children.
    if not parented.empty:
        parent_totals = (
            parented.groupby("parent_category")["amount"].sum()
            .sort_values(ascending=False)
        )
        for parent_name, parent_total in parent_totals.items():
            children_totals = (
                parented[parented["parent_category"] == parent_name]
                .groupby("category_norm")["amount"].sum()
                .sort_values(ascending=False)
            )
            children = [
                {
                    "name": str(child_name),
                    "level": "leaf",
                    "total": round(float(child_total), 2),
                }
                for child_name, child_total in children_totals.items()
            ]
            nodes.append({
                "name": str(parent_name),
                "level": "parent",
                "total": round(float(parent_total), 2),
                "children": children,
            })

    # Orphan leaves (no parent group) — appear at the top level.
    if not orphans.empty:
        orphan_totals = (
            orphans.groupby("category_norm")["amount"].sum()
            .sort_values(ascending=False)
        )
        for leaf_name, leaf_total in orphan_totals.items():
            nodes.append({
                "name": str(leaf_name),
                "level": "leaf",
                "total": round(float(leaf_total), 2),
                "children": [],
            })

    # Re-sort the combined top level by total descending.
    nodes.sort(key=lambda n: n["total"], reverse=True)

    return {
        "month": year_month,
        "all_total": all_total,
        "nodes": nodes,
    }


# ── Overview: this-month snapshot ─────────────────────────────────────────────


def _ym_period(ym: str) -> pd.Period:
    return pd.Period(ym, freq="M")


def _days_in_month(ym: str) -> int:
    return _ym_period(ym).end_time.day


def _shift_month(ym: str, n: int) -> str:
    """Returns ym shifted back by n months. _shift_month('2026-05', 1) → '2026-04'."""
    return str(_ym_period(ym) - n)


def _spent_in_month(df: pd.DataFrame, ym: str, through_day: Optional[int] = None) -> float:
    sub = df[df["year_month"] == ym]
    if through_day is not None:
        sub = sub[sub["date"].dt.day <= through_day]
    return float(sub["amount"].sum())


def _cumulative_by_day(df: pd.DataFrame, ym: str, through_day: int) -> list[dict]:
    sub = df[(df["year_month"] == ym) & (df["date"].dt.day <= through_day)]
    daily = sub.groupby(sub["date"].dt.day)["amount"].sum()
    rows: list[dict] = []
    running = 0.0
    for d in range(1, through_day + 1):
        running += float(daily.get(d, 0.0))
        rows.append({"day": d, "total": round(running, 2)})
    return rows


def get_overview_snapshot(month: Optional[str] = None) -> dict:
    """Snapshot for the Overview tab — primary stat, comparisons, cumulative chart data.

    If `month` is None or matches today's calendar month, the active month is
    today's; if that month has no data, falls back to the latest month with data
    (signaled by `is_fallback=True`). Otherwise honors the explicit month even
    if empty.
    """
    df = load_data()
    months_with_data = sorted(df["year_month"].dropna().unique().tolist())

    today = pd.Timestamp.now().normalize()
    today_ym = f"{today.year}-{today.month:02d}"
    requested_month = month or today_ym

    is_fallback = False
    if requested_month in months_with_data:
        active_month = requested_month
    elif requested_month == today_ym and months_with_data:
        active_month = months_with_data[-1]
        is_fallback = True
    else:
        active_month = requested_month

    # No data anywhere — return skeleton with the requested month echoed back
    if not months_with_data:
        return {
            "month": active_month,
            "requested_month": requested_month,
            "is_fallback": False,
            "through_day": None,
            "is_partial": False,
            "this_month_total": 0.0,
            "last_month_mtd": None,
            "last_month_total": None,
            "three_month_avg": None,
            "three_month_avg_mtd": None,
            "last_month_3mo_avg": None,
            "this_cumulative": [],
            "last_cumulative": [],
        }

    days_in_active = _days_in_month(active_month)
    if active_month == today_ym:
        through_day = min(int(today.day), days_in_active)
        is_partial = int(today.day) < days_in_active
    else:
        through_day = days_in_active
        is_partial = False

    active_total_mtd = _spent_in_month(df, active_month, through_day)

    # Last month — comparisons
    last_month = _shift_month(active_month, 1)
    has_last = last_month in months_with_data
    last_days = _days_in_month(last_month)
    last_through = min(through_day, last_days)

    last_month_mtd   = _spent_in_month(df, last_month, last_through) if has_last else None
    last_month_total = _spent_in_month(df, last_month)               if has_last else None

    # Trailing 3 full months (months m-3, m-2, m-1) — full and MTD-prorated averages.
    prior_months = [_shift_month(active_month, n) for n in (1, 2, 3)]
    priors_with_data = [m for m in prior_months if m in months_with_data]

    three_month_avg = None
    three_month_avg_mtd = None
    if len(priors_with_data) == 3:
        full_totals = [_spent_in_month(df, m) for m in priors_with_data]
        three_month_avg = round(sum(full_totals) / 3, 2)
        mtd_totals = [
            _spent_in_month(df, m, min(through_day, _days_in_month(m)))
            for m in priors_with_data
        ]
        three_month_avg_mtd = round(sum(mtd_totals) / 3, 2)

    # Last month's own 3-month avg — months m-4, m-3, m-2 (the 3 months before last month).
    last_priors = [_shift_month(active_month, n) for n in (2, 3, 4)]
    last_priors_with_data = [m for m in last_priors if m in months_with_data]
    last_month_3mo_avg = None
    if len(last_priors_with_data) == 3:
        totals = [_spent_in_month(df, m) for m in last_priors_with_data]
        last_month_3mo_avg = round(sum(totals) / 3, 2)

    # Cumulative arrays for the line chart
    this_cumulative = _cumulative_by_day(df, active_month, through_day)
    last_cumulative = _cumulative_by_day(df, last_month, last_days) if has_last else []

    return {
        "month":               active_month,
        "requested_month":     requested_month,
        "is_fallback":         is_fallback,
        "through_day":         through_day,
        "is_partial":          is_partial,
        "this_month_total":    round(active_total_mtd, 2),
        "last_month_mtd":      round(last_month_mtd, 2)   if last_month_mtd   is not None else None,
        "last_month_total":    round(last_month_total, 2) if last_month_total is not None else None,
        "three_month_avg":     three_month_avg,
        "three_month_avg_mtd": three_month_avg_mtd,
        "last_month_3mo_avg":  last_month_3mo_avg,
        "this_cumulative":     this_cumulative,
        "last_cumulative":     last_cumulative,
    }


# ── Overview: monthly income vs. spending bars ────────────────────────────────

_BUDGET_TOP_N = 4  # top categories shown explicitly; remainder rolls into "Other"


def get_overview_budget_months() -> list[str]:
    """Distinct months with income or spending activity, descending (latest first)."""
    df = load_full_data()
    months = df["year_month"].dropna().unique().tolist()
    return sorted(months, reverse=True)


def get_overview_budget_data(month: Optional[str] = None) -> dict:
    df = load_full_data()
    months_desc = get_overview_budget_months()
    if not months_desc:
        return {"month": None, "income": {"total": 0, "items": []}, "spending": {"total": 0, "items": []}}

    if not month or month not in months_desc:
        month = months_desc[0]

    sub = df[df["year_month"] == month]

    # Income: each row is its own segment, by `name`. Status: received unless planned.
    inc_rows = sub[sub["type_norm"] == "income"]
    income_items = []
    for _, row in inc_rows.iterrows():
        amt = float(row["pos_amount"]) if pd.notna(row["pos_amount"]) else 0.0
        if amt <= 0:
            continue
        income_items.append({
            "name": (row.get("name") or "").strip() or "Income",
            "amount": round(amt, 2),
            "status": "planned" if row["status_norm"] == "planned" else "received",
        })
    income_items.sort(key=lambda x: x["amount"], reverse=True)
    income_total = round(sum(i["amount"] for i in income_items), 2)

    # Spending paid: regular rows with positive amount, status != planned, grouped by category.
    paid_rows = sub[
        (sub["type_norm"] == "regular")
        & (sub["status_norm"] != "planned")
        & (sub["amount"] > 0)
    ]
    paid_by_cat = (
        paid_rows.groupby("category_norm")["amount"]
        .sum()
        .sort_values(ascending=False)
    )
    spending_items: list[dict] = []
    if not paid_by_cat.empty:
        top = paid_by_cat.head(_BUDGET_TOP_N)
        rest_total = float(paid_by_cat.iloc[_BUDGET_TOP_N:].sum())
        for cat, total in top.items():
            spending_items.append({
                "name": cat,
                "amount": round(float(total), 2),
                "status": "paid",
            })
        if rest_total > 0:
            spending_items.append({
                "name": "Other",
                "amount": round(rest_total, 2),
                "status": "paid",
            })

    # Spending planned: each row is its own segment by `name`.
    planned_rows = sub[
        (sub["type_norm"] == "regular")
        & (sub["status_norm"] == "planned")
        & (sub["amount"] > 0)
    ]
    for _, row in planned_rows.iterrows():
        amt = float(row["amount"]) if pd.notna(row["amount"]) else 0.0
        if amt <= 0:
            continue
        spending_items.append({
            "name": (row.get("name") or "").strip() or (row.get("category_norm") or "Planned"),
            "amount": round(amt, 2),
            "status": "planned",
        })

    spending_total = round(sum(i["amount"] for i in spending_items), 2)

    return {
        "month": month,
        "income":   {"total": income_total,   "items": income_items},
        "spending": {"total": spending_total, "items": spending_items},
    }
