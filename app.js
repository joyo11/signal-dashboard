/* ============================================================
   Signal Performance Dashboard — App wiring & live compute
   Everything shown (KPIs, priority ranking, charts, alerts) is
   computed in the browser from DATA.raw against the active filters,
   using the same rules as src/analysis.py and src/model.py.
   ============================================================ */
(function () {
  const D = window.DATA;
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---- precompute lookups ----
  const SIG = D.signals;
  SIG.forEach((s, i) => (s.idx = i));
  const sigById = {}; SIG.forEach((s) => (sigById[s.id] = s));
  const featuredIds = D.featured.map((s) => s.id);
  const dayMeta = D.dayList.map((dt) => { const j = dt.getDay(); return { date: dt, jsDay: j, weekend: j === 0 || j === 6 }; });
  const TODAY = dayMeta[dayMeta.length - 1].date;
  const rowMap = {}; D.raw.forEach((r) => (rowMap[r.s + "_" + r.d + "_" + r.h] = r));
  const ND = D.dayList.length;

  // ---- state ----
  const state = {
    active: featuredIds.slice(),
    win: 7,
    days: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
    sigma: 2.5,
    tab: "performance",
  };
  let V = {}; // current computed view

  /* ================= window / filter helpers ================= */
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  function winIndices() { return range(ND - state.win, ND - 1); }
  function priorIndices() { const end = ND - state.win - 1; if (end < 0) return []; return range(Math.max(0, ND - 2 * state.win), end); }
  function dowOk(d) { return !!state.days[dayMeta[d].jsDay]; }
  function rowsFor(indices) { const set = new Set(indices.filter(dowOk)); return D.raw.filter((r) => set.has(r.d)); }
  function isAlert(r) { return r.vz <= -state.sigma || r.az >= state.sigma || r.sz >= state.sigma; }
  const sgn = (v) => (v > 0 ? "+" : "") + v.toFixed(1);

  /* ================= compute layer ================= */
  function computePriority(rows) {
    const agg = SIG.map(() => ({ sf: 0, aorS: 0, pedS: 0, volS: 0, n: 0 }));
    rows.forEach((r) => {
      if (dayMeta[r.d].weekend) return; // weekday only, per analysis.py
      const a = agg[r.s];
      a.n++; a.aorS += r.aor; a.pedS += r.ped; a.volS += r.vol;
      if (D.pmPeak.includes(r.h)) a.sf += r.sf;
    });
    const recs = SIG.map((s, i) => {
      const a = agg[i], n = a.n || 1;
      return { id: s.id, name: s.name, pmsf: a.sf, aor: a.n ? a.aorS / n : 0, ped: a.n ? a.pedS / n : 0, vol: a.n ? a.volS / n : 0 };
    });
    const norm = (key) => { const vals = recs.map((r) => r[key]); const mn = Math.min(...vals), mx = Math.max(...vals), d = mx - mn; return (v) => (d ? (v - mn) / d : 0); };
    const nsf = norm("pmsf"), naor = norm("aor"), nped = norm("ped");
    recs.forEach((r) => (r.score = (D.weights.sf * nsf(r.pmsf) + D.weights.aor * naor(r.aor) + D.weights.ped * nped(r.ped)) * 100));
    recs.sort((a, b) => b.score - a.score);
    recs.forEach((r, i) => { r.rank = i + 1; r.pri = r.score >= 70 ? "High" : r.score >= 40 ? "Medium" : "Low"; });
    return recs;
  }

  function computeKpis(cur, prev, priority) {
    const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
    const mean = (rows, k) => (rows.length ? sum(rows, k) / rows.length : 0);
    const volNow = sum(cur, "vol"), volPrev = sum(prev, "vol");
    const aorNow = mean(cur, "aor"), aorPrev = mean(prev, "aor");
    const sfNow = sum(cur, "sf"), sfPrev = sum(prev, "sf");
    const high = priority.filter((r) => r.pri === "High").length;

    const pctDelta = (now, prev) => { if (!prev) return { txt: "no prior data", up: null }; const c = (now - prev) / prev * 100; return { txt: (c >= 0 ? "↑" : "↓") + " " + Math.abs(c).toFixed(1) + "% vs prior", up: c >= 0 }; };
    const vd = pctDelta(volNow, volPrev);
    const ad = prev.length ? (() => { const c = aorNow - aorPrev; return { txt: (c >= 0 ? "↑" : "↓") + " " + Math.abs(c).toFixed(1) + " pts", up: c >= 0 }; })() : { txt: "no prior data", up: null };
    const sd = pctDelta(sfNow, sfPrev);
    let hd;
    if (!prev.length) hd = { txt: "no prior data" };
    else { const hp = computePriority(prev).filter((r) => r.pri === "High").length; const d = high - hp; hd = { txt: d === 0 ? "no change" : (d > 0 ? "↑ " : "↓ ") + Math.abs(d) + " vs prior" }; }

    return [
      { label: "Total Volume", value: +(volNow / 1e6).toFixed(1), unit: "M veh", fmt: "M", delta: vd.txt, tone: "mute" },
      { label: "Avg Arrivals-on-Red", value: +aorNow.toFixed(1), unit: "%", fmt: "pct", delta: ad.txt, tone: ad.up == null ? "mute" : ad.up ? "regress" : "improve" },
      { label: "Split Failures", value: Math.round(sfNow), unit: "", fmt: "int", delta: sd.txt, tone: sd.up == null ? "mute" : sd.up ? "regress" : "improve" },
      { label: "High-Priority Signals", value: high, unit: "", fmt: "int", delta: hd.txt, tone: "mute" },
    ];
  }

  function computeInsight(priority, cur) {
    const top = priority[0];
    if (!top || top.score <= 0) return "No signal stands out across the selected window. The network is within normal range.";
    const i = sigById[top.id].idx, hours = {};
    cur.forEach((r) => { if (r.s === i && !dayMeta[r.d].weekend && D.pmPeak.includes(r.h)) hours[r.h] = (hours[r.h] || 0) + r.sf; });
    let wh = 18, wm = -1; for (const h in hours) if (hours[h] > wm) { wm = hours[h]; wh = +h; }
    return `<b>${esc(top.name)}</b> (${top.id}) is the top retiming candidate: <span class="mono">${top.pmsf}</span> PM-peak split failures over the window, concentrated around <span class="mono">${wh}:00</span> weekdays.`;
  }

  function computeSeries() {
    const idxs = winIndices().filter(dowOk).sort((a, b) => a - b);
    const positions = [], tList = [], dayTicks = [];
    idxs.forEach((d) => { for (let h = 0; h < 24; h++) { const pos = positions.length; positions.push({ d, h }); const dt = new Date(dayMeta[d].date.getTime()); dt.setHours(h); tList.push(dt); if (h === 0) dayTicks.push({ pos, label: FMT.MON[dayMeta[d].date.getMonth()] + " " + dayMeta[d].date.getDate() }); } });
    const series = {}, colors = {};
    D.featured.forEach((f) => {
      const i = sigById[f.id].idx; colors[f.id] = f.hex;
      series[f.id] = positions.map((p) => { const r = rowMap[i + "_" + p.d + "_" + p.h]; return r ? { v: r.aor, anomaly: isAlert(r) } : { v: 0, anomaly: false }; });
    });
    return { series, tList, dayTicks, colors };
  }

  function computeHourPattern(cur) {
    const wd = {}, we = {};
    D.featured.forEach((f) => { wd[f.id] = Array.from({ length: 24 }, () => []); we[f.id] = Array.from({ length: 24 }, () => []); });
    cur.forEach((r) => { const s = SIG[r.s]; if (!s.featured) return; (dayMeta[r.d].weekend ? we : wd)[s.id][r.h].push(r.aor); });
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const weekday = {}, weekend = {};
    D.featured.forEach((f) => { weekday[f.id] = wd[f.id].map(avg); weekend[f.id] = we[f.id].map(avg); });
    return { weekday, weekend };
  }

  function computeHeatmap(cur, activeIds) {
    const rows = []; let max = 0;
    D.featured.forEach((f) => {
      if (!activeIds.includes(f.id)) return;
      const i = sigById[f.id].idx, cells = Array(24).fill(0);
      cur.forEach((r) => { if (r.s === i) cells[r.h] += r.sf; });
      rows.push({ id: f.id, name: f.name, cells }); max = Math.max(max, ...cells);
    });
    return { rows, max };
  }

  function computeAlerts(cur) {
    const groups = {};
    cur.filter(isAlert).forEach((r) => { const k = r.s + "_" + r.d; (groups[k] = groups[k] || []).push(r); });
    const eps = [];
    Object.values(groups).forEach((g) => {
      let peak = g[0], pa = -1;
      g.forEach((r) => { const a = Math.max(Math.abs(r.vz), Math.abs(r.az), Math.abs(r.sz)); if (a > pa) { pa = a; peak = r; } });
      const zs = { volume: peak.vz, aor: peak.az, sf: peak.sz };
      let dom = "volume", da = -1; for (const k in zs) if (Math.abs(zs[k]) > da) { da = Math.abs(zs[k]); dom = k; }
      const sev = zs[dom];
      const line = dom === "volume" ? `${sgn(sev)}σ volume, possible detector fault.` : dom === "aor" ? `${sgn(sev)}σ arrivals-on-red.` : `${sgn(sev)}σ split failures.`;
      const subs = [];
      if (dom !== "aor" && peak.az >= state.sigma) subs.push(`Arrivals-on-red ${Math.round(peak.aor)}% (${sgn(peak.az)}σ)`);
      if (dom !== "sf" && peak.sz >= state.sigma) subs.push(`${peak.sf} split failures (${sgn(peak.sz)}σ)`);
      if (dom !== "volume" && peak.vz <= -state.sigma) subs.push(`Volume ${Math.round(peak.vol)} vph (${sgn(peak.vz)}σ)`);
      const dt = new Date(dayMeta[peak.d].date.getTime()); dt.setHours(peak.h);
      const s = SIG[peak.s];
      eps.push({ id: s.id, name: s.name, when: dt, sev: +sev.toFixed(1), metric: dom, line, sub: subs.length ? subs.join(". ") : "Excursion against the time-of-week baseline.", hex: s.hex });
    });
    eps.sort((a, b) => b.when - a.when);
    return eps;
  }

  /* ================= rendering ================= */
  function fmtKpi(v, fmt) {
    if (!Number.isFinite(v)) return "—";
    if (fmt === "M" || fmt === "pct") return v.toFixed(1);
    return Math.round(v).toLocaleString();
  }
  function reveal(node, delay) {
    if (REDUCED || document.hidden) return;
    node.style.opacity = "0"; node.style.transform = "translateY(8px)";
    node.style.transition = "opacity 360ms var(--ease-in), transform 360ms var(--ease-in)";
    setTimeout(() => { node.style.opacity = "1"; node.style.transform = "none"; }, delay);
  }

  function renderKpis(animate) {
    const wrap = $("#kpiStrip"); wrap.innerHTML = "";
    V.kpis.forEach((k, i) => {
      const card = document.createElement("div"); card.className = "kpi";
      card.innerHTML = `
        <span class="caption">${k.label}</span>
        <div class="kpi-val"><span class="kpi-num" data-target="${k.value}" data-fmt="${k.fmt}">${fmtKpi(k.value, k.fmt)}</span><span class="unit">${k.unit}</span></div>
        <div class="kpi-delta ${k.tone}">${k.delta}</div>`;
      wrap.appendChild(card);
      if (animate) reveal(card, 100 + i * 40);
    });
    if (animate) countUp();
  }
  function countUp() {
    if (REDUCED) return;
    $$(".kpi-num").forEach((node) => {
      const target = parseFloat(node.dataset.target); if (!Number.isFinite(target)) return;
      const fmt = node.dataset.fmt, dur = 600, start = performance.now();
      (function frame(now) {
        const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
        node.textContent = fmtKpi(target * e, fmt);
        if (t < 1) requestAnimationFrame(frame); else node.textContent = fmtKpi(target, fmt);
      })(performance.now());
    });
  }

  function renderInsight() { $("#insightText").innerHTML = `<span class="insight-lead">Insight.</span> ` + V.insight; }
  function renderTabCounts() {
    const pc = $('.tab[data-tab="priority"] .tab-count'); if (pc) pc.textContent = V.priority.length;
    const ac = $("#alertTabCount"); if (ac) ac.textContent = V.alerts.length;
  }

  function windowLabel() {
    const idxs = winIndices().filter(dowOk); if (!idxs.length) return "—";
    const a = dayMeta[Math.min(...idxs)].date, b = dayMeta[Math.max(...idxs)].date;
    return `${FMT.MON[a.getMonth()]} ${a.getDate()} – ${FMT.MON[b.getMonth()]} ${b.getDate()}`;
  }

  function renderSigChips() {
    const wrap = $("#sigChips"); wrap.innerHTML = "";
    D.featured.forEach((s) => {
      const on = state.active.includes(s.id);
      const chip = document.createElement("button");
      chip.className = "chip " + (on ? "is-on" : "is-off"); chip.style.color = on ? s.hex : "";
      chip.innerHTML = `<span class="dot" style="background:${s.hex}"></span>${s.id.replace("SIG-", "")}`;
      chip.title = s.name;
      chip.addEventListener("click", () => { toggleActive(s.id); });
      wrap.appendChild(chip);
    });
  }
  function renderLegend() {
    const wrap = $("#lineLegend"); wrap.innerHTML = "";
    D.featured.forEach((s) => {
      const on = state.active.includes(s.id);
      const chip = document.createElement("button");
      chip.className = "chip " + (on ? "is-on" : "is-off"); chip.style.color = on ? s.hex : "";
      chip.innerHTML = `<span class="dot" style="background:${s.hex}"></span>${s.id} <span style="color:var(--mute-2);margin-left:2px">${esc(s.name.replace("State St & ", ""))}</span>`;
      chip.addEventListener("click", () => { toggleActive(s.id); });
      wrap.appendChild(chip);
    });
  }
  function toggleActive(id) {
    const i = state.active.indexOf(id);
    if (i >= 0) state.active.splice(i, 1); else state.active.push(id);
    renderSigChips(); renderLegend(); updateFilterActive(); renderActiveTab();
  }
  function renderDow() {
    const wrap = $("#dowRow"); wrap.innerHTML = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach((d, i) => {
      const on = !!state.days[i];
      const b = document.createElement("button"); b.className = "dow " + (on ? "is-on" : "is-off"); b.textContent = d;
      b.title = FMT.DOW[i];
      b.addEventListener("click", () => { state.days[i] = on ? 0 : 1; renderDow(); updateFilterActive(); refresh(); });
      wrap.appendChild(b);
    });
  }
  function updateFilterActive() {
    $("#fc-sigs").classList.toggle("is-active", state.active.length !== D.featured.length);
    $("#fc-dates").classList.toggle("is-active", state.win !== 7);
    $("#fc-days").classList.toggle("is-active", !Object.values(state.days).every((v) => v === 1));
    $("#fc-sigma").classList.toggle("is-active", state.sigma !== 2.5);
  }
  function wireFilters() {
    $$("#dateSeg button").forEach((b) => b.addEventListener("click", () => {
      $$("#dateSeg button").forEach((x) => x.classList.remove("is-on"));
      b.classList.add("is-on"); state.win = +b.dataset.win; updateFilterActive(); refresh();
    }));
    const slider = $("#sigmaSlider");
    slider.addEventListener("input", () => { state.sigma = +slider.value; $("#sigmaVal").textContent = (+slider.value).toFixed(1); updateFilterActive(); refresh(); });
    $("#resetFilters").addEventListener("click", () => {
      state.active = featuredIds.slice(); state.win = 7; state.sigma = 2.5;
      Object.keys(state.days).forEach((k) => (state.days[k] = 1));
      slider.value = 2.5; $("#sigmaVal").textContent = "2.5";
      $$("#dateSeg button").forEach((x) => x.classList.toggle("is-on", x.dataset.win === "7"));
      renderSigChips(); renderDow(); renderLegend(); updateFilterActive(); refresh();
    });
  }

  /* ================= tabs ================= */
  function moveUnderline() { const a = $(`.tab[data-tab="${state.tab}"]`); const u = $("#tabUnderline"); u.style.left = a.offsetLeft + "px"; u.style.width = a.offsetWidth + "px"; }
  function setTab(tab) {
    state.tab = tab;
    try { localStorage.setItem("sp_tab", tab); } catch (e) {}
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    $$(".tabpanel").forEach((p) => p.classList.toggle("is-on", p.id === "panel-" + tab));
    const panel = $("#panel-" + tab);
    if (!REDUCED && !document.hidden) { panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = "fadeUp 200ms var(--ease-in)"; }
    moveUnderline(); renderActiveTab();
  }
  function wireTabs() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { moveUnderline(); renderActiveTab(); }, 120); });
  }

  function emptyState() {
    return `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <div class="eh">No intersections selected</div>
      <div class="et">Pick one or more signals from the sidebar to populate this view.</div>
    </div>`;
  }

  /* ================= per-tab renders ================= */
  function renderActiveTab() {
    if (state.tab === "performance") renderPerformance();
    else if (state.tab === "priority") renderPriority();
    else renderAlerts();
  }

  function renderPerformance() {
    const lcw = $("#lcWindow"); if (lcw) lcw.textContent = windowLabel();
    const lc = $("#lineChart");
    if (state.active.length === 0) { lc.innerHTML = emptyState(); $("#smWeekday").innerHTML = ""; $("#smWeekend").innerHTML = ""; return; }
    const s = computeSeries();
    const emphasisId = (V.priority.find((r) => sigById[r.id].featured) || {}).id || featuredIds[0];
    C.LineChart(lc, { series: s.series, tList: s.tList, dayTicks: s.dayTicks, colors: s.colors, activeIds: state.active, emphasisId, height: 340 });
    const hp = computeHourPattern(V.cur);
    const allH = [...Object.values(hp.weekday), ...Object.values(hp.weekend)].flat();
    const yMax = Math.max(10, Math.ceil(Math.max(...allH, 0) / 10) * 10);
    C.SmallMultiple($("#smWeekday"), { data: hp.weekday, colors: s.colors, activeIds: state.active, emphasisId, title: "Weekday", yMax, height: 230 });
    C.SmallMultiple($("#smWeekend"), { data: hp.weekend, colors: s.colors, activeIds: state.active, emphasisId, title: "Weekend", yMax, height: 230 });
  }

  function scoreColor(score) {
    const t = Math.min(1, score / 100), lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const accent = [31, 110, 67], warn = [201, 122, 30], alert = [192, 57, 43];
    const c = t < 0.5 ? lerp(accent, warn, t / 0.5) : lerp(warn, alert, (t - 0.5) / 0.5);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function renderPriority() {
    const table = $("#ptable");
    const maxScore = Math.max(...V.priority.map((r) => r.score), 1) || 1;
    table.innerHTML = `
      <thead><tr>
        <th class="l">#</th><th class="l">ID</th><th class="l">Signal</th>
        <th>PM SF</th><th>AoR</th><th>Ped (s)</th><th>Vol (vph)</th><th>Score</th><th class="l" style="padding-left:18px">Priority</th>
      </tr></thead><tbody></tbody>`;
    const tb = $("tbody", table);
    V.priority.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.pri === "High") tr.classList.add("is-high"); else if (r.pri === "Medium") tr.classList.add("is-medium");
      const barW = (r.score / maxScore) * 70;
      tr.innerHTML = `
        <td class="l rank">${r.rank}</td>
        <td class="l sig-id">${esc(r.id)}</td>
        <td class="l sig-name">${esc(r.name)}</td>
        <td class="num">${r.pmsf}</td>
        <td class="num">${r.aor.toFixed(1)}%</td>
        <td class="num">${r.ped.toFixed(1)}</td>
        <td class="num">${Math.round(r.vol)}</td>
        <td class="num score-cell"><span class="score-bar" style="width:${barW}px;background:${scoreColor(r.score)}"></span><span class="score-num">${r.score.toFixed(1)}</span></td>
        <td class="l" style="padding-left:18px"><span class="pri-pill ${r.pri.toLowerCase()}"><span class="pdot"></span>${r.pri}</span></td>`;
      tr.addEventListener("click", () => openDrawer(r));
      tb.appendChild(tr);
    });
    const hm = computeHeatmap(V.cur, state.active);
    C.Heatmap($("#heatmap"), hm);
    $("#heatScale").innerHTML = `0 <span style="display:inline-block;width:54px;height:9px;border-radius:3px;margin:0 6px;vertical-align:middle;background:linear-gradient(90deg,#FAF8F4,#C97A1E,#C0392B);border:1px solid var(--line)"></span> ${hm.max}`;
  }

  function renderAlerts() {
    const eps = V.alerts;
    // alerts-per (all signals with alerts) + scatter lanes
    const cnt = {}; eps.forEach((e) => (cnt[e.id] = (cnt[e.id] || 0) + 1));
    const perData = Object.keys(cnt).map((id) => ({ id, n: cnt[id], hex: sigById[id].hex })).sort((a, b) => b.n - a.n);
    C.HorizontalBars($("#alertBars"), { data: perData, height: 200 });

    const lanes = perData.map((d) => ({ id: d.id, hex: sigById[d.id].hex }));
    const laneIdx = {}; lanes.forEach((l, i) => (laneIdx[l.id] = i));
    const points = eps.map((e) => ({ lane: laneIdx[e.id], t: e.when, sev: e.sev, hex: e.hex, id: e.id }));
    const idxs = winIndices().filter(dowOk);
    let tMin = 0, tMax = 1, dayTicks = [];
    if (idxs.length) {
      const sorted = [...idxs].sort((a, b) => a - b);
      tMin = dayMeta[sorted[0]].date.getTime();
      const last = new Date(dayMeta[sorted[sorted.length - 1]].date.getTime()); last.setHours(23); tMax = last.getTime();
      [...new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]])]
        .forEach((d) => dayTicks.push({ t: dayMeta[d].date.getTime(), label: FMT.MON[dayMeta[d].date.getMonth()] + " " + dayMeta[d].date.getDate() }));
    }
    C.ScatterLane($("#alertScatter"), { lanes, points, tMin, tMax, dayTicks, height: 200 });

    // feed, grouped by day
    const feed = $("#alertFeed"); feed.innerHTML = "";
    if (!eps.length) { feed.innerHTML = `<div class="empty-state" style="padding:48px 20px"><div class="eh">No alerts</div><div class="et">Nothing exceeds σ ≥ ${state.sigma.toFixed(1)} in this window. Lower the threshold to see more.</div></div>`; return; }
    const groups = {};
    eps.forEach((a) => { const k = dayKey(a.when); (groups[k] = groups[k] || []).push(a); });
    Object.keys(groups).forEach((k) => {
      const h = document.createElement("div"); h.className = "alert-group-head"; h.textContent = k; feed.appendChild(h);
      groups[k].forEach((a, i) => {
        const isHi = Math.abs(a.sev) > 4;
        const card = document.createElement("div"); card.className = "alert-card " + (isHi ? "sev-alert" : "sev-warn");
        const t = a.when, timeStr = `${FMT.DOW[t.getDay()]} ${FMT.MON[t.getMonth()]} ${t.getDate()}, ${fmtTime(t)}`;
        card.innerHTML = `
          <div class="alert-row1">
            <div class="alert-sig"><span class="sdot" style="background:${isHi ? "var(--alert)" : a.hex}"></span><span class="sid">${esc(a.id)}</span><span class="sname">${esc(a.name)}</span></div>
            <span class="alert-time">${timeStr}</span>
          </div>
          <div class="alert-line">${a.line.replace(/([+-]?\d[\d.]*σ)/g, '<span class="sig-val">$1</span>')}</div>
          <div class="alert-sub">${a.sub.replace(/([+-]?\d[\d.]*σ)/g, '<span class="sig-val" style="font-family:var(--mono)">$1</span>')}</div>
          <button class="alert-inspect">inspect <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M9 7h8v8"/></svg></button>`;
        card.querySelector(".alert-inspect").addEventListener("click", () => {
          const row = V.priority.find((r) => r.id === a.id); if (row) openDrawer(row);
        });
        feed.appendChild(card); reveal(card, 60 + i * 40);
      });
    });
  }

  function dayKey(d) {
    const diff = Math.round((new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff === 0) return "Today"; if (diff === 1) return "Yesterday";
    return `${FMT.MON[d.getMonth()]} ${d.getDate()}`;
  }
  function fmtTime(t) { let h = t.getHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(t.getMinutes()).padStart(2, "0")} ${ap}`; }

  /* ================= drawer ================= */
  function openDrawer(r) {
    const sig = sigById[r.id], hex = sig ? sig.hex : "#6E6B62";
    $("#drawerDot").style.background = hex;
    $("#drawerId").textContent = `${r.id} · rank ${r.rank}`;
    $("#drawerTitle").textContent = r.name;
    $("#drawerBody").innerHTML = `
      <div class="drawer-stats">
        <div class="drawer-stat"><span class="caption">Composite score</span><div class="v" style="color:${scoreColor(r.score)}">${(r.score || 0).toFixed(1)}</div></div>
        <div class="drawer-stat"><span class="caption">PM split failures</span><div class="v">${r.pmsf}</div></div>
        <div class="drawer-stat"><span class="caption">Arrivals-on-red</span><div class="v">${(r.aor || 0).toFixed(1)}%</div></div>
        <div class="drawer-stat"><span class="caption">Ped delay (s)</span><div class="v">${(r.ped || 0).toFixed(1)}</div></div>
      </div>
      <div class="drawer-section-t">Recommendation</div>
      <p style="font-size:14px;color:var(--ink);margin:0 0 18px;line-height:1.55">
        ${r.pri === "High"
        ? "Re-time the PM-peak split plan; reallocate green to the heaviest through phase between 16:00–19:00 on weekdays. Verify upstream coordination offset."
        : r.pri === "Medium"
          ? "Watchlist. Review the PM-peak split allocation; revisit if the score trends up next window."
          : "Within normal range. Continue monitoring; no retiming action required this window."}
      </p>
      <div class="drawer-section-t">Window context</div>
      <p style="font-size:13.5px;color:var(--mute);margin:0;line-height:1.55">Volume ${Math.round(r.vol)} vph · ${windowLabel()} · weekday PM peak. Composite score weights PM-peak split failures (55%), arrivals-on-red (30%), pedestrian delay (15%).</p>`;
    $("#scrim").classList.add("is-on"); $("#drawer").classList.add("is-on"); $("#drawer").setAttribute("aria-hidden", "false");
    $("#drawerClose").focus();
  }
  function closeDrawer() { $("#scrim").classList.remove("is-on"); $("#drawer").classList.remove("is-on"); $("#drawer").setAttribute("aria-hidden", "true"); }

  /* ================= user menu ================= */
  function wireUserMenu() {
    const btn = $("#userBtn"), menu = $("#userMenu"); if (!btn || !menu) return;
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  /* ================= refresh / load / init ================= */
  function refresh(animateKpi) {
    V.cur = rowsFor(winIndices());
    V.prev = rowsFor(priorIndices());
    V.priority = computePriority(V.cur);
    V.kpis = computeKpis(V.cur, V.prev, V.priority);
    V.alerts = computeAlerts(V.cur);
    V.insight = computeInsight(V.priority, V.cur);
    renderInsight(); renderKpis(animateKpi); renderTabCounts(); renderActiveTab();
  }

  function runLoad() {
    const p = $("#progress"); p.style.width = "0";
    requestAnimationFrame(() => { p.style.width = "72%"; });
    setTimeout(() => { p.style.width = "100%"; setTimeout(() => { p.style.opacity = "0"; }, 200); refresh(true); }, 620);
  }

  function init() {
    try { const s = localStorage.getItem("sp_tab"); if (s) state.tab = s; } catch (e) {}
    // topbar date + sample tag from the data window
    const td = $("#topbarDate"); if (td) td.textContent = `${FMT.DOW[TODAY.getDay()]} ${FMT.MON[TODAY.getMonth()]} ${TODAY.getDate()}`;
    const sc = $("#sampleCount"); if (sc) sc.textContent = `${SIG.length} signals`;

    renderSigChips(); renderDow(); renderLegend();
    wireFilters(); wireTabs(); wireUserMenu(); updateFilterActive();
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === state.tab));
    $$(".tabpanel").forEach((p) => p.classList.toggle("is-on", p.id === "panel-" + state.tab));
    moveUnderline();

    $("#scrim").addEventListener("click", closeDrawer);
    $("#drawerClose").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

    refresh(false);   // immediate visible content (never strands blank)
    runLoad();        // progress bar + count-up
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
