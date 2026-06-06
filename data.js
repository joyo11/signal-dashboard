/* ============================================================
   Signal Performance Dashboard — Fabricated dataset
   Deterministic (seeded) so charts are stable across reloads.
   Window: 7 days ending Thu Jun 4 2026. "Today" = Jun 4.
   ============================================================ */

// --- tiny seeded RNG (mulberry32) ---
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOURS = 24;
const DAYS = 7;                       // window length
const WINDOW_END = new Date(2026, 5, 4);  // Thu Jun 4 2026 (month 0-indexed)
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// day list, oldest -> newest
const DAY_LIST = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(WINDOW_END);
  d.setDate(d.getDate() - (DAYS - 1 - i));
  return d;
});

// --- the four featured (charted) signals ---
const FEATURED = [
  { id: "SIG-1001", name: "State St & 400 South",  color: "var(--s-1001)", hex: "#2D5F8A", base: { aor: 41, vol: 905, peakHr: 17 }, health: "ok"     },
  { id: "SIG-1002", name: "State St & 600 South",  color: "var(--s-1002)", hex: "#1F6E43", base: { aor: 49, vol: 754, peakHr: 17 }, health: "alert"  },
  { id: "SIG-1003", name: "State St & 800 South",  color: "var(--s-1003)", hex: "#C0392B", base: { aor: 58, vol: 973, peakHr: 18 }, health: "bad"    },
  { id: "SIG-1004", name: "State St & 1000 South", color: "var(--s-1004)", hex: "#8E6E2F", base: { aor: 45, vol: 812, peakHr: 17 }, health: "ok"     },
];

// --- full priority roster (12 rows, pre-scored, sorted desc) ---
const PRIORITY = [
  { rank: 1,  id: "SIG-1003", name: "State St & 800 South",   pmsf: 222, aor: 64.5, ped: 32.1, vol: 973, score: 93.2, pri: "High" },
  { rank: 2,  id: "SIG-1002", name: "State St & 600 South",   pmsf: 71,  aor: 58.4, ped: 31.5, vol: 754, score: 28.7, pri: "Low"  },
  { rank: 3,  id: "SIG-1009", name: "700 East & 2100 South",  pmsf: 58,  aor: 55.1, ped: 29.8, vol: 690, score: 24.9, pri: "Low"  },
  { rank: 4,  id: "SIG-1004", name: "State St & 1000 South",  pmsf: 49,  aor: 52.7, ped: 27.4, vol: 812, score: 22.1, pri: "Low"  },
  { rank: 5,  id: "SIG-1011", name: "900 East & 900 South",   pmsf: 41,  aor: 51.0, ped: 26.6, vol: 603, score: 19.8, pri: "Low"  },
  { rank: 6,  id: "SIG-1006", name: "300 West & 600 South",   pmsf: 37,  aor: 49.8, ped: 24.9, vol: 548, score: 18.0, pri: "Low"  },
  { rank: 7,  id: "SIG-1001", name: "State St & 400 South",   pmsf: 33,  aor: 48.2, ped: 23.1, vol: 905, score: 16.4, pri: "Low"  },
  { rank: 8,  id: "SIG-1014", name: "Foothill & 1300 South",  pmsf: 28,  aor: 46.5, ped: 22.0, vol: 472, score: 14.1, pri: "Low"  },
  { rank: 9,  id: "SIG-1008", name: "500 East & 400 South",   pmsf: 22,  aor: 44.9, ped: 20.7, vol: 531, score: 11.9, pri: "Low"  },
  { rank: 10, id: "SIG-1012", name: "University & 200 South",  pmsf: 18,  aor: 43.2, ped: 19.4, vol: 638, score: 10.2, pri: "Low"  },
  { rank: 11, id: "SIG-1005", name: "200 West & 700 South",   pmsf: 14,  aor: 41.0, ped: 18.1, vol: 410, score: 8.3,  pri: "Low"  },
  { rank: 12, id: "SIG-1010", name: "1100 East & 1700 South", pmsf: 9,   aor: 38.6, ped: 16.2, vol: 377, score: 6.1,  pri: "Low"  },
];

