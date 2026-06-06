"""
Predictive / alerting layer: detect when an intersection is behaving
abnormally compared to its own historical pattern at the same time of
week.

Chose anomaly detection over a predictive classifier because:
- It mirrors how production ATSPM platforms actually flag issues
  (e.g. detector failures show up as "this signal's volume just dropped
  to zero against its own baseline").
- It's fully explainable to a non-technical operator: "this hour was
  N sigma off your normal Tuesday at 3pm."
- It works on small data, which is what an interview demo has.

Approach: for each (intersection_id, day_of_week, hour) bucket, compute
mean + std of each metric over a *historical* window, then z-score the
*recent* window against that baseline. Anything past `threshold` sigma
on volume drop or split-failure / arrivals-on-red spike is flagged.

Splitting baseline vs scored prevents anomalies from contaminating their
own baseline — the same train/test discipline you'd want in production.
"""

from __future__ import annotations

import pandas as pd

METRICS = ["volume_vph", "arrivals_on_red_pct", "split_failures"]


def split_history_recent(df: pd.DataFrame, recent_days: int = 3) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Last `recent_days` days = scored window; everything before = baseline."""
    cutoff = df["timestamp"].max() - pd.Timedelta(days=recent_days)
    history = df[df["timestamp"] <= cutoff]
    recent = df[df["timestamp"] > cutoff]
    return history, recent


def build_baseline(df: pd.DataFrame) -> pd.DataFrame:
    grouped = df.groupby(["intersection_id", "day_of_week", "hour"])
    agg = grouped[METRICS].agg(["mean", "std"]).reset_index()
    agg.columns = [
        "_".join(c).rstrip("_") for c in agg.columns.to_flat_index()
    ]
    for m in METRICS:
        std_col = f"{m}_std"
        # Tighten the floor so small absolute deviations on low-volume
        # buckets don't get z-scores in the hundreds. Each metric gets a
        # minimum std that reflects realistic sensor noise.
        floor = {"volume_vph": 20.0, "arrivals_on_red_pct": 3.0, "split_failures": 0.5}[m]
        agg[std_col] = agg[std_col].fillna(floor).clip(lower=floor)
    return agg


def score(df: pd.DataFrame, baseline: pd.DataFrame) -> pd.DataFrame:
    merged = df.merge(
        baseline,
        on=["intersection_id", "day_of_week", "hour"],
        how="left",
    )
    for m in METRICS:
        merged[f"{m}_z"] = (
            merged[m] - merged[f"{m}_mean"]
        ) / merged[f"{m}_std"]
    return merged


def alerts(scored: pd.DataFrame, threshold: float = 2.5) -> pd.DataFrame:
    flagged = scored[
        (scored["volume_vph_z"] < -threshold)
        | (scored["arrivals_on_red_pct_z"] > threshold)
        | (scored["split_failures_z"] > threshold)
    ].copy()

    def reason(row: pd.Series) -> str:
        bits: list[str] = []
        if row["volume_vph_z"] < -threshold:
            bits.append(
                f"volume {row['volume_vph']:.0f} vph "
                f"({row['volume_vph_z']:+.1f}σ — possible detector fault)"
            )
        if row["arrivals_on_red_pct_z"] > threshold:
            bits.append(
                f"arrivals-on-red {row['arrivals_on_red_pct']:.0f}% "
                f"({row['arrivals_on_red_pct_z']:+.1f}σ)"
            )
        if row["split_failures_z"] > threshold:
            bits.append(
                f"{int(row['split_failures'])} split failures "
                f"({row['split_failures_z']:+.1f}σ)"
            )
        return "; ".join(bits)

    flagged["reason"] = flagged.apply(reason, axis=1)
    flagged["severity"] = flagged[
        ["volume_vph_z", "arrivals_on_red_pct_z", "split_failures_z"]
    ].abs().max(axis=1)

    out = flagged[
        [
            "timestamp",
            "intersection_id",
            "intersection_name",
            "volume_vph",
            "arrivals_on_red_pct",
            "split_failures",
            "severity",
            "reason",
        ]
    ].sort_values("severity", ascending=False)
    return out.reset_index(drop=True)
