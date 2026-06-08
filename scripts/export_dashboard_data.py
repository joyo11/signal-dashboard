"""
Bridge the Python analysis pipeline to the web dashboard.

Runs the real flow (generate -> clean -> anomaly z-scoring) and emits a
compact RAW hourly dataset into `data.js`. The dashboard then computes
everything it shows (KPIs, the priority ranking, the charts, and the alert
feed) from that raw data, live, against the current filter state. That is
what makes the sidebar filters real: the date window, day-of-week mask,
and sigma threshold all re-slice and re-score the same rows in the browser,
using the same scoring rules as src/analysis.py and src/model.py.

What we precompute in Python (because it is data, not view):
  - the raw hourly metrics for every signal, and
  - each hour's z-score vs that signal's own (weekday/weekend, hour)
    baseline over the period (model.build_baseline / model.score).

Window: 14 days of hourly data ending Thu Jun 4 2026 (matches the design).
The dashboard's 3d/7d/14d control selects how much of it to view.

Run:  .venv/bin/python scripts/export_dashboard_data.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import analysis  # noqa: E402  (used for a sanity check only)
import clean_data  # noqa: E402
import model  # noqa: E402
from generate_sample_data import generate  # noqa: E402

WINDOW_END = pd.Timestamp("2026-06-05")  # generate() backs off 1h -> last ts Jun 4 23:00
TOTAL_DAYS = 14

# The four "featured" signals are charted with a curated palette; the rest
# use a neutral ink so they still read in the alert charts.
FEATURED_IDS = ["SIG-1001", "SIG-1002", "SIG-1003", "SIG-1004"]
SERIES = {
    "SIG-1001": "#2D5F8A",
    "SIG-1002": "#1F6E43",
    "SIG-1003": "#C0392B",
    "SIG-1004": "#8E6E2F",
}
NEUTRAL_HEX = "#8A867C"
SERIES_VAR = {
    "SIG-1001": "var(--s-1001)",
    "SIG-1002": "var(--s-1002)",
    "SIG-1003": "var(--s-1003)",
    "SIG-1004": "var(--s-1004)",
}
WEIGHTS = {"sf": 0.55, "aor": 0.30, "ped": 0.15}  # mirrors analysis.priority_table
PM_PEAK = [16, 17, 18, 19]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def jdate(ts: pd.Timestamp) -> str:
    return f"new Date({ts.year},{ts.month - 1},{ts.day},{ts.hour},{ts.minute})"


def jstr(s: str) -> str:
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> None:
    # 1) generate the canonical 14-day dataset + write the CSV
    raw = generate(days=TOTAL_DAYS, seed=42, end_date=WINDOW_END)
    csv_path = ROOT / "data" / "raw" / "atspm_sample.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    raw.to_csv(csv_path, index=False)

    # 2) clean + z-score every hour against its (weekday/weekend, hour) baseline.
    #    Build the baseline from HISTORY only (everything before the last 3 days)
    #    so an anomaly can't contaminate its own baseline — the train/score split
    #    from model.py. Recent hours then score strongly; older hours score ~0.
    df = clean_data.load(csv_path)
    history, _recent = model.split_history_recent(df, recent_days=3)
    baseline = model.build_baseline(history)
    scored = model.score(df, baseline)

    # signal + day indices
    sig_ids = list(dict.fromkeys(df["intersection_id"]))
    sig_ids = FEATURED_IDS + [s for s in sig_ids if s not in FEATURED_IDS]
    sidx = {sid: i for i, sid in enumerate(sig_ids)}
    names = {sid: df.loc[df["intersection_id"] == sid, "intersection_name"].iloc[0] for sid in sig_ids}

    day_list = [pd.Timestamp(d) for d in sorted(df["timestamp"].dt.normalize().unique())]
    didx = {d.date(): i for i, d in enumerate(day_list)}

    # 3) emit raw rows
    rows = []
    for _, r in scored.iterrows():
        ts = r["timestamp"]
        rows.append(
            "{s:%d,d:%d,h:%d,vol:%.1f,aor:%.1f,sf:%d,ped:%.1f,vz:%.2f,az:%.2f,sz:%.2f}"
            % (
                sidx[r["intersection_id"]],
                didx[ts.date()],
                int(r["hour"]),
                float(r["volume_vph"]),
                float(r["arrivals_on_red_pct"]),
                int(r["split_failures"]),
                float(r["ped_delay_avg_sec"]),
                float(r["volume_vph_z"]),
                float(r["arrivals_on_red_pct_z"]),
                float(r["split_failures_z"]),
            )
        )

    signals_js = ",\n".join(
        "  { id: %s, name: %s, hex: %s, featured: %s }"
        % (
            jstr(sid),
            jstr(names[sid]),
            jstr(SERIES.get(sid, NEUTRAL_HEX)),
            "true" if sid in FEATURED_IDS else "false",
        )
        for sid in sig_ids
    )
    featured_js = ",\n".join(
        "  { id: %s, name: %s, color: %s, hex: %s }"
        % (jstr(sid), jstr(names[sid]), jstr(SERIES_VAR[sid]), jstr(SERIES[sid]))
        for sid in FEATURED_IDS
    )

    L = [
        "/* ============================================================",
        "   Signal Performance Dashboard — REAL pipeline output (raw)",
        "   AUTO-GENERATED by scripts/export_dashboard_data.py — do not edit by hand.",
        "   Raw hourly metrics + per-hour z-scores for all signals over 14 days.",
        "   The dashboard computes KPIs, priority, charts, and alerts from this",
        "   live, against the active filters (window / days / sigma).",
        "   ============================================================ */",
        "",
        "const DATA = {",
        "  featured: [",
        featured_js,
        "  ],",
        "  signals: [",
        signals_js,
        "  ],",
        "  dayList: [" + ", ".join(jdate(d) for d in day_list) + "],",
        "  weights: " + json.dumps(WEIGHTS) + ",",
        "  pmPeak: " + json.dumps(PM_PEAK) + ",",
        "  raw: [",
        ",\n".join("    " + r for r in rows),
        "  ],",
        "};",
        "",
        "window.DATA = DATA;",
        "window.FMT = { DOW: %s, MON: %s };" % (json.dumps(DOW), json.dumps(MON)),
        "",
    ]
    out = ROOT / "data.js"
    out.write_text("\n".join(L))

    # 4) sanity check against the Python priority ranking (default 7d window)
    cutoff = df["timestamp"].max() - pd.Timedelta(days=7)
    p = analysis.priority_table(df[df["timestamp"] > cutoff])
    top = p.iloc[0]
    print(f"wrote {out}  ({out.stat().st_size:,} bytes, {len(rows):,} raw rows)")
    print(f"  signals: {len(sig_ids)}  days: {len(day_list)}")
    print(f"  python top (7d): {top['intersection_id']} score {top['score']:.1f} ({top['priority']})")
    print("  -> verify the dashboard's default Priority tab matches this")


if __name__ == "__main__":
    main()
