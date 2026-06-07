"""
Generate a realistic ATSPM-style sample dataset.

Schema mirrors what UDOT Open ATSPM exports look like when aggregated to
hourly: one row per (intersection_id, timestamp), with the four signal
performance metrics the AMC cares about.

Patterns baked in (so EDA actually finds something):
- Weekday volume is bimodal (AM peak ~7-9, PM peak ~16-19)
- Weekend volume is flatter and lower
- Arrivals-on-red is higher when volume is high (worse progression under load)
- One intersection (SIG-1003) is intentionally PM-oversaturated: split
  failures spike weekdays 16-19. This is the "story" the dashboard should
  surface.
- One intersection (SIG-1004) is mostly healthy.
- A 36-hour window of detector "noise" injected on SIG-1002 so the
  anomaly detector has something real to flag.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# Real-ish SLC corridor names so it reads like a real export.
# `cap` = base hourly capacity (vph), `aor_base` = baseline arrivals-on-red
# fraction. The first four (State St) are the "featured" signals the
# dashboard charts. SIG-1003 is the chronic PM offender; SIG-1002 carries
# the injected detector fault.
INTERSECTIONS = [
    {"id": "SIG-1001", "name": "State St & 400 South",    "corridor": "State St",   "cap": 1800, "aor_base": 0.42},
    {"id": "SIG-1002", "name": "State St & 600 South",    "corridor": "State St",   "cap": 1700, "aor_base": 0.45},
    {"id": "SIG-1003", "name": "State St & 800 South",    "corridor": "State St",   "cap": 1900, "aor_base": 0.55},
    {"id": "SIG-1004", "name": "State St & 1000 South",   "corridor": "State St",   "cap": 1400, "aor_base": 0.30},
    {"id": "SIG-1005", "name": "200 West & 700 South",    "corridor": "200 West",   "cap": 1200, "aor_base": 0.38},
    {"id": "SIG-1006", "name": "300 West & 600 South",    "corridor": "300 West",   "cap": 1500, "aor_base": 0.40},
    {"id": "SIG-1007", "name": "400 South & 500 East",    "corridor": "400 South",  "cap": 1600, "aor_base": 0.41},
    {"id": "SIG-1008", "name": "500 East & 400 South",    "corridor": "500 East",   "cap": 1300, "aor_base": 0.36},
    {"id": "SIG-1009", "name": "700 East & 2100 South",   "corridor": "700 East",   "cap": 1700, "aor_base": 0.43},
    {"id": "SIG-1010", "name": "1100 East & 1700 South",  "corridor": "1100 East",  "cap": 1100, "aor_base": 0.33},
    {"id": "SIG-1011", "name": "900 East & 900 South",    "corridor": "900 East",   "cap": 1450, "aor_base": 0.39},
    {"id": "SIG-1012", "name": "University & 200 South",   "corridor": "University", "cap": 1550, "aor_base": 0.40},
]


def hourly_volume(hour: int, is_weekend: bool, base: float, rng: np.random.Generator) -> float:
    if is_weekend:
        weekend_shape = np.exp(-((hour - 13) ** 2) / 40)
        return float(base * 0.55 * weekend_shape * rng.normal(1.0, 0.08))
    am = np.exp(-((hour - 8) ** 2) / 4)
    pm = np.exp(-((hour - 17.5) ** 2) / 5)
    midday = 0.45 * np.exp(-((hour - 12.5) ** 2) / 30)
    night = 0.08 if 0 <= hour < 5 else 0.0
    shape = max(am, pm) + midday + night
    return float(base * shape * rng.normal(1.0, 0.06))


def make_row(
    sig: dict,
    ts: pd.Timestamp,
    rng: np.random.Generator,
) -> dict:
    is_weekend = ts.dayofweek >= 5
    hour = ts.hour
    base_capacity = sig["cap"]

    vol = max(0.0, hourly_volume(hour, is_weekend, base_capacity, rng))
    saturation = min(1.0, vol / base_capacity)

    aor_base = sig["aor_base"]
    arrivals_on_red_pct = float(
        np.clip(aor_base + 0.20 * saturation + rng.normal(0, 0.03), 0.05, 0.85)
    )

    if sig["id"] == "SIG-1003" and not is_weekend and 16 <= hour <= 19:
        sf_mean = 6.0
    elif saturation > 0.85:
        sf_mean = 2.0
    else:
        sf_mean = 0.15
    split_failures = int(rng.poisson(sf_mean))

    ped_delay = float(
        np.clip(20 + 25 * saturation + rng.normal(0, 4), 5, 120)
    )

    return {
        "intersection_id": sig["id"],
        "intersection_name": sig["name"],
        "corridor": sig["corridor"],
        "timestamp": ts,
        "hour": hour,
        "day_of_week": ts.day_name(),
        "is_weekend": is_weekend,
        "volume_vph": round(vol, 1),
        "arrivals_on_red_pct": round(arrivals_on_red_pct * 100, 2),
        "split_failures": split_failures,
        "ped_delay_avg_sec": round(ped_delay, 1),
    }


def generate(days: int, seed: int, end_date: pd.Timestamp | None = None) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    end = (end_date or pd.Timestamp.now().normalize()) - pd.Timedelta(hours=1)
    start = end - pd.Timedelta(days=days) + pd.Timedelta(hours=1)
    timestamps = pd.date_range(start=start, end=end, freq="h")

    rows: list[dict] = []
    for sig in INTERSECTIONS:
        for ts in timestamps:
            rows.append(make_row(sig, ts, rng))

    df = pd.DataFrame(rows)

    # Inject a 36-hour detector-fault window on SIG-1002 so the anomaly
    # detector has something to flag. Volume drops to ~10% of expected,
    # arrivals-on-red shoots up.
    fault_start = end - pd.Timedelta(days=3)
    fault_end = fault_start + pd.Timedelta(hours=36)
    mask = (
        (df["intersection_id"] == "SIG-1002")
        & (df["timestamp"] >= fault_start)
        & (df["timestamp"] < fault_end)
    )
    df.loc[mask, "volume_vph"] = (df.loc[mask, "volume_vph"] * 0.1).round(1)
    df.loc[mask, "arrivals_on_red_pct"] = (
        df.loc[mask, "arrivals_on_red_pct"] + 25
    ).clip(upper=90)

    return df.sort_values(["intersection_id", "timestamp"]).reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "raw" / "atspm_sample.csv",
    )
    args = parser.parse_args()

    df = generate(days=args.days, seed=args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"wrote {len(df):,} rows -> {args.out}")
    print(df.head())


if __name__ == "__main__":
    main()
