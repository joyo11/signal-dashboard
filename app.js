/* ============================================================
   Signal Performance — Command Center
   Implements the Claude Design handoff (navy NOC layout), wired to the
   REAL pipeline data in data.js (DATA.raw). Everything shown — donut,
   KPIs, alerts, trend, heatmap, queue, drawer — is computed in-browser
   from the same rules as src/analysis.py + src/model.py.
   ============================================================ */
(function () {
  var D = window.DATA, FMT = window.FMT;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var cssVar = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888"; };

  // ---- lookups ----
  var SIG = D.signals; SIG.forEach(function (s, i) { s.idx = i; });
  var sigById = {}; SIG.forEach(function (s) { sigById[s.id] = s; });
  var featuredIds = D.featured.map(function (s) { return s.id; });
  var dayMeta = D.dayList.map(function (dt) { var j = dt.getDay(); return { date: dt, jsDay: j, weekend: j === 0 || j === 6 }; });
  var ND = D.dayList.length, WIN = 7;
  var SIGMA = 2.5;
  var rowMap = {}; D.raw.forEach(function (r) { rowMap[r.s + "_" + r.d + "_" + r.h] = r; });
  var winEndDate = dayMeta[ND - 1].date;

  var PRI = { High: "var(--alert)", Med: "var(--amber)", Low: "var(--healthy)" };
  var PRIBG = { High: "rgba(229,87,62,.13)", Med: "rgba(224,162,60,.13)", Low: "rgba(79,176,122,.13)" };

  function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }
  function winIdx() { return range(ND - WIN, ND - 1); }
  function priorIdx() { var e = ND - WIN - 1; return e < 0 ? [] : range(Math.max(0, ND - 2 * WIN), e); }
  function rowsFor(idxs) { var set = {}; idxs.forEach(function (d) { set[d] = 1; }); return D.raw.filter(function (r) { return set[r.d]; }); }
  function isAlert(r) { return r.vz <= -SIGMA || r.az >= SIGMA || r.sz >= SIGMA; }
  function sgn(v) { return (v > 0 ? "+" : "") + v.toFixed(1); }

  // ---- compute ----
  function computePriority(rows) {
    var agg = SIG.map(function () { return { sf: 0, aorS: 0, pedS: 0, volS: 0, n: 0 }; });
    rows.forEach(function (r) {
      if (dayMeta[r.d].weekend) return;
      var a = agg[r.s]; a.n++; a.aorS += r.aor; a.pedS += r.ped; a.volS += r.vol;
      if (D.pmPeak.indexOf(r.h) >= 0) a.sf += r.sf;
    });
    var recs = SIG.map(function (s, i) {
      var a = agg[i], n = a.n || 1;
      return { id: s.id, name: s.name, pmsf: a.sf, aor: a.n ? a.aorS / n : 0, ped: a.n ? a.pedS / n : 0, vol: a.n ? a.volS / n : 0 };
    });
    var norm = function (k) { var v = recs.map(function (r) { return r[k]; }); var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), d = mx - mn; return function (x) { return d ? (x - mn) / d : 0; }; };
    var ns = norm("pmsf"), na = norm("aor"), np = norm("ped");
    recs.forEach(function (r) { r.score = Math.round((D.weights.sf * ns(r.pmsf) + D.weights.aor * na(r.aor) + D.weights.ped * np(r.ped)) * 100); });
    recs.sort(function (a, b) { return b.score - a.score; });
    recs.forEach(function (r, i) { r.rank = i + 1; r.pri = r.score >= 70 ? "High" : r.score >= 40 ? "Med" : "Low"; r.priColor = PRI[r.pri]; r.priBg = PRIBG[r.pri]; });
    return recs;
  }
  function faultSet(rows) { var f = {}; rows.forEach(function (r) { if (r.vz <= -SIGMA) f[r.s] = 1; }); return f; }
  function hourAvgAoR(rows, sidx, weekdayOnly) {
    var sum = Array(24).fill(0), cnt = Array(24).fill(0);
    rows.forEach(function (r) { if (r.s !== sidx) return; if (weekdayOnly && dayMeta[r.d].weekend) return; sum[r.h] += r.aor; cnt[r.h]++; });
    return sum.map(function (s, h) { return cnt[h] ? s / cnt[h] : 0; });
  }

  function computeKpis(cur, prior, priority) {
    var sum = function (rows, k) { return rows.reduce(function (a, r) { return a + r[k]; }, 0); };
    var mean = function (rows, k) { return rows.length ? sum(rows, k) / rows.length : 0; };
    var volNow = sum(cur, "vol") / WIN, volPrev = prior.length ? sum(prior, "vol") / WIN : 0;
    var aorNow = mean(cur, "aor"), aorPrev = mean(prior, "aor");
    var sfNow = sum(cur, "sf"), sfPrev = sum(prior, "sf");
    var high = priority.filter(function (r) { return r.pri === "High"; }).length;
    var pct = function (n, p) { return p ? (n - p) / p * 100 : 0; };
    function delta(now, prev, kind, goodDown) {
      if (!prev) return { text: "—", color: "var(--mute)" };
      var up, txt;
      if (kind === "pts") { var c = now - prev; up = c >= 0; txt = (up ? "▲ " : "▼ ") + Math.abs(c).toFixed(1); }
      else { var c2 = pct(now, prev); up = c2 >= 0; txt = (up ? "▲ " : "▼ ") + Math.abs(c2).toFixed(1) + "%"; }
      var good = goodDown ? !up : up;
      return { text: txt, color: good ? "var(--healthy)" : "var(--alert)" };
    }
    return [
      { label: "Total Volume", target: volNow / 1000, fmt: function (v) { return v.toFixed(1) + "K"; }, sub: "vehicles · daily avg", d: delta(volNow, volPrev, "pct", false) },
      { label: "Avg Arrivals-on-Red", target: aorNow, fmt: function (v) { return v.toFixed(1) + "%"; }, sub: "across " + SIG.length + " signals", d: delta(aorNow, aorPrev, "pts", true) },
      { label: "Split Failures", target: sfNow, fmt: function (v) { return String(Math.round(v)); }, sub: "this window", d: delta(sfNow, sfPrev, "pct", true) },
      { label: "High-Priority Signals", target: high, fmt: function (v) { return String(Math.round(v)); }, sub: "score ≥ 70", d: { text: "", color: "var(--mute)" } }
    ];
  }

  function computeAlerts(cur) {
    var groups = {};
    cur.filter(isAlert).forEach(function (r) { var k = r.s + "_" + r.d; (groups[k] = groups[k] || []).push(r); });
    var eps = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], peak = g[0], pa = -1;
      g.forEach(function (r) { var a = Math.max(Math.abs(r.vz), Math.abs(r.az), Math.abs(r.sz)); if (a > pa) { pa = a; peak = r; } });
      var zs = { volume: peak.vz, aor: peak.az, sf: peak.sz }, dom = "volume", da = -1;
      Object.keys(zs).forEach(function (m) { if (Math.abs(zs[m]) > da) { da = Math.abs(zs[m]); dom = m; } });
      var sev = zs[dom], reason;
      if (dom === "volume") reason = sgn(sev) + "σ volume drop — possible detector fault";
      else if (dom === "aor") reason = sgn(sev) + "σ arrivals-on-red vs baseline";
      else reason = sgn(sev) + "σ split failures vs baseline";
      var dt = new Date(dayMeta[peak.d].date.getTime()); dt.setHours(peak.h);
      eps.push({ id: SIG[peak.s].id, sidx: peak.s, when: dt, sev: +sev.toFixed(1), metric: dom, reason: reason, hour: peak.h });
    });
    eps.sort(function (a, b) { return b.when - a.when; });
    return eps;
  }

  function relTime(dt) {
    var diffH = Math.round((winEndDate.getTime() + 23 * 3600e3 - dt.getTime()) / 3600e3);
    if (diffH <= 0) return "now";
    if (diffH < 24) return diffH + "h";
    var dd = Math.round(diffH / 24); return dd + "d";
  }

  // ---- state + view ----
  var state = { hero: "trend", selected: null, prog: 0 };
  var V = null;
  function compute() {
    var cur = rowsFor(winIdx()), prior = rowsFor(priorIdx());
    var priority = computePriority(cur);
    var counts = { High: 0, Med: 0, Low: 0 }; priority.forEach(function (r) { counts[r.pri]++; });
    var faults = faultSet(cur);
    var sumAll = function (k) { return cur.reduce(function (a, r) { return a + r[k]; }, 0); };
    var meanAll = function (k) { return cur.length ? sumAll(k) / cur.length : 0; };
    // per-signal extras
    var byId = {}; priority.forEach(function (r) {
      r.loc = r.name; r.corr = (r.name.split("&")[0] || r.name).trim();
      r.fault = !!faults[sigById[r.id].idx];
      r.dailyVol = r.vol * 24; r.volK = (r.vol * 24 / 1000).toFixed(1) + "K";
      r.last = ((sigById[r.id].idx * 7) % 14 + 1) + " mo"; // cosmetic: synthetic last-retimed
      byId[r.id] = r;
    });
    V = {
      cur: cur, priority: priority, byId: byId, counts: counts,
      kpis: computeKpis(cur, prior, priority),
      alerts: computeAlerts(cur),
      totals: { sf: sumAll("sf"), aor: meanAll("aor"), ped: meanAll("ped"), vol: sumAll("vol") / WIN },
      attention: counts.High + counts.Med
    };
  }

  // ---- charts (SVG strings, theme-resolved colors) ----
  function donutSVG(prog) {
    var c = V.counts, total = SIG.length, r = 64, cx = 82, cy = 82, sw = 15, C = 2 * Math.PI * r;
    var segs = [["High", c.High, cssVar("--alert")], ["Med", c.Med, cssVar("--amber")], ["Low", c.Low, cssVar("--healthy")]];
    var arcs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + cssVar("--line") + '" stroke-width="' + sw + '"/>';
    var acc = 0;
    segs.forEach(function (s) { var frac = s[1] / total, len = frac * C * prog, off = acc * C * prog; arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + s[2] + '" stroke-width="' + sw + '" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>'; acc += frac; });
    var big = Math.round(V.attention * prog);
    return '<div style="position:relative;width:164px;height:164px;margin:0 auto">' +
      '<svg viewBox="0 0 164 164" width="164" height="164">' + arcs + '</svg>' +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
      '<div class="mono" style="font-size:42px;font-weight:600;line-height:1;color:var(--ink)">' + big + '</div>' +
      '<div style="font-size:9.5px;color:var(--mute);margin-top:4px;letter-spacing:.4px;text-align:center;width:96px;line-height:1.25">SIGNALS NEED RETIMING</div>' +
      '</div></div>';
  }

  function trendSVG() {
    var W = 920, H = 300, pl = 44, pr = 14, pt = 18, pb = 30, pw = W - pl - pr, ph = H - pt - pb, maxY = 80;
    var hours = range(6, 23);
    var topId = (V.priority.filter(function (r) { return sigById[r.id].featured; })[0] || {}).id;
    var sc = [cssVar("--s1"), cssVar("--s2"), cssVar("--s3"), cssVar("--s4")];
    var series = D.featured.map(function (f, i) {
      var avg = hourAvgAoR(V.cur, sigById[f.id].idx, false);
      var ep = V.alerts.filter(function (a) { return a.id === f.id; })[0];
      return { id: f.id, c: sc[i], v: hours.map(function (h) { return avg[h]; }), an: ep ? hours.indexOf(ep.hour) : -1, emph: f.id === topId };
    });
    var n = hours.length, X = function (i) { return pl + i * (pw / (n - 1)); }, Y = function (v) { return pt + (1 - v / maxY) * ph; };
    var s = "";
    [0, 20, 40, 60, 80].forEach(function (g) { var y = Y(g); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="' + cssVar("--line") + '"/>'; s += '<text x="' + (pl - 8) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="' + cssVar("--mute") + '" font-family="JetBrains Mono,monospace">' + g + '</text>'; });
    var labs = ["6a", "9a", "12p", "3p", "6p", "9p"];
    [0, 3, 6, 9, 12, 15].forEach(function (idx, i) { s += '<text x="' + X(idx) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="' + cssVar("--mute") + '" font-family="JetBrains Mono,monospace">' + labs[i] + '</text>'; });
    series.forEach(function (ser) {
      var pts = ser.v.map(function (v, i) { return X(i) + "," + Y(v); }).join(" ");
      s += '<polyline points="' + pts + '" fill="none" stroke="' + ser.c + '" stroke-width="' + (ser.emph ? 2.4 : 1.4) + '" stroke-linejoin="round" stroke-linecap="round"/>';
      if (ser.an >= 0) { var cx = X(ser.an), cy = Y(ser.v[ser.an]); s += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + ser.c + '" style="transform-origin:' + cx + 'px ' + cy + 'px;transform-box:fill-box;animation:pulseRing 1.9s cubic-bezier(0.2,0,0,1) infinite"/>'; s += '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="' + ser.c + '" stroke="' + cssVar("--surface") + '" stroke-width="1.5"/>'; }
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="none" style="display:block">' + s + '</svg>';
  }

  function heatSVG(big) {
    var rows = SIG.length, cols = 24, cellH = big ? 16 : 11, gap = 2, labelW = 64, topPad = 4, bottomPad = 16, W = 920;
    var cw = (W - labelW) / cols - gap;
    // sf per signal per hour over window
    var grid = SIG.map(function () { return Array(24).fill(0); });
    V.cur.forEach(function (r) { grid[r.s][r.h] += r.sf; });
    var max = 1; grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    var amber = cssVar("--amber"), alert = cssVar("--alert");
    function rgb(hex) { hex = hex.replace("#", ""); if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join(""); var n = parseInt(hex, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    var A = rgb(amber), B = rgb(alert);
    function color(t) { if (t <= 0.02) return "transparent"; if (t < 0.45) return "rgba(" + A[0] + "," + A[1] + "," + A[2] + "," + (0.22 + t).toFixed(2) + ")"; var k = (t - 0.45) / 0.55, r = Math.round(A[0] + (B[0] - A[0]) * k), g = Math.round(A[1] + (B[1] - A[1]) * k), b = Math.round(A[2] + (B[2] - A[2]) * k); return "rgba(" + r + "," + g + "," + b + "," + (0.6 + 0.4 * k).toFixed(2) + ")"; }
    var s = "", line = cssVar("--line"), mute = cssVar("--mute");
    grid.forEach(function (row, ri) {
      var y = topPad + ri * (cellH + gap);
      s += '<text x="0" y="' + (y + cellH - 2) + '" font-size="' + (big ? 10 : 9) + '" fill="' + mute + '" font-family="JetBrains Mono,monospace">' + SIG[ri].id.replace("SIG-", "") + '</text>';
      for (var c = 0; c < cols; c++) { var t = row[c] / max, f = color(t); s += '<rect x="' + (labelW + c * (cw + gap)) + '" y="' + y + '" width="' + cw + '" height="' + cellH + '" rx="1.5" fill="' + f + '"' + (f === "transparent" ? ' stroke="' + line + '" stroke-width="0.6" stroke-opacity="0.5"' : "") + '/>'; }
    });
    var totalH = topPad + rows * (cellH + gap) + bottomPad;
    [0, 6, 12, 18, 23].forEach(function (c) { s += '<text x="' + (labelW + c * (cw + gap) + cw / 2) + '" y="' + (totalH - 3) + '" text-anchor="middle" font-size="8.5" fill="' + mute + '" font-family="JetBrains Mono,monospace">' + c + ':00</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + totalH + '" width="100%" height="' + (big ? "100%" : "auto") + '" preserveAspectRatio="xMidYMid meet" style="display:block">' + s + '</svg>';
  }

  function sparkSVG(rec) {
    var W = 300, H = 70, pl = 4, pr = 4, pt = 8, pb = 8, pw = W - pl - pr, ph = H - pt - pb;
    var avg = hourAvgAoR(V.cur, sigById[rec.id].idx, false), hours = range(6, 23);
    var vals = hours.map(function (h) { return avg[h]; }), max = Math.max.apply(null, vals) || 1;
    var n = vals.length, X = function (i) { return pl + i * (pw / (n - 1)); }, Y = function (v) { return pt + (1 - v / max) * ph; };
    var pts = vals.map(function (v, i) { return X(i) + "," + Y(v); }).join(" ");
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" style="display:block"><polyline points="' + pts + '" fill="none" stroke="' + rec.priColor.replace("var(--alert)", cssVar("--alert")).replace("var(--amber)", cssVar("--amber")).replace("var(--healthy)", cssVar("--healthy")) + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  // ---- render regions ----
  function fmtKpi(k, prog) { return k.fmt(k.target * prog); }

  function renderStatic() {
    $("#nhCount").textContent = SIG.length + " signals";
    $("#alertCrit").textContent = V.alerts.filter(function (a) { return Math.abs(a.sev) > 4; }).length + " critical";
    $("#liveLabel").textContent = "LIVE · " + FMT.MON[winEndDate.getMonth()] + " " + winEndDate.getDate();
    $("#maint").textContent = "Tue " + FMT.MON[winEndDate.getMonth()] + " " + (winEndDate.getDate() + 3);
    // network health rows
    $("#nhRows").innerHTML =
      nhRow("hi", "var(--alert)", "High priority", V.counts.High) +
      nhRow("", "var(--amber)", "Medium priority", V.counts.Med) +
      nhRow("", "var(--healthy)", "Low / nominal", V.counts.Low);
    // alerts
    $("#alertsBody").innerHTML = V.alerts.map(function (a) {
      var edge = Math.abs(a.sev) > 4 ? "var(--alert)" : "var(--amber)";
      return '<button class="alert" data-sig="' + a.id + '" style="border-left-color:' + edge + '">' +
        '<div style="flex:1;min-width:0"><div class="r1"><span class="id" style="color:' + edge + '">' + a.id + '</span><span class="tm">' + relTime(a.when) + '</span></div>' +
        '<div class="rs">' + esc(a.reason) + '</div></div></button>';
    }).join("");
    // bottom strip
    $("#bottom").innerHTML =
      bm(ICON.split, "var(--alert)", "Split Failures", V.totals.sf, "this window", function (v) { return String(Math.round(v)); }) +
      bm(ICON.red, "var(--amber)", "Arrivals-on-Red", V.totals.aor, "network avg", function (v) { return v.toFixed(1) + "%"; }) +
      bm(ICON.ped, "var(--s1)", "Pedestrian Delay", V.totals.ped, "avg per cycle", function (v) { return v.toFixed(1) + "s"; }) +
      bm(ICON.vol, "var(--healthy)", "Total Volume", V.totals.vol / 1000, "daily avg", function (v) { return v.toFixed(1) + "K"; });
    renderKpis(REDUCED ? 1 : 0);
    renderRightQueue();
    renderHero();
  }
  function nhRow(cls, col, lab, n) { return '<div class="nh-row ' + cls + '"><span class="sw" style="background:' + col + '"></span><span class="lb">' + lab + '</span><span class="vn" style="color:' + col + '">' + n + '</span></div>'; }
  function bm(ic, col, lab, target, unit, fmt) { return '<div class="card bm"><div class="ic" style="color:' + col + '">' + ic + '</div><div style="flex:1"><div class="lb">' + lab + '</div><div class="row"><span class="vn bm-num" data-t="' + target + '" data-fmt2="1">' + fmt(REDUCED ? target : 0) + '</span><span class="un">' + unit + '</span></div></div></div>'; window._bmfmt = fmt; }

  // bottom-strip number formatters (stored per-node)
  var BM_FMT = [function (v) { return String(Math.round(v)); }, function (v) { return v.toFixed(1) + "%"; }, function (v) { return v.toFixed(1) + "s"; }, function (v) { return v.toFixed(1) + "K"; }];

  function renderKpis(prog) {
    $("#kpis").innerHTML = V.kpis.map(function (k) {
      return '<div class="card kpi"><div class="lb">' + k.label + '</div><div class="row"><span class="vn">' + fmtKpi(k, prog) + '</span><span class="dl" style="color:' + k.d.color + '">' + k.d.text + '</span></div><div class="sb">' + k.sub + '</div></div>';
    }).join("");
  }

  function renderRightQueue() {
    var top = V.priority.slice(0, 5);
    $("#rqBody").innerHTML = top.map(function (q) {
      return '<button class="rq-item" data-sig="' + q.id + '">' +
        '<div class="rq-r1"><span class="rq-rank">' + q.rank + '</span>' +
        '<div style="flex:1;min-width:0"><div class="rq-id">' + q.id + '</div><div class="rq-loc">' + esc(q.loc) + '</div></div>' +
        '<span class="pill" style="font-size:9.5px;padding:2px 8px;color:' + q.priColor + ';background:' + q.priBg + ';border:1px solid ' + q.priColor + '">' + q.pri + '</span></div>' +
        '<div class="rq-r2"><div class="bar"><i style="width:0;background:' + q.priColor + '" data-w="' + q.score + '"></i></div>' +
        '<span class="rq-score" style="color:' + q.priColor + '">' + q.score + '</span></div></button>';
    }).join("");
  }

  function renderHero() {
    var hv = state.hero, body = $("#heroBody");
    // sync segmented + nav
    Array.prototype.forEach.call(document.querySelectorAll("#seg button"), function (b) { b.classList.toggle("on", b.dataset.view === hv); });
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      var on = (hv === "trend" && b.textContent === "Overview") || (hv === "queue" && b.textContent === "Priority") || (hv === "heatmap" && b.textContent === "Alerts");
      b.classList.toggle("on", on);
    });
    $("#heroSub").textContent = hv === "queue" ? "Ranked retiming queue · all " + SIG.length + " signals"
      : hv === "heatmap" ? "Split failures · signal × hour-of-day" : "Arrivals-on-red by hour · weekday + weekend";

    if (hv === "trend") {
      var sc = [cssVar("--s1"), cssVar("--s2"), cssVar("--s3"), cssVar("--s4")];
      var legend = D.featured.map(function (f, i) { return '<span class="l"><i style="background:' + sc[i] + '"></i>' + f.id + '</span>'; }).join("");
      body.innerHTML =
        '<div class="hero-body">' +
        '<div class="legend">' + legend + '<span class="an"><i></i>anomaly vs baseline</span></div>' +
        '<div class="trend-wrap">' + trendSVG() + '</div>' +
        '<div class="heat-foot"><div class="r"><h3>SPLIT-FAILURE HEATMAP · SIGNAL × HOUR</h3><div class="scale">low<i></i>high</div></div>' + heatSVG(false) + '</div>' +
        '</div>';
    } else if (hv === "heatmap") {
      body.innerHTML = '<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 16px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><p style="font-size:11.5px;color:var(--mute)">Each cell = split failures that hour, relative to the worst cell. Empty = none recorded.</p><div class="scale">low<i></i>high</div></div>' +
        '<div style="flex:1;min-height:0">' + heatSVG(true) + '</div></div>';
    } else {
      var rowsHtml = V.priority.map(function (q) {
        return '<tr data-sig="' + q.id + '"><td class="mono" style="color:var(--mute)">' + q.rank + '</td>' +
          '<td class="mono" style="font-weight:600">' + q.id + '</td>' +
          '<td>' + esc(q.loc) + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:9px"><div class="bar"><i style="width:0;background:' + q.priColor + '" data-w="' + q.score + '"></i></div><span class="mono" style="font-weight:600;width:22px;text-align:right;color:' + q.priColor + '">' + q.score + '</span></div></td>' +
          '<td class="r mono">' + q.aor.toFixed(0) + '</td>' +
          '<td class="r mono">' + q.pmsf + '</td>' +
          '<td class="r mono">' + q.ped.toFixed(0) + '</td>' +
          '<td class="c"><span class="pill" style="color:' + q.priColor + ';background:' + q.priBg + ';border:1px solid ' + q.priColor + '">' + q.pri + '</span></td>' +
          '<td class="r mono" style="color:var(--mute)">' + q.last + '</td></tr>';
      }).join("");
      body.innerHTML = '<div class="qtable-wrap"><table class="qt"><thead><tr>' +
        '<th>#</th><th>SIGNAL</th><th>LOCATION</th><th style="width:150px">SCORE</th><th class="r">AoR %</th><th class="r">SF (PM)</th><th class="r">PED s</th><th class="c">PRIORITY</th><th class="r">LAST RETIMED</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    }
    // redraw donut at current prog (theme-safe) + animate bars
    paintDonut();
    animateBars();
  }

  function animateBars() {
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(document.querySelectorAll(".bar i[data-w], .comp .track i[data-w]"), function (el) {
        el.style.width = (REDUCED ? 1 : 1) * parseFloat(el.dataset.w) + "%";
      });
    });
  }
  function paintDonut() { $("#donut").innerHTML = donutSVG(state.prog); }

  // ---- drawer ----
  function openDrawer(id) {
    var r = V.byId[id]; if (!r) return;
    state.selected = id;
    var comp = [
      { label: "PM split failures", pct: 55, w: Math.min(100, Math.round(r.pmsf / Math.max(1, Math.max.apply(null, V.priority.map(function (x) { return x.pmsf; }))) * 100)), c: "var(--alert)" },
      { label: "Arrivals-on-red", pct: 30, w: Math.min(100, Math.round(r.aor / 65 * 100)), c: "var(--amber)" },
      { label: "Pedestrian delay", pct: 15, w: Math.min(100, Math.round(r.ped / 45 * 100)), c: "var(--s1)" }
    ];
    var faultHtml = r.fault ? '<div class="dr-fault"><b>!</b><div>Detector fault suspected — volume collapsed against this signal\'s own baseline with no incident logged. Scores are unreliable until the loop is serviced.</div></div>' : "";
    $("#drawer").innerHTML =
      '<div class="dr-h"><div>' +
      '<div style="display:flex;align-items:center;gap:10px"><span class="id">' + r.id + '</span>' +
      '<span class="pill" style="font-size:10px;color:' + r.priColor + ';background:' + r.priBg + ';border:1px solid ' + r.priColor + '">' + r.pri + ' priority</span></div>' +
      '<div class="loc">' + esc(r.loc) + '</div>' +
      '<div class="sub">' + esc(r.corr) + ' · last retimed ' + r.last + ' ago</div></div>' +
      '<button class="dr-x" id="drX" aria-label="Close">✕</button></div>' +
      '<div class="dr-body">' +
      '<div class="dr-score"><div><div class="big" style="color:' + r.priColor + '">' + r.score + '</div><div class="cap">RETIMING SCORE / 100</div></div><div style="flex:1">' + sparkSVG(r) + '</div></div>' +
      '<h3 class="dr-h3">SCORE COMPOSITION</h3><div class="comp">' +
      comp.map(function (c) { return '<div><div class="r"><span class="l">' + c.label + '</span><span class="w">weight ' + c.pct + '%</span></div><div class="track"><i style="width:0;background:' + c.c + '" data-w="' + c.w + '"></i></div></div>'; }).join("") +
      '</div>' +
      '<h3 class="dr-h3">CURRENT METRICS</h3><div class="dr-metrics">' +
      drM("Arrivals-on-Red", r.aor.toFixed(0) + "%") + drM("Split Failures (PM)", r.pmsf) +
      drM("Pedestrian Delay", r.ped.toFixed(0) + "s") + drM("Daily Volume", r.volK) +
      '</div>' + faultHtml + '</div>' +
      '<div class="dr-foot"><button class="primary">Add to retiming plan<span class="demo-tag">demo</span></button><button class="ghost">Open log<span class="demo-tag">demo</span></button></div>';
    $("#drX").addEventListener("click", closeDrawer);
    $("#scrim").classList.add("on");
    $("#drawer").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false");
    animateBars();
  }
  function drM(l, v) { return '<div class="dr-m"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; }
  function closeDrawer() { state.selected = null; $("#scrim").classList.remove("on"); $("#drawer").classList.remove("on"); $("#drawer").setAttribute("aria-hidden", "true"); }

  // ---- icons ----
  function ic(paths) { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'; }
  var ICON = {
    split: ic('<path d="M12 3v6"/><path d="M12 9l-5 5"/><path d="M12 9l5 5"/><path d="M7 14v7"/><path d="M17 14v7"/>'),
    red: ic('<rect x="8" y="3" width="8" height="18" rx="4"/><circle cx="12" cy="8" r="1.6" fill="currentColor" stroke="none"/>'),
    ped: ic('<circle cx="12" cy="4.5" r="1.8"/><path d="M12 7v7"/><path d="M9 10l3-1 3 1"/><path d="M10 21l2-5 2 5"/>'),
    vol: ic('<path d="M3 17l5-5 4 3 8-8"/><path d="M17 7h4v4"/>')
  };

  // ---- count-up + donut sweep ----
  function animateProg() {
    if (REDUCED) { state.prog = 1; renderKpis(1); paintDonut(); setBottom(1); return; }
    var t0 = performance.now(), dur = 900;
    function tick(now) {
      var p = Math.min(1, (now - t0) / dur); p = 1 - Math.pow(1 - p, 3); state.prog = p;
      renderKpis(p); paintDonut(); setBottom(p);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function setBottom(p) {
    Array.prototype.forEach.call(document.querySelectorAll(".bm-num"), function (el, i) { el.textContent = BM_FMT[i](parseFloat(el.dataset.t) * p); });
  }

  // ---- theme ----
  function wireTheme() {
    var btn = $("#themeBtn"), root = document.documentElement;
    function sync() { var dark = root.getAttribute("data-theme") === "dark"; $("#themeLabel").textContent = dark ? "Light" : "Dark"; $(".ico-sun", btn).style.display = dark ? "block" : "none"; $(".ico-moon", btn).style.display = dark ? "none" : "block"; }
    sync();
    btn.addEventListener("click", function () {
      var dark = root.getAttribute("data-theme") === "dark";
      root.setAttribute("data-theme", dark ? "light" : "dark");
      try { localStorage.setItem("sp_theme", dark ? "light" : "dark"); } catch (e) {}
      sync(); paintDonut(); renderHero(); // re-resolve chart colors
    });
  }

  // ---- delegation ----
  function wireClicks() {
    document.body.addEventListener("click", function (e) {
      var sigEl = e.target.closest("[data-sig]"); if (sigEl) { openDrawer(sigEl.dataset.sig); return; }
      var seg = e.target.closest("#seg button, #nav button"); if (seg && seg.dataset.view) { state.hero = seg.dataset.view; renderHero(); return; }
    });
    $("#scrim").addEventListener("click", closeDrawer);
    $("#viewAll").addEventListener("click", function () { state.hero = "queue"; renderHero(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeDrawer(); closeAsst(); } });
  }

  // ---- assistant (grounded) ----
  function asstFindSignal(t) {
    var m = t.match(/sig[\s-]?(\d{3,4})/); if (m && sigById["SIG-" + m[1]]) return "SIG-" + m[1];
    m = t.match(/\b(\d{3,4})\b/); if (m && sigById["SIG-" + m[1]]) return "SIG-" + m[1];
    for (var i = 0; i < SIG.length; i++) { var cross = (SIG[i].name.split("&")[1] || "").trim().toLowerCase(); if (cross && t.indexOf(cross) >= 0) return SIG[i].id; }
    return null;
  }
  function asstSigCard(r) {
    var rec = r.pri === "High" ? "Re-time the PM-peak split plan; reallocate green to the heaviest through phase 16:00–19:00 weekdays."
      : r.pri === "Med" ? "Watchlist — review the PM-peak split allocation." : "Within normal range; keep monitoring.";
    return "<p><b>" + esc(r.loc) + "</b> (" + r.id + ") is rank " + r.rank + " of " + V.priority.length + ", score " + r.score + " (" + r.pri + ").</p>" +
      "<ul><li>PM split failures: " + r.pmsf + "</li><li>Arrivals-on-red: " + r.aor.toFixed(0) + "%</li><li>Ped delay: " + r.ped.toFixed(0) + "s</li></ul><p>" + rec + "</p>" +
      '<button class="asst-act" data-sig="' + r.id + '">Open full detail →</button>';
  }
  function asstAnswer(q) {
    var t = q.toLowerCase().trim(), words = t.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
    var has = function () { for (var i = 0; i < arguments.length; i++) if (t.indexOf(arguments[i]) >= 0) return true; return false; };
    var hasW = function () { for (var i = 0; i < arguments.length; i++) if (words.indexOf(arguments[i]) >= 0) return true; return false; };
    var P = V.priority, top = P[0], A = V.alerts, sid = asstFindSignal(t);
    if (sid) return asstSigCard(V.byId[sid]);
    if (has("what can you", "what do you do", "capab", "who are you", "help")) return "<p>I read the dashboard's live numbers. Ask me what to retime first, about alerts, a specific intersection (e.g. “why SIG-1003”), or a metric.</p>";
    if (has("what is this", "what's this", "about this", "what is the dash", "explain this", "purpose")) return "<p>A <b>signal performance command center</b> for a DOT analyst: which signals are misbehaving and which to retime first. Donut = network health, center = signals needing attention; the hero shows arrivals-on-red trends, a split-failure heatmap, and the ranked retiming queue. " + SIG.length + " intersections.</p>";
    if (has("how does it work", "how is this built", "tech", "pipeline", "real data", "data come", "synthetic")) return "<p>Numbers are computed live in your browser from a real ATSPM-style pipeline (Python: clean → score → anomaly-detect). Underlying signal data is synthetic but schema-faithful to UDOT ATSPM exports, swap in real CSVs and it runs unchanged.</p>";
    if (t === "" || has("happening", "summary", "overview", "status", "going on")) { var f = A.filter(function (a) { return a.metric === "volume"; })[0]; return "<p><b>" + esc(top.loc) + "</b> (" + top.id + ") is the top retiming candidate, score " + top.score + " (" + top.pri + "). " + V.counts.High + " high-priority, " + A.length + " alerts" + (f ? ", including a likely detector fault at <b>" + f.id + "</b>" : "") + ".</p>"; }
    if (has("worst", "retime", "first", "priority", "fix", "attention")) return asstSigCard(top);
    if (has("alert", "anomal", "fault", "detector", "broken")) { if (!A.length) return "<p>No alerts in this window.</p>"; return "<p>" + A.length + " alerts:</p><ul>" + A.slice(0, 6).map(function (a) { return "<li><b>" + a.id + "</b> " + esc(a.reason) + "</li>"; }).join("") + "</ul>"; }
    if (has("split fail") || hasW("split", "sf")) return "<p><b>Split failures</b> = phases that ran out of green (55% of the score). <b>" + esc(top.loc) + "</b> leads with " + top.pmsf + " PM-peak failures.</p>";
    if (has("arrivals", "on red", "progression") || hasW("aor")) return "<p><b>Arrivals-on-red</b>: share of vehicles hitting a red (30% of score). Network avg " + V.totals.aor.toFixed(1) + "%.</p>";
    if (hasW("volume", "vph", "vehicles", "traffic")) return "<p><b>Volume</b> averages " + (V.totals.vol / 1000).toFixed(1) + "K vehicles/day across the network.</p>";
    if (has("pedestrian") || hasW("ped", "walk")) return "<p><b>Pedestrian delay</b>: avg wait after a button press (15% of score). Network avg " + V.totals.ped.toFixed(1) + "s.</p>";
    if (has("score", "composite", "weight", "rank")) return "<p>Composite score = 55% PM split failures + 30% arrivals-on-red + 15% pedestrian delay, min-max normalized across " + P.length + " signals, 0–100. ≥70 High, ≥40 Medium.</p>";
    if (has("dark", "light", "theme")) return "<p>Use the <b>theme button</b> in the top bar to switch light/dark; it follows your system by default.</p>";
    if (hasW("hi", "hello", "hey", "yo")) return "<p>Hi — I'm the dashboard helper. Ask what to retime first, about alerts, or any intersection.</p>";
    return "<p>I can answer from the live data: the <b>worst signal</b>, current <b>alerts</b>, a specific <b>intersection</b> (“why SIG-1003”), or a metric (split failures, arrivals-on-red, volume, ped delay).</p>";
  }
  function closeAsst() { $("#asst").classList.remove("on"); $("#asst").setAttribute("aria-hidden", "true"); }
  function wireAssistant() {
    var panel = $("#asst"), fab = $("#asstFab"), body = $("#asstBody"), chips = $("#asstChips"), form = $("#asstForm"), input = $("#asstInput"), greeted = false;
    function add(html, who) { var m = document.createElement("div"); m.className = "asst-msg " + who; if (who === "user") m.textContent = html; else m.innerHTML = html; body.appendChild(m); body.scrollTop = body.scrollHeight; }
    function ask(q) { add(q, "user"); setTimeout(function () { add(asstAnswer(q), "bot"); }, 160); }
    ["What is this?", "What do I retime first?", "Any alerts?", "Explain the score"].forEach(function (c) { var b = document.createElement("button"); b.className = "asst-chip"; b.textContent = c; b.addEventListener("click", function () { ask(c); }); chips.appendChild(b); });
    try { if (!localStorage.getItem("sp_asst_seen")) { var n = document.createElement("span"); n.className = "nudge"; fab.appendChild(n); } } catch (e) {}
    function open() { panel.classList.add("on"); panel.setAttribute("aria-hidden", "false"); var nd = fab.querySelector(".nudge"); if (nd) nd.remove(); try { localStorage.setItem("sp_asst_seen", "1"); } catch (e) {} if (!greeted) { greeted = true; add(asstAnswer(""), "bot"); } setTimeout(function () { input.focus(); }, 80); }
    fab.addEventListener("click", function () { panel.classList.contains("on") ? closeAsst() : open(); });
    $("#asstX").addEventListener("click", closeAsst);
    form.addEventListener("submit", function (e) { e.preventDefault(); var q = input.value.trim(); if (!q) return; input.value = ""; ask(q); });
    body.addEventListener("click", function (e) { var a = e.target.closest(".asst-act"); if (a) { openDrawer(a.dataset.sig); } });
  }

  // ---- init ----
  function init() {
    compute();
    renderStatic();
    wireTheme(); wireClicks(); wireAssistant();
    animateProg();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
