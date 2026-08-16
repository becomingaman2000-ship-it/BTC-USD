/* BTC/USD market fabric — anchored to published 2025–2026 prints,
   then expanded into session-aware OHLC so ICT structure is readable.

   Price unit: US dollars. One "pip" for this desk is defined as $10
   (BTC's smallest meaningful swing increment), so 1 pip = 10 USD.
   The engine, backtester and UI all share MARKET_META.pip. */

const NY = "America/New_York";

export const MARKET_META = {
  pair: "BTC/USD",
  pip: 10, // 1 pip = $10
  asOf: "2026-08-14T19:30:00Z",
  spotSeed: 92400,
  prevClose: 92800,
  dayHigh: 93600,
  dayLow: 91200,
  sma50: 89800,
  sma100: 97200,
  sma200: 103000,
  yearHigh: 121400,
  yearLow: 79400,
  yearAvg: 100400,
  eth: 3050,
  macro: {
    funding8h: 0.008,
    openInterest: 38.2, // $bn
    btcDom: 54.1, // %
    spotPremium: 0.02, // %
    ethBTC: 0.033,
    headline:
      "BTC faded the 97,200 supply block after a weak US session; spot drifting back toward the 90,000 pool.",
  },
};

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundPx(v) {
  return Math.round(v * 100) / 100; // BTC to $0.01 precision
}

function nyParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get("weekday"),
    year: +get("year"),
    month: +get("month"),
    day: +get("day"),
    hour: +get("hour"),
    minute: +get("minute"),
  };
}

// BTC/USD trades 24/7 — the market is always open.
export function isMarketOpen(ms) {
  return true;
}

export function sessionOf(ms) {
  const { hour } = nyParts(ms);
  if (hour >= 20 || hour < 2) return "ASIAN";
  if (hour >= 2 && hour < 7) return "LONDON";
  if (hour >= 7 && hour < 12) return "NY_AM";
  if (hour >= 12 && hour < 17) return "NY_PM";
  return "AFTER";
}

export function killZoneOf(ms) {
  const { hour, minute } = nyParts(ms);
  const t = hour + minute / 60;
  if (t >= 20 || t < 0) return { id: "ASIAN", label: "Asian Range", active: t >= 20 };
  if (t >= 2 && t < 5) return { id: "LONDON", label: "London Kill Zone", active: true };
  if (t >= 3 && t < 4) return { id: "SB_LON", label: "London Silver Bullet", active: true };
  if (t >= 7 && t < 10) return { id: "NY_AM", label: "New York AM Kill Zone", active: true };
  if (t >= 10 && t < 11) return { id: "SB_NY", label: "NY AM Silver Bullet", active: true };
  if (t >= 10 && t < 12) return { id: "LONDON_CLOSE", label: "London Close", active: true };
  if (t >= 13.5 && t < 16) return { id: "NY_PM", label: "New York PM Kill Zone", active: true };
  if (t >= 14 && t < 15) return { id: "SB_PM", label: "NY PM Silver Bullet", active: true };
  return { id: "OFF", label: "Outside kill zone", active: false };
}

/* BTC/USD 2025–2026 daily anchors (USD). Built from published prints:
   Jan 2026 high 121,400 · Jun 2026 low 79,400 · 14 Aug 2026 spot ~92,400. */
const DAILY_ANCHORS = [
  ["2025-01-02", 96500],
  ["2025-01-20", 109000],
  ["2025-02-15", 89000],
  ["2025-03-12", 78000],
  ["2025-04-22", 88500],
  ["2025-06-01", 108000],
  ["2025-07-10", 96800],
  ["2025-08-20", 82400],
  ["2025-09-20", 90200],
  ["2025-10-15", 98400],
  ["2025-11-20", 105500],
  ["2025-12-31", 112000],
  ["2026-01-20", 121400],
  ["2026-02-15", 112400],
  ["2026-03-15", 98400],
  ["2026-04-10", 105600],
  ["2026-05-10", 96800],
  ["2026-06-01", 88200],
  ["2026-06-20", 79400],
  ["2026-07-01", 85600],
  ["2026-07-15", 91600],
  ["2026-07-30", 89400],
  ["2026-08-05", 91800],
  ["2026-08-10", 93000],
  ["2026-08-12", 92100],
  ["2026-08-13", 91600],
  ["2026-08-14", 92400],
];

function parseUTCDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 21, 0, 0); // ~17:00 NY
}

function weekdayUTC(ms) {
  return new Date(ms).getUTCDay();
}

function buildDailyPath(rng) {
  const pts = DAILY_ANCHORS.map(([d, p]) => [parseUTCDate(d), p]);
  const start = pts[0][0];
  const end = pts[pts.length - 1][0];
  const days = [];
  let t = start;
  let prev = pts[0][1];

  // BTC trades 24/7 — include weekends.
  while (t <= end) {
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1][0] < t) i++;
    const a = pts[Math.max(0, i)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const span = Math.max(1, b[0] - a[0]);
    const u = clamp((t - a[0]) / span, 0, 1);
    const smooth = u * u * (3 - 2 * u);
    const mid = lerp(a[1], b[1], smooth);
    const mean = mid * 0.82 + prev * 0.18;
    days.push({ t, close: mean });
    prev = mean;
    t += 86400000;
  }

  days[days.length - 1].close = MARKET_META.spotSeed;
  return days;
}

function dailyOHLC(path, rng) {
  return path.map((d, i) => {
    const prev = i ? path[i - 1].close : d.close;
    const close = d.close;
    const range = 0.006 + rng() * 0.007; // 0.6%–1.3% daily range for BTC
    const bias = close >= prev ? 0.35 : -0.35;
    const high = Math.max(prev, close) + range * (0.28 + rng() * 0.45);
    const low = Math.min(prev, close) - range * (0.28 + rng() * 0.45);
    const open = prev + (rng() - 0.5) * 30 + bias * 4;
    return {
      t: d.t,
      o: roundPx(open),
      h: roundPx(Math.max(open, close, high)),
      l: roundPx(Math.min(open, close, low)),
      c: roundPx(close),
      v: Math.round(82000 + rng() * 54000),
    };
  });
}

function sessionVol(hourNY) {
  if (hourNY >= 2 && hourNY < 5) return 1.55;
  if (hourNY >= 7 && hourNY < 11) return 1.7;
  if (hourNY >= 11 && hourNY < 12) return 1.15;
  if (hourNY >= 13 && hourNY < 16) return 1.25;
  if (hourNY >= 20 || hourNY < 2) return 0.55;
  return 0.85;
}

/* BTC intraday expansion. The base price is ~92,400 vs EUR ~1.15, so the
   absolute noise/shock/wick terms are scaled by PX_SCALE to keep the same
   proportional volatility the EUR tape used. */
const PX_SCALE = MARKET_META.spotSeed / 1.15;

function expandIntraday(daily, minutes, rng) {
  const out = [];
  for (let i = 0; i < daily.length; i++) {
    const bar = daily[i];
    const prevClose = i ? daily[i - 1].c : bar.o;
    const dayMs = 24 * 60 * 60 * 1000;
    const sessionStart = bar.t - dayMs;
    const steps = Math.floor((24 * 60) / minutes);
    let px = prevClose;
    const target = bar.c;
    const hiCap = bar.h;
    const loCap = bar.l;
    let ranJudas = false;

    for (let s = 0; s < steps; s++) {
      const ts = sessionStart + s * minutes * 60 * 1000;
      const p = nyParts(ts);
      const vol =
        sessionVol(p.hour) *
        (0.00009 + rng() * 0.00007) *
        Math.sqrt(minutes / 60) *
        PX_SCALE;
      const progress = s / steps;
      const magnet = (target - px) * (0.018 + progress * 0.04);
      let shock = 0;

      // London Judas: sweep opposite of daily close, then reverse
      if (!ranJudas && p.hour === 3 && p.minute < minutes) {
        const dir = target < prevClose ? 1 : -1;
        shock = dir * (0.0009 + rng() * 0.0007) * PX_SCALE;
        ranJudas = true;
      }
      // NY continuation / distribution
      if (p.hour === 8 && p.minute < minutes) {
        shock += (target < prevClose ? -1 : 1) * (0.0004 + rng() * 0.0004) * PX_SCALE;
      }

      const noise = (rng() - 0.5) * vol * 2.2;
      const next = px + magnet + noise + shock;
      const wick = vol * (0.6 + rng() * 1.4);
      let o = px;
      let c = next;
      let h = Math.max(o, c) + wick * rng();
      let l = Math.min(o, c) - wick * rng();

      h = Math.min(h, hiCap + 30);
      l = Math.max(l, loCap - 30);
      c = clamp(c, l, h);
      o = clamp(o, l, h);

      out.push({
        t: ts,
        o: roundPx(o),
        h: roundPx(h),
        l: roundPx(l),
        c: roundPx(c),
        v: Math.round((900 + rng() * 1600) * sessionVol(p.hour) * (minutes / 15)),
      });
      px = c;
    }
  }
  return out;
}

