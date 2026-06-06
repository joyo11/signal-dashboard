# Signal Performance Dashboard — UI Design Brief

A Claude Design / Figma brief for a single-page web dashboard. Implementation will follow this design 1:1, so be specific.

---

## 1. What this is

A traffic agency operations dashboard. An analyst at a state DOT looks at it to answer one question every morning:

> Which traffic signals are misbehaving today, and which one do I retime first?

Three layers, in this order:

1. **Performance.** What every signal is doing right now: volume, arrivals-on-red, split failures, pedestrian delay.
2. **Priority.** A ranked queue of signals that need a human, sorted by a composite score.
3. **Alerts.** A live-feeling list of abnormal signal behavior in the last 3 days. The analyst's "what's broken" inbox.

The story we want the screen to tell, in one breath:
**Things are mostly fine. These three signals aren't. Fix this one first.**

## 2. Who's looking at it

A municipal / state DOT engineer or analyst. Calm, technical, sees this screen all day. Wants information density, not animation candy. But the second they spot an anomaly, the UI should feel alive enough that the eye goes there first. Think Bloomberg terminal calmness with Linear's polish.

## 3. Tone & mood

| | |
|---|---|
| **Feels like** | Linear × Vercel × a quiet ops room |
| **Doesn't feel like** | A consumer SaaS landing page, dark cyberpunk, gradient-soup, kid-friendly |
| **Density** | High but breathable. Generous line-height, deliberate whitespace inside cards, tight margins between them. |
| **Voice** | Clinical and confident. "Retime first" not "Let's look at!" |

## 4. Visual language

### Palette
Default theme: **light, neutral, with one hot accent for alerts**. Dark mode is a stretch goal, ship light first.

```
--bg:           #FAFAF7  (paper white, slight warmth)
--surface:      #FFFFFF
--surface-alt:  #F4F2EC  (subtle card / sidebar fill)
--line:         #E6E3DC
--line-hi:      #D6D2C8
--ink:          #16170F  (near-black for headings + numbers)
--mute:         #6E6B62
--accent:       #1F6E43  (deep green; "healthy" / brand)
--warn:         #C97A1E  (signal amber)
--alert:        #C0392B  (signal red, used SPARINGLY for true anomalies)
--alert-soft:   #FBE9E6
```

Reds appear only on the Alerts tab and on rows tagged "High" priority. Everywhere else, restraint.

### Type

- **Display / headings:** Fraunces or a tight serif with very low optical size (e.g. Fraunces 9pt opsz, weight 500, -0.02em tracking).
- **Body:** Inter or Söhne, regular 400, 14–15px.
- **Numerics (KPIs, table cells, axes):** tabular-figures sans, ideally JetBrains Mono or Söhne Mono at smaller sizes. Always tabular.
- **Captions / labels:** uppercase 11px, +6% letter-spacing, weight 600, color `--mute`.

### Shape

- Cards: 1px solid `--line`, radius 10px, no shadow by default. Hover lifts via a 1px `--line-hi` border, no shadow.
- Buttons: 8px radius, 36px height, no gradients. Primary = `--ink` background, white text. Secondary = transparent, `--line` border.
- Charts: never use grid noise. Hairline horizontal rules only, `--line` at 60% opacity. No legends inside the plot area — put them above as a chip row.

## 5. Layout

Desktop-first, ~1440 design width.

```
┌────────────────────────────────────────────────────────────────┐
│ Top bar:   logo · Signal Performance     [Mon Jun 4]  [user]   │
├──────────┬─────────────────────────────────────────────────────┤
│          │                                                     │
│ Sidebar  │   1) Headline insight banner                        │
│          │   2) KPI strip (4 metrics)                          │
│ Filters  │   3) Tab bar: Performance · Priority · Alerts       │
│ -Sigs    │   4) Tab content                                    │
│ -Dates   │                                                     │
│ -Days    │                                                     │
│ -σ       │                                                     │
│          │                                                     │
│ Sample   │                                                     │
│ data tag │                                                     │
│          │                                                     │
└──────────┴─────────────────────────────────────────────────────┘
```

