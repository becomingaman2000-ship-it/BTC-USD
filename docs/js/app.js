import { getMarket, hydrateFromLive, MARKET_META } from "./data.js";
import { analyze, killZones, executionFrom } from "./ict.js";
import { DeskChart } from "./chart.js";
import { loadLiveBook, startStream } from "./live.js";
import { mailEnabled, setMailEnabled, maybeNotify, sendAlert, lastMail, ALERT_EMAIL } from "./notify.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const PIP = MARKET_META.pip; // 1 pip = $10

const state = {
  tf: "H1",
  market: null,
  analysis: null,
  chart: null,
  live: false,
  stopStream: null,
};

function fmt(n, d = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: d });
}
function pips(n) {
  return (n / PIP).toFixed(1);
}
function clsBias(v) {
  if (v === "BULLISH" || v === "UP" || v === "LONG" || v === "BUY") return "up";
  if (v === "BEARISH" || v === "DOWN" || v === "SHORT" || v === "SELL") return "down";
  return "flat";
}
function actionOf(side) {
  if (side === "LONG" || side === "BUY" || side === "BULLISH" || side === "UP") return "BUY";
  if (side === "SHORT" || side === "SELL" || side === "BEARISH" || side === "DOWN") return "SELL";
  return "FLAT";
}

function feedLabel(meta) {
  if (meta?.streaming) return `LIVE · ${meta.source || "STREAM"}`;
  if (meta?.live && meta?.feed === "poll") return `LIVE POLL · ${meta.source || "REST"}`;
  if (meta?.live) return `LIVE BOOK · ${meta.source || "TAPE"}`;
  return "COMPOSITE TAPE · SEEKING LIVE FEED";
}

function setFeedStatus(stateName, detail) {
  const el = $("#feedStatus");
  if (!el) return;
  el.dataset.state = stateName;
  el.textContent = detail || stateName;
}

function renderClock() {
  const kz = killZones(new Date());
  $("#nyClock").textContent = kz.ny;
  const active = kz.active[0];
  const pill = $("#kzPill");
  if (active) {
    pill.textContent = active.name;
    pill.dataset.on = "1";
  } else {
    pill.textContent = "Outside kill zone";
    pill.dataset.on = "0";
  }
  const list = $("#kzList");
  if (list) {
    list.innerHTML = kz.zones
      .map(
        (z) => `<li class="${z.on ? "on" : ""}">
          <i></i><span>${z.name}</span><em>${z.note}</em>
        </li>`
      )
      .join("");
  }
}

