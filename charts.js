/* ============================================================
   Signal Performance Dashboard — Hand-rolled SVG charts
   Calm, hairline aesthetic. Data-driven (no hardcoded signals).
   ============================================================ */

const NS = "http://www.w3.org/2000/svg";
const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canAnimate = () => !REDUCED && !document.hidden;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// shared tooltip
let _tip;
function tip() {
  if (!_tip) { _tip = document.createElement("div"); _tip.className = "tooltip"; document.body.appendChild(_tip); }
  return _tip;
}
function showTip(html, x, y) {
  const t = tip(); t.innerHTML = html; t.classList.add("is-on");
  t.style.left = x + 12 + "px"; t.style.top = y - 8 + "px";
}
function hideTip() { if (_tip) _tip.classList.remove("is-on"); }

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const niceMax = (v) => Math.ceil(v / 10) * 10;
const niceMin = (v) => Math.max(0, Math.floor(v / 10) * 10);

/* ---------- LineChart : arrivals-on-red time series ----------
   opts: { series:{id:[{v,anomaly}]}, tList:[Date], dayTicks:[{pos,label}],
           colors:{id:hex}, activeIds, emphasisId, height, yLabel } */
function LineChart(mount, opts) {
  const { series, tList, dayTicks, colors, activeIds, emphasisId, height = 340, yLabel = "Arrivals-on-Red (%)" } = opts;
  clear(mount);
  const ids = Object.keys(series);
  const n = tList.length;
  const W = mount.clientWidth || 1100, H = height;
  const m = { t: 18, r: 16, b: 30, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "linechart" }, mount);
  if (n < 2) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = "No data for this selection";
    return;
  }

  // y-range from the ACTIVE series so the plot fills the panel
  const vis = ids.filter((id) => activeIds.includes(id));
  const pool = (vis.length ? vis : ids).flatMap((id) => series[id].map((p) => p.v));
  const yMax = niceMax(Math.max(...pool));
  const yMin = niceMin(Math.min(...pool));
  const X = (i) => m.l + (i / (n - 1)) * iw;
  const Y = (v) => m.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + (i / ticks) * (yMax - yMin);
    const y = Y(v);
    el("line", { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: "var(--line)", "stroke-opacity": 0.6, "stroke-width": 1 }, svg);
    el("text", { x: m.l - 10, y: y + 4, "text-anchor": "end", class: "axis-num" }, svg).textContent = Math.round(v);
  }
  dayTicks.forEach((d) => {
    const x = X(d.pos);
    el("line", { x1: x, x2: x, y1: m.t, y2: m.t + ih, stroke: "var(--line)", "stroke-opacity": 0.35, "stroke-width": 1 }, svg);
    el("text", { x: x, y: H - 10, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = d.label;
  });

  ids.forEach((id) => {
    const on = activeIds.includes(id);
    const emph = id === emphasisId;
    const pts = series[id];
    let dpath = "";
    pts.forEach((p, i) => { dpath += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
    const path = el("path", {
      d: dpath, fill: "none", stroke: colors[id], "stroke-width": emph ? 2 : 1.5,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      opacity: on ? (emph ? 1 : 0.92) : 0.08, class: "line-path"
    }, svg);
    if (canAnimate()) {
      const len = path.getTotalLength ? path.getTotalLength() : 2000;
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.style.transition = "stroke-dashoffset 700ms var(--ease-in), opacity 220ms var(--ease-in)";
      setTimeout(() => { path.style.strokeDashoffset = 0; }, 20);
    }
    if (on) pts.forEach((p, i) => {
      if (!p.anomaly) return;
      const cx = X(i), cy = Y(p.v);
      el("circle", { cx, cy, r: 3.4, fill: colors[id], class: "anom-dot" }, svg);
      const ring = el("circle", { cx, cy, r: 4, fill: "none", stroke: colors[id], "stroke-width": 1.5, class: "anom-ring" }, svg);
      ring.style.transformOrigin = `${cx}px ${cy}px`;
    });
  });

  el("text", { x: m.l - 36, y: m.t - 4, class: "axis-cap" }, svg).textContent = yLabel;

  const hover = el("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, stroke: "var(--ink)", "stroke-width": 1, opacity: 0, class: "crosshair" }, svg);
  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    let i = Math.round(((e.clientX - rect.left - m.l) / iw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    hover.setAttribute("x1", X(i)); hover.setAttribute("x2", X(i)); hover.setAttribute("opacity", 0.25);
    const rows = ids.filter((id) => activeIds.includes(id))
      .map((id) => `<span style="color:${colors[id]}">●</span> ${id.replace("SIG-", "")} ${series[id][i].v}%`).join("&nbsp;&nbsp;");
    const d = tList[i];
    showTip(`<b>${FMT.DOW[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:00</b><br>${rows}`, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => { hover.setAttribute("opacity", 0); hideTip(); });
}

/* ---------- SmallMultiple : weekday | weekend hour-of-day ----------
   opts: { data:{id:[24]}, colors, activeIds, emphasisId, title, yMax, height } */
function SmallMultiple(mount, opts) {
  const { data, colors, activeIds, emphasisId, title, yMax, height = 220 } = opts;
  clear(mount);
  const ids = Object.keys(data);
  const W = mount.clientWidth || 520, H = height;
  const m = { t: 16, r: 12, b: 26, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, mount);
  const ymax = yMax || 10;
  const X = (h) => m.l + (h / 23) * iw;
  const Y = (v) => m.t + ih - (v / ymax) * ih;

  for (let i = 0; i <= 3; i++) {
    const v = (i / 3) * ymax, y = Y(v);
    el("line", { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: "var(--line)", "stroke-opacity": 0.55 }, svg);
    el("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", class: "axis-num" }, svg).textContent = Math.round(v);
  }
  [0, 6, 12, 18, 23].forEach((h) => {
    el("text", { x: X(h), y: H - 8, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = h;
  });

  ids.forEach((id) => {
    const on = activeIds.includes(id);
    const emph = id === emphasisId;
    const arr = data[id];
    let dpath = "";
    arr.forEach((v, h) => { dpath += (h ? "L" : "M") + X(h).toFixed(1) + " " + Y(v).toFixed(1) + " "; });
    el("path", { d: dpath, fill: "none", stroke: colors[id], "stroke-width": emph ? 1.8 : 1.4,
      "stroke-linejoin": "round", opacity: on ? (emph ? 1 : 0.85) : 0.07 }, svg);
  });

  el("text", { x: m.l - 26, y: m.t - 3, class: "axis-cap" }, svg).textContent = title;
}

/* ---------- Heatmap : split failures, signals x hours ---------- */
function Heatmap(mount, opts) {
  const { rows, max } = opts;
  clear(mount);
  const W = mount.clientWidth || 1100;
  const labelW = 168, padR = 8, padT = 20, padB = 24, cellGap = 2;
  const gridW = W - labelW - padR;
  const cw = (gridW - 23 * cellGap) / 24;
  const ch = 30;
  const H = padT + rows.length * (ch + cellGap) + padB;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, mount);
  if (!rows.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = "No data for this selection";
    return;
  }

  for (let h = 0; h <= 23; h += 3) {
    const x = labelW + h * (cw + cellGap) + cw / 2;
    el("text", { x, y: 12, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = h;
  }

  function color(v) {
    if (v <= 0) return "transparent";
    const t = max ? v / max : 0;
    const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const paper = [250, 248, 244], warn = [201, 122, 30], alert = [192, 57, 43];
    const c = t < 0.5 ? lerp(paper, warn, t / 0.5) : lerp(warn, alert, (t - 0.5) / 0.5);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  rows.forEach((row, ri) => {
    const y = padT + ri * (ch + cellGap);
    el("text", { x: 6, y: y + ch / 2 + 4, "text-anchor": "start", class: "heat-lab" }, svg).textContent = row.id;
    const cross = row.name.replace(/^.*&\s*/, "");
    el("text", { x: 72, y: y + ch / 2 + 4, "text-anchor": "start", class: "heat-sub" }, svg).textContent = cross;
    row.cells.forEach((v, h) => {
      const x = labelW + h * (cw + cellGap);
      const rect = el("rect", { x, y, width: cw, height: ch, rx: 2, fill: color(v),
        stroke: v > 0 ? "rgba(0,0,0,0.04)" : "var(--line)", "stroke-opacity": v > 0 ? 1 : 0.5, class: "heat-cell" }, svg);
      rect.style.transition = "filter 80ms var(--ease-in)";
      const show = (e) => showTip(`${row.id} · ${String(h).padStart(2, "0")}:00<br><b>${v}</b> split failures`, e.clientX, e.clientY);
      rect.addEventListener("mouseenter", (e) => { rect.style.filter = "brightness(0.9)"; show(e); });
      rect.addEventListener("mousemove", show);
      rect.addEventListener("mouseleave", () => { rect.style.filter = ""; hideTip(); });
    });
  });
}

/* ---------- HorizontalBars : alerts per signal ----------
   opts: { data:[{id,n,hex}], height } */
function HorizontalBars(mount, opts) {
  const { data, height = 200 } = opts;
  clear(mount);
  const W = mount.clientWidth || 520, H = height;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, mount);
  if (!data.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = "No alerts in this selection";
    return;
  }
  const m = { t: 10, r: 30, b: 10, l: 86 };
  const iw = W - m.l - m.r;
  const max = Math.max(...data.map((d) => d.n), 1);
  const rowH = (H - m.t - m.b) / data.length;
  data.forEach((d, i) => {
    const y = m.t + i * rowH + rowH / 2;
    el("text", { x: m.l - 12, y: y + 4, "text-anchor": "end", class: "heat-lab" }, svg).textContent = d.id;
    const bw = (d.n / max) * iw;
    const bar = el("rect", { x: m.l, y: y - 8, width: canAnimate() ? 0 : bw, height: 16, rx: 3, fill: d.hex, opacity: 0.9 }, svg);
    if (canAnimate()) { bar.style.transition = "width 600ms var(--ease-in)"; setTimeout(() => bar.setAttribute("width", bw), 20); }
    el("text", { x: m.l + bw + 8, y: y + 4, class: "axis-num", "text-anchor": "start" }, svg).textContent = d.n;
  });
}

/* ---------- ScatterLane : alerts over time ----------
   opts: { lanes:[{id,hex}], points:[{lane,t,sev,hex,id}], tMin, tMax, dayTicks, height } */
function ScatterLane(mount, opts) {
  const { lanes, points, tMin, tMax, dayTicks, height = 220 } = opts;
  clear(mount);
  const W = mount.clientWidth || 520, H = height;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, mount);
  if (!lanes.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = "No alerts in this selection";
    return;
  }
  const m = { t: 16, r: 18, b: 26, l: 86 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const laneH = ih / lanes.length;
  const span = (tMax - tMin) || 1;
  const X = (t) => m.l + ((t - tMin) / span) * iw;
  const Y = (lane) => m.t + lane * laneH + laneH / 2;

  lanes.forEach((s, lane) => {
    el("line", { x1: m.l, x2: m.l + iw, y1: Y(lane), y2: Y(lane), stroke: "var(--line)", "stroke-opacity": 0.5 }, svg);
    el("text", { x: m.l - 12, y: Y(lane) + 4, "text-anchor": "end", class: "heat-lab" }, svg).textContent = s.id;
  });
  (dayTicks || []).forEach((d) => {
    el("text", { x: X(d.t), y: H - 8, "text-anchor": "middle", class: "axis-lab" }, svg).textContent = d.label;
  });
  points.forEach((p) => {
    const sev = Math.abs(p.sev);
    const r = 3 + Math.min(9, sev * 1.4);
    const isAlert = sev > 4;
    const c = el("circle", { cx: X(p.t.getTime()), cy: Y(p.lane), r: canAnimate() ? 0 : r,
      fill: isAlert ? "var(--alert)" : p.hex, "fill-opacity": 0.72,
      stroke: isAlert ? "var(--alert)" : p.hex, "stroke-opacity": 0.9 }, svg);
    if (canAnimate()) { c.style.transition = "r 320ms var(--ease-in)"; setTimeout(() => c.setAttribute("r", r), 20); }
    c.addEventListener("mouseenter", (e) => showTip(`${p.id} · ${FMT.DOW[p.t.getDay()]} ${String(p.t.getHours()).padStart(2, "0")}:${String(p.t.getMinutes()).padStart(2, "0")}<br><b>${p.sev > 0 ? "+" : ""}${p.sev}σ</b>`, e.clientX, e.clientY));
    c.addEventListener("mouseleave", hideTip);
  });
}

window.Charts = { LineChart, SmallMultiple, Heatmap, HorizontalBars, ScatterLane };
