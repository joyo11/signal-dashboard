# Traffic Signal Performance Dashboard

An operations dashboard that answers one question a traffic analyst asks every
morning: **which signals are misbehaving today, and which one do I retime first?**

The screen tells one story in a breath: things are mostly fine, these three
signals are not, fix this one first.

Built as a portfolio piece for an NJDOT Arterial Management Center (AMC) Data
Analyst interview. It mirrors the proactive, ATSPM-style approach the AMC uses:
turn raw signal-controller data into a ranked action queue.

## Live demo

Open `index.html` in any browser, no build step or server required. If GitHub
Pages is enabled on this repo, it serves from the root automatically.

```bash
git clone https://github.com/joyo11/signal-dashboard.git
cd signal-dashboard
open index.html        # macOS  (or: python3 -m http.server, then visit localhost:8000)
```

## What's inside

The dashboard has three layers, in the order an analyst works them:

1. **Performance.** Hourly arrivals-on-red across selected intersections, plus
   weekday vs. weekend hour-of-day small-multiples. Anomalous points pulse so
   the eye lands on them first.
2. **Priority.** A dense ranked retiming queue scored by a composite of split
   failures (40%), arrivals-on-red (30%), pedestrian delay (20%), and volume
   (10%). The worst signal sits at the top with a red row and a High pill. A
   split-failure heatmap (signals x hours) sits below.
3. **Alerts.** Alerts-per-signal bars, a severity-over-time scatter, and a
   date-grouped feed of abnormal behavior with signed sigma values. The
   analyst's "what's broken" inbox.

Click any priority row or alert to open the signal detail drawer with the
composite breakdown and a recommended action.

### Interaction

- Sidebar filters: intersections, date window, days of week, anomaly sigma
  threshold. Active filters show a hairline left border.
- Animated underline tabs, KPI count-up, staggered first paint, hover
  crosshairs and tooltips on every chart.
- Empty-filter and loading states are designed, not afterthoughts.

## Design

The interface follows a single, documented design system: a calm, dense
"Bloomberg-terminal-calm meets Linear-polish" light theme. Restraint over
novelty. Red appears only on true anomalies and High-priority rows.

- **Palette:** warm paper white, near-black ink, deep green for healthy, amber
  for warnings, red used sparingly for real anomalies.
- **Type:** Fraunces (display), Inter (body), JetBrains Mono (all numerics,
  always tabular figures).
- **Charts:** hand-rolled SVG, hairline rules only, a curated 4-color series
  palette, no chart-library defaults.

`component-sheet.html` documents every token, type specimen, and named
component (TopBar, InsightBanner, KpiCard, PriorityTable, AlertCard,
LineChart, Heatmap, ScatterLane, SignalDetailDrawer, and more).

## The analysis layer (Python)

The `src/` and `scripts/` directories hold the methodology behind the dashboard:
the cleaning, scoring, and anomaly-detection logic, written against an
ATSPM-faithful schema so real exports drop in as a CSV.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/generate_sample_data.py    # writes data/raw/atspm_sample.csv
streamlit run src/app.py                   # the Python/Streamlit view of the same data
```

- `clean_data.py` loads, validates, and derives metrics.
- `analysis.py` computes the composite priority score and headline insight.
- `model.py` builds per-`(signal, day-of-week, hour)` baselines and z-scores
  each hour to flag detector faults and unexpected congestion.

The data source schema mirrors UDOT Open ATSPM exports
(`udottraffic.utah.gov/atspm`). The included sample is synthetic but
schema-faithful: four intersections over 14 days, one PM-oversaturated signal,
and a 36-hour detector-fault window so the anomaly detector has something to find.

## Vocabulary

- **Arrivals on Red %.** Share of vehicles arriving on red. High under load = retime.
- **Split failure.** A phase that ran out of green during a cycle. Repeated
  failures = oversaturated phase = retime candidate.
- **Pedestrian delay.** Average wait after pressing the button.
- **Hour-of-week baseline.** Each `(signal, day-of-week, hour)` gets its own
  mean and std; today's hour is z-scored against its bucket.

## Limitations

The dashboard data is a deterministic, coherent fabrication that tells the
story above; the Python sample data is synthetic but schema-faithful. Swap in
real UDOT exports, or in production the AMC's live SCATS / RITIS feeds, to
extend this to real-time alerting across the arterial network.

## Author

Shafay, shafay11august@gmail.com
