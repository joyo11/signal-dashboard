/* Component Sheet — populate swatches, score cells, axis demo, inventory */
(function () {
  const $ = (s) => document.querySelector(s);

  const core = [
    ["--bg", "#FAFAF7", "Background"], ["--surface", "#FFFFFF", "Surface"],
    ["--surface-alt", "#F4F2EC", "Surface alt"], ["--line", "#E6E3DC", "Line"],
    ["--line-hi", "#D6D2C8", "Line hi"], ["--ink", "#16170F", "Ink"],
    ["--mute", "#6E6B62", "Mute"], ["--accent", "#1F6E43", "Accent · healthy"],
    ["--warn", "#C97A1E", "Warn · amber"], ["--alert", "#C0392B", "Alert · red"],
  ];
  const series = [
    ["SIG-1001", "#2D5F8A", "Slate blue"], ["SIG-1002", "#1F6E43", "Accent green"],
    ["SIG-1003", "#C0392B", "Alert red"], ["SIG-1004", "#8E6E2F", "Warm bronze"],
    ["alert-soft", "#FBE9E6", "Alert wash"],
  ];
  function swatch(nm, hex, label) {
    return `<div class="swatch"><div class="chip-fill" style="background:${hex}"></div><div class="meta"><div class="nm">${label}</div><div class="hx">${hex}</div></div></div>`;
  }
  $("#coreSwatches").innerHTML = core.map((c) => swatch(c[0], c[1], c[2])).join("");
  $("#seriesSwatches").innerHTML = series.map((c) => swatch(c[0], c[1], c[2])).join("");

  // spacing grid
  const steps = [4, 8, 16, 24, 32, 48];
  $("#spacingRow").innerHTML = steps.map((n) =>
    `<div class="sp"><div class="box" style="width:${n}px;height:${n}px;border-radius:3px"></div><div class="lab">${n}</div></div>`).join("");

  // score cells
  function scoreColor(score) {
    const t = Math.min(1, score / 100);
    const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const accent = [31,110,67], warn = [201,122,30], alert = [192,57,43];
    let c = t < 0.5 ? lerp(accent, warn, t / 0.5) : lerp(warn, alert, (t - 0.5) / 0.5);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const scores = [93.2, 58.0, 28.7, 16.4, 6.1];
  $("#scoreCells").innerHTML = scores.map((s) => `
    <div style="display:flex;align-items:center;gap:14px;padding:6px 0">
      <div style="position:relative;width:120px;height:24px;display:flex;align-items:center">
        <span style="position:absolute;left:0;height:22px;border-radius:4px;width:${(s/93.2)*110}px;background:${scoreColor(s)};opacity:0.18"></span>
        <span class="mono" style="position:relative;font-weight:500;padding-left:8px">${s.toFixed(1)}</span>
      </div>
      <span class="mono" style="font-size:11px;color:var(--mute-2)">${s >= 90 ? "High" : "Low"}</span>
    </div>`).join("");

  // axis demo — tiny line chart with hairline rules (3-day slice from raw)
  const demo = $("#axisDemo");
  if (window.Charts && window.DATA) {
    const ids = ["SIG-1003", "SIG-1001"];
    const colors = { "SIG-1003": "#C0392B", "SIG-1001": "#2D5F8A" };
    const sidx = {}; DATA.signals.forEach((s, i) => (sidx[s.id] = i));
    const map = {}; DATA.raw.forEach((r) => (map[r.s + "_" + r.d + "_" + r.h] = r));
    const series = {}; ids.forEach((id) => (series[id] = []));
    const tList = [], dayTicks = [];
    for (let d = 0; d < 3; d++) {
      for (let h = 0; h < 24; h++) {
        const dt = new Date(DATA.dayList[d].getTime()); dt.setHours(h); tList.push(dt);
        if (h === 0) dayTicks.push({ pos: tList.length - 1, label: FMT.MON[DATA.dayList[d].getMonth()] + " " + DATA.dayList[d].getDate() });
        ids.forEach((id) => { const r = map[sidx[id] + "_" + d + "_" + h]; series[id].push({ v: r ? r.aor : 0, anomaly: false }); });
      }
    }
    Charts.LineChart(demo, { series, tList, dayTicks, colors, activeIds: ids, emphasisId: "SIG-1003", height: 180, yLabel: "AoR (%)" });
  }

  // inventory
  const inv = [
    ["TopBar", "Logo, title, date, user"],
    ["Sidebar", "Sticky filter rail, 280px"],
    ["FilterCard", "Active-state hairline border"],
    ["FilterChip", "Signal toggle, mono label"],
    ["InsightBanner", "Single-line headline insight"],
    ["KpiCard", "Label · big number · delta"],
    ["Tabs", "Underlined, sliding indicator"],
    ["LineChart", "Time series, all signals"],
    ["SmallMultiplesPair", "Weekday | weekend, shared y"],
    ["Heatmap", "Signals × hours, split failures"],
    ["HorizontalBars", "Alerts per signal"],
    ["ScatterLane", "Severity over time, by signal"],
    ["PriorityTable", "Dense ranked queue"],
    ["PriorityScoreCell", "Bar behind tabular number"],
    ["PriorityPill", "High / Medium / Low indicator"],
    ["AlertFeed", "Date-grouped card list"],
    ["AlertCard", "One abnormal behavior"],
    ["AlertSeverityBar", "Left edge, warn / alert"],
    ["EmptyState", "No intersections selected"],
    ["SignalDetailDrawer", "Right-side, 480px"],
  ];
  $("#inventory").innerHTML = inv.map((i) =>
    `<div class="inv-item"><span class="nm">${i[0]}</span><span class="ds">${i[1]}</span></div>`).join("");
})();