- **Sidebar:** 280px, `--surface-alt`. Sticky. Filters live there.
- **Main:** max 1180px, generous side padding.
- **Tab bar:** underlined tabs, not pill tabs. Active tab has a 2px `--ink` underline that slides between tabs on click (more on animation below).

## 6. The headline insight banner

Yellow-ish soft surface, full width of main, 56px tall. Single line:

> 💡 **Insight.** State St & 800 South is the top retiming candidate: 222 PM-peak split failures over the window, concentrated around 19:00 weekdays.

- Surface: `#FFF6E0`, left border 3px `--warn`.
- Icon: outline lightbulb, no emoji in the final design.
- This is the single most important element on the screen on first load.

## 7. KPI strip

4 cards in a row. Each card has a tiny uppercase label, a big tabular-figure number, and a one-line delta vs. the prior comparable window.

```
TOTAL VOLUME           AVG ARRIVALS-ON-RED      SPLIT FAILURES          HIGH-PRIORITY SIGNALS
2.1M veh               48.6 %                   399                     1
↑ 3.1% vs last 7d      ↑ 2.4 pts                ↑ 27 % at SIG-1003      no change
```

Deltas color: improvement = `--accent`, regression = `--alert`, no change = `--mute`.

## 8. Performance tab

### A. Time-series row
One large line chart spanning the row, ~360px tall, showing the selected metric across all selected intersections. Y-axis label sits to the upper-left in caption type. X-axis: dates only at midnight ticks, no minor grid.

Series colors come from a curated 4-color palette (NOT plotly defaults):
```
SIG-1001: #2D5F8A  (slate blue)
SIG-1002: #1F6E43  (accent green)
SIG-1003: #C0392B  (alert red — because it's always the troublemaker)
SIG-1004: #8E6E2F  (warm bronze)
```

A small chip row above the chart toggles which lines are visible. Clicking a chip dims the others to 12% opacity.

### B. Hour-of-day pattern row
Two side-by-side small-multiples, ~260px tall: Weekday | Weekend. Same y-axis scale across both so the eye can compare.

## 9. Priority tab

### A. Ranked table
Single dense table, 12 rows max visible. Columns:

```
#  ID         Signal                         PM SF   AoR     Ped (s)   Vol (vph)   Score   Priority
1  SIG-1003   State St & 800 South            222    64.5%   32.1      973         93.2    ● High
2  SIG-1002   State St & 600 South             71    58.4%   31.5      754         28.7    ○ Low
…
```

Row hover: faint `--surface-alt` background, score cell highlighted.
Priority pill: filled red dot + "High" / hollow circle + "Low".
Score cell: subtle horizontal bar behind the number, width proportional to score, color shifts from `--accent` → `--warn` → `--alert` across the range.

### B. Split-failure heatmap
Below the table. Y = intersections (4 rows), X = hours of day (0–23), cell color = total split failures.

- Color scale: paper-white → `--warn` → `--alert`. Empty cells transparent (NOT light grey — keeps the screen calm).
- Hover shows the exact number in a 12px tooltip.

## 10. Alerts tab

### A. Two summary visuals top of tab
Side-by-side. Left = small horizontal bar chart "alerts per signal". Right = scatter "when did alerts happen": x = timestamp, y = intersection (4 lanes), point size = severity, point color = severity.

### B. Alert feed
Card-style rows, one per alert. Each row:

```
┌────────────────────────────────────────────────────────────────────┐
│ ● SIG-1002 · State St & 600 South               Tue Jun 3, 8:00 AM │
│   −101.6σ volume — possible detector fault.                        │
│   AoR 90% (+5.5σ).                                                 │
│   [ inspect ↗ ]                                                    │
└────────────────────────────────────────────────────────────────────┘
```

- Left edge: 3px colored bar. `--alert` if any σ > 4, else `--warn`.
- Severity sigma shown in tabular figures with the sign baked in.
- Newest at the top. Date-grouped headers ("Today", "Yesterday", "Jun 3").

## 11. Animation & motion

Subtle. Functional. No bounce, no overshoot, no spring physics on big surfaces. Easing: `cubic-bezier(0.2, 0, 0, 1)` for entry, `cubic-bezier(0.4, 0, 1, 1)` for exit. Durations 160-220ms.

