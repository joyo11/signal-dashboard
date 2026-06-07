/* ============================================================
   Signal Performance Dashboard — App wiring & interactions
   ============================================================ */
(function () {
  const D = window.DATA;
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- state ----
  const state = {
    active: D.featured.map((s) => s.id),   // visible signal ids
    win: 7,
    days: { 0:1,1:1,2:1,3:1,4:1,5:1,6:1 }, // dow on/off
    sigma: 2,
    tab: "performance",
    loaded: false,
  };

  function fmtKpi(v, fmt) {
    if (fmt === "M") return v.toFixed(1);
    if (fmt === "pct") return v.toFixed(1);
    return Math.round(v).toLocaleString();
  }

  // Entrance reveal that NEVER strands content invisible:
  // if the tab is hidden (capture/background), transitions are frozen, so we
  // leave the element in its visible base state and skip the animation entirely.
  function reveal(node, delay) {
    if (document.hidden) return;
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    node.style.transition = "opacity 360ms var(--ease-in), transform 360ms var(--ease-in)";
    setTimeout(() => { node.style.opacity = "1"; node.style.transform = "none"; }, delay);
  }

  /* ================= KPI strip ================= */
  function renderKpis() {
    const wrap = $("#kpiStrip");
    wrap.innerHTML = "";
    D.kpis.forEach((k, i) => {
      const card = document.createElement("div");
      card.className = "kpi";
      const tone = k.dir === "improve" ? "improve" : k.dir === "regress" ? "regress" : "mute";
      card.innerHTML = `
        <span class="caption">${k.label}</span>
        <div class="kpi-val"><span class="kpi-num" data-target="${k.value}" data-fmt="${k.fmt}">${fmtKpi(k.value, k.fmt)}</span><span class="unit">${k.unit}</span></div>
        <div class="kpi-delta ${tone}">${k.delta}</div>`;
      wrap.appendChild(card);
      reveal(card, 100 + i * 40);
    });
  }

  function countUp() {
    $$(".kpi-num").forEach((node) => {
      const target = parseFloat(node.dataset.target);
      const fmt = node.dataset.fmt;
      const dur = 600, start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
        node.textContent = fmtKpi(target * e, fmt);
        if (t < 1) requestAnimationFrame(frame);
        else node.textContent = fmtKpi(target, fmt);
      }
      requestAnimationFrame(frame);
    });
  }

  /* ================= Insight banner ================= */
  function renderInsight() {
    $("#insightText").innerHTML =
      `<span class="insight-lead">Insight.</span> ` + D.insightHtml;
  }

  // Tab counts reflect the real pipeline output.
  function renderTabCounts() {
    const pc = $('.tab[data-tab="priority"] .tab-count');
    if (pc) pc.textContent = D.priority.length;
    const ac = $("#alertTabCount");
    if (ac) ac.textContent = D.alerts.length;
  }

  /* ================= Sidebar filters ================= */
  function renderSigChips() {
    const wrap = $("#sigChips");
    wrap.innerHTML = "";
    D.featured.forEach((s) => {
      const on = state.active.includes(s.id);
      const chip = document.createElement("button");
      chip.className = "chip " + (on ? "is-on" : "is-off");
      chip.style.color = on ? s.hex : "";
      chip.innerHTML = `<span class="dot" style="background:${s.hex}"></span>${s.id.replace("SIG-","")}`;
      chip.title = s.name;
      chip.addEventListener("click", () => {
        const idx = state.active.indexOf(s.id);
        if (idx >= 0) state.active.splice(idx, 1); else state.active.push(s.id);
        renderSigChips(); renderLegend(); updateFilterActive(); renderActiveTab();
      });
      wrap.appendChild(chip);
    });
  }

  function renderDow() {
    const wrap = $("#dowRow");
    wrap.innerHTML = "";
    ["S","M","T","W","T","F","S"].forEach((d, i) => {
      const on = !!state.days[i];
      const b = document.createElement("button");
      b.className = "dow " + (on ? "is-on" : "is-off");
      b.textContent = d;
      b.addEventListener("click", () => { state.days[i] = on ? 0 : 1; renderDow(); updateFilterActive(); });
      wrap.appendChild(b);
    });
  }

  function updateFilterActive() {
    // signals: active if not all selected
    $("#fc-sigs").classList.toggle("is-active", state.active.length !== D.featured.length);
    $("#fc-dates").classList.toggle("is-active", state.win !== 7);
    const allDays = Object.values(state.days).every((v) => v === 1);
    $("#fc-days").classList.toggle("is-active", !allDays);
    $("#fc-sigma").classList.toggle("is-active", state.sigma !== 2);
  }

  function wireFilters() {
    $$("#dateSeg button").forEach((b) => b.addEventListener("click", () => {
      $$("#dateSeg button").forEach((x) => x.classList.remove("is-on"));
      b.classList.add("is-on"); state.win = +b.dataset.win; updateFilterActive();
    }));
    const slider = $("#sigmaSlider");
    slider.addEventListener("input", () => { state.sigma = +slider.value; $("#sigmaVal").textContent = (+slider.value).toFixed(1); updateFilterActive(); });
    $("#resetFilters").addEventListener("click", () => {
      state.active = D.featured.map((s) => s.id); state.win = 7; state.sigma = 2;
      Object.keys(state.days).forEach((k) => state.days[k] = 1);
      slider.value = 2; $("#sigmaVal").textContent = "2.0";
      $$("#dateSeg button").forEach((x) => x.classList.toggle("is-on", x.dataset.win === "7"));
      renderSigChips(); renderDow(); renderLegend(); updateFilterActive(); renderActiveTab();
    });
  }

  /* ================= Legend (line chart chips) ================= */
  function renderLegend() {
    const wrap = $("#lineLegend");
    wrap.innerHTML = "";
    D.featured.forEach((s) => {
      const on = state.active.includes(s.id);
      const chip = document.createElement("button");
      chip.className = "chip " + (on ? "is-on" : "is-off");
      chip.style.color = on ? s.hex : "";
      chip.innerHTML = `<span class="dot" style="background:${s.hex}"></span>${s.id} <span style="color:var(--mute-2);margin-left:2px">${s.name.replace("State St & ","")}</span>`;
      chip.addEventListener("click", () => {
        const idx = state.active.indexOf(s.id);
        if (idx >= 0) state.active.splice(idx, 1); else state.active.push(s.id);
        renderSigChips(); renderLegend(); updateFilterActive(); renderActiveTab();
      });
      wrap.appendChild(chip);
    });
  }

  /* ================= Tab system ================= */
  function moveUnderline() {
    const active = $(`.tab[data-tab="${state.tab}"]`);
    const u = $("#tabUnderline");
    u.style.left = active.offsetLeft + "px";
    u.style.width = active.offsetWidth + "px";
  }
  function setTab(tab) {
    state.tab = tab;
    try { localStorage.setItem("sp_tab", tab); } catch (e) {}
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    $$(".tabpanel").forEach((p) => p.classList.toggle("is-on", p.id === "panel-" + tab));
    const panel = $("#panel-" + tab);
    if (!document.hidden) {
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "fadeUp 200ms var(--ease-in)";
    }
    moveUnderline();
    renderActiveTab();
  }
  function wireTabs() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
    window.addEventListener("resize", () => { moveUnderline(); renderActiveTab(); });
  }

  /* ================= Empty state ================= */
  function emptyState() {
    return `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <div class="eh">No intersections selected</div>
      <div class="et">Pick one or more signals from the sidebar to populate this view.</div>
    </div>`;
  }

  /* ================= Render tabs ================= */
  function renderActiveTab() {
    if (state.tab === "performance") renderPerformance();
    else if (state.tab === "priority") renderPriority();
    else renderAlerts();
  }

  function renderPerformance() {
    const lcw = $("#lcWindow");
    if (lcw) lcw.textContent = D.windowLabel;
    const lc = $("#lineChart");
    if (state.active.length === 0) { lc.innerHTML = emptyState(); $("#smWeekday").innerHTML = ""; $("#smWeekend").innerHTML = ""; return; }
    C.LineChart(lc, { series: D.timeseries, dayList: D.dayList, activeIds: state.active, height: 340 });
    const allH = [...Object.values(D.hourPattern.weekday), ...Object.values(D.hourPattern.weekend)].flat();
    const yMax = Math.ceil(Math.max(...allH) / 10) * 10;
    C.SmallMultiple($("#smWeekday"), { data: D.hourPattern.weekday, activeIds: state.active, title: "Weekday", yMax, height: 230 });
    C.SmallMultiple($("#smWeekend"), { data: D.hourPattern.weekend, activeIds: state.active, title: "Weekend", yMax, height: 230 });
  }

  function scoreColor(score) {
    // accent -> warn -> alert across 0..100
    const t = Math.min(1, score / 100);
    const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const accent = [31,110,67], warn = [201,122,30], alert = [192,57,43];
    let c = t < 0.5 ? lerp(accent, warn, t / 0.5) : lerp(warn, alert, (t - 0.5) / 0.5);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function renderPriority() {
    const table = $("#ptable");
    const maxScore = Math.max(...D.priority.map((r) => r.score));
    table.innerHTML = `
      <thead><tr>
        <th class="l">#</th><th class="l">ID</th><th class="l">Signal</th>
        <th>PM SF</th><th>AoR</th><th>Ped (s)</th><th>Vol (vph)</th><th>Score</th><th class="l" style="padding-left:18px">Priority</th>
      </tr></thead><tbody></tbody>`;
    const tb = $("tbody", table);
    D.priority.forEach((r) => {
      const sig = D.featured.find((s) => s.id === r.id);
      const tr = document.createElement("tr");
      if (r.pri === "High") tr.classList.add("is-high");
      else if (r.pri === "Medium") tr.classList.add("is-medium");
      const barW = (r.score / maxScore) * 70; // px-ish within cell
      tr.innerHTML = `
        <td class="l rank">${r.rank}</td>
        <td class="l sig-id">${r.id}</td>
        <td class="l sig-name">${r.name}</td>
        <td class="num">${r.pmsf}</td>
        <td class="num">${r.aor.toFixed(1)}%</td>
        <td class="num">${r.ped.toFixed(1)}</td>
        <td class="num">${r.vol}</td>
        <td class="num score-cell"><span class="score-bar" style="width:${barW}px;background:${scoreColor(r.score)}"></span><span class="score-num">${r.score.toFixed(1)}</span></td>
        <td class="l" style="padding-left:18px"><span class="pri-pill ${r.pri.toLowerCase()}"><span class="pdot"></span>${r.pri}</span></td>`;
      tr.addEventListener("click", () => openDrawer(r));
      tb.appendChild(tr);
    });
    // heatmap
    C.Heatmap($("#heatmap"), D.heatmap);
    renderHeatScale();
  }

  function renderHeatScale() {
    $("#heatScale").innerHTML = `0 <span style="display:inline-block;width:54px;height:9px;border-radius:3px;margin:0 6px;vertical-align:middle;background:linear-gradient(90deg,#FAF8F4,#C97A1E,#C0392B);border:1px solid var(--line)"></span> ${D.heatmap.max}`;
  }

  function renderAlerts() {
    C.HorizontalBars($("#alertBars"), { data: D.alertsPer, height: 200 });
    C.ScatterLane($("#alertScatter"), { points: D.scatter, height: 200 });

    // group alerts by day
    const feed = $("#alertFeed");
    feed.innerHTML = "";
    const groups = {};
    D.alerts.forEach((a) => {
      const key = dayKey(a.when);
      (groups[key] = groups[key] || []).push(a);
    });
    Object.keys(groups).forEach((k) => {
      const h = document.createElement("div");
      h.className = "alert-group-head"; h.textContent = k;
      feed.appendChild(h);
      groups[k].forEach((a, i) => {
        const sig = D.featured.find((s) => s.id === a.id);
        const isAlert = Math.abs(a.sev) > 4;
        const card = document.createElement("div");
        card.className = "alert-card " + (isAlert ? "sev-alert" : "sev-warn");
        const t = a.when;
        const timeStr = `${FMT.DOW[t.getDay()]} ${FMT.MON[t.getMonth()]} ${t.getDate()}, ${fmtTime(t)}`;
        card.innerHTML = `
          <div class="alert-row1">
            <div class="alert-sig"><span class="sdot" style="background:${isAlert ? 'var(--alert)' : sig.hex}"></span><span class="sid">${a.id}</span><span class="sname">${a.name}</span></div>
            <span class="alert-time">${timeStr}</span>
          </div>
          <div class="alert-line">${a.line.replace(/([+-]?\d[\d.]*σ)/g, '<span class="sig-val">$1</span>')}</div>
          <div class="alert-sub">${a.sub.replace(/([+-]?\d[\d.]*σ)/g, '<span class="sig-val" style="font-family:var(--mono)">$1</span>')}</div>
          <button class="alert-inspect">inspect <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M9 7h8v8"/></svg></button>`;
        card.querySelector(".alert-inspect").addEventListener("click", () => {
          const row = D.priority.find((r) => r.id === a.id) || { id: a.id, name: a.name, pmsf: "—", aor: 0, ped: 0, vol: 0, score: 0, pri: "Low", rank: "—" };
          openDrawer(row);
        });
        feed.appendChild(card);
        reveal(card, 60 + i * 40);
      });
    });
  }

  function dayKey(d) {
    const today = new Date(2026, 5, 4);
    const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return `${FMT.MON[d.getMonth()]} ${d.getDate()}`;
  }
  function fmtTime(t) {
    let h = t.getHours(), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${String(t.getMinutes()).padStart(2, "0")} ${ap}`;
  }

  /* ================= Drawer ================= */
  function openDrawer(r) {
    const sig = D.featured.find((s) => s.id === r.id);
    const hex = sig ? sig.hex : "#6E6B62";
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
          ? "Re-time the PM-peak split plan; reallocate green to the SB through phase between 17:00–19:00 on weekdays. Verify upstream coordination offset."
          : "Within normal range. Continue monitoring; no retiming action required this window."}
      </p>
      <div class="drawer-section-t">Window context</div>
      <p style="font-size:13.5px;color:var(--mute);margin:0;line-height:1.55">Volume ${r.vol} vph · ${D.windowLabel} · weekday PM peak. Composite score weights PM-peak split failures (55%), arrivals-on-red (30%), pedestrian delay (15%).</p>`;
    $("#scrim").classList.add("is-on");
    $("#drawer").classList.add("is-on");
    $("#drawer").setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    $("#scrim").classList.remove("is-on");
    $("#drawer").classList.remove("is-on");
    $("#drawer").setAttribute("aria-hidden", "true");
  }

  /* ================= Loading sequence ================= */
  function runLoad() {
    const p = $("#progress");
    p.style.width = "0";
    requestAnimationFrame(() => { p.style.width = "72%"; });
    setTimeout(() => {
      p.style.width = "100%";
      setTimeout(() => { p.style.opacity = "0"; }, 200);
      state.loaded = true;
      countUp();
      renderActiveTab();
    }, 620);
  }

  /* ================= Init ================= */
  function init() {
    try { const saved = localStorage.getItem("sp_tab"); if (saved) state.tab = saved; } catch (e) {}
    renderInsight();
    renderTabCounts();
    renderKpis();
    renderSigChips();
    renderDow();
    renderLegend();
    wireFilters();
    wireTabs();
    updateFilterActive();
    // reflect persisted tab in the UI
    $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === state.tab));
    $$(".tabpanel").forEach((p) => p.classList.toggle("is-on", p.id === "panel-" + state.tab));
    moveUnderline();

    $("#scrim").addEventListener("click", closeDrawer);
    $("#drawerClose").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

    // initial render + load animation
    renderActiveTab();
    runLoad();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
