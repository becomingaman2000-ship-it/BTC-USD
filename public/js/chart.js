/* Institutional tape — canvas candlesticks with ICT overlays. */

export class DeskChart {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = canvas.getContext("2d");
    this.octx = overlay.getContext("2d");
    this.bars = [];
    this.analysis = null;
    this.tf = "H1";
    this.overlays = {
      fvg: true,
      ob: true,
      liq: true,
      eq: true,
      sessions: true,
      setup: true,
      sma: true,
    };
    this.view = { end: 0, count: 80 };
    this.hover = null;
    this.drag = null;
    this.dpr = 1;
    this.pad = { l: 12, r: 72, t: 18, b: 28 };
    this.onHover = null;
    this.bind();
  }

  bind() {
    const ov = this.overlay;
    ov.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1.12 : 0.88;
      const mid = this.hover?.i ?? this.view.end - this.view.count / 2;
      this.view.count = Math.round(clamp(this.view.count * dir, 24, Math.min(360, this.bars.length)));
      this.view.end = clamp(Math.round(mid + this.view.count / 2), this.view.count, this.bars.length);
      this.draw();
    }, { passive: false });

    ov.addEventListener("pointerdown", (e) => {
      ov.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, end: this.view.end };
    });
    ov.addEventListener("pointerup", () => (this.drag = null));
    ov.addEventListener("pointerleave", () => {
      this.hover = null;
      this.draw();
      this.onHover?.(null);
    });
    ov.addEventListener("pointermove", (e) => {
      const rect = ov.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (this.drag) {
        const w = this.inner().w;
        const px = w / this.view.count;
        const dx = Math.round((this.drag.x - e.clientX) / Math.max(px, 1));
        this.view.end = clamp(this.drag.end + dx, this.view.count, this.bars.length);
      }
      this.hover = this.hit(x, y);
      this.draw();
      this.onHover?.(this.hover);
    });
  }

  setData(bars, analysis, tf, opts = {}) {
    const pinned = this.view.end >= this.bars.length - 1;
    const prevCount = this.view.count;
    this.bars = bars;
    this.analysis = analysis;
    const tfChanged = tf && tf !== this.tf;
    this.tf = tf || this.tf;
    if (!opts.preserve || tfChanged || !prevCount) {
      this.view.end = bars.length;
      this.view.count = this.tf === "M15" ? 96 : this.tf === "H1" ? 90 : this.tf === "H4" ? 80 : this.tf === "D1" ? 120 : 64;
      this.view.count = Math.min(this.view.count, bars.length);
      if (!opts.soft) this.resize();
      else this.draw();
      return;
    }
    this.view.count = Math.min(prevCount, bars.length);
    this.view.end = pinned ? bars.length : Math.min(this.view.end, bars.length);
    this.draw();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = w + "px";
      c.style.height = h + "px";
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  inner() {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    return {
      x: this.pad.l,
      y: this.pad.t,
      w: w - this.pad.l - this.pad.r,
      h: h - this.pad.t - this.pad.b,
      W: w,
      H: h,
    };
  }

  windowBars() {
    const end = this.view.end;
    const start = Math.max(0, end - this.view.count);
    return { start, end, bars: this.bars.slice(start, end) };
  }

  scales() {
    const { bars } = this.windowBars();
    if (!bars.length) return { min: 88000, max: 97000 };
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
      min = Math.min(min, b.l);
      max = Math.max(max, b.h);
    }
    const pad = (max - min) * 0.12 || 0.001;
    return { min: min - pad, max: max + pad };
  }

  xAt(i) {
    const box = this.inner();
    const { start } = this.windowBars();
    const local = i - start;
    const slot = box.w / this.view.count;
    return box.x + local * slot + slot / 2;
  }

  yAt(px) {
    const box = this.inner();
    const { min, max } = this.scales();
    return box.y + ((max - px) / (max - min)) * box.h;
  }

  hit(x, y) {
    const box = this.inner();
    if (x < box.x || x > box.x + box.w) return null;
    const { start, bars } = this.windowBars();
    const slot = box.w / this.view.count;
    const local = Math.floor((x - box.x) / slot);
    if (local < 0 || local >= bars.length) return null;
    const b = bars[local];
    const { min, max } = this.scales();
    const price = max - ((y - box.y) / box.h) * (max - min);
    return { i: start + local, bar: b, x: this.xAt(start + local), y, price };
  }

  draw() {
    const ctx = this.ctx;
    const box = this.inner();
    ctx.clearRect(0, 0, box.W, box.H);
    ctx.fillStyle = "#0c0d11";
    ctx.fillRect(0, 0, box.W, box.H);

    this.grid(ctx, box);
    if (this.overlays.sessions) this.drawSessions(ctx);
    if (this.overlays.eq) this.drawEQ(ctx);
    if (this.overlays.fvg) this.drawFVGs(ctx);
    if (this.overlays.ob) this.drawOBs(ctx);
    if (this.overlays.sma) this.drawSMAs(ctx);
    this.drawCandles(ctx);
    if (this.overlays.liq) this.drawLiq(ctx);
    if (this.overlays.setup) this.drawSetup(ctx);
    this.drawAxis(ctx, box);
    this.drawCross(this.octx, box);
  }

  grid(ctx, box) {
    const { min, max } = this.scales();
    ctx.save();
    ctx.strokeStyle = "rgba(196,163,90,0.06)";
    ctx.lineWidth = 1;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const p = min + ((max - min) * i) / steps;
      const y = this.yAt(p);
      ctx.beginPath();
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSessions(ctx) {
    const { start, end } = this.windowBars();
    const bars = this.bars;
    if (this.tf !== "M15" && this.tf !== "H1") return;
    ctx.save();
    for (let i = start; i < end; i++) {
      const d = new Date(bars[i].t);
      const utcH = d.getUTCHours();
      // EDT: UTC-4. Asian ~ 00-06 UTC, London 06-11, NY 11-21
      let color = null;
      if (utcH >= 0 && utcH < 6) color = "rgba(122,155,184,0.045)";
      else if (utcH >= 6 && utcH < 11) color = "rgba(196,163,90,0.05)";
      else if (utcH >= 11 && utcH < 16) color = "rgba(111,191,154,0.04)";
      if (!color) continue;
      const x0 = this.xAt(i) - (this.inner().w / this.view.count) / 2;
      ctx.fillStyle = color;
      ctx.fillRect(x0, this.inner().y, this.inner().w / this.view.count + 0.5, this.inner().h);
    }
    ctx.restore();
  }

  drawEQ(ctx) {
    const a = this.analysis;
    if (!a) return;
    const eq = a.dealing?.h1?.eq || a.dealing?.day?.eq;
    if (!eq) return;
    this.hline(ctx, eq, "rgba(232,213,163,0.35)", true, "EQ");
    if (a.dealing.year) {
      this.hline(ctx, a.dealing.year.eq, "rgba(196,163,90,0.25)", true, "YR EQ");
    }
  }

  drawFVGs(ctx) {
    const pack = this.analysis?.frames?.[this.tf];
    if (!pack) return;
    const { start, end } = this.windowBars();
    const t0 = this.bars[start]?.t;
    const t1 = this.bars[end - 1]?.t;
    ctx.save();
    for (const g of pack.gaps.slice(-40)) {
      if (g.fill >= 1) continue;
      if (g.t > t1) continue;
      const i0 = this.indexAtTime(g.t);
      if (i0 < start - 20) continue;
      const x0 = this.xAt(Math.max(i0, start));
      const x1 = this.inner().x + this.inner().w;
      const y0 = this.yAt(g.top);
      const y1 = this.yAt(g.bot);
      ctx.fillStyle = g.type === "BULL" ? "rgba(111,191,154,0.13)" : "rgba(211,106,106,0.13)";
      ctx.strokeStyle = g.type === "BULL" ? "rgba(111,191,154,0.35)" : "rgba(211,106,106,0.35)";
      ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  drawOBs(ctx) {
    const pack = this.analysis?.frames?.[this.tf];
    if (!pack) return;
    const { start } = this.windowBars();
    ctx.save();
    for (const ob of pack.obs.slice(-12)) {
      if (ob.broken && !ob.breaker) continue;
      const i0 = this.indexAtTime(ob.t);
      const x0 = this.xAt(Math.max(i0, start));
      const x1 = this.inner().x + this.inner().w;
      const y0 = this.yAt(ob.top);
      const y1 = this.yAt(ob.bot);
      ctx.fillStyle = ob.breaker
        ? "rgba(196,163,90,0.08)"
        : ob.type === "BULL"
          ? "rgba(111,191,154,0.08)"
          : "rgba(211,106,106,0.08)";
      ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(196,163,90,0.35)";
      ctx.strokeRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawSMAs(ctx) {
    const levels = [
      [90900, "#6fbf9a", "50D"],
      [93400, "#d36a6a", "100D"],
      [94700, "#7a9bb8", "200D"],
      [90000, "#e8d5a3", "90,000"],
    ];
    for (const [p, c, lab] of levels) {
      if (p < this.scales().min || p > this.scales().max) continue;
      this.hline(ctx, p, c + "99", false, lab);
    }
  }

  drawLiq(ctx) {
    const pack = this.analysis?.frames?.[this.tf];
    if (!pack) return;
    ctx.save();
    for (const p of pack.liq.pools.slice(0, 10)) {
      if (p.price < this.scales().min || p.price > this.scales().max) continue;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = p.side === "BSL" ? "rgba(211,106,106,0.55)" : "rgba(111,191,154,0.55)";
      ctx.lineWidth = p.equal ? 1.4 : 0.8;
      const y = this.yAt(p.price);
      ctx.beginPath();
      ctx.moveTo(this.inner().x, y);
      ctx.lineTo(this.inner().x + this.inner().w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawSetup(ctx) {
    const s = this.analysis?.setups?.[0];
    if (!s) return;
    ctx.save();
    const yE = this.yAt(s.entry);
    const yS = this.yAt(s.sl);
    const yT = this.yAt(s.t1);
    const x = this.inner().x + this.inner().w * 0.72;
    const w = this.inner().w * 0.28;
    ctx.fillStyle = s.side === "SHORT" ? "rgba(211,106,106,0.10)" : "rgba(111,191,154,0.10)";
    ctx.fillRect(x, Math.min(yE, yT), w, Math.abs(yT - yE));
    ctx.fillStyle = "rgba(211,106,106,0.10)";
    ctx.fillRect(x, Math.min(yE, yS), w, Math.abs(yS - yE));
    this.hline(ctx, s.entry, "rgba(232,213,163,0.7)", false, "IN");
    this.hline(ctx, s.sl, "rgba(211,106,106,0.7)", false, "SL");
    this.hline(ctx, s.t1, "rgba(111,191,154,0.7)", false, "T1");
    ctx.restore();
  }

  drawCandles(ctx) {
    const { start, bars } = this.windowBars();
    const slot = this.inner().w / this.view.count;
    const bodyW = Math.max(1.2, slot * 0.62);
    bars.forEach((b, k) => {
      const i = start + k;
      const x = this.xAt(i);
      const up = b.c >= b.o;
      const color = up ? "#6fbf9a" : "#d36a6a";
      ctx.strokeStyle = color;
      ctx.fillStyle = up ? "rgba(111,191,154,0.15)" : "#d36a6a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, this.yAt(b.h));
      ctx.lineTo(x, this.yAt(b.l));
      ctx.stroke();
      const y0 = this.yAt(Math.max(b.o, b.c));
      const y1 = this.yAt(Math.min(b.o, b.c));
      const h = Math.max(1, y1 - y0);
      ctx.fillRect(x - bodyW / 2, y0, bodyW, h);
      ctx.strokeRect(x - bodyW / 2, y0, bodyW, h);
    });
  }

  drawAxis(ctx, box) {
    const { min, max } = this.scales();
    ctx.save();
    ctx.fillStyle = "#8a8478";
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 6; i++) {
      const p = min + ((max - min) * i) / 6;
      ctx.fillText(Math.round(p).toLocaleString("en-US"), box.x + box.w + 8, this.yAt(p));
    }
    const { start, bars } = this.windowBars();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const step = Math.max(1, Math.floor(bars.length / 6));
    for (let k = 0; k < bars.length; k += step) {
      ctx.fillText(fmtTime(bars[k].t, this.tf), this.xAt(start + k), box.y + box.h + 8);
    }
    const last = this.bars[this.bars.length - 1];
    if (last) {
      const y = this.yAt(last.c);
      ctx.fillStyle = last.c >= last.o ? "#6fbf9a" : "#d36a6a";
      roundRect(ctx, box.x + box.w + 4, y - 9, 64, 18, 2);
      ctx.fill();
      ctx.fillStyle = "#0c0d11";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(last.c).toLocaleString("en-US"), box.x + box.w + 36, y);
    }
    ctx.restore();
  }

  drawCross(ctx, box) {
    ctx.clearRect(0, 0, box.W, box.H);
    if (!this.hover) return;
    ctx.save();
    ctx.strokeStyle = "rgba(232,213,163,0.28)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(this.hover.x, box.y);
    ctx.lineTo(this.hover.x, box.y + box.h);
    ctx.moveTo(box.x, this.hover.y);
    ctx.lineTo(box.x + box.w, this.hover.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e8d5a3";
    ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(Math.round(this.hover.price).toLocaleString("en-US"), box.x + box.w + 8, this.hover.y);
    ctx.restore();
  }

  hline(ctx, price, color, dash, label) {
    const y = this.yAt(price);
    if (y < this.inner().y || y > this.inner().y + this.inner().h) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(this.inner().x, y);
    ctx.lineTo(this.inner().x + this.inner().w, y);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(label, this.inner().x + 6, y - 4);
    }
    ctx.restore();
  }

  indexAtTime(t) {
    let lo = 0;
    let hi = this.bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.bars[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function fmtTime(t, tf) {
  const d = new Date(t);
  const opts =
    tf === "D1" || tf === "W1"
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", ...opts }).format(d);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