function renderTape(a) {
  const chg = a.price - (a.meta.prevClose || a.price);
  const pct = (chg / (a.meta.prevClose || a.price)) * 100;
  $("#spot").textContent = fmt(a.price);
  $("#spotChg").textContent = `${chg >= 0 ? "+" : ""}${fmt(chg)}  (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  $("#spotChg").className = "chg " + (chg >= 0 ? "up" : "down");
  $("#asOf").textContent = feedLabel(a.meta);
  $("#biasHtf").textContent = a.bias.htf;
  $("#biasHtf").className = "seal " + clsBias(a.bias.htf);
  $("#biasLtf").textContent = a.bias.shortTerm;
  $("#biasLtf").className = "seal " + clsBias(a.bias.shortTerm);

  const live = $("#livePill");
  if (live) {
    live.dataset.on = a.meta.live ? "1" : "0";
    live.dataset.stream = a.meta.streaming ? "1" : "0";
    live.textContent = a.meta.streaming ? "STREAMING" : a.meta.live ? "LIVE BOOK" : "STANDBY";
  }
  const feed = $("#feedLine");
  if (feed) {
    const age = a.meta.liveAt ? Math.max(0, Math.round((Date.now() - a.meta.liveAt) / 1000)) : "—";
    const ba = a.meta.bid && a.meta.ask ? `  ·  ${fmt(a.meta.bid)} / ${fmt(a.meta.ask)}` : "";
    feed.textContent = `${a.meta.source || "composite"}${ba}  ·  ${age === "—" ? "no tick yet" : age + "s ago"}`;
  }

  const g = $("#gaugeFill");
  if (g) {
    const ang = (a.confluence.score / 100) * 180;
    g.style.transform = `rotate(${ang - 90}deg)`;
  }
  $("#confScore").textContent = a.confluence.score;
  $("#confNotes").textContent = a.confluence.notes.join(" · ") || "Mixed read";

  const act = actionOf(a.execution?.side || a.bias.shortTerm);
  const flag = $("#actionFlag");
  const word = $("#actionWord");
  if (flag && word) {
    flag.dataset.action = act;
    word.textContent = act;
  }
}

function renderMTF(a) {
  const box = $("#mtfGrid");
  const rows = ["W1", "D1", "H4", "H1", "M15"];
  box.innerHTML = rows
    .map((tf) => {
      const s = a.structure[tf];
      const ev = s.lastEvent;
      return `<article>
        <header><span>${tf}</span><b class="${clsBias(s.trend)}">${s.trend}</b></header>
        <p>${ev ? `${ev.kind} ${ev.dir} @ ${fmt(ev.price)}` : "No fresh MSS"}</p>
        <footer>H ${fmt(s.lastHigh?.price || 0)} · L ${fmt(s.lastLow?.price || 0)}</footer>
      </article>`;
    })
    .join("");
}

function renderExecute(a) {
  const box = $("#execute");
  const ex = a.execution;
  if (!box || !ex) return;
  const act = actionOf(ex.side);
  box.dataset.status = ex.status;
  box.dataset.action = act;
  const stamp = $("#exAction");
  if (stamp) {
    stamp.dataset.action = act;
    $("#exActionWord").textContent = act;
    $("#exActionSub").textContent =
      act === "BUY" ? "Go long bitcoin / sell the dollar" :
      act === "SELL" ? "Go short bitcoin / buy the dollar" :
      "No directional order";
  }
  $("#exState").textContent = ex.label.replace("LONG", "BUY").replace("SHORT", "SELL");
  $("#exWhen").textContent = ex.when;
  $("#exEntry").textContent = ex.entry != null ? fmt(ex.entry) : "—";
  $("#exSl").textContent = ex.sl != null ? fmt(ex.sl) : "—";
  $("#exTp1").textContent = ex.t1 != null ? fmt(ex.t1) : "—";
  $("#exTp2").textContent = ex.t2 != null ? fmt(ex.t2) : "—";
  $("#exWindow").textContent = ex.when;
  $("#exCount").textContent = ex.countdown === "now" ? "window open" : `in ${ex.countdown}`;
  $("#exModel").textContent = ex.model || "—";
  $("#exRr").textContent = ex.rr ? `R:R ${ex.rr}` : "—";
  $("#exEntryDist").textContent = ex.pipsToEntry != null ? `${ex.pipsToEntry} pips from spot` : "—";
  $("#exSlDist").textContent = ex.pipsToSl != null ? `${ex.pipsToSl} pips of room` : "—";
  $("#exTp1Dist").textContent = ex.pipsToTp != null ? `${ex.pipsToTp} pips to T1` : "—";
  $("#exTp2Dist").textContent = ex.t2 != null ? `${pips(Math.abs(ex.t2 - a.price))} pips to T2` : "—";
  $("#exNote").textContent = (ex.note || "").replace(/\bLONG\b/g, "BUY").replace(/\bSHORT\b/g, "SELL");
  const bar = $("#exBar");
  if (bar) bar.style.width = `${Math.max(2, ex.progress || 0)}%`;
  maybeNotify(ex, state.market, setMailStatus);
}

function setMailStatus(stateName, detail) {
  const el = $("#mailStatus");
  if (!el) return;
  el.dataset.state = stateName || "idle";
  el.textContent = detail || "";
}

function renderLimits(a) {
  const board = $("#limitBoard");
  if (!board) return;
  const rows = a.limits || [];
  board.innerHTML = rows
    .map((c) => {
      const act = c.action || "FLAT";
      return `<article class="limit-card" data-action="${act}" data-live="${c.live ? "1" : "0"}">
        <header>
          <div>
            <h3>${c.session}</h3>
            <span class="clock">${c.clock}</span>
          </div>
          <b class="pill-fill" data-fill="${c.fill}">${c.fill}</b>
        </header>
        <strong class="limit-order">${c.order}</strong>
        <dl>
          <div><dt>Limit</dt><dd>${c.limit != null ? fmt(c.limit) : "—"}</dd></div>
          <div><dt>Stop</dt><dd>${c.sl != null ? fmt(c.sl) : "—"}</dd></div>
          <div><dt>TP1</dt><dd>${c.tp1 != null ? fmt(c.tp1) : "—"}</dd></div>
          <div><dt>TP2</dt><dd>${c.tp2 != null ? fmt(c.tp2) : "—"}</dd></div>
          <div><dt>R:R</dt><dd>${c.rr != null ? c.rr : "—"}</dd></div>
          <div><dt>Distance</dt><dd>${c.dist != null ? c.dist + " pips" : "—"}</dd></div>
        </dl>
        <p class="why">${c.why}</p>
      </article>`;
    })
    .join("");
}

function renderPred(a) {
  const p = a.predictions;
  const cards = [
    ["Intraday", p.intraday],
    ["Next 24h", p.day],
    ["Swing", p.swing],
  ];
  $("#predGrid").innerHTML = cards
    .map(
      ([name, x]) => `<article class="${clsBias(x.direction)}">
        <header><span>${name}</span><b>${actionOf(x.direction)}</b></header>
        <div class="target">${fmt(x.target)}</div>
        <dl>
          <div><dt>Stretch</dt><dd>${fmt(x.stretch)}</dd></div>
          <div><dt>Invalid</dt><dd>${fmt(x.invalid)}</dd></div>
          <div><dt>Conf.</dt><dd>${x.confidence}%</dd></div>
        </dl>
        <p>${x.text}</p>
      </article>`
    )
    .join("");

  $("#scenarios").innerHTML = p.scenarios
    .map(
      (s) => `<li>
        <div><strong>${s.name}</strong><span>${Math.round(s.odds * 100)}%</span></div>
        <i><b style="width:${s.odds * 100}%"></b></i>
        <p>${s.path}</p>
      </li>`
    )
    .join("");
}

function renderSetups(a) {
  $("#setups").innerHTML = a.setups
    .map(
      (s) => `<article class="${clsBias(s.side)}">
        <header>
          <span class="tag">${s.model}</span>
          <b>${actionOf(s.side)}</b>
        </header>
        <h3>${s.title}</h3>
        <ul class="levels">
          <li><span>Entry</span><em>${fmt(s.entry)}</em></li>
          <li><span>Stop</span><em>${fmt(s.sl)}</em></li>
          <li><span>T1</span><em>${fmt(s.t1)}</em></li>
          <li><span>T2</span><em>${fmt(s.t2)}</em></li>
        </ul>
        <div class="meta">
          <span>R:R ${s.rr}</span>
          <span>${s.riskPips} pip risk</span>
          <span>${s.window}</span>
        </div>
        <p>${s.thesis}</p>
      </article>`
    )
    .join("");
}

function renderPD(a) {
  $("#fvgList").innerHTML = a.pdArrays.fvgs
    .slice(0, 6)
    .map(
      (g) => `<li>
        <b class="${g.type === "BULL" ? "up" : "down"}">${g.tf} ${g.type} FVG</b>
        <span>${fmt(g.bot)} – ${fmt(g.top)}</span>
        <em>${g.virgin ? "virgin" : Math.round(g.fill * 100) + "% filled"}${g.inverted ? " · IFVG" : ""}</em>
      </li>`
    )
    .join("");
  $("#obList").innerHTML = a.pdArrays.orderBlocks
    .slice(0, 6)
    .map(
      (o) => `<li>
        <b class="${o.type === "BULL" ? "up" : "down"}">${o.tf} ${o.breaker ? "BREAKER" : "OB"}</b>
        <span>${fmt(o.bot)} – ${fmt(o.top)}</span>
        <em>${o.fresh ? "fresh" : o.breaker ? "inverted" : "mitigated"}</em>
      </li>`
    )
    .join("");

  const y = a.dealing.year;
  $("#pdMeter").style.setProperty("--pos", `${clamp(y.pos, 0, 1) * 100}%`);
  $("#pdZone").textContent = y.zone;
  $("#pdZone").className = clsBias(y.zone === "DISCOUNT" ? "BULLISH" : y.zone === "PREMIUM" ? "BEARISH" : "RANGE");
  $("#pdLow").textContent = fmt(y.low);
  $("#pdHigh").textContent = fmt(y.high);
  $("#pdEq").textContent = fmt(y.eq);
}

function renderStory(a) {
  $("#storyHead").textContent = a.narrative.headline;
  $("#storyBody").innerHTML = a.narrative.paragraphs.map((p) => `<p>${p}</p>`).join("");
  $("#storyBullets").innerHTML = a.narrative.bullets.map((b) => `<li>${b}</li>`).join("");
  $("#smtBox").innerHTML = `<strong>${a.smt?.label || "SMT"}</strong><p>${a.smt?.detail || ""}</p>`;
  $("#po3Phase").textContent = a.po3.phase;
  $("#po3Text").textContent = a.po3.narrative + (a.po3.judas ? " " + a.po3.judas.label + "." : "");

  const sess = a.sessions;
  $("#sessGrid").innerHTML = ["asian", "london", "ny"]
    .map((k) => {
      const s = sess[k];
      if (!s) return `<article><header>${k}</header><p>Building…</p></article>`;
      return `<article>
        <header>${k.toUpperCase()}</header>
        <p>${fmt(s.low)} – ${fmt(s.high)}</p>
        <em>${pips(s.high - s.low)} pips</em>
      </article>`;
    })
    .join("");
}

function renderLevels(a) {
  $("#lvlList").innerHTML = a.keyLevels
    .sort((x, y) => y.price - x.price)
    .map((l) => {
      const dist = ((l.price - a.price) / PIP).toFixed(1);
      return `<li>
        <span>${fmt(l.price)}</span>
        <em>${l.kind}</em>
        <b class="${+dist >= 0 ? "down" : "up"}">${dist > 0 ? "+" : ""}${dist}</b>
      </li>`;
    })
    .join("");
}

function renderHover(h) {
  const el = $("#ohlc");
  if (!h) {
    el.innerHTML = "<span>Hover the tape</span>";
    return;
  }
  const b = h.bar;
  const up = b.c >= b.o;
  el.innerHTML = `
    <b class="${up ? "up" : "down"}">${fmt(b.c)}</b>
    <span>O ${fmt(b.o)}</span>
    <span>H ${fmt(b.h)}</span>
    <span>L ${fmt(b.l)}</span>
    <span>${new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(b.t)} NY</span>`;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function refresh(market, opts = {}) {
  state.market = market;
  state.analysis = analyze(market);
  const a = state.analysis;
  renderTape(a);
  renderExecute(a);
  if (!opts.tickOnly) {
    renderMTF(a);
    renderLimits(a);
    renderPred(a);
    renderSetups(a);
    renderPD(a);
    renderStory(a);
    renderLevels(a);
  }
  const bars = market.frames[state.tf];
  state.chart.setData(bars, a, state.tf, {
    preserve: opts.preserve,
    soft: opts.soft,
  });
}

function setTF(tf) {
  state.tf = tf;
  $$(".tf button").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
  if (state.market) {
    state.chart.setData(state.market.frames[tf], state.analysis, tf);
  }
}

async function attachLive() {
  setFeedStatus("seek", "Requesting live BTC/USD book…");
  const book = await loadLiveBook();
  if (!book) {
    setFeedStatus("offline", "Live venues blocked — composite tape");
    window.setTimeout(attachLive, 20000);
    return;
  }
  state.live = true;
  if (state.stopStream) state.stopStream();
  const m = hydrateFromLive(book);
  refresh(m);
  setFeedStatus("book", `${book.source.label} book loaded`);
  let lastScan = Date.now();
  let lastPaint = 0;
  state.stopStream = startStream(m, {
    onTick: ({ opened, price }) => {
      const now = Date.now();
      const heavy = opened || now - lastScan > 8000;
      if (heavy) {
        lastScan = now;
        lastPaint = now;
        refresh(m, { preserve: true, soft: true });
        return;
      }
      if (!state.analysis || now - lastPaint < 200) return;
      lastPaint = now;
      state.analysis.price = price;
      state.analysis.meta = m.meta;
      state.analysis.execution = executionFrom(
        state.analysis.setups,
        price,
        now,
        state.analysis.po3,
        state.analysis.bias
      );
      renderTape(state.analysis);
      renderExecute(state.analysis);
      state.chart.setData(m.frames[state.tf], state.analysis, state.tf, {
        preserve: true,
        soft: true,
      });
    },
    onStatus: (s) => setFeedStatus(s.state, s.detail),
  });
}

function boot() {
  state.chart = new DeskChart($("#tape"), $("#tapeOv"));
  state.chart.onHover = renderHover;
  refresh(getMarket());

  $$(".tf button").forEach((b) =>
    b.addEventListener("click", () => setTF(b.dataset.tf))
  );
  $$("[data-ov]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.ov;
      state.chart.overlays[k] = !state.chart.overlays[k];
      b.classList.toggle("off", !state.chart.overlays[k]);
      state.chart.draw();
    })
  );

  $("#rescan").addEventListener("click", async () => {
    $("#rescan").classList.add("spin");
    await attachLive();
    setTimeout(() => $("#rescan").classList.remove("spin"), 700);
  });

  window.addEventListener("resize", () => state.chart.resize());
  renderClock();
  setInterval(renderClock, 1000);
  attachLive();

  window.addEventListener("keydown", (e) => {
    const map = { 1: "M15", 2: "H1", 3: "H4", 4: "D1", 5: "W1" };
    if (map[e.key]) setTF(map[e.key]);
  });

  $("#yearNow").textContent = new Date().getFullYear();
  requestAnimationFrame(() => $("#boot")?.classList.add("off"));
}

document.addEventListener("DOMContentLoaded", boot);
Object.assign(window, { MARKET_META });
