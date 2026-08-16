/* Email alerts when a setup is fit to enter.
   Uses FormSubmit (no API key). First mail asks Gmail to confirm the inbox. */

export const ALERT_EMAIL = "becomingaman2000@gmail.com";
const KEY_ON = "ipda-mail-on";
const KEY_LAST = "ipda-mail-last";
const KEY_ARMED = "ipda-mail-armed";
const COOLDOWN_MS = 40 * 60 * 1000;

export function mailEnabled() {
  return localStorage.getItem(KEY_ON) !== "0";
}

export function setMailEnabled(on) {
  localStorage.setItem(KEY_ON, on ? "1" : "0");
}

export function lastMail() {
  try {
    return JSON.parse(localStorage.getItem(KEY_LAST) || "null");
  } catch {
    return null;
  }
}

function actionOf(side) {
  if (side === "LONG" || side === "BUY" || side === "BULLISH") return "BUY";
  if (side === "SHORT" || side === "SELL" || side === "BEARISH") return "SELL";
  return "FLAT";
}

function fmt(n) {
  return Number.isFinite(+n) ? Math.round(+n).toLocaleString("en-US") : "—";
}

export function buildAlert(ex, market) {
  const act = actionOf(ex.side);
  const spot = fmt(market?.meta?.spot ?? ex.entry);
  const when = new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour12: false,
  });
  return {
    subject: `IPDA Desk: ${ex.status === "ENTER" ? "ENTER" : ex.status} ${act} BTC/USD @ ${fmt(ex.entry)}`,
    action: act,
    status: ex.status,
    label: (ex.label || "").replace("LONG", "BUY").replace("SHORT", "SELL"),
    pair: "BTC/USD",
    spot,
    entry: fmt(ex.entry),
    stop: fmt(ex.sl),
    tp1: fmt(ex.t1),
    tp2: fmt(ex.t2),
    rr: ex.rr != null ? String(ex.rr) : "—",
    model: ex.model || "—",
    window: ex.window || ex.when || "—",
    pipsToEntry: ex.pipsToEntry != null ? `${ex.pipsToEntry}` : "—",
    pipsToTp: ex.pipsToTp != null ? `${ex.pipsToTp}` : "—",
    note: (ex.note || "").replace(/\bLONG\b/g, "BUY").replace(/\bSHORT\b/g, "SELL"),
    source: market?.meta?.source || "IPDA Desk",
    time: when,
    desk: "https://becomingaman2000-ship-it.github.io/BTC-USD/",
  };
}

async function postFormSubmit(payload) {
  const body = {
    _subject: payload.subject,
    _template: "table",
    _captcha: "false",
    _honey: "",
    name: "IPDA Desk",
    email: "ipda-desk@noreply.local",
    Action: payload.action,
    Status: payload.label,
    Pair: payload.pair,
    Spot: payload.spot,
    "Enter at": payload.entry,
    "Stop loss": payload.stop,
    "Take profit 1": payload.tp1,
    "Take profit 2": payload.tp2,
    "R:R": payload.rr,
    Model: payload.model,
    Window: payload.window,
    "Pips to entry": payload.pipsToEntry,
    "Pips to TP1": payload.pipsToTp,
    Note: payload.note,
    Source: payload.source,
    Time: payload.time,
    Desk: payload.desk,
    message:
      `${payload.label}\n` +
      `ACTION: ${payload.action}\n` +
      `BTC/USD spot ${payload.spot}\n` +
      `Enter ${payload.entry}  |  Stop ${payload.stop}\n` +
      `TP1 ${payload.tp1}  |  TP2 ${payload.tp2}\n` +
      `R:R ${payload.rr}  |  ${payload.model}\n` +
      `${payload.window}\n` +
      `${payload.note}\n` +
      payload.desk,
  };

  const res = await fetch(`https://formsubmit.co/ajax/${ALERT_EMAIL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || String(res.status));
  return json;
}

export async function sendAlert(ex, market, { force = false } = {}) {
  const payload = buildAlert(ex, market);
  const rec = {
    key: `${payload.action}-${payload.entry}-${payload.tp1}`,
    at: Date.now(),
    action: payload.action,
    entry: payload.entry,
    subject: payload.subject,
  };
  if (!force) {
    const prev = lastMail();
    if (prev && prev.key === rec.key && Date.now() - prev.at < COOLDOWN_MS) {
      return { skipped: true, reason: "cooldown", last: prev };
    }
  }
  const result = await postFormSubmit(payload);
  localStorage.setItem(KEY_LAST, JSON.stringify(rec));
  return { ok: true, result, last: rec };
}

export async function maybeNotify(ex, market, onStatus) {
  if (!mailEnabled()) return;
  if (!ex) return;
  if (ex.status !== "ENTER") {
    sessionStorage.setItem(KEY_ARMED, "0");
    return;
  }
  if (sessionStorage.getItem(KEY_ARMED) === "1") {
    const prev = lastMail();
    const key = `${actionOf(ex.side)}-${fmt(ex.entry)}-${fmt(ex.t1)}`;
    if (prev && prev.key === key) return;
  }
  try {
    onStatus?.("sending", "Sending entry alert…");
    const out = await sendAlert(ex, market);
    if (out.skipped) {
      onStatus?.("idle", `Last alert ${new Date(out.last.at).toLocaleTimeString()} (cooldown)`);
      return;
    }
    sessionStorage.setItem(KEY_ARMED, "1");
    onStatus?.("sent", `Alert mailed to ${ALERT_EMAIL}`);
  } catch (err) {
    onStatus?.("error", err.message || "Mail failed");
  }
}
