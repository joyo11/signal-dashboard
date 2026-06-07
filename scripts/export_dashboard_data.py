"""
Bridge the Python analysis pipeline to the web dashboard.

Runs the real flow — generate -> clean -> priority scoring -> anomaly
detection — then serializes the results into `data.js`, the file the
static dashboard (index.html) reads. Every number rendered in the browser
therefore comes from the same pipeline that backs the Streamlit view, not
from hand-authored fixtures.

Window model:
  - 14 days of hourly data, ending Thu Jun 4 2026 (matches the design).
  - The last 7 days (May 29 - Jun 4) are the displayed window: charts,
    KPIs, priority table, heatmap.
  - The 7 days before that are the comparison window for KPI deltas.
  - Anomaly baseline = everything older than the last 3 days; the last
    3 days are scored against it (the same train/score split as model.py).

Run:  .venv/bin/python scripts/export_dashboard_data.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import analysis  # noqa: E402
import clean_data  # noqa: E402
import model  # noqa: E402
from generate_sample_data import generate  # noqa: E402

WINDOW_END = pd.Timestamp("2026-06-05")  # generate() backs off 1h -> last ts Jun 4 23:00
DISPLAY_DAYS = 7
ALERT_THRESHOLD = 2.5

FEATURED_IDS = ["SIG-1001", "SIG-1002", "SIG-1003", "SIG-1004"]
SERIES = {
    "SIG-1001": {"var": "var(--s-1001)", "hex": "#2D5F8A"},
    "SIG-1002": {"var": "var(--s-1002)", "hex": "#1F6E43"},
    "SIG-1003": {"var": "var(--s-1003)", "hex": "#C0392B"},
    "SIG-1004": {"var": "var(--s-1004)", "hex": "#8E6E2F"},
}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


# ---------- JS serialization helpers ----------
def jdate(ts: pd.Timestamp) -> str:
    return f"new Date({ts.year},{ts.month - 1},{ts.day},{ts.hour},{ts.minute})"


def jbool(b) -> str:
    return "true" if bool(b) else "false"


def jstr(s: str) -> str:
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


# ---------- derivations ----------
def name_of(df: pd.DataFrame, sig_id: str) -> str:
    return df.loc[df["intersection_id"] == sig_id, "intersection_name"].iloc[0]


def build_featured(window_df: pd.DataFrame) -> list[dict]:
    out = []
    for sid in FEATURED_IDS:
        out.append(
            {
                "id": sid,
                "name": name_of(window_df, sid),
                "color": SERIES[sid]["var"],
                "hex": SERIES[sid]["hex"],
            }
        )
    return out


def build_priority(window_df: pd.DataFrame) -> list[dict]:
    p = analysis.priority_table(window_df)
    rows = []
    for _, r in p.iterrows():
        rows.append(
            {
                "rank": int(r["rank"]),
                "id": r["intersection_id"],
                "name": r["intersection_name"],
                "pmsf": int(r["pm_split_failures_total"]),
                "aor": round(float(r["avg_arrivals_on_red_pct"]), 1),
                "ped": round(float(r["avg_ped_delay_sec"]), 1),
                "vol": int(round(float(r["avg_volume_vph"]))),
                "score": round(float(r["score"]), 1),
                "pri": r["priority"],
            }
        )
    return rows


def _delta_str(now: float, prev: float, *, pct: bool, unit: str = "") -> tuple[str, str]:
    if prev == 0:
        return "no prior data", "flat"
    if pct:
        change = (now - prev) / prev * 100
        arrow = "↑" if change >= 0 else "↓"
        return f"{arrow} {abs(change):.1f}% vs prior 7d", ("up" if change >= 0 else "down")
    change = now - prev
    arrow = "↑" if change >= 0 else "↓"
    return f"{arrow} {abs(change):.1f}{unit}", ("up" if change >= 0 else "down")


def build_kpis(window_df: pd.DataFrame, prior_df: pd.DataFrame, priority: list[dict]) -> list[dict]:
    # Total volume
    vol_now, vol_prev = window_df["volume_vph"].sum(), prior_df["volume_vph"].sum()
    vol_delta, _ = _delta_str(vol_now, vol_prev, pct=True)

    # Avg arrivals-on-red
    aor_now, aor_prev = window_df["arrivals_on_red_pct"].mean(), prior_df["arrivals_on_red_pct"].mean()
    aor_delta, aor_dir = _delta_str(aor_now, aor_prev, pct=False, unit=" pts")

    # Split failures + worst contributor
    sf_now, sf_prev = window_df["split_failures"].sum(), prior_df["split_failures"].sum()
    worst_sf_id = window_df.groupby("intersection_id")["split_failures"].sum().idxmax()
    if sf_prev:
        sf_change = (sf_now - sf_prev) / sf_prev * 100
        sf_arrow = "↑" if sf_change >= 0 else "↓"
        sf_delta = f"{sf_arrow} {abs(sf_change):.0f}% at {worst_sf_id}"
        sf_dir = "up" if sf_change >= 0 else "down"
    else:
        sf_delta, sf_dir = "no prior data", "flat"

    # High-priority count vs prior window
    high_now = sum(1 for r in priority if r["pri"] == "High")
    high_prev = int((analysis.priority_table(prior_df)["priority"] == "High").sum())
    hd = high_now - high_prev
    high_delta = "no change" if hd == 0 else (f"↑ {hd} vs prior 7d" if hd > 0 else f"↓ {abs(hd)} vs prior 7d")

    return [
        {"label": "Total Volume", "value": round(vol_now / 1e6, 1), "unit": "M veh", "fmt": "M",
         "delta": vol_delta, "dir": "flat", "tone": "mute"},
        {"label": "Avg Arrivals-on-Red", "value": round(float(aor_now), 1), "unit": "%", "fmt": "pct",
         "delta": aor_delta, "dir": ("regress" if aor_dir == "up" else "improve"),
         "tone": ("alert" if aor_dir == "up" else "accent")},
        {"label": "Split Failures", "value": int(sf_now), "unit": "", "fmt": "int",
         "delta": sf_delta, "dir": ("regress" if sf_dir == "up" else "improve" if sf_dir == "down" else "flat"),
         "tone": "alert"},
        {"label": "High-Priority Signals", "value": high_now, "unit": "", "fmt": "int",
         "delta": high_delta, "dir": "flat", "tone": "mute"},
    ]


def build_timeseries(window_df: pd.DataFrame, day_list: list[pd.Timestamp], anomaly_keys: set) -> dict:
    date_to_idx = {d.date(): i for i, d in enumerate(day_list)}
    out = {}
    for sid in FEATURED_IDS:
        s = window_df[window_df["intersection_id"] == sid].sort_values("timestamp")
        pts = []
        for _, r in s.iterrows():
            ts = r["timestamp"]
            if ts.date() not in date_to_idx:
                continue
            key = (sid, ts.to_pydatetime())
            pts.append(
                {
                    "t": jdate(ts),
                    "hr": int(r["hour"]),
                    "day": date_to_idx[ts.date()],
                    "dow": int((ts.dayofweek + 1) % 7),  # JS getDay(): Sun=0
                    "weekend": bool(r["is_weekend"]),
                    "v": round(float(r["arrivals_on_red_pct"]), 1),
                    "anomaly": key in anomaly_keys,
                }
            )
        out[sid] = pts
    return out


def build_hour_pattern(window_df: pd.DataFrame) -> dict:
    res = {"weekday": {}, "weekend": {}}
    for sid in FEATURED_IDS:
        s = window_df[window_df["intersection_id"] == sid]
        for bucket, is_we in (("weekday", False), ("weekend", True)):
            grp = s[s["is_weekend"] == is_we].groupby("hour")["arrivals_on_red_pct"].mean()
            res[bucket][sid] = [round(float(grp.get(h, 0.0)), 1) for h in range(24)]
    return res


def build_heatmap(window_df: pd.DataFrame) -> dict:
    rows = []
    for sid in FEATURED_IDS:
        s = window_df[window_df["intersection_id"] == sid]
        grp = s.groupby("hour")["split_failures"].sum()
        cells = [int(grp.get(h, 0)) for h in range(24)]
        rows.append({"id": sid, "name": name_of(window_df, sid), "cells": cells})
    mx = max((max(r["cells"]) for r in rows), default=0)
    return {"rows": rows, "max": mx}


def build_alerts(df_full: pd.DataFrame):
    """Run the real anomaly detector, collapse flagged hours into one
    episode per (signal, day), and shape them for the feed/scatter/bars."""
    history, recent = model.split_history_recent(df_full, recent_days=3)
    baseline = model.build_baseline(history)
    scored = model.score(recent, baseline)

    thr = ALERT_THRESHOLD
    flagged = scored[
        (scored["volume_vph_z"] < -thr)
        | (scored["arrivals_on_red_pct_z"] > thr)
        | (scored["split_failures_z"] > thr)
    ].copy()

    episodes = []
    for (sid, _date), grp in flagged.groupby(["intersection_id", flagged["timestamp"].dt.date]):
        # peak hour of the episode = largest absolute z across metrics
        grp = grp.assign(
            _absmax=grp[["volume_vph_z", "arrivals_on_red_pct_z", "split_failures_z"]].abs().max(axis=1)
        )
        r = grp.sort_values("_absmax", ascending=False).iloc[0]
        zs = {
            "volume": float(r["volume_vph_z"]),
            "aor": float(r["arrivals_on_red_pct_z"]),
            "sf": float(r["split_failures_z"]),
        }
        dom = max(zs, key=lambda k: abs(zs[k]))
        sev = zs[dom]

        if dom == "volume":
            line = f"{sev:+.1f}σ volume, possible detector fault."
        elif dom == "aor":
            line = f"{sev:+.1f}σ arrivals-on-red."
        else:
            line = f"{sev:+.1f}σ split failures."

        sub_parts = []
        if dom != "aor" and zs["aor"] > thr:
            sub_parts.append(f"Arrivals-on-red {r['arrivals_on_red_pct']:.0f}% ({zs['aor']:+.1f}σ)")
        if dom != "sf" and zs["sf"] > thr:
            sub_parts.append(f"{int(r['split_failures'])} split failures ({zs['sf']:+.1f}σ)")
        if dom != "volume" and zs["volume"] < -thr:
            sub_parts.append(f"Volume {r['volume_vph']:.0f} vph ({zs['volume']:+.1f}σ)")
        sub = ". ".join(sub_parts) if sub_parts else "Excursion against the time-of-week baseline."

        episodes.append(
            {
                "id": sid,
                "name": r["intersection_name"],
                "when": r["timestamp"],
                "sev": round(sev, 1),
                "metric": dom,
                "line": line,
                "sub": sub,
            }
        )

    episodes.sort(key=lambda e: e["when"], reverse=True)

    # Feed (newest first); scatter + bars are featured-only, by design.
    feed = [
        {
            "id": e["id"], "name": e["name"], "when": jdate(e["when"]),
            "sev": e["sev"], "metric": e["metric"], "line": e["line"], "sub": e["sub"],
        }
        for e in episodes
    ]
    anomaly_keys = {(e["id"], e["when"].to_pydatetime()) for e in episodes if e["id"] in FEATURED_IDS}

    per_counts = {sid: 0 for sid in FEATURED_IDS}
    for e in episodes:
        if e["id"] in FEATURED_IDS:
            per_counts[e["id"]] += 1
    alerts_per = [{"id": sid, "n": per_counts[sid]} for sid in FEATURED_IDS]

    scatter = [
        {"id": e["id"], "lane": FEATURED_IDS.index(e["id"]), "t": jdate(e["when"]), "sev": e["sev"]}
        for e in episodes
        if e["id"] in FEATURED_IDS
    ]
    return feed, anomaly_keys, alerts_per, scatter


def build_insight_html(window_df: pd.DataFrame, priority: list[dict]) -> str:
    top = priority[0]
    pm = window_df[
        (window_df["intersection_id"] == top["id"])
        & (~window_df["is_weekend"])
        & (window_df["hour"].isin(range(16, 20)))
    ]
    worst_hour = int(pm.groupby("hour")["split_failures"].sum().idxmax()) if not pm.empty else 18
    return (
        f'<b>{top["name"]}</b> ({top["id"]}) is the top retiming candidate: '
        f'<span class="mono">{top["pmsf"]}</span> PM-peak split failures over the window, '
        f'concentrated around <span class="mono">{worst_hour}:00</span> weekdays.'
    )


# ---------- emit data.js ----------
def emit(featured, priority, kpis, day_list, timeseries, hour_pattern, heatmap,
         alerts, alerts_per, scatter, window_label, insight_html) -> str:
    import json

    def arr(objs, point=False):
        return "[\n" + ",\n".join("    " + o for o in objs) + "\n  ]"

    L = []
    L.append("/* ============================================================")
    L.append("   Signal Performance Dashboard — REAL pipeline output")
    L.append("   AUTO-GENERATED by scripts/export_dashboard_data.py — do not edit by hand.")
    L.append("   Every value below is computed from the ATSPM analysis pipeline")
    L.append("   (generate -> clean_data -> analysis -> model).")
    L.append("   ============================================================ */")
    L.append("")
    L.append("const DATA = {};")
    L.append("")

    # featured
    L.append("DATA.featured = [")
    for s in featured:
        L.append(f'  {{ id: {jstr(s["id"])}, name: {jstr(s["name"])}, color: {jstr(s["color"])}, hex: {jstr(s["hex"])} }},')
    L.append("];")
    L.append("")

    # priority
    L.append("DATA.priority = [")
    for r in priority:
        L.append(
            f'  {{ rank: {r["rank"]}, id: {jstr(r["id"])}, name: {jstr(r["name"])}, '
            f'pmsf: {r["pmsf"]}, aor: {r["aor"]}, ped: {r["ped"]}, vol: {r["vol"]}, '
            f'score: {r["score"]}, pri: {jstr(r["pri"])} }},'
        )
    L.append("];")
    L.append("")

    # kpis
    L.append("DATA.kpis = [")
    for k in kpis:
        L.append(
            f'  {{ label: {jstr(k["label"])}, value: {k["value"]}, unit: {jstr(k["unit"])}, '
            f'fmt: {jstr(k["fmt"])}, delta: {jstr(k["delta"])}, dir: {jstr(k["dir"])}, tone: {jstr(k["tone"])} }},'
        )
    L.append("];")
    L.append("")

    # dayList
    L.append("DATA.dayList = [")
    L.append("  " + ", ".join(jdate(d) for d in day_list))
    L.append("];")
    L.append("")

    # timeseries
    L.append("DATA.timeseries = {")
    for sid, pts in timeseries.items():
        L.append(f"  {jstr(sid)}: [")
        for p in pts:
            L.append(
                f'    {{ t: {p["t"]}, hr: {p["hr"]}, day: {p["day"]}, dow: {p["dow"]}, '
                f'weekend: {jbool(p["weekend"])}, v: {p["v"]}, anomaly: {jbool(p["anomaly"])} }},'
            )
        L.append("  ],")
    L.append("};")
    L.append("")

    # hourPattern
    L.append("DATA.hourPattern = {")
    for bucket in ("weekday", "weekend"):
        L.append(f"  {bucket}: {{")
        for sid, vals in hour_pattern[bucket].items():
            L.append(f"    {jstr(sid)}: {json.dumps(vals)},")
        L.append("  },")
    L.append("};")
    L.append("")

    # heatmap
    L.append("DATA.heatmap = {")
    L.append("  rows: [")
    for row in heatmap["rows"]:
        L.append(f'    {{ id: {jstr(row["id"])}, name: {jstr(row["name"])}, cells: {json.dumps(row["cells"])} }},')
    L.append("  ],")
    L.append(f'  max: {heatmap["max"]},')
    L.append("};")
    L.append("")

    # alerts
    L.append("DATA.alerts = [")
    for a in alerts:
        L.append(
            f'  {{ id: {jstr(a["id"])}, name: {jstr(a["name"])}, when: {a["when"]}, '
            f'sev: {a["sev"]}, metric: {jstr(a["metric"])}, line: {jstr(a["line"])}, sub: {jstr(a["sub"])} }},'
        )
    L.append("];")
    L.append("")

    # alertsPer
    L.append("DATA.alertsPer = [")
    for a in alerts_per:
        L.append(f'  {{ id: {jstr(a["id"])}, n: {a["n"]} }},')
    L.append("];")
    L.append("")

    # scatter
    L.append("DATA.scatter = [")
    for s in scatter:
        L.append(f'  {{ id: {jstr(s["id"])}, lane: {s["lane"]}, t: {s["t"]}, sev: {s["sev"]} }},')
    L.append("];")
    L.append("")

    L.append(f"DATA.windowLabel = {jstr(window_label)};")
    L.append(f"DATA.insightHtml = {jstr(insight_html)};")
    L.append("")
    L.append("window.DATA = DATA;")
    L.append(f"window.FMT = {{ DOW: {json.dumps(DOW)}, MON: {json.dumps(MON)} }};")
    L.append("")
    return "\n".join(L)


def main() -> None:
    # 1) generate fresh 14-day dataset, write the canonical CSV
    raw = generate(days=14, seed=42, end_date=WINDOW_END)
    csv_path = ROOT / "data" / "raw" / "atspm_sample.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    raw.to_csv(csv_path, index=False)

    # 2) run the real pipeline
    df = clean_data.load(csv_path)
    cutoff = df["timestamp"].max() - pd.Timedelta(days=DISPLAY_DAYS)
    window_df = df[df["timestamp"] > cutoff].copy()
    prior_df = df[df["timestamp"] <= cutoff].copy()

    day_list = sorted({ts for ts in window_df["timestamp"].dt.normalize().unique()})
    day_list = [pd.Timestamp(d) for d in day_list]

    priority = build_priority(window_df)
    kpis = build_kpis(window_df, prior_df, priority)
    alerts, anomaly_keys, alerts_per, scatter = build_alerts(df)
    featured = build_featured(window_df)
    timeseries = build_timeseries(window_df, day_list, anomaly_keys)
    hour_pattern = build_hour_pattern(window_df)
    heatmap = build_heatmap(window_df)
    insight_html = build_insight_html(window_df, priority)

    first, last = day_list[0], day_list[-1]
    window_label = f"{MON[first.month - 1]} {first.day} – {MON[last.month - 1]} {last.day}"

    js = emit(featured, priority, kpis, day_list, timeseries, hour_pattern,
              heatmap, alerts, alerts_per, scatter, window_label, insight_html)
    out = ROOT / "data.js"
    out.write_text(js)

    # 3) report
    high = sum(1 for r in priority if r["pri"] == "High")
    print(f"wrote {out}  ({len(js):,} bytes)")
    print(f"  signals: {len(priority)}  |  high-priority: {high}  |  alerts: {len(alerts)}")
    print(f"  window:  {window_label}  ({len(day_list)} days)")
    print(f"  top:     {priority[0]['id']} {priority[0]['name']}  score {priority[0]['score']}")


if __name__ == "__main__":
    main()