function sculptToday(m15) {
  // Friday 14 Aug 2026 — published tape:
  // prev 92,800, spike 93,600 on US close, fade to 92,400.
  const dayStart = Date.UTC(2026, 7, 13, 21, 0, 0);
  const dayEnd = Date.UTC(2026, 7, 14, 19, 45, 0);
  const path = [
    [Date.UTC(2026, 7, 13, 21, 0, 0), 92800],
    [Date.UTC(2026, 7, 14, 0, 0, 0), 92750],
    [Date.UTC(2026, 7, 14, 4, 0, 0), 92400], // Asian
    [Date.UTC(2026, 7, 14, 6, 0, 0), 92150], // London open dip
    [Date.UTC(2026, 7, 14, 7, 30, 0), 92800],
    [Date.UTC(2026, 7, 14, 10, 0, 0), 92500],
    [Date.UTC(2026, 7, 14, 12, 35, 0), 93600], // US close spike / Judas BSL
    [Date.UTC(2026, 7, 14, 13, 30, 0), 93000],
    [Date.UTC(2026, 7, 14, 15, 0, 0), 92600],
    [Date.UTC(2026, 7, 14, 17, 0, 0), 92500],
    [Date.UTC(2026, 7, 14, 19, 30, 0), 92400],
  ];

  return m15.map((b) => {
    if (b.t < dayStart || b.t > dayEnd) return b;
    let i = 0;
    while (i < path.length - 1 && path[i + 1][0] < b.t) i++;
    const a = path[i];
    const c = path[Math.min(path.length - 1, i + 1)];
    const u = clamp((b.t - a[0]) / Math.max(1, c[0] - a[0]), 0, 1);
    const mid = lerp(a[1], c[1], u);
    const isSpike =
      b.t >= Date.UTC(2026, 7, 14, 12, 15, 0) && b.t <= Date.UTC(2026, 7, 14, 12, 45, 0);
    const high = isSpike ? 93600 : Math.max(b.h, mid + 12);
    const low = Math.min(b.l, mid - 12, b.t >= dayStart ? 91200 : b.l);
    return {
      ...b,
      o: roundPx(b.o * 0.25 + mid * 0.75),
      c: roundPx(mid),
      h: roundPx(Math.max(mid, high)),
      l: roundPx(Math.min(mid, low)),
    };
  });
}

