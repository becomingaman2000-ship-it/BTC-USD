/* Real-time BTC/USD tape.
   Prefers Binance BTCUSDT (deepest BTC cash book), then Kraken XBT/USD.
   Streams ticks over WebSocket and falls back to 1s REST polling. */

const TF_MS = {
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
  W1: 7 * 24 * 60 * 60 * 1000,
};

const BINANCE_TF = { M15: "15m", H1: "1h", H4: "4h", D1: "1d", W1: "1w" };
const KRAKEN_TF = { M15: 15, H1: 60, H4: 240, D1: 1440, W1: 10080 };
const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api.binance.us",
];

function roundPx(v) {
  return Math.round(v * 100) / 100; // BTC to $0.01
}

function validPx(v) {
  return Number.isFinite(v) && v > 20000 && v < 250000;
}

async function getJSON(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function binanceRows(rows) {
  return rows.map((r) => ({
    t: +r[0],
    o: roundPx(+r[1]),
    h: roundPx(+r[2]),
    l: roundPx(+r[3]),
    c: roundPx(+r[4]),
    v: +r[5],
  }));
}

async function fetchBinance(symbol, interval, limit = 1000) {
  let lastErr;
  for (const host of BINANCE_HOSTS) {
    try {
      const j = await getJSON(
        `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );
      if (Array.isArray(j) && j.length > 10) return binanceRows(j);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("binance failed");
}

async function fetchKraken(pair, interval) {
  const j = await getJSON(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`
  );
  if (j.error?.length) throw new Error(j.error.join(","));
  const key = Object.keys(j.result || {}).find((k) => k !== "last");
  const rows = key ? j.result[key] : null;
  if (!rows?.length) throw new Error("kraken empty");
  return rows.map((r) => ({
    t: +r[0] * 1000,
    o: roundPx(+r[1]),
    h: roundPx(+r[2]),
    l: roundPx(+r[3]),
    c: roundPx(+r[4]),
    v: +r[6],
  }));
}

async function fetchKrakenTicker(pair) {
  const j = await getJSON(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const key = Object.keys(j.result || {})[0];
  const t = key && j.result[key];
  if (!t) return null;
  return {
    bid: +t.b[0],
    ask: +t.a[0],
    last: +t.c[0],
    open: +t.o,
    high: +t.h[1],
    low: +t.l[1],
  };
}

async function fetchBinanceTicker(symbol) {
  const j = await getJSON(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  return {
    last: +j.lastPrice,
    open: +j.openPrice,
    high: +j.highPrice,
    low: +j.lowPrice,
    bid: +j.bidPrice,
    ask: +j.askPrice,
  };
}

export async function loadLiveBook() {
  const frames = {};
  let source = null;
  let ticker = null;

  // 1) Deepest BTC cash book from Binance
  try {
    const pack = await Promise.all(
      Object.keys(BINANCE_TF).map(async (tf) => [tf, await fetchBinance("BTCUSDT", BINANCE_TF[tf])])
    );
    for (const [tf, bars] of pack) frames[tf] = bars;
    ticker = await fetchBinanceTicker("BTCUSDT").catch(() => null);
    source = { id: "BINANCE", label: "Binance BTC/USDT", venue: "crypto cash" };
  } catch {
    // 2) Kraken XBT/USD
    try {
      const pack = await Promise.all(
        Object.keys(KRAKEN_TF).map(async (tf) => [tf, await fetchKraken("XBTUSD", KRAKEN_TF[tf])])
      );
      for (const [tf, bars] of pack) frames[tf] = bars;
      ticker = await fetchKrakenTicker("XBTUSD").catch(() => null);
      source = { id: "KRAKEN", label: "Kraken XBT/USD", venue: "crypto spot" };
    } catch {
      return null;
    }
  }

  let ethDaily = [];
  try {
    ethDaily = source.id === "BINANCE"
      ? await fetchBinance("ETHUSDT", "1d", 400)
      : await fetchKraken("ETHUSD", 1440);
  } catch {
    ethDaily = [];
  }

  const last = frames.M15[frames.M15.length - 1];
  const prev = frames.D1.length > 1 ? frames.D1[frames.D1.length - 2].c : last.o;
  const spot = ticker?.last || last.c;

  return {
    source,
    ticker,
    ethDaily,
    frames,
    meta: {
      live: true,
      streaming: false,
      source: source.label,
      venue: source.venue,
      spot: roundPx(spot),
      prevClose: roundPx(ticker?.open || prev),
      dayHigh: roundPx(ticker?.high || last.h),
      dayLow: roundPx(ticker?.low || last.l),
      bid: ticker?.bid,
      ask: ticker?.ask,
      lastBar: last.t,
      liveAt: Date.now(),
    },
  };
}

export function applyTick(market, price, ts = Date.now()) {
  if (!market || !validPx(price)) return false;
  const px = roundPx(price);
  let opened = false;
  for (const [tf, ms] of Object.entries(TF_MS)) {
    const bars = market.frames[tf];
    if (!bars?.length) continue;
    const bucket = Math.floor(ts / ms) * ms;
    const last = bars[bars.length - 1];
    if (last.t === bucket) {
      last.c = px;
      last.h = roundPx(Math.max(last.h, px));
      last.l = roundPx(Math.min(last.l, px));
    } else if (bucket > last.t) {
      bars.push({ t: bucket, o: last.c, h: px, l: px, c: px, v: 0 });
      opened = true;
    }
  }
  market.meta.spot = px;
  market.meta.live = true;
  market.meta.liveAt = ts;
  market.meta.dayHigh = roundPx(Math.max(market.meta.dayHigh || px, px));
  market.meta.dayLow = roundPx(Math.min(market.meta.dayLow || px, px));
  return opened;
}

export function startStream(market, { onTick, onStatus }) {
  const sockets = [];
  let poll = null;
  let beat = null;
  let dead = false;
  let lastPx = market.meta.spot;
  let lastTickAt = 0;
  let ticks = 0;

  const emit = (px, ts, how) => {
    if (!validPx(px)) return;
    if (Math.abs(px - lastPx) < 0.01 && how !== "poll") return;
    lastPx = px;
    lastTickAt = Date.now();
    ticks += 1;
    const opened = applyTick(market, px, ts);
    market.meta.streaming = how === "ws";
    market.meta.feed = how;
    onTick?.({ price: px, ts, opened, ticks, how });
  };

  const setStatus = (state, detail) => onStatus?.({ state, detail, source: market.meta.source });

  const track = (ws) => {
    sockets.push(ws);
    return ws;
  };

  const openBinance = () => {
    const ws = track(new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade"));
    ws.onopen = () => setStatus("live", "Binance BTC trade stream");
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        emit(+(m.p || m.price), +(m.T || m.E || Date.now()), "ws");
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (dead) return;
      window.setTimeout(openBinance, 1200);
    };
    ws.onerror = () => {};
  };

  const openKraken = () => {
    const ws = track(new WebSocket("wss://ws.kraken.com"));
    ws.onopen = () => {
      ws.send(JSON.stringify({
        event: "subscribe",
        pair: ["XBT/USD"],
        subscription: { name: "trade" },
      }));
      ws.send(JSON.stringify({
        event: "subscribe",
        pair: ["XBT/USD"],
        subscription: { name: "ticker" },
      }));
      setStatus("live", "Kraken trade + ticker stream");
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (!Array.isArray(m)) return;
        if (m[2] === "trade" && Array.isArray(m[1])) {
          const last = m[1][m[1].length - 1];
          if (last) emit(+last[0], Math.round(+last[2] * 1000), "ws");
          return;
        }
        if (m[1]?.c) {
          if (m[1].b) market.meta.bid = +m[1].b[0];
          if (m[1].a) market.meta.ask = +m[1].a[0];
          emit(+m[1].c[0], Date.now(), "ws");
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (dead) return;
      window.setTimeout(openKraken, 1200);
    };
    ws.onerror = () => {};
  };

  const pollOnce = async () => {
    try {
      const preferBinance = market.meta.source?.includes("Binance");
      if (preferBinance) {
        const t = await fetchBinanceTicker("BTCUSDT");
        if (t) {
          market.meta.bid = t.bid;
          market.meta.ask = t.ask;
          emit(t.last, Date.now(), lastTickAt && Date.now() - lastTickAt < 3000 ? "ws" : "poll");
          return;
        }
      }
      const t = await fetchKrakenTicker("XBTUSD");
      if (t) {
        market.meta.bid = t.bid;
        market.meta.ask = t.ask;
        emit(t.last, Date.now(), lastTickAt && Date.now() - lastTickAt < 3000 ? "ws" : "poll");
      }
    } catch {
      setStatus("offline", "quote poll failed");
    }
  };

  try {
    if (market.meta.source?.includes("Binance")) openBinance();
    else openKraken();
    openKraken();
  } catch {
    setStatus("poll", "websocket blocked — polling");
  }

  poll = window.setInterval(pollOnce, 1000);
  pollOnce();
  beat = window.setInterval(() => {
    if (dead) return;
    if (Date.now() - lastTickAt > 6000) {
      setStatus("reconnect", "stale tape — forcing poll");
      pollOnce();
    }
  }, 3000);

  return () => {
    dead = true;
    for (const ws of sockets) try { ws.close(); } catch { /* */ }
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
  };
}
