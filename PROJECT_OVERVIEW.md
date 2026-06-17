# Signal Performance Dashboard: Plain-English Overview

A simple guide to what this project is, what every part does, and what's real
vs. sample. Written so anyone can read it, no traffic-engineering background needed.

---

## 1. What this project is (one sentence)

**A dashboard that reads traffic-light data and tells an engineer which traffic
light to fix first.**

That's the whole idea. Everything below is just detail.

---

## 2. The problem it solves

A city has hundreds of traffic lights. Some are timed badly, so cars pile up and
people wait. Today, cities often find out a light is bad **only when someone
complains**, slow and reactive.

This tool flips that: it reads the data the lights already produce and **spots the
bad ones automatically**, before anyone complains. An engineer opens it in the
morning and instantly sees where to go. That shift, from *reactive* (wait for a
complaint) to *proactive* (let the data point you), is the entire point.

---

## 3. What it actually does (think: a doctor for traffic lights)

1. **Takes the vitals.** Every light reports hourly numbers, how many cars, how
   many hit a red light, how often the green ran out. The app reads all of it.
2. **Diagnoses & ranks.** It scores each light 0-100 on "how badly is this
   performing," and ranks them worst-to-best. The worst goes to the top.
   → *"Fix this one first."*
3. **Sounds alarms.** If a light suddenly does something weird (like a sensor
   breaking and reporting zero cars), it flags an alert. → *"Go check this now."*

So: **reads data → ranks the worst lights → flags emergencies.**

---

## 4. The four key numbers (what the app measures)

| Metric | Plain meaning | Good vs. bad |
|---|---|---|
| **Arrivals on Red (AoR %)** | What % of cars arrive while the light is red (and have to stop) | ~30% good · 60%+ bad |
| **Split Failures (SF)** | How many times the green ran out before clearing the waiting cars | near 0 good · lots = bad |
| **Pedestrian Delay (Ped s)** | Average seconds a person waits to cross | lower is better |
| **Volume** | How many cars pass through | just context, not good/bad |

### The score (0-100)
The app blends three of these into one grade:

> **Score = 55% Split Failures + 30% Arrivals-on-Red + 15% Pedestrian Delay**

Each metric is scaled against the *other* signals, so the worst lands near the top.
**Higher score = worse = fix sooner.** Labels: **70+ = High**, **40-69 = Medium**,**under 40 = Low**.

**Example (real output from this app):** SIG-1003 "State St & 800 South" scores
**91**, 64% of cars hit red, and the green ran out **113** times in evening rush.
The next signal is only 42. That big gap is the story: *one* light is genuinely
bad, the rest are basically fine. → "Go retime SIG-1003 first."

---

## 5. The dashboard, region by region

- **Network Health donut (top-left).** A ring split into High / Medium / Low. The
  big center number = how many signals need attention.
- **KPI tiles (top center).** Four headline numbers, Total Volume, Avg
  Arrivals-on-Red, Split Failures, High-Priority count, each with an up/down
  arrow vs. the previous period (green = better, red = worse).
- **Hero panel (center).** A switcher with three views:
  - **Trend**, arrivals-on-red over the day for the main signals (a pulsing dot
    marks an anomaly), plus a split-failure heatmap underneath.
  - **Retiming Queue**, the full ranked table of all 12 signals.
  - **Heatmap**, split failures by signal × hour (the red band shows *when* a
    light jams, e.g. 5-7pm).
- **Recent Alerts (left rail).** A live-feeling list of abnormal behavior, newest
  first, color-coded by severity.
- **Retiming Queue (right rail).** The top 5 worst signals at a glance.
- **Bottom strip.** Network totals for the four metrics with icons.
- **Signal detail drawer.** Click any signal → a panel slides in with its score,  the score breakdown (55/30/15), its current metrics, and a fault warning if a
  detector looks broken.
- **Theme toggle.** Dark (navy "command center") or light. Follows your system
  setting by default.

---

## 6. The chatbot / assistant: what it does