// --- KPI strip ---
const KPIS = [
  { label: "Total Volume",        value: 2.1,  unit: "M veh",  fmt: "M",   delta: "↑ 3.1% vs last 7d",      dir: "up-bad-no" /*neutral*/, tone: "mute"   },
  { label: "Avg Arrivals-on-Red", value: 48.6, unit: "%",      fmt: "pct", delta: "↑ 2.4 pts",              dir: "regress",  tone: "alert"  },
  { label: "Split Failures",      value: 399,  unit: "",       fmt: "int", delta: "↑ 27% at SIG-1003",      dir: "regress",  tone: "alert"  },
  { label: "High-Priority Signals", value: 1,  unit: "",       fmt: "int", delta: "no change",              dir: "flat",     tone: "mute"   },
];

// --- Time-series: hourly Arrivals-on-Red (%) per featured signal over window ---
// returns { signalId: [ {t: Date, hr, day, v, anomaly?} x168 ] }
function buildTimeSeries() {
  const out = {};
  FEATURED.forEach((sig, si) => {
    const r = rng(101 + si * 7);
    const series = [];
    DAY_LIST.forEach((d, di) => {
      const dow = d.getDay();
      const weekend = dow === 0 || dow === 6;
      for (let h = 0; h < HOURS; h++) {
        const t = new Date(d); t.setHours(h);
        // diurnal AoR curve: low overnight, AM + PM peaks
        const amPeak = Math.exp(-Math.pow(h - 8, 2) / 6);
        const pmPeak = Math.exp(-Math.pow(h - sig.base.peakHr, 2) / 7);
        let v = sig.base.aor * (0.35 + 0.5 * amPeak + 0.85 * pmPeak);
        if (weekend) v *= 0.72;
        v += (r() - 0.5) * 4;
        let anomaly = false;
        // SIG-1003: chronic PM split-failure spikes -> AoR jumps
        if (sig.id === "SIG-1003" && !weekend && h >= 17 && h <= 19) {
          v += 14 + r() * 6;
          if (h === 18 && (di === 2 || di === 5)) anomaly = true;
        }
        // SIG-1002: detector fault on Jun 3 (di=5) at 08:00 -> AoR spikes to ~90
        if (sig.id === "SIG-1002" && di === 5 && h === 8) { v = 90; anomaly = true; }
        v = Math.max(6, Math.min(96, v));
        series.push({ t, hr: h, day: di, dow, weekend, v: +v.toFixed(1), anomaly });
      }
    });
    out[sig.id] = series;
  });
  return out;
}

// --- Hour-of-day averages, split weekday / weekend ---
function buildHourPattern(ts) {
  const res = { weekday: {}, weekend: {} };
  FEATURED.forEach((sig) => {
    const wd = Array.from({ length: HOURS }, () => []);
    const we = Array.from({ length: HOURS }, () => []);
    ts[sig.id].forEach((p) => (p.weekend ? we : wd)[p.hr].push(p.v));
    const avg = (arr) => arr.map((a) => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : 0);
    res.weekday[sig.id] = avg(wd);
    res.weekend[sig.id] = avg(we);
  });
  return res;
}

// --- Split-failure heatmap: 4 featured rows x 24 hours (totals over window) ---
function buildHeatmap() {
  const rows = FEATURED.map((sig, si) => {
    const r = rng(303 + si * 13);
    const cells = Array.from({ length: HOURS }, (_, h) => {
      const amPeak = Math.exp(-Math.pow(h - 8, 2) / 4);
      const pmPeak = Math.exp(-Math.pow(h - sig.base.peakHr, 2) / 5);
      let n = (sig.base.aor / 12) * (amPeak * 0.7 + pmPeak * 1.6) + r() * 2;
      if (sig.id === "SIG-1003" && h >= 16 && h <= 19) n += 18 + r() * 10;
      if (h < 5 || h > 22) n *= 0.15;
      return Math.round(Math.max(0, n));
    });
    return { id: sig.id, name: sig.name, cells };
  });
  const max = Math.max(...rows.flatMap((r) => r.cells));
  return { rows, max };
}

