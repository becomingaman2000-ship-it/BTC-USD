/* Walk-forward ICT 2022 model — 3 months BTC/USD
   Binance-style spot/cash fees: ~0.03% taker, per BTC per side, USD account.
   1 pip = $10 (see data.js). Contract = 1 BTC. */

import { getMarket, isMarketOpen } from "./data.js";

export const SPEC = {
  from: "2026-05-14",
  to: "2026-08-14",
  startEquity: 10000,
  lots: 0.5, // 0.5 BTC
  leverage: 20,
  spreadPips: 1,
  commissionPerLotSide: 25, // ~0.03% of a ~92k BTC
  pipValuePerLot: 10, // 1 BTC * $10/pip
  swapLongPerLot: 0,
  swapShortPerLot: 0,
  stopOutPct: 0.5,
  contract: 1, // 1 BTC
};

const PIP = 10;

function nyHour(ms) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { hour: +g("hour"), minute: +g("minute"), weekday: g("weekday") };
}

function inKill(ms) {
  const { hour, minute } = nyHour(ms);
  const t = hour + minute / 60;
  if (t >= 2 && t < 5) return "LONDON";
  if (t >= 7 && t < 11) return "NY_AM";
  if (t >= 13.5 && t < 16) return "NY_PM";
  return null;
}

