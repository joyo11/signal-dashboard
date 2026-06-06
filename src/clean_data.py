"""
Load + clean ATSPM-style hourly performance exports.

Real UDOT exports come per-chart per-signal as separate CSVs. The
production flow would consolidate them into the same long-format schema
this loader expects, so swapping in real data later means dropping new
CSVs into data/raw/ and pointing `load()` at them.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REQUIRED_COLS = [
    "intersection_id",
    "intersection_name",
    "timestamp",
    "volume_vph",
    "arrivals_on_red_pct",
    "split_failures",
    "ped_delay_avg_sec",
]


def load(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["intersection_id", "timestamp"]).reset_index(drop=True)

    # Derived fields the dashboard reuses
    df["date"] = df["timestamp"].dt.date
    df["hour"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.day_name()
    df["is_weekend"] = df["timestamp"].dt.dayofweek >= 5
    df["hour_of_week"] = df["timestamp"].dt.dayofweek * 24 + df["hour"]

    return df


def summarize_coverage(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby(["intersection_id", "intersection_name"])
        .agg(
            rows=("timestamp", "size"),
            start=("timestamp", "min"),
            end=("timestamp", "max"),
        )
        .reset_index()
    )