### Specific motions

- **First paint.** Cards stagger in from 8px below + opacity 0 → 1, 40ms between siblings, total under 400ms. KPI numbers count up from 0 to target over 600ms, ease-out.
- **Tab switch.** Underline slides between tabs in 220ms. Tab content cross-fades over 160ms (out then in, not simultaneous).
- **Chart re-rendering** on filter change. Lines tween from old to new path over 280ms (use d3 / framer-motion / chart lib equivalent). Never just snap.
- **Sidebar filter.** Each filter card has a hairline left border that slides in (`width: 0 → 3px`) when its value is non-default, signaling "this filter is active."
- **Hover.** All hover states cross-fade in 80ms. No instant snap.
- **Alert row enter** (when a new alert appears in a live build): row slides down from -8px, opacity 0 → 1, 240ms. Existing rows shift down in the same window.
- **Anomalous data point on charts.** A tiny pulsing ring (1.2s loop, 0% to 60% opacity) on points flagged by the alert layer. ONE pulse type, used sparingly. This is what draws the eye.

What we explicitly do NOT want:
- Confetti, particles, blur, glassmorphism, neon glow.
- Loading skeletons that pulse aggressively. Use a single 1px progress line at the top of the affected region.
- Hover scale (`transform: scale(1.02)`) on cards. Cards do not grow.

## 12. States to design

For each tab, design all four states:

1. **Loaded, healthy.** Most signals green, score bars short.
2. **Loaded, one bad signal.** SIG-1003 dominates the priority list. Insight banner names it.
3. **Loading.** Top-bar progress hairline, faint placeholder rectangles where data goes (no pulse).
4. **Empty filter.** "No intersections selected." Centered, 14px `--mute`, illustrated icon optional.

Also design:
- The sidebar both at default and with 2 filters active.
- A keyboard-focused button (1.5px `--ink` ring, 2px outside the element).
- A modal style we can reuse later (signal detail drawer slides in from the right, 480px wide, with a 200ms ease).

## 13. Components inventory (please name each)

So the engineer can find them:
- `TopBar`
- `Sidebar` / `FilterCard` / `FilterChip`
- `InsightBanner`
- `KpiCard`
- `Tabs` (animated underline)
- `LineChart`, `SmallMultiplesPair`, `Heatmap`, `HorizontalBars`, `ScatterLane`
- `PriorityTable` / `PriorityScoreCell` / `PriorityPill`
- `AlertFeed` / `AlertCard` / `AlertSeverityBar`
- `EmptyState`
- `SignalDetailDrawer`

## 14. References to draw on

- **Linear** — table density, hairline borders, calm hover, perfect typography for monospace numerics.
- **Vercel dashboard** — KPI card hierarchy, restraint with color, deltas, the way "all healthy" feels.
- **Stripe operations dashboards** — table heatmap subtlety, never-loud colors.
- **Retool** — feels like an internal tool that respects the user's intelligence.
- **Mapbox docs** — typographic refinement.

## 15. Deliverables

1. Hi-fi mock of the **Performance tab** at desktop, loaded-healthy state.
2. Hi-fi mock of the **Priority tab** at desktop, loaded-one-bad-signal state — this is the hero screen.
3. Hi-fi mock of the **Alerts tab** at desktop, with the feed populated.
4. Component sheet showing tokens, tabs, KPI cards, alert cards, priority cells, charts axes.
5. Three short motion specs as inline GIFs or video frames: tab switch, anomalous pulse, KPI count-up.

Width 1440. Spacing on an 8px grid. All typography on a 4px baseline. Export tokens as JSON if possible.

## 16. Constraints

- Implementation target is Streamlit + Plotly initially. Designs should be expressible as: HTML + Plotly traces + custom CSS. If a flourish requires a full React rebuild, mark it `[stretch]`.
- No external paid font families. Stick to Fraunces / Inter / JetBrains Mono (all free).
- Accessibility: text contrast ≥ 4.5:1 against its surface. Alert color must be reinforced by an icon or label, never color alone.

---

*Note to designer: the audience is a state DOT analyst. They will use this every day. Restraint > novelty. The single best compliment this dashboard can get is "I knew what to fix in five seconds."*
