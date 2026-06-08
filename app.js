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
  // ---- theme-adaptive color resolution (read CSS tokens at call time) ----
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function cssRGB(name) {
    const v = cssVar(name);
    if (v[0] === "#") { let h = v.slice(1); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }
  const seriesToken = (id) => (id === "SIG-1001" ? "--s-1001" : id === "SIG-1002" ? "--s-1002" : id === "SIG-1003" ? "--s-1003" : id === "SIG-1004" ? "--s-1004" : "--s-other");
  const seriesColor = (id) => cssVar(seriesToken(id));
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
      const i = sigById[f.id].idx; colors[f.id] = seriesColor(f.id);
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
      eps.push({ id: s.id, name: s.name, when: dt, sev: +sev.toFixed(1), metric: dom, line, sub: subs.length ? subs.join(". ") : "Excursion against the time-of-week baseline.", hex: seriesColor(s.id) });
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
      chip.className = "chip " + (on ? "is-on" : "is-off"); chip.style.color = on ? seriesColor(s.id) : "";
      chip.innerHTML = `<span class="dot" style="background:${seriesColor(s.id)}"></span>${s.id.replace("SIG-", "")}`;
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
      chip.className = "chip " + (on ? "is-on" : "is-off"); chip.style.color = on ? seriesColor(s.id) : "";
      chip.innerHTML = `<span class="dot" style="background:${seriesColor(s.id)}"></span>${s.id} <span style="color:var(--mute-2);margin-left:2px">${esc(s.name.replace("State St & ", ""))}</span>`;
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
    const accent = cssRGB("--accent"), warn = cssRGB("--warn"), alert = cssRGB("--alert");
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
    $("#heatScale").innerHTML = `0 <span style="display:inline-block;width:54px;height:9px;border-radius:3px;margin:0 6px;vertical-align:middle;background:linear-gradient(90deg,var(--surface-alt),var(--warn),var(--alert));border:1px solid var(--line)"></span> ${hm.max}`;
  }

  function renderAlerts() {
    const eps = V.alerts;
    // alerts-per (all signals with alerts) + scatter lanes
    const cnt = {}; eps.forEach((e) => (cnt[e.id] = (cnt[e.id] || 0) + 1));
    const perData = Object.keys(cnt).map((id) => ({ id, n: cnt[id], hex: seriesColor(id) })).sort((a, b) => b.n - a.n);
    C.HorizontalBars($("#alertBars"), { data: perData, height: 200 });

    const lanes = perData.map((d) => ({ id: d.id, hex: seriesColor(d.id) }));
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
    const sig = sigById[r.id], hex = sig ? seriesColor(sig.id) : cssVar("--mute");
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

  /* ================= theme toggle ================= */
  function wireThemeToggle() {
    const btn = $("#themeBtn"); if (!btn) return;
    const root = document.documentElement;
    const sync = () => { const dark = root.getAttribute("data-theme") === "dark"; btn.setAttribute("aria-pressed", String(dark)); };
    sync();
    btn.addEventListener("click", () => {
      const dark = root.getAttribute("data-theme") === "dark";
      if (dark) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", "dark");
      try { localStorage.setItem("sp_theme", dark ? "light" : "dark"); } catch (e) {}
      sync();
      // SVG fills were set to literal resolved colors at render; re-render so charts re-read tokens.
      renderSigChips(); renderLegend(); refresh();
    });
  }

  /* ================= assistant (grounded helper) ================= */
  function asstFindSignal(t) {
    let m = t.match(/sig[\s-]?(\d{3,4})/); if (m && sigById["SIG-" + m[1]]) return "SIG-" + m[1];
    m = t.match(/\b(\d{3,4})\b/); if (m && sigById["SIG-" + m[1]]) return "SIG-" + m[1];
    for (const s of SIG) { const cross = (s.name.split("&")[1] || "").trim().toLowerCase(); if (cross && t.includes(cross)) return s.id; }
    for (const s of SIG) { if (t.includes(s.name.toLowerCase())) return s.id; }
    return null;
  }
  function asstFault() { return V.alerts.find((a) => a.metric === "volume"); }
  function asstSigCard(r, extra) {
    const rec = r.pri === "High"
      ? "Recommendation: re-time the PM-peak split plan, reallocate green to the heaviest through phase 16:00–19:00 on weekdays."
      : r.pri === "Medium" ? "Watchlist, review the PM-peak split allocation." : "Within normal range, keep monitoring.";
    return `<p><b>${esc(r.name)}</b> (${r.id}) is rank <span class="mono">${r.rank}</span> of ${V.priority.length}, score <span class="mono">${r.score.toFixed(1)}</span> (${r.pri}).</p>
      <ul class="asst-list"><li>PM split failures: <span class="mono">${r.pmsf}</span></li><li>Arrivals-on-red: <span class="mono">${r.aor.toFixed(1)}%</span></li><li>Ped delay: <span class="mono">${r.ped.toFixed(1)}s</span></li><li>Volume: <span class="mono">${Math.round(r.vol)} vph</span></li></ul>
      ${extra ? `<p>${extra}</p>` : ""}<p>${rec}</p><button class="asst-action" data-sig="${r.id}">Open full detail →</button>`;
  }
  function asstAnswer(q) {
    const t = q.toLowerCase().trim();
    const words = t.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
    const has = (...ws) => ws.some((w) => t.includes(w));            // substring
    const hasW = (...ws) => ws.some((w) => words.includes(w));        // whole word
    const P = V.priority, top = P[0], win = windowLabel();
    const highN = P.filter((r) => r.pri === "High").length, A = V.alerts;

    // 1) specific intersection
    const sid = asstFindSignal(t);
    if (sid) return asstSigCard(P.find((r) => r.id === sid));

    // 2) capabilities
    if (has("what can you", "what do you do", "how can you help", "capab", "your job", "who are you")) {
      return `<p>I'm a built-in helper for this dashboard. I can explain <b>what it is</b> and how it works, define the <b>metrics</b> (split failures, arrivals-on-red, pedestrian delay), explain <b>how alerts are detected</b> and how the <b>priority score</b> works, and answer from the <b>live data</b>: the worst signal, current alerts, or any intersection (try "why SIG-1003"). What would you like?</p>`;
    }

    // 3) project / "what is this"
    if (has("what is this", "what's this", "what is it", "what am i looking", "what does this", "about this", "what is the dashboard", "explain this", "purpose", "what is signal performance") || (hasW("about") && words.length <= 3)) {
      return `<p>This is a <b>traffic-signal performance dashboard</b> for a DOT operations team. It turns raw signal-controller data into one answer: which signals are misbehaving and which to retime first. Three tabs, <b>Performance</b> (what each signal is doing), <b>Priority</b> (a ranked retiming queue), and <b>Alerts</b> (abnormal behavior). It's showing sample data for ${SIG.length} intersections right now. Ask me "how does it work" or "what is ATSPM" for more.</p>`;
    }
    if (has("atspm", "automated traffic")) {
      return `<p><b>ATSPM</b> = Automated Traffic Signal Performance Measures: using high-resolution controller data (volume, arrivals-on-red, split failures, pedestrian delay) to manage signals <i>proactively</i> instead of waiting for complaints. This dashboard mirrors that approach, reactive to proactive.</p>`;
    }
    if (has("how does it work", "how does this work", "how is this built", "how was this", "tech stack", "technology", "built with", "how do you work", "under the hood", "framework")) {
      return `<p>It's a static web app, hand-rolled SVG charts, no chart library, that computes everything <b>live in your browser</b> from a raw dataset, so the filters genuinely re-score the data. Behind it is a <b>Python pipeline</b> (pandas) that does the cleaning, the composite priority scoring, and the anomaly detection; the dashboard uses the same rules. No backend required.</p>`;
    }
    if (has("real data", "where does the data", "data come from", "data source", "fake data", "is this real", "synthetic", "sample data")) {
      return `<p>The numbers are produced by a <b>real analysis pipeline</b>, but the underlying signal data is <b>synthetic and schema-faithful</b> to UDOT Open ATSPM exports. Drop in real UDOT CSVs (or, in production, live SCATS / RITIS feeds) and the same scoring and alerting run unchanged.</p>`;
    }
    if (has("how do i use", "how to use", "navigate", "what are the tabs", "tabs", "get started", "how do i read")) {
      return `<p>Three tabs: <b>Performance</b> (hourly arrivals-on-red + weekday/weekend patterns), <b>Priority</b> (the ranked retiming queue + a split-failure heatmap), and <b>Alerts</b> (anomalies vs each signal's baseline). Use the left sidebar to filter by signal, date window, day of week, and the anomaly threshold, everything updates live, including me.</p>`;
    }

    // 4) summary / status
    if (t === "" || has("happening", "summary", "overview", "today", "status", "going on", "brief", "tell me")) {
      const f = asstFault();
      return `<p>Over <b>${win}</b>, <b>${esc(top.name)}</b> (${top.id}) is the top retiming candidate, score <span class="mono">${top.score.toFixed(1)}</span> (${top.pri}). ${highN} high-priority signal${highN !== 1 ? "s" : ""}, ${A.length} alert${A.length !== 1 ? "s" : ""} at σ ≥ <span class="mono">${state.sigma.toFixed(1)}</span>${f ? `, including a likely detector fault at <b>${f.id}</b>` : ""}.</p>`;
    }

    // 5) worst / retime first
    if (has("worst", "retime", "first", "biggest problem", "most attention", "what should i fix", "priority signal")) return asstSigCard(top, `It tops the queue of ${P.length} signals.`);

    // 6) how alerts/anomalies are detected (explanation) — before the alert listing
    if (has("how are alert", "how do alert", "how are anomal", "how do you detect", "what is an alert", "what is a anomaly", "what is an anomaly", "how alerts work", "baseline", "z-score", "z score", "how do you flag")) {
      return `<p>Each signal gets its own <b>baseline</b> per (weekday/weekend, hour). The recent window is z-scored against it, anything past the <b>sigma threshold</b> (the sidebar slider, currently <span class="mono">${state.sigma.toFixed(1)}</span>) is flagged. The baseline is built from history only, so an anomaly can't hide inside its own baseline.</p>`;
    }
    if (has("detector fault", "detector")) {
      const f = asstFault();
      return `<p>A <b>detector fault</b> is when a signal's vehicle detector stops reporting, so volume collapses toward zero against its normal pattern (a large negative sigma).${f ? ` Here <b>${f.id}</b> shows one: ${f.line}` : ""} You want to catch these before they skew the timing.</p>`;
    }

    // 7) alert listing
    if (has("alert", "anomal", "broken", "spike", "wrong", "issues", "problems")) {
      if (!A.length) return `<p>No alerts above σ ≥ <span class="mono">${state.sigma.toFixed(1)}</span> in this window. Lower the threshold in the sidebar to surface more.</p>`;
      const li = A.slice(0, 6).map((a) => `<li><b>${a.id}</b> ${a.line} <span style="color:var(--mute)">· ${FMT.DOW[a.when.getDay()]} ${FMT.MON[a.when.getMonth()]} ${a.when.getDate()}</span></li>`).join("");
      return `<p>${A.length} alert${A.length !== 1 ? "s" : ""} at σ ≥ <span class="mono">${state.sigma.toFixed(1)}</span>:</p><ul class="asst-list">${li}</ul>`;
    }

    // 8) metrics
    if (has("split fail", "split-fail") || hasW("split", "sf")) return `<p><b>Split failures</b> are phases that ran out of green during a cycle, the strongest sign of oversaturation (55% of the score). <b>${esc(top.name)}</b> leads with <span class="mono">${top.pmsf}</span> PM-peak failures over ${win}.</p>`;
    if (has("arrivals", "on red", "progression") || hasW("aor")) { const k = V.kpis.find((x) => x.label.includes("Arrivals")); return `<p><b>Arrivals-on-red</b> is the share of vehicles hitting a red; high under load means poor progression (30% of the score). Network average is <span class="mono">${k.value}%</span> (${k.delta}).</p>`; }
    if (hasW("volume", "vph", "vehicles", "traffic")) { const k = V.kpis[0]; return `<p><b>Total volume</b> over ${win} is <span class="mono">${k.value} ${k.unit}</span> (${k.delta}).</p>`; }
    if (has("pedestrian", "ped delay") || hasW("ped", "walk", "crossing")) return `<p><b>Pedestrian delay</b> is the average wait after a button press (15% of the score). <b>${esc(top.name)}</b> averages <span class="mono">${top.ped.toFixed(1)}s</span>.</p>`;

    // 9) score / priority queue
    if (has("score", "composite", "weight", "ranked", "ranking", "how is rank", "retiming queue", "priority queue")) return `<p>The <b>composite score</b> = 55% PM-peak split failures + 30% arrivals-on-red + 15% pedestrian delay, each min-max normalized across the ${P.length} signals and scaled 0–100. ≥70 = High, ≥40 = Medium. The Priority tab ranks all ${P.length} signals so you know what to retime first.</p>`;

    // 10) filters / features
    if (has("filter", "window", "sigma", "threshold", "date range") || hasW("days")) return `<p>Current view: <b>${state.win}-day</b> window (${win}), σ ≥ <span class="mono">${state.sigma.toFixed(1)}</span>, charting ${state.active.length} signal${state.active.length !== 1 ? "s" : ""}. Change these in the sidebar and every number, and my answers, update live.</p>`;
    if (has("dark mode", "light mode", "theme", "dark theme")) return `<p>Use the <b>sun/moon button</b> in the top bar to switch light and dark. It follows your system setting by default and remembers your choice.</p>`;
    if (has("mobile", "phone", "responsive")) return `<p>Yes, it's responsive, the sidebar and panels stack on smaller screens so it works on a phone.</p>`;
    if (has("who made", "who built", "who created", "author", "your creator")) return `<p>It's a <b>portfolio project by Shafay</b>, built to demonstrate proactive, ATSPM-style signal management, raw data to a ranked list of what to fix.</p>`;
    if (has("how many", "number of signal") || hasW("count")) return `<p>${SIG.length} signals total; the queue ranks all ${P.length}. ${highN} ${highN === 1 ? "is" : "are"} High priority right now.</p>`;

    // 11) greeting (whole word, so "this"/"high" don't trigger it)
    if (hasW("hi", "hello", "hey", "yo", "hiya", "sup") || has("good morning", "good afternoon")) {
      return `<p>Hi, I'm the dashboard helper. I can explain what this is and how it works, define any metric, or answer from the live data, what to retime first, the alerts, or any intersection. Try a chip below.</p>`;
    }

    // 12) fallback
    return `<p>I'm not sure I caught that. I can help with:</p><ul class="asst-list"><li><b>What this is</b> and how it's built</li><li>The <b>metrics</b> (split failures, arrivals-on-red, pedestrian delay, volume)</li><li><b>How alerts are detected</b> and the <b>priority score</b></li><li>Live data: the <b>worst signal</b>, current <b>alerts</b>, or any <b>intersection</b> ("why SIG-1003")</li></ul>`;
  }
  function wireAssistant() {
    const panel = $("#asst"), btn = $("#asstBtn"), body = $("#asstBody"), chips = $("#asstChips"), form = $("#asstForm"), input = $("#asstInput");
    if (!panel || !btn) return;
    let greeted = false;
    const add = (html, who) => { const m = document.createElement("div"); m.className = "asst-msg " + who; if (who === "user") m.textContent = html; else m.innerHTML = html; body.appendChild(m); body.scrollTop = body.scrollHeight; };
    const ask = (q) => { add(q, "user"); setTimeout(() => add(asstAnswer(q), "bot"), 180); };
    const SUGG = ["What is this?", "What's happening?", "What do I retime first?", "Any alerts?", "How does it work?"];
    chips.innerHTML = ""; SUGG.forEach((c) => { const b = document.createElement("button"); b.className = "asst-chip"; b.textContent = c; b.addEventListener("click", () => ask(c)); chips.appendChild(b); });
    try { if (!localStorage.getItem("sp_asst_seen")) btn.classList.add("nudge"); } catch (e) {}
    const open = () => { panel.classList.add("is-on"); panel.setAttribute("aria-hidden", "false"); btn.setAttribute("aria-expanded", "true"); btn.classList.remove("nudge"); try { localStorage.setItem("sp_asst_seen", "1"); } catch (e) {} if (!greeted) { greeted = true; add(asstAnswer(""), "bot"); } setTimeout(() => input.focus(), 80); };
    const close = () => { panel.classList.remove("is-on"); panel.setAttribute("aria-hidden", "true"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => (panel.classList.contains("is-on") ? close() : open()));
    $("#asstClose").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("is-on")) close(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ""; ask(q); });
    body.addEventListener("click", (e) => { const a = e.target.closest(".asst-action"); if (a) { const r = V.priority.find((x) => x.id === a.dataset.sig); if (r) openDrawer(r); } });
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
    wireFilters(); wireTabs(); wireUserMenu(); wireThemeToggle(); wireAssistant(); updateFilterActive();
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
