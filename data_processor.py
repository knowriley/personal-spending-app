import pandas as pd
from pathlib import Path
from typing import Optional

CSV_PATH = Path(__file__).parent / "transactions.csv"

_df: Optional[pd.DataFrame] = None


def load_data() -> pd.DataFrame:
    global _df
    if _df is None:
        raw = pd.read_csv(CSV_PATH, dtype=str)
        raw.columns = raw.columns.str.strip().str.strip('"')

        raw["amount"] = pd.to_numeric(raw["amount"], errors="coerce")
        raw["date"] = pd.to_datetime(raw["date"], errors="coerce")
        raw["excluded"] = raw["excluded"].str.lower().str.strip() == "true"

        # spending rows only
        df = raw[
            (~raw["excluded"])
            & (raw["type"].str.strip().str.lower() == "regular")
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


def get_monthly_totals() -> list[dict]:
    df = load_data()
    totals = (
        df.groupby("year_month")["amount"]
        .sum()
        .reset_index()
        .rename(columns={"year_month": "month", "amount": "total"})
        .sort_values("month")
    )
    totals["total"] = totals["total"].round(2)
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


def get_spending_trends(categories: Optional[list] = None) -> dict:
    df = load_data()
    if categories:
        df = df[df["category_norm"].isin(categories)]
    pivot = (
        df.groupby(["year_month", "category_norm"])["amount"]
        .sum()
        .reset_index()
        .rename(columns={"category_norm": "category", "amount": "total"})
        .sort_values("year_month")
    )
    pivot["total"] = pivot["total"].round(2)

    result: dict[str, list] = {}
    for _, row in pivot.iterrows():
        cat = row["category"]
        if cat not in result:
            result[cat] = []
        result[cat].append({"month": row["year_month"], "total": row["total"]})
    return result


def get_transactions(
    search: str = "",
    category: str = "",
    year_month: str = "",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    df = load_data()

    if search:
        df = df[df["name"].str.contains(search, case=False, na=False)]
    if category:
        df = df[df["category_norm"] == category]
    if year_month:
        df = df[df["year_month"] == year_month]

    total = len(df)
    df = df.sort_values("date", ascending=False)
    df = df.iloc[(page - 1) * per_page : page * per_page]

    rows = df[["date", "name", "category_norm", "amount", "account"]].copy()
    rows["day_of_week"] = rows["date"].dt.strftime("%A")  # e.g. "Monday"
    rows["date"] = rows["date"].dt.strftime("%Y-%m-%d")
    rows["amount"] = rows["amount"].round(2)
    rows = rows.rename(columns={"category_norm": "category"})

    return {"total": total, "page": page, "per_page": per_page, "rows": rows.to_dict(orient="records")}


def get_summary_stats() -> dict:
    df = load_data()
    months = sorted(df["year_month"].unique())

    if not months:
        return {}

    latest = months[-1]
    prev = months[-2] if len(months) >= 2 else None

    this_month = df[df["year_month"] == latest]["amount"].sum()
    last_month = df[df["year_month"] == prev]["amount"].sum() if prev else 0

    # rolling 3-month avg (last 3 complete months before current)
    recent_months = months[-4:-1] if len(months) >= 4 else months[:-1]
    if recent_months:
        avg = df[df["year_month"].isin(recent_months)]["amount"].sum() / len(recent_months)
    else:
        avg = this_month

    top_cat = (
        df[df["year_month"] == latest]
        .groupby("category_norm")["amount"]
        .sum()
        .idxmax()
        if not df[df["year_month"] == latest].empty
        else "—"
    )

    return {
        "this_month": round(this_month, 2),
        "last_month": round(last_month, 2),
        "three_month_avg": round(avg, 2),
        "top_category": top_cat,
        "current_month": latest,
        "date_range": {"start": months[0], "end": months[-1]},
    }


def get_radial_data(category: Optional[str] = None) -> dict:
    """Return monthly spending by calendar year for a radar chart.

    Returns {year_str: [jan, feb, ..., dec]} — 12 floats each, 0 where no data.
    """
    df = load_data()
    if category:
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


def get_categories_list() -> list[str]:
    df = load_data()
    return sorted(df["category_norm"].dropna().unique().tolist())


def get_months_list() -> list[str]:
    df = load_data()
    return sorted(df["year_month"].unique().tolist())