// --- Alert feed (newest first), date-grouped ---
const ALERTS = [
  { id: "SIG-1003", name: "State St & 800 South", when: new Date(2026,5,4,6,10),  sev: 4.8,  metric: "split failures",
    line: "+4.8σ split failures during AM peak.", sub: "Sustained green-time shortfall on the SB through phase." },
  { id: "SIG-1003", name: "State St & 800 South", when: new Date(2026,5,4,5,0),   sev: 3.2,  metric: "arrivals-on-red",
    line: "+3.2σ arrivals-on-red, early-AM onset.", sub: "Coordination drift vs upstream signal." },
  { id: "SIG-1002", name: "State St & 600 South", when: new Date(2026,5,3,8,0),   sev: -101.6, metric: "volume",
    line: "−101.6σ volume, possible detector fault.", sub: "AoR 90% (+5.5σ). Loop on NB approach not reporting." },
  { id: "SIG-1003", name: "State St & 800 South", when: new Date(2026,5,3,18,0),  sev: 3.6,  metric: "split failures",
    line: "+3.6σ split failures, sustained PM congestion.", sub: "222 PM-peak failures over the window." },
  { id: "SIG-1004", name: "State St & 1000 South", when: new Date(2026,5,3,17,30), sev: 2.9,  metric: "pedestrian delay",
    line: "+2.9σ pedestrian delay on the EW crossing.", sub: "Recall not serving during PM peak." },
  { id: "SIG-1001", name: "State St & 400 South",  when: new Date(2026,5,2,16,45), sev: 2.1,  metric: "arrivals-on-red",
    line: "+2.1σ arrivals-on-red, isolated.", sub: "Single-day excursion, monitoring." },
  { id: "SIG-1003", name: "State St & 800 South",  when: new Date(2026,5,2,18,15), sev: 3.4,  metric: "split failures",
    line: "+3.4σ split failures during PM peak.", sub: "Repeat of the corridor pattern." },
];

// --- Alerts-per-signal (horizontal bars, featured only) ---
const ALERTS_PER = [
  { id: "SIG-1003", n: 9 },
  { id: "SIG-1002", n: 5 },
  { id: "SIG-1004", n: 3 },
  { id: "SIG-1001", n: 2 },
];

// --- Scatter lanes: many alert points over the 3-day window ---
function buildScatter() {
  const pts = [];
  FEATURED.forEach((sig, lane) => {
    const r = rng(707 + lane * 5);
    const n = ALERTS_PER.find((a) => a.id === sig.id).n;
    for (let i = 0; i < n; i++) {
      const dayOffset = Math.floor(r() * 3);          // last 3 days
      const d = new Date(WINDOW_END); d.setDate(d.getDate() - dayOffset);
      const hr = 6 + Math.floor(r() * 14);            // daytime
      d.setHours(hr, Math.floor(r() * 60));
      // severity: 1003 skews high; 1002 has the giant detector fault
      let sev = 2 + r() * 2.5;
      if (sig.id === "SIG-1003") sev = 3 + r() * 2.5;
      if (sig.id === "SIG-1002" && i === 0) { sev = 5.5; d.setDate(WINDOW_END.getDate() - 1); d.setHours(8, 0); }
      pts.push({ id: sig.id, lane, t: d, sev: +sev.toFixed(1) });
    }
  });
  return pts;
}

const DATA = {
  featured: FEATURED,
  priority: PRIORITY,
  kpis: KPIS,
  dayList: DAY_LIST,
  timeseries: buildTimeSeries(),
  hourPattern: null,
  heatmap: buildHeatmap(),
  alerts: ALERTS,
  alertsPer: ALERTS_PER,
  scatter: buildScatter(),
  windowLabel: "May 29 – Jun 4",
};
DATA.hourPattern = buildHourPattern(DATA.timeseries);

window.DATA = DATA;
window.FMT = { DOW, MON };
