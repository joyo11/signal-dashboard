"""
Diagnostic layer: rank intersections by how badly they need operator
attention.

The composite score is intentionally simple and explainable, because
that's how the AMC actually triages retiming work: a signal with many
split failures and bad progression deserves to move up the queue, and
the operator needs to be able to defend the ordering.

  score = 0.55 * normalized_pm_split_failures
        + 0.30 * normalized_arrivals_on_red
        + 0.15 * normalized_ped_delay

The weights weight split failures highest because they're the strongest
signal of oversaturation, then progression, then pedestrian experience.
"""

from __future__ import annotations

import pandas as pd

PM_PEAK_HOURS = range(16, 20)


def _norm(series: pd.Series) -> pd.Series:
    s_min, s_max = series.min(), series.max()
    if s_max == s_min:
        return pd.Series(0.0, index=series.index)
    return (series - s_min) / (s_max - s_min)


def priority_table(df: pd.DataFrame) -> pd.DataFrame:
    weekday = df[~df["is_weekend"]].copy()
    pm = weekday[weekday["hour"].isin(PM_PEAK_HOURS)]

    pm_sf = (
        pm.groupby(["intersection_id", "intersection_name"])["split_failures"]
        .sum()
        .rename("pm_split_failures_total")
    )
    aor = (
        weekday.groupby(["intersection_id", "intersection_name"])[
            "arrivals_on_red_pct"
        ]
        .mean()
        .rename("avg_arrivals_on_red_pct")
    )
    ped = (
        weekday.groupby(["intersection_id", "intersection_name"])[
            "ped_delay_avg_sec"
        ]
        .mean()
        .rename("avg_ped_delay_sec")
    )
    vol = (
        weekday.groupby(["intersection_id", "intersection_name"])["volume_vph"]
        .mean()
        .rename("avg_volume_vph")
    )

    table = pd.concat([pm_sf, aor, ped, vol], axis=1).reset_index()

    table["score"] = (
        0.55 * _norm(table["pm_split_failures_total"])
        + 0.30 * _norm(table["avg_arrivals_on_red_pct"])
        + 0.15 * _norm(table["avg_ped_delay_sec"])
    ) * 100

    table = table.sort_values("score", ascending=False).reset_index(drop=True)
    table.insert(0, "rank", range(1, len(table) + 1))

    def tier(score: float) -> str:
        if score >= 70:
            return "High"
        if score >= 40:
            return "Medium"
        return "Low"

    table["priority"] = table["score"].apply(tier)
    return table


def headline_insight(df: pd.DataFrame, priority: pd.DataFrame) -> str:
    """One sentence summarizing the worst offender. Use this above the
    priority table in the dashboard so the story lands immediately."""
    if priority.empty:
        return "No data."
    worst = priority.iloc[0]
    pm = df[
        (df["intersection_id"] == worst["intersection_id"])
        & (~df["is_weekend"])
        & (df["hour"].isin(PM_PEAK_HOURS))
    ]
    if pm.empty:
        return f"{worst['intersection_name']} ranks highest for attention."
    worst_hour = pm.groupby("hour")["split_failures"].sum().idxmax()
    return (
        f"{worst['intersection_name']} is the top retiming candidate: "
        f"{int(worst['pm_split_failures_total'])} PM-peak split failures over the window, "
        f"concentrated around {worst_hour}:00 weekdays."
    )