function aggregate(src, ms) {
  const map = new Map();
  for (const b of src) {
    const key = Math.floor(b.t / ms) * ms;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function buildEth(btcDaily, rng) {
  // ETHUSD ~ 3,050 now; slightly more resilient into the sell so SMT can appear.
  return btcDaily.map((b, i) => {
    const scale = 0.033;
    const base = b.c * scale;
    const hold = i > btcDaily.length - 8 ? 60 : 0;
    const c = roundPx(base - 15 + hold + (rng() - 0.5) * 30);
    return {
      t: b.t,
      o: roundPx(b.o * scale),
      h: roundPx(Math.max(b.h * scale, c) + 12),
      l: roundPx(Math.min(b.l * scale, c) - 10),
      c,
      v: b.v,
    };
  });
}

let CACHE = null;

export function getMarket() {
  if (CACHE) return CACHE;
  const rng = mulberry32(0x425443); // BTC
  const dailyPath = buildDailyPath(rng);
  const daily = dailyOHLC(dailyPath, rng);
  let m15 = expandIntraday(daily.slice(-95), 15, rng);
  m15 = sculptToday(m15);
  const h1Recent = aggregate(m15, 60 * 60 * 1000);
  const h1Old = expandIntraday(daily.slice(-140, -45), 60, mulberry32(0x455448));
  const h1 = [...h1Old, ...h1Recent].sort((a, b) => a.t - b.t);
  const h4 = aggregate(h1, 4 * 60 * 60 * 1000);
  const weekly = aggregate(daily, 7 * 24 * 60 * 60 * 1000);
  const ethDaily = buildEth(daily, mulberry32(0x455448));

  const last = m15[m15.length - 1];
  const todayBars = m15.filter((b) => b.t >= Date.UTC(2026, 7, 13, 21, 0, 0));
  if (todayBars.length && daily.length) {
    const d = daily[daily.length - 1];
    d.h = roundPx(Math.max(d.h, ...todayBars.map((b) => b.h), MARKET_META.dayHigh));
    d.l = roundPx(Math.min(d.l, ...todayBars.map((b) => b.l), MARKET_META.dayLow));
    d.c = last.c;
  }
  CACHE = {
    meta: {
      ...MARKET_META,
      spot: last.c,
      lastBar: last.t,
    },
    frames: {
      M15: m15,
      H1: h1.slice(-1800),
      H4: h4.slice(-900),
      D1: daily,
      W1: weekly,
    },
    ethDaily,
  };
  return CACHE;
}

export function applyLiveSpot(spot) {
  const m = getMarket();
  if (!Number.isFinite(spot) || spot < 20000 || spot > 250000) return m;
  const last = m.frames.M15[m.frames.M15.length - 1];
  const delta = spot - last.c;
  if (Math.abs(delta) > 6000) return m;
  last.c = roundPx(spot);
  last.h = roundPx(Math.max(last.h, spot));
  last.l = roundPx(Math.min(last.l, spot));
  for (const key of ["H1", "H4", "D1"]) {
    const bar = m.frames[key][m.frames[key].length - 1];
    bar.c = last.c;
    bar.h = Math.max(bar.h, last.h);
    bar.l = Math.min(bar.l, last.l);
  }
  m.meta.spot = last.c;
  m.meta.live = true;
  return m;
}

export function hydrateFromLive(book) {
  if (!book?.frames?.M15?.length) return getMarket();
  const base = getMarket();
  CACHE = {
    meta: {
      ...base.meta,
      ...book.meta,
      yearHigh: base.meta.yearHigh,
      yearLow: base.meta.yearLow,
      yearAvg: base.meta.yearAvg,
      sma50: base.meta.sma50,
      sma100: base.meta.sma100,
      sma200: base.meta.sma200,
      live: true,
    },
    frames: {
      M15: book.frames.M15,
      H1: book.frames.H1,
      H4: book.frames.H4,
      D1: book.frames.D1,
      W1: book.frames.W1,
    },
    ethDaily: book.ethDaily?.length ? book.ethDaily : base.ethDaily,
    source: book.source,
  };
  return CACHE;
}

export async function fetchLiveSpot() {
  const controllers = [];
  const tryFetch = async (url, parse) => {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const t = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return parse(await res.json());
    } finally {
      clearTimeout(t);
    }
  };

  const jobs = [
    tryFetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", (j) => +j?.price),
    tryFetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", (j) => {
      const k = Object.keys(j?.result || {})[0];
      return k ? +j.result[k].c[0] : null;
    }),
    tryFetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", (j) => +j?.data?.amount),
    tryFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", (j) => j?.bitcoin?.usd),
  ];

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "fulfilled" && Number.isFinite(r.value) && r.value > 20000 && r.value < 250000) {
      return r.value;
    }
  }
  return null;
}