function sessionDayKey(ms) {
  const { hour } = nyHour(ms);
  const d = new Date(ms);
  if (hour >= 17) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function swings(bars, left = 2) {
  const out = [];
  for (let i = left; i < bars.length - left; i++) {
    let hi = true;
    let lo = true;
    for (let k = i - left; k <= i + left; k++) {
      if (k === i) continue;
      if (bars[k].h >= bars[i].h) hi = false;
      if (bars[k].l <= bars[i].l) lo = false;
    }
    if (hi) out.push({ i, price: bars[i].h, type: "H", t: bars[i].t });
    if (lo) out.push({ i, price: bars[i].l, type: "L", t: bars[i].t });
  }
  return out;
}

function htfBias(h1, i) {
  const win = h1.slice(Math.max(0, i - 40), i + 1);
  if (win.length < 10) return "FLAT";
  const sw = swings(win, 2);
  const hs = sw.filter((s) => s.type === "H").slice(-3);
  const ls = sw.filter((s) => s.type === "L").slice(-3);
  if (hs.length >= 2 && ls.length >= 2) {
    const upH = hs[hs.length - 1].price > hs[0].price;
    const upL = ls[ls.length - 1].price > ls[0].price;
    if (upH && upL) return "LONG";
    if (!upH && !upL) return "SHORT";
  }
  const first = win[0].c;
  const last = win[win.length - 1].c;
  if (last > first + 8 * PIP) return "LONG";
  if (last < first - 8 * PIP) return "SHORT";
  return "FLAT";
}

function findFVG(bars, from, to, type) {
  for (let i = from + 1; i < to - 1; i++) {
    const a = bars[i - 1];
    const c = bars[i + 1];
    if (type === "BEAR" && c.h < a.l) return { i, top: a.l, bot: c.h, ce: (a.l + c.h) / 2 };
    if (type === "BULL" && c.l > a.h) return { i, top: c.l, bot: a.h, ce: (c.l + a.h) / 2 };
  }
  return null;
}

function nearestH1(h1, t) {
  let lo = 0;
  let hi = h1.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (h1[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function runBacktest(opts = {}) {
  const spec = { ...SPEC, ...opts };
  const m = getMarket();
  const start = Date.parse(spec.from + "T00:00:00Z");
  const end = Date.parse(spec.to + "T23:59:00Z");
  const m15 = m.frames.M15.filter((b) => b.t >= start && b.t <= end && isMarketOpen(b.t));
  const h1 = m.frames.H1.filter((b) => b.t >= start - 5 * 864e5 && b.t <= end);

  const pipVal = spec.lots * spec.pipValuePerLot;
  const comm = spec.lots * spec.commissionPerLotSide * 2;
  const swapL = spec.lots * spec.swapLongPerLot;
  const swapS = spec.lots * spec.swapShortPerLot;

  let equity = spec.startEquity;
  let peak = equity;
  let maxDD = 0;
  let maxDDPct = 0;
  const trades = [];
  const equityCurve = [{ t: m15[0]?.t, eq: equity }];
  let open = null;
  let lastTradeDay = "";
  let tradesToday = 0;
  let stopped = false;
  const asianBox = new Map();

  const boxOf = (ms) => {
    const key = sessionDayKey(ms);
    if (!asianBox.has(key)) asianBox.set(key, { hi: -Infinity, lo: Infinity, ready: false });
    return asianBox.get(key);
  };

  const openTrade = (side, entry, sl, tp, t, zone, note) => {
    const margin = (spec.lots * spec.contract * entry) / spec.leverage;
    if (equity - margin < 0) return false;
    if (equity <= spec.startEquity * spec.stopOutPct) return false;
    open = {
      side,
      entry,
      sl,
      tp,
      t,
      zone,
      note,
      lots: spec.lots,
      riskPips: Math.abs(entry - sl) / PIP,
    };
    return true;
  };

  const closeTrade = (bar, price, reason) => {
    if (!open) return;
    const pips =
      open.side === "LONG" ? (price - open.entry) / PIP : (open.entry - price) / PIP;
    const nights = Math.max(0, Math.floor((bar.t - open.t) / 864e5));
    const swapNights = nights + (nights >= 1 ? Math.floor(nights / 5) : 0);
    const swap = open.side === "LONG" ? swapL * swapNights : swapS * swapNights;
    const pnl = pips * pipVal - comm + swap;
    equity = +(equity + pnl).toFixed(2);
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDD = Math.max(maxDD, dd);
    maxDDPct = Math.max(maxDDPct, peak ? dd / peak : 0);
    trades.push({
      ...open,
      exit: Math.round(price),
      exitT: bar.t,
      pips: +pips.toFixed(1),
      pnl: +pnl.toFixed(2),
      comm: +comm.toFixed(2),
      swap: +swap.toFixed(2),
      reason,
      equity,
    });
    open = null;
    if (equity <= spec.startEquity * spec.stopOutPct || equity <= 0) stopped = true;
  };

  for (let i = 8; i < m15.length; i++) {
    const b = m15[i];
    if (stopped) {
      equityCurve.push({ t: b.t, eq: equity });
      continue;
    }

    if (open) {
      const hitSL = open.side === "LONG" ? b.l <= open.sl : b.h >= open.sl;
      const hitTP = open.side === "LONG" ? b.h >= open.tp : b.l <= open.tp;
      if (hitSL && hitTP) {
        closeTrade(b, open.sl, "SL (same bar as TP — conservative)");
      } else if (hitSL) {
        closeTrade(b, open.sl, "SL");
      } else if (hitTP) {
        closeTrade(b, open.tp, "TP");
      } else if (i === m15.length - 1) {
        closeTrade(b, b.c, "EOD flatten");
      }
    }

    const day = sessionDayKey(b.t);
    if (day !== lastTradeDay) {
      lastTradeDay = day;
      tradesToday = 0;
    }

    const { hour } = nyHour(b.t);
    const box = boxOf(b.t);
    if (hour >= 20 || hour < 2) {
      box.hi = Math.max(box.hi, b.h);
      box.lo = Math.min(box.lo, b.l);
    }
    if (hour >= 2 && box.hi > box.lo) box.ready = true;

    const zone = inKill(b.t);
    if (!open && zone && tradesToday < 1 && !stopped) {
      const hi = nearestH1(h1, b.t);
      const bias = htfBias(h1, hi);
      if (bias !== "FLAT") {
        const look = m15.slice(Math.max(0, i - 16), i + 1);
        const prior = look.slice(0, -3);
        if (prior.length > 4) {
          const swingHi = Math.max(...prior.map((x) => x.h));
          const swingLo = Math.min(...prior.map((x) => x.l));
          const sweptHigh = look.some((x) => x.h > swingHi + 0.5 * PIP);
          const sweptLow = look.some((x) => x.l < swingLo - 0.5 * PIP);
          const sweepHi = Math.max(...look.map((x) => x.h));
          const sweepLo = Math.min(...look.map((x) => x.l));
          const cisdShort = sweptHigh && b.c < swingHi && b.c < b.o;
          const cisdLong = sweptLow && b.c > swingLo && b.c > b.o;

          let side = null;
          let sweep = null;
          if (bias === "SHORT" && cisdShort) {
            side = "SHORT";
            sweep = sweepHi;
          }
          if (bias === "LONG" && cisdLong) {
            side = "LONG";
            sweep = sweepLo;
          }

          if (side) {
            const entry = b.c;
            const sl = side === "SHORT" ? sweep + 2.2 * PIP : sweep - 2.2 * PIP;
            const risk = Math.abs(entry - sl);
            if (risk >= 10 * PIP && risk <= 38 * PIP) {
              const tp = side === "SHORT" ? entry - 2 * risk : entry + 2 * risk;
              if (openTrade(side, Math.round(entry), Math.round(sl), Math.round(tp), b.t, zone, "2022 sweep + CISD")) {
                tradesToday += 1;
              }
            }
          }
        }
      }
    }

    if (!open && zone && tradesToday < 1 && !stopped && box.ready && box.hi > box.lo + 4 * PIP) {
      const fadeShort = b.h > box.hi + 0.3 * PIP && b.c < box.hi;
      const fadeLong = b.l < box.lo - 0.3 * PIP && b.c > box.lo;
      if (fadeShort || fadeLong) {
        const side = fadeShort ? "SHORT" : "LONG";
        const sweep = fadeShort ? b.h : b.l;
        const entry = b.c;
        const sl = fadeShort ? sweep + 2 * PIP : sweep - 2 * PIP;
        const risk = Math.abs(entry - sl);
        const tp = fadeShort ? entry - 1.2 * risk : entry + 1.2 * risk;
        if (risk >= 10 * PIP && risk <= 28 * PIP) {
          if (openTrade(side, Math.round(entry), Math.round(sl), Math.round(tp), b.t, zone, "PO3 Judas fade")) {
            tradesToday += 1;
          }
        }
      }
    }

    if (i % 8 === 0) equityCurve.push({ t: b.t, eq: equity });
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const longs = trades.filter((t) => t.side === "LONG");
  const shorts = trades.filter((t) => t.side === "SHORT");
  const byMonth = {};
  for (const t of trades) {
    const k = new Date(t.t).toISOString().slice(0, 7);
    byMonth[k] = byMonth[k] || { pnl: 0, n: 0, wins: 0 };
    byMonth[k].pnl += t.pnl;
    byMonth[k].n += 1;
    if (t.pnl > 0) byMonth[k].wins += 1;
  }
  const byZone = {};
  for (const t of trades) {
    byZone[t.zone] = byZone[t.zone] || { pnl: 0, n: 0, wins: 0 };
    byZone[t.zone].pnl += t.pnl;
    byZone[t.zone].n += 1;
    if (t.pnl > 0) byZone[t.zone].wins += 1;
  }

  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;
  const avgWinPips = wins.length ? wins.reduce((s, t) => s + t.pips, 0) / wins.length : 0;
  const avgLossPips = losses.length ? losses.reduce((s, t) => s + t.pips, 0) / losses.length : 0;
  const profit = equity - spec.startEquity;
  const ret = profit / spec.startEquity;
  const pf = grossLoss ? grossWin / grossLoss : grossWin ? 99 : 0;

  let streak = 0;
  let maxLoseStreak = 0;
  let maxWinStreak = 0;
  let cur = 0;
  let curSign = 0;
  for (const t of trades) {
    const s = t.pnl > 0 ? 1 : -1;
    if (s === curSign) cur += 1;
    else {
      cur = 1;
      curSign = s;
    }
    if (s < 0) maxLoseStreak = Math.max(maxLoseStreak, cur);
    else maxWinStreak = Math.max(maxWinStreak, cur);
  }

  const margin = (spec.lots * spec.contract * 1.15) / spec.leverage;
  const riskPer25 = 25 * pipVal;

  return {
    spec: {
      ...spec,
      pipValue: pipVal,
      roundTurnCommission: comm,
      marginApprox: +margin.toFixed(2),
      risk25pips: +riskPer25.toFixed(2),
    },
    bars: m15.length,
    equity,
    profit: +profit.toFixed(2),
    returnPct: +(ret * 100).toFixed(2),
    maxDD: +maxDD.toFixed(2),
    maxDDPct: +(maxDDPct * 100).toFixed(2),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    profitFactor: +pf.toFixed(2),
    expectancy: +expectancy.toFixed(2),
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    avgWinPips: +avgWinPips.toFixed(1),
    avgLossPips: +avgLossPips.toFixed(1),
    longs: longs.length,
    shorts: shorts.length,
    longPnl: +longs.reduce((s, t) => s + t.pnl, 0).toFixed(2),
    shortPnl: +shorts.reduce((s, t) => s + t.pnl, 0).toFixed(2),
    maxWinStreak,
    maxLoseStreak,
    stopped,
    byMonth,
    byZone,
    equityCurve,
    tradeList: trades,
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backtest.js")) {
  const r = runBacktest();
  const safe = runBacktest({ lots: 0.1 });
  console.log(JSON.stringify({ primary: summarize(r), tiny: summarize(safe) }, null, 2));
}

function summarize(r) {
  return {
    equity: r.equity,
    profit: r.profit,
    returnPct: r.returnPct,
    maxDDPct: r.maxDDPct,
    trades: r.trades,
    winRate: r.winRate,
    pf: r.profitFactor,
    exp: r.expectancy,
    stopped: r.stopped,
    byMonth: r.byMonth,
    byZone: r.byZone,
  };
}
