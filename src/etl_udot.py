"""
ETL adapter: real UDOT Open ATSPM exports -> the pipeline's unified schema.

UDOT's Aggregate Data Export (udottraffic.utah.gov/ATSPM/AggregateDataExport)
gives you ONE metric per file. Export the four we use, each with
Bin Size = Hour, X-Axis = Time, Series Type = Signal, over the SAME signals and
date range, and drop them in data/raw/udot/. This merges them into one
hourly CSV that clean_data.load() already understands, so the whole dashboard
(priority scoring, anomaly detection, charts) then runs on real Utah signals.

See EXPORT_GUIDE.md for the exact portal clicks.

Usage:
    .venv/bin/python src/etl_udot.py                 # reads data/raw/udot/, writes data/raw/atspm_real.csv
    .venv/bin/python src/etl_udot.py --make-sample   # write a labeled UDOT-shaped sample to test the path
Then:
    .venv/bin/python scripts/export_dashboard_data.py --source real
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
UDOT_DIR = ROOT / "data" / "raw" / "udot"
OUT_CSV = ROOT / "data" / "raw" / "atspm_real.csv"

# Map each of our metrics to (a) filename keywords and (b) the output column.
# A file is matched to a metric if its name contains any of the keywords.
METRICS = {
    "split_failures": {
        "out": "split_failures",
        "keywords": ["split", "sf", "splitfail"],
        "kind": "int",
    },
    "volume_vph": {
        "out": "volume_vph",
        "keywords": ["volume", "vol", "approachvolume", "count"],
        "kind": "float",
    },
    "arrivals_on_red_pct": {
        "out": "arrivals_on_red_pct",
        "keywords": ["arrivalsonred", "arrivals_on_red", "arrivalsred", "aor", "arrivals", "red"],
        "kind": "pct",
    },
    "ped_delay_avg_sec": {
        "out": "ped_delay_avg_sec",
        "keywords": ["peddelay", "ped_delay", "pedestrian", "ped"],
        "kind": "float",
    },
}

# Column-name hints for auto-detection (lowercased, non-alnum stripped).
TIME_HINTS = ["timestamp", "time", "datetime", "date", "bin", "binstart", "hour", "starttime"]
SIGNAL_HINTS = ["signal", "signalid", "locationid", "intersection", "deviceid", "location"]
VALUE_HINTS = ["value", "total", "sum", "average", "avg", "count", "result", "y", "metric"]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def classify_file(path: Path) -> str | None:
    """Return our metric key for a file, by filename keywords."""
    n = _norm(path.stem)
    # check the more specific metrics first (ped/split before generic 'red'/'vol')
    order = ["ped_delay_avg_sec", "split_failures", "arrivals_on_red_pct", "volume_vph"]
    for metric in order:
        for kw in METRICS[metric]["keywords"]:
            if _norm(kw) in n:
                return metric
    return None


def _find(cols: list[str], hints: list[str]) -> str | None:
    norm = {c: _norm(c) for c in cols}
    # exact-ish: a hint fully contained in the normalized column name
    for hint in hints:
        for c, nc in norm.items():
            if hint in nc:
                return c
    return None


def to_long(df: pd.DataFrame, metric: str) -> pd.DataFrame:
    """Coerce one UDOT export (wide time x signal, or long) into
    rows of (intersection_id, timestamp, <value>)."""
    cols = list(df.columns)
    tcol = _find(cols, TIME_HINTS)
    if tcol is None:
        # fall back to the first column if it parses as datetime
        first = cols[0]
        if pd.to_datetime(df[first], errors="coerce").notna().mean() > 0.5:
            tcol = first
    if tcol is None:
        raise ValueError(f"{metric}: could not find a timestamp column in {cols}")

    scol = _find([c for c in cols if c != tcol], SIGNAL_HINTS)
    vcol = _find([c for c in cols if c not in (tcol, scol)], VALUE_HINTS)

    out_name = METRICS[metric]["out"]

    if scol and vcol:
        # already long: timestamp, signal, value
        long = df[[tcol, scol, vcol]].copy()
        long.columns = ["timestamp", "intersection_id", out_name]
    else:
        # wide: timestamp + one column per signal -> melt
        value_cols = [c for c in cols if c != tcol]
        long = df.melt(id_vars=[tcol], value_vars=value_cols,
                       var_name="intersection_id", value_name=out_name)
        long = long.rename(columns={tcol: "timestamp"})

    long["timestamp"] = pd.to_datetime(long["timestamp"], errors="coerce")
    long[out_name] = pd.to_numeric(long[out_name], errors="coerce")
    long["intersection_id"] = long["intersection_id"].astype(str).str.strip()
    long = long.dropna(subset=["timestamp", "intersection_id"])
    # hourly grain: floor to the hour and aggregate (sum counts, mean rates)
    long["timestamp"] = long["timestamp"].dt.floor("h")
    agg = "mean" if METRICS[metric]["kind"] == "pct" else ("sum" if out_name in ("split_failures", "volume_vph") else "mean")
    long = long.groupby(["intersection_id", "timestamp"], as_index=False)[out_name].agg(agg)
    return long


def merge(udot_dir: Path = UDOT_DIR) -> pd.DataFrame:
    files = sorted([p for p in udot_dir.glob("*.csv")])
    if not files:
        raise SystemExit(
            f"No CSVs in {udot_dir}. Export the 4 metrics from UDOT (see EXPORT_GUIDE.md) "
            f"and drop them here, or run with --make-sample to test the path."
        )
    found: dict[str, pd.DataFrame] = {}
    for p in files:
        metric = classify_file(p)
        if not metric:
            print(f"  ? skip (unrecognized name): {p.name}")
            continue
        df = pd.read_csv(p)
        found[metric] = to_long(df, metric)
        print(f"  ✓ {p.name}  ->  {metric}  ({len(found[metric]):,} signal-hours)")

    if "split_failures" not in found and "arrivals_on_red_pct" not in found:
        raise SystemExit("Need at least Split Failures or Arrivals-on-Red to build a useful dataset.")

    # outer-merge all metrics on (signal, hour)
    base = None
    for metric, long in found.items():
        base = long if base is None else base.merge(long, on=["intersection_id", "timestamp"], how="outer")

    # fill missing metric columns so the schema is complete
    for metric in METRICS:
        out = METRICS[metric]["out"]
        if out not in base.columns:
            base[out] = 0.0
            print(f"  (note: {out} not provided; filled with 0)")
    base = base.fillna({"split_failures": 0, "volume_vph": 0.0,
                        "arrivals_on_red_pct": 0.0, "ped_delay_avg_sec": 0.0})

    base["split_failures"] = base["split_failures"].round().astype(int)
    base["volume_vph"] = base["volume_vph"].round(1)
    base["arrivals_on_red_pct"] = base["arrivals_on_red_pct"].round(2)
    base["ped_delay_avg_sec"] = base["ped_delay_avg_sec"].round(1)
    base["intersection_name"] = base["intersection_id"]   # portal often exports IDs; rename map optional
    base["corridor"] = "UDOT"

    base = base.sort_values(["intersection_id", "timestamp"]).reset_index(drop=True)
    return base[["intersection_id", "intersection_name", "corridor", "timestamp",
                 "volume_vph", "arrivals_on_red_pct", "split_failures", "ped_delay_avg_sec"]]


def make_sample(udot_dir: Path = UDOT_DIR) -> None:
    """Write 4 labeled UDOT-shaped CSVs (wide: timestamp x signal) so the
    ETL path is testable without a manual export. Clearly synthetic."""
    import numpy as np

    udot_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    sigs = ["7115", "7116", "7117", "7118", "7119"]
    end = pd.Timestamp("2026-06-04 23:00")
    ts = pd.date_range(end - pd.Timedelta(days=7) + pd.Timedelta(hours=1), end, freq="h")

    def shape(h):
        am = np.exp(-((h - 8) ** 2) / 6); pm = np.exp(-((h - 17) ** 2) / 7)
        return 0.3 + 0.5 * am + 0.9 * pm

    specs = {
        "split_failures.csv": lambda h, s: int(max(0, rng.poisson(6 if (s == "7117" and 16 <= h <= 19) else 0.4 * shape(h)))),
        "approach_volume.csv": lambda h, s: round(1500 * shape(h) * rng.normal(1, 0.05), 1),
        "arrivals_on_red.csv": lambda h, s: round(min(85, 30 + 30 * shape(h) + rng.normal(0, 3)), 1),
        "ped_delay.csv": lambda h, s: round(20 + 25 * shape(h) + rng.normal(0, 4), 1),
    }
    for fname, fn in specs.items():
        data = {"Timestamp": ts}
        for s in sigs:
            data[s] = [fn(t.hour, s) for t in ts]
        pd.DataFrame(data).to_csv(udot_dir / fname, index=False)
        print(f"  wrote sample {fname}")
    print(f"Sample UDOT-shaped exports in {udot_dir}. Now run: python src/etl_udot.py")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--make-sample", action="store_true", help="write labeled UDOT-shaped sample CSVs to data/raw/udot/")
    ap.add_argument("--dir", type=Path, default=UDOT_DIR)
    ap.add_argument("--out", type=Path, default=OUT_CSV)
    args = ap.parse_args()

    if args.make_sample:
        make_sample(args.dir)
        return

    print(f"Merging UDOT exports from {args.dir} ...")
    df = merge(args.dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    n_sig = df["intersection_id"].nunique()
    print(f"\nwrote {args.out}  ({len(df):,} rows, {n_sig} signals, "
          f"{df['timestamp'].min()} -> {df['timestamp'].max()})")
    print("Next: python scripts/export_dashboard_data.py --source real")


if __name__ == "__main__":
    main()