The floating chat button (bottom-right) opens a **grounded helper.** "Grounded"
means it answers **only from the dashboard's live numbers**, it cannot make things
up, and it has no API key or internet call. It reads the same computed data the
charts use and replies in plain English.

You can ask it:
- **"What's happening?"** → a summary: the top signal, how many are high-priority,  how many alerts.
- **"What do I retime first?"** → the worst signal with its numbers and a
  recommendation.
- **"Any alerts?"** → the current anomaly list.
- **"Why SIG-1003?"** (any signal) → that intersection's rank, score, and metrics,  plus a button to open its detail drawer.
- **"Explain the score"**, **"what is split failure"**, **"what is this / how does
  it work / is this real data"** → it explains the project and the metrics.

It's a keyword-matched helper over the real data (not a free-form AI like ChatGPT),so every answer is accurate to what's on screen. It also greets first-time visitors
with a small nudge dot, and respects "reduced motion" accessibility settings.

> Note: this is the *grounded* version (reliable, no key). A *Claude-powered* free-
> form mode can be added later, it would need an API key and a small server piece.

---

## 7. Is the data real?

**The analysis is 100% real. The underlying numbers are realistic sample data.**

- **The brain is real**, the scoring, ranking, and anomaly detection are the exact
  same calculations you'd run on live traffic data. Nothing about the method is
  faked.
- **The data is generated**, a script (`scripts/generate_sample_data.py`) invents
  14 days of hourly numbers for 12 intersections. It's invented, but shaped to look
  like real traffic (busy at rush hour) and built in the real industry format
  (**ATSPM**, see below). It even bakes in two true-to-life stories: one chronic
  problem signal (SIG-1003) and one with a broken sensor (SIG-1002).

**Why sample data?** Real signal data isn't freely downloadable by a program,agencies make you export it by hand from their website. So the project ships with
realistic stand-in data, and is built to accept real data with no code changes.

**Honest caveats (so nothing surprises you):**
- "Last retimed" and "next maintenance window" are **cosmetic placeholders**, we
  have no retiming-history data, so don't present those as real.
- Pedestrian delay barely varies in the sample data, so that column looks flat.

### What is "ATSPM"?
**A**utomated **T**raffic **S**ignal **P**erformance **M**easures, the standard
format/layout traffic-signal data comes in (popularized by Utah's DOT). Think of it
like how every bank statement has the same columns. This project uses that same
shape, so real exports drop straight in.

---

## 8. How it's built

- **Python pipeline (`src/`)**, the brain:
  - `clean_data.py`, loads and tidies the raw hourly data.
  - `analysis.py`, computes the composite priority score and ranking.
  - `model.py`, the anomaly detector (learns each signal's normal pattern, flags
    hours that are far off, that's how it catches the broken sensor).
  - `app.py`, a Python/Streamlit version of the same analysis.
- **Web dashboard (`index.html`, `app.css`, `app.js`)**, the navy command-center
  UI. It recomputes everything live in the browser from `data.js`, so it's fast and
  needs no server.
- **The bridge (`scripts/export_dashboard_data.py`)**, runs the Python pipeline
  and writes `data.js` (the data the web app reads). Re-run it whenever the data
  changes.

The web design came from a Claude Design mock and was implemented to match.

---

## 9. How to make the data genuinely real (optional next step)

1. Go to the public UDOT ATSPM site and export the four metrics (split failures,   approach volume, arrivals-on-red, pedestrian delay) as CSV files, done by hand,   one metric at a time.
2. Drop those files into `data/raw/udot/`.
3. Run `python src/etl_udot.py`, the adapter merges them into the project's format.

After that, every number on the dashboard is real Utah signal data. (It's still a
manual export, not a live feed, UDOT has no public auto-API.)

---

## 10. How to run it

**Just the dashboard (no setup):** open `index.html` in a browser, or visit the
live site.

**Rebuild the data / run the Python side:**
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/generate_sample_data.py        # make the sample data
python scripts/export_dashboard_data.py        # feed it to the web app (writes data.js)
streamlit run src/app.py                        # optional: the Python view
```
