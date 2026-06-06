"""
Streamlit dashboard. Three sections matching the project's three layers:
Performance (descriptive), Priority (diagnostic), Alerts (predictive).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from clean_data import load
from analysis import priority_table, headline_insight, PM_PEAK_HOURS
from model import build_baseline, score, alerts, split_history_recent

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "atspm_sample.csv"

st.set_page_config(
    page_title="Signal Performance Dashboard",
    page_icon="🚦",
    layout="wide",
)

# Subtle, dashboard-y styling. Streamlit's default is fine but a few
# tweaks make it read more like agency tooling and less like a notebook.
st.markdown(
    """
    <style>
      .block-container { padding-top: 2.5rem; padding-bottom: 2rem; }
      h1, h2, h3 { letter-spacing: -0.01em; }
      [data-testid="stMetricValue"] { font-size: 1.6rem; }
      .insight-box {
        background: #FFF8E6;
        border-left: 4px solid #E5A100;
        padding: 14px 18px;
        border-radius: 4px;
        font-size: 15px;
        line-height: 1.4;
      }
      .footer-note { color: #666; font-size: 12px; margin-top: 24px; }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data
def get_data() -> pd.DataFrame:
    return load(DATA_PATH)


@st.cache_data
def get_alerts(df: pd.DataFrame, threshold: float, recent_days: int = 3) -> pd.DataFrame:
    history, recent = split_history_recent(df, recent_days=recent_days)
    baseline = build_baseline(history)
    scored = score(recent, baseline)
    return alerts(scored, threshold=threshold)


df = get_data()
window_start, window_end = df["timestamp"].min(), df["timestamp"].max()

# Sidebar filters
st.sidebar.title("Signal Performance")
st.sidebar.caption("ATSPM-style dashboard demo")

intersection_options = (
    df[["intersection_id", "intersection_name"]]
    .drop_duplicates()
    .sort_values("intersection_id")
)
intersection_map = dict(
    zip(intersection_options["intersection_id"], intersection_options["intersection_name"])
)
selected_ids = st.sidebar.multiselect(
    "Intersections",
    options=list(intersection_map.keys()),
    default=list(intersection_map.keys()),
    format_func=lambda x: f"{x} — {intersection_map[x]}",
)

date_range = st.sidebar.date_input(
    "Date range",
    value=(window_start.date(), window_end.date()),
    min_value=window_start.date(),
    max_value=window_end.date(),
)
if isinstance(date_range, tuple) and len(date_range) == 2:
    start_date, end_date = date_range
else:
    start_date, end_date = window_start.date(), window_end.date()

day_filter = st.sidebar.radio(
    "Days", options=["All", "Weekday only", "Weekend only"], horizontal=False
)

threshold = st.sidebar.slider(
    "Alert sensitivity (σ)",
    min_value=1.5,
    max_value=4.0,
    value=2.5,
    step=0.1,
    help="Lower = more alerts. 2.5σ is the default operator threshold.",
)

st.sidebar.markdown("---")
st.sidebar.caption(
    f"**Data window:** {window_start.strftime('%b %d')} – {window_end.strftime('%b %d, %Y')}  \n"
    f"**Rows:** {len(df):,}  \n"
    f"**Source:** Labeled sample (ATSPM schema)"
)

# Filter dataframe
mask = (
    df["intersection_id"].isin(selected_ids)
    & (df["timestamp"].dt.date >= start_date)
    & (df["timestamp"].dt.date <= end_date)
)
if day_filter == "Weekday only":
    mask &= ~df["is_weekend"]
elif day_filter == "Weekend only":
    mask &= df["is_weekend"]

view = df[mask].copy()

# Header
st.title("Traffic Signal Performance")
st.caption(
    "Surface underperforming intersections, rank them by retiming priority, "
    "and flag abnormal behavior before complaints arrive."
)

priority = priority_table(view) if not view.empty else pd.DataFrame()
if not priority.empty:
    st.markdown(
        f"<div class='insight-box'>💡 <strong>Insight.</strong> {headline_insight(view, priority)}</div>",
        unsafe_allow_html=True,
    )

# KPI strip
col1, col2, col3, col4 = st.columns(4)
total_vol = int(view["volume_vph"].sum())
avg_aor = view["arrivals_on_red_pct"].mean() if not view.empty else 0.0
total_sf = int(view["split_failures"].sum())
n_high = (priority["priority"] == "High").sum() if not priority.empty else 0
col1.metric("Total volume (veh)", f"{total_vol:,}")
col2.metric("Avg arrivals-on-red", f"{avg_aor:.1f}%")
col3.metric("Split failures", f"{total_sf:,}")
col4.metric("High-priority signals", f"{n_high}")

st.markdown("")

tab1, tab2, tab3 = st.tabs(["Performance", "Priority", "Alerts"])

# ---------------------------------------------------------------- Performance
with tab1:
    st.subheader("Hourly performance by intersection")

    metric_choice = st.selectbox(
        "Metric",
        options=[
            ("volume_vph", "Volume (veh/hr)"),
            ("arrivals_on_red_pct", "Arrivals on red (%)"),
            ("split_failures", "Split failures"),
            ("ped_delay_avg_sec", "Pedestrian delay (sec)"),
        ],
        format_func=lambda x: x[1],
    )
    mcol, mlabel = metric_choice

    fig = px.line(
        view,
        x="timestamp",
        y=mcol,
        color="intersection_name",
        labels={mcol: mlabel, "timestamp": "", "intersection_name": "Signal"},
    )
    fig.update_layout(
        height=420,
        margin=dict(l=10, r=10, t=10, b=10),
        legend=dict(orientation="h", y=-0.18),
        hovermode="x unified",
    )
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("Average pattern by hour of day")
    cols = st.columns(2)
    by_hour = (
        view.groupby(["intersection_name", "hour", "is_weekend"])[mcol]
        .mean()
        .reset_index()
    )
    with cols[0]:
        st.caption("Weekday")
        wk = by_hour[~by_hour["is_weekend"]]
        fig2 = px.line(wk, x="hour", y=mcol, color="intersection_name",
                       labels={mcol: mlabel, "hour": "Hour"})
        fig2.update_layout(height=320, margin=dict(l=10, r=10, t=10, b=10),
                           showlegend=False)
        st.plotly_chart(fig2, use_container_width=True)
    with cols[1]:
        st.caption("Weekend")
        we = by_hour[by_hour["is_weekend"]]
        fig3 = px.line(we, x="hour", y=mcol, color="intersection_name",
                       labels={mcol: mlabel, "hour": "Hour"})
        fig3.update_layout(height=320, margin=dict(l=10, r=10, t=10, b=10),
                           legend=dict(orientation="h", y=-0.25))
        st.plotly_chart(fig3, use_container_width=True)

# ---------------------------------------------------------------- Priority
with tab2:
    st.subheader("Signals needing attention")
    st.caption(
        "Composite score weighs weekday PM-peak split failures (55%), average "
        "arrivals-on-red (30%), and pedestrian delay (15%). Higher = retime first."
    )

    if priority.empty:
        st.info("No data in current filter.")
    else:
        display = priority[
            [
                "rank",
                "intersection_id",
                "intersection_name",
                "pm_split_failures_total",
                "avg_arrivals_on_red_pct",
                "avg_ped_delay_sec",
                "avg_volume_vph",
                "score",
                "priority",
            ]
        ].rename(
            columns={
                "rank": "#",
                "intersection_id": "ID",
                "intersection_name": "Signal",
                "pm_split_failures_total": "PM split failures",
                "avg_arrivals_on_red_pct": "Avg AoR %",
                "avg_ped_delay_sec": "Avg ped delay (s)",
                "avg_volume_vph": "Avg vol (vph)",
                "score": "Score",
                "priority": "Priority",
            }
        )

        st.dataframe(
            display.style.format(
                {
                    "Avg AoR %": "{:.1f}",
                    "Avg ped delay (s)": "{:.1f}",
                    "Avg vol (vph)": "{:.0f}",
                    "Score": "{:.1f}",
                }
            ).background_gradient(subset=["Score"], cmap="Reds"),
            use_container_width=True,
            hide_index=True,
        )

        st.subheader("PM peak split failures by hour")
        weekday_pm = view[~view["is_weekend"]]
        pm_grid = (
            weekday_pm.groupby(["intersection_name", "hour"])["split_failures"]
            .sum()
            .reset_index()
        )
        heat = pm_grid.pivot(
            index="intersection_name", columns="hour", values="split_failures"
        ).fillna(0)
        fig = go.Figure(
            data=go.Heatmap(
                z=heat.values,
                x=heat.columns,
                y=heat.index,
                colorscale="Reds",
                colorbar=dict(title="Failures"),
            )
        )
        fig.update_layout(
            height=300,
            margin=dict(l=10, r=10, t=10, b=10),
            xaxis_title="Hour of day",
            yaxis_title="",
        )
        st.plotly_chart(fig, use_container_width=True)

# ---------------------------------------------------------------- Alerts
with tab3:
    st.subheader("Abnormal behavior alerts")
    st.caption(
        "Each (intersection, day-of-week, hour) gets its own baseline. "
        "An hour is flagged when it deviates beyond the sensitivity threshold."
    )

    a = get_alerts(view, threshold=threshold) if not view.empty else pd.DataFrame()

    if a.empty:
        st.success("No alerts in current filter.")
    else:
        st.warning(f"{len(a)} alerts flagged.")

        ac1, ac2 = st.columns([2, 3])
        with ac1:
            by_signal = (
                a.groupby("intersection_name")
                .size()
                .reset_index(name="alerts")
                .sort_values("alerts", ascending=True)
            )
            fig = px.bar(
                by_signal,
                x="alerts",
                y="intersection_name",
                orientation="h",
                labels={"intersection_name": "", "alerts": "Alerts"},
                color="alerts",
                color_continuous_scale="Reds",
            )
            fig.update_layout(
                height=260,
                margin=dict(l=10, r=10, t=10, b=10),
                coloraxis_showscale=False,
            )
            st.plotly_chart(fig, use_container_width=True)

        with ac2:
            fig = px.scatter(
                a,
                x="timestamp",
                y="intersection_name",
                size="severity",
                color="severity",
                color_continuous_scale="Reds",
                labels={"intersection_name": "", "timestamp": ""},
            )
            fig.update_layout(height=260, margin=dict(l=10, r=10, t=10, b=10))
            st.plotly_chart(fig, use_container_width=True)

        st.dataframe(
            a.rename(
                columns={
                    "timestamp": "When",
                    "intersection_id": "ID",
                    "intersection_name": "Signal",
                    "volume_vph": "Vol",
                    "arrivals_on_red_pct": "AoR %",
                    "split_failures": "SF",
                    "severity": "σ",
                    "reason": "Why flagged",
                }
            ).style.format({"σ": "{:.2f}", "AoR %": "{:.1f}"}),
            use_container_width=True,
            hide_index=True,
        )

st.markdown(
    "<div class='footer-note'>Sample data, ATSPM-compatible schema. "
    "Built for the NJDOT AMC Data Analyst interview by Shafay.</div>",
    unsafe_allow_html=True,
)
