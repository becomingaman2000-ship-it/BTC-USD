const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  analysis: null,
  timeframe: '15m',
  overlays: { fvg: true, ob: true, liquidity: true },
  hoverIndex: null,
  refreshing: false,
};

const money = (value, decimals = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return '$' + number.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const signed = value => `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const byId = id => document.getElementById(id);

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text;
}

function toast(message) {
  const el = byId('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function renderAnalysis(data) {
  state.analysis = data;
  $$('.loading-card').forEach(el => el.classList.remove('loading-card'));

  const isDemo = data.data_mode === 'demo';
  byId('feedBanner').classList.toggle('show', isDemo);
  setText('feedLabel', isDemo ? 'DEMO' : 'LIVE');
  setText('dataIntegrity', isDemo ? '◉ DEMO DATA' : '● VERIFIED FEED');
  setText('providerLabel', `DATA · ${data.provider.toUpperCase()}`);
  setText('headerPrice', money(data.price));
  setText('sessionName', data.session.name);
  setText('sessionTime', data.session.hour_utc);

  const generated = new Date(data.generated_at);
  const validDate = !Number.isNaN(generated.valueOf());
  setText('asOf', validDate ? `AS OF ${generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : 'LATEST CANDLE');
  setText('verdictText', data.verdict);
  setText('verdictSummary', data.summary);
  setText('confidenceValue', `${data.confidence}%`);
  setText('rawScore', `${data.raw_score > 0 ? '+' : ''}${data.raw_score}`);

  const directionIcon = byId('directionIcon');
  directionIcon.className = `direction-icon ${data.direction}`;
  directionIcon.textContent = data.direction === 'bullish' ? '↗' : data.direction === 'bearish' ? '↘' : '—';

  const ring = byId('confidenceRing');
  ring.style.strokeDashoffset = String(264 - 264 * data.confidence / 100);
  ring.style.stroke = data.direction === 'bullish' ? '#5cdea3' : data.direction === 'bearish' ? '#ed706b' : '#e6a246';

  setText('bullProbability', `${data.bullish_probability}%`);
  setText('bearProbability', `${data.bearish_probability}%`);
  byId('bullBar').style.width = `${data.bullish_probability}%`;
  byId('bearBar').style.width = `${data.bearish_probability}%`;

  renderTradePlan(data);
  renderStructure(data);
  renderConfluences(data);
  renderLiquidity(data);
  renderReferences(data);
  renderChecklist(data);

  setText('chartPrice', money(data.price, 2));
  const change = byId('chartChange');
  change.textContent = signed(data.change_24h);
  change.classList.toggle('negative', data.change_24h < 0);
  setText('footerDisclaimer', data.disclaimer);
  byId('chartEmpty').classList.add('hidden');
  drawChart();
}

function renderTradePlan(data) {
  const plan = data.trade_plan;
  const setupBadge = byId('setupBadge');
  setupBadge.className = `setup-badge ${plan.status}`;
  setupBadge.textContent = plan.status === 'armed' ? 'ARMED' : plan.status === 'developing' ? 'DEVELOPING' : 'STAND ASIDE';
  setText('executionState', plan.status === 'armed' ? 'SETUP ARMED' : plan.status === 'developing' ? 'AWAIT TRIGGER' : 'NO DEPLOYMENT');

  const side = data.trade_status === 'buy' ? 'BUY SETUP' : data.trade_status === 'sell' ? 'SELL SETUP' : 'WAIT / NO TRADE';
  setText('planSide', side);
  byId('planSide').className = data.trade_status === 'wait' ? 'neutral' : data.direction;
  setText('planType', data.trade_status === 'wait' ? 'Conditions incomplete — preserve capital' : titleCase(plan.entry_type));
  setText('planEntry', money(plan.entry, 2));
  setText('planStop', money(plan.stop, 2));
  setText('planTarget1', money(plan.target_1, 2));
  setText('planTarget2', money(plan.target_2, 2));
  setText('planRR', `${plan.risk_reward.toFixed(2)}R`);
  setText('planInvalidation', plan.invalidation);
  byId('calcEntry').value = Number(plan.entry).toFixed(2);
  byId('calcStop').value = Number(plan.stop).toFixed(2);
  calculateRisk();
}

function renderStructure(data) {
  const labels = {
    '1w': 'Macro narrative', '1d': 'Daily bias', '4h': 'Strategic intent',
    '1h': 'Operational flow', '30m': 'Intraday context', '15m': 'Execution', '5m': 'Trigger'
  };
  byId('structureGrid').innerHTML = ['1w', '1d', '4h', '1h', '30m', '15m', '5m'].map(tf => {
    const item = data.structures[tf];
    const pips = Array.from({ length: 5 }, (_, index) => {
      const active = index < Math.abs(item.score);
      return `<i class="${active ? `on ${item.bias}` : ''}"></i>`;
    }).join('');
    return `<article class="structure-card">
      <div class="tf-head"><span class="tf-name">${tf.toUpperCase()} / ${labels[tf]}</span><span class="bias-badge ${item.bias}">${item.bias}</span></div>
      <h3 class="${item.bias}">${item.action.toUpperCase()}</h3>
      <p><strong>${item.event}</strong><br>${item.high_pattern} highs · ${item.low_pattern} lows · ${item.strength}%</p>
      <div class="score-pips" aria-label="Structure strength ${Math.abs(item.score)} out of 5">${pips}</div>
    </article>`;
  }).join('');
}

function renderConfluences(data) {
  const aligned = data.confluences.filter(item => item.state === data.direction && item.impact > 0).length;
  setText('confluenceCount', `${aligned} / ${data.confluences.length} aligned`);
  byId('confluenceList').innerHTML = data.confluences.map(item => {
    const directional = ['bullish', 'bearish'].includes(item.state);
    const icon = item.state === 'bullish' ? '↗' : item.state === 'bearish' ? '↘' : item.state === 'active' ? '◷' : '·';
    return `<div class="confluence-item">
      <span class="conf-check ${directional ? item.state : ''}">${icon}</span>
      <div><h4>${item.name}</h4><p>${item.detail}</p></div>
      <span class="conf-impact">${item.impact ? `+${item.impact}` : '—'}</span>
    </div>`;
  }).join('');
}

function renderLiquidity(data) {
  const liq = data.liquidity;
  setText('dealingZone', liq.zone.toUpperCase());
  setText('buySide', money(liq.buy_side));
  setText('sellSide', money(liq.sell_side));
  setText('equilibriumPrice', money(liq.equilibrium));
  const ote = data.direction === 'bearish' ? liq.ote_short : liq.ote_long;
  setText('oteZone', `${money(ote.low)}–${money(ote.high)}`);
  const buyDistance = Math.abs(liq.buy_side - data.price);
  const sellDistance = Math.abs(data.price - liq.sell_side);
  setText('nearestDraw', buyDistance <= sellDistance ? `BUY ${money(liq.buy_side)}` : `SELL ${money(liq.sell_side)}`);
  const span = Math.max(liq.range_high - liq.range_low, 1);
  const fromTop = Math.max(4, Math.min(96, (liq.range_high - data.price) / span * 100));
  byId('rangePriceMarker').style.top = `${fromTop}%`;
}

function renderReferences(data) {
  const levels = data.reference_levels;
  setText('dailyOpen', money(levels.daily_open));
  setText('weeklyOpen', money(levels.weekly_open));
  setText('previousHigh', money(levels.previous_day_high));
  setText('previousLow', money(levels.previous_day_low));
  setText('activeWindow', data.session.name);
  setText('windowState', data.session.active ? 'ACTIVE' : 'MONITOR');
}

function renderChecklist(data) {
  const status = data.trade_status || 'wait';
  const statusLabel = status === 'buy' ? 'BUY AUTHORIZED' : status === 'sell' ? 'SELL AUTHORIZED' : 'WAIT — NO TRADE';
  setText('readinessStatus', statusLabel);
  const heading = byId('readinessStatus');
  heading.className = status;
  setText('readinessMessage', status === 'wait'
    ? 'One or more essential conditions are incomplete. Preserve capital and wait for confirmation.'
    : `${status.toUpperCase()} conditions are aligned. Execute only at the defined entry with the stated invalidation.`);
  byId('tradeChecklist').innerHTML = data.trade_checklist.map(item => {
    const icon = item.status === 'confirmed' ? '✓' : item.status === 'blocked' ? '×' : item.status === 'manual' ? '!' : '·';
    return `<div class="check-item">
      <span class="check-icon ${item.status}">${icon}</span>
      <div><h4>${item.name}</h4><p>${item.detail}</p></div>
    </div>`;
  }).join('');
}

async function loadAnalysis(force = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  byId('refreshButton').classList.add('spinning');
  try {
    const response = await fetch(`/api/analysis${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.detail || data.error);
    renderAnalysis(data);
    if (force) toast(`Analysis refreshed · ${data.provider}`);
  } catch (error) {
    console.error(error);
    byId('chartEmpty').innerHTML = '<p>Intelligence feed unavailable</p><button onclick="loadAnalysis(true)">Retry</button>';
    toast('Feed unavailable. Retry in a moment.');
  } finally {
    state.refreshing = false;
    byId('refreshButton').classList.remove('spinning');
  }
}

// --- High-DPI candlestick renderer ---------------------------------------------------------
const canvas = byId('priceChart');
const ctx = canvas.getContext('2d');
let chartGeometry = null;

function nicePriceStep(range, targetLines = 6) {
  const rough = range / targetLines;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 0.01)));
  const normalized = rough / power;
  const nice = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return nice * power;
}

function drawChart() {
  if (!state.analysis || !state.analysis.candles[state.timeframe]) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const all = state.analysis.candles[state.timeframe];
  const visibleCount = rect.width < 600 ? 62 : state.timeframe === '4h' ? 90 : 104;
  const candles = all.slice(-visibleCount);
  const startIndex = all.length - candles.length;
  const pad = { left: 14, right: 74, top: 17, bottom: 28 };
  const width = rect.width - pad.left - pad.right;
  const height = rect.height - pad.top - pad.bottom;
  let min = Math.min(...candles.map(c => c.low));
  let max = Math.max(...candles.map(c => c.high));
  const baseRange = Math.max(max - min, 1);
  min -= baseRange * .08;
  max += baseRange * .08;
  const y = price => pad.top + (max - price) / (max - min) * height;
  const x = index => pad.left + (index + .5) * width / candles.length;
  const candleWidth = Math.max(2.2, Math.min(7, width / candles.length * .64));

  ctx.fillStyle = '#0d1112';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Grid and price axis.
  ctx.font = '9px "DM Mono", monospace';
  ctx.textBaseline = 'middle';
  const step = nicePriceStep(max - min);
  const first = Math.ceil(min / step) * step;
  for (let price = first; price <= max; price += step) {
    const py = y(price);
    ctx.strokeStyle = '#202628';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, py + .5); ctx.lineTo(rect.width - pad.right + 6, py + .5); ctx.stroke();
    ctx.fillStyle = '#5c6668';
    ctx.fillText('$' + Math.round(price).toLocaleString(), rect.width - pad.right + 11, py);
  }
  for (let i = 0; i < candles.length; i += Math.max(12, Math.round(candles.length / 6))) {
    const px = x(i);
    ctx.strokeStyle = '#181e20';
    ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, rect.height - pad.bottom); ctx.stroke();
    const date = new Date(candles[i].time * 1000);
    const label = ['4h', '1d', '1w'].includes(state.timeframe)
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    ctx.fillStyle = '#4f595b'; ctx.textAlign = 'center'; ctx.fillText(label, px, rect.height - 12);
  }
  ctx.textAlign = 'left';

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, width, height); ctx.clip();

  // ICT arrays are detected on the execution (15M) chart.
  if (state.timeframe === '15m' && state.overlays.fvg) {
    state.analysis.fair_value_gaps.filter(g => g.status === 'open' && g.index >= startIndex - 5).forEach(gap => {
      const from = Math.max(0, gap.index - startIndex - 1);
      const px = x(from);
      const top = y(gap.high), bottom = y(gap.low);
      ctx.fillStyle = gap.direction === 'bullish' ? 'rgba(91, 81, 193, .11)' : 'rgba(146, 75, 102, .10)';
      ctx.strokeStyle = gap.direction === 'bullish' ? 'rgba(111, 98, 221, .45)' : 'rgba(189, 87, 112, .42)';
      ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.fillRect(px, top, rect.width - pad.right - px, bottom - top);
      ctx.strokeRect(px, top, rect.width - pad.right - px, bottom - top);
      ctx.setLineDash([]);
      ctx.fillStyle = '#8d84d8'; ctx.font = '8px "DM Mono", monospace'; ctx.fillText('FVG', px + 5, top + 9);
    });
  }
  if (state.timeframe === '15m' && state.overlays.ob) {
    state.analysis.order_blocks.filter(o => o.status === 'active' && o.index >= startIndex - 8).forEach(block => {
      const from = Math.max(0, block.index - startIndex);
      const px = x(from);
      const top = y(block.high), bottom = y(block.low);
      ctx.fillStyle = 'rgba(226, 154, 63, .08)'; ctx.strokeStyle = 'rgba(226, 154, 63, .38)';
      ctx.fillRect(px, top, rect.width - pad.right - px, Math.max(1, bottom - top));
      ctx.strokeRect(px, top, rect.width - pad.right - px, Math.max(1, bottom - top));
      ctx.fillStyle = '#d49a50'; ctx.font = '8px "DM Mono", monospace'; ctx.fillText('OB', px + 5, top + 9);
    });
  }
  if (state.overlays.liquidity) {
    const levels = [
      { price: state.analysis.liquidity.buy_side, label: 'BSL', color: '#c3605d' },
      { price: state.analysis.liquidity.sell_side, label: 'SSL', color: '#4ab184' },
      { price: state.analysis.liquidity.equilibrium, label: 'EQ', color: '#566164' },
    ];
    levels.filter(level => level.price >= min && level.price <= max).forEach(level => {
      const py = y(level.price); ctx.strokeStyle = level.color; ctx.globalAlpha = .58; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(rect.width - pad.right, py); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = level.color; ctx.globalAlpha = 1; ctx.font = '8px "DM Mono", monospace'; ctx.fillText(level.label, pad.left + 4, py - 7);
    });
  }

  // Candles.
  candles.forEach((candle, index) => {
    const px = x(index);
    const bullish = candle.close >= candle.open;
    const color = bullish ? '#56d79b' : '#e26863';
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, y(candle.high)); ctx.lineTo(px, y(candle.low)); ctx.stroke();
    const bodyTop = y(Math.max(candle.open, candle.close));
    const bodyBottom = y(Math.min(candle.open, candle.close));
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    if (bullish) { ctx.fillStyle = color; ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight); }
    else { ctx.fillStyle = color; ctx.fillRect(px - candleWidth / 2, bodyTop, candleWidth, bodyHeight); }
  });

  // Current price line.
  const current = candles[candles.length - 1].close;
  const currentY = y(current);
  const currentColor = candles[candles.length - 1].close >= candles[candles.length - 1].open ? '#57d99d' : '#e36b65';
  ctx.strokeStyle = currentColor; ctx.globalAlpha = .8; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pad.left, currentY); ctx.lineTo(rect.width - pad.right + 6, currentY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;

  if (state.hoverIndex != null && state.hoverIndex >= 0 && state.hoverIndex < candles.length) {
    const px = x(state.hoverIndex); const candle = candles[state.hoverIndex];
    ctx.strokeStyle = 'rgba(173,184,182,.38)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, rect.height - pad.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(pad.left, y(candle.close)); ctx.lineTo(rect.width - pad.right, y(candle.close)); ctx.stroke();
  }
  ctx.restore();

  // Current price flag outside clipped area.
  ctx.fillStyle = currentColor; ctx.fillRect(rect.width - pad.right + 6, currentY - 9, 68, 18);
  ctx.fillStyle = '#08100d'; ctx.font = '600 9px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.round(current).toLocaleString(), rect.width - pad.right + 40, currentY);
  chartGeometry = { candles, pad, width, height, x, y, min, max };
}

canvas.addEventListener('mousemove', event => {
  if (!chartGeometry) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const index = Math.max(0, Math.min(chartGeometry.candles.length - 1, Math.floor((mouseX - chartGeometry.pad.left) / chartGeometry.width * chartGeometry.candles.length)));
  state.hoverIndex = index;
  const candle = chartGeometry.candles[index];
  const tooltip = byId('chartTooltip');
  tooltip.innerHTML = `<strong>${new Date(candle.time * 1000).toLocaleString([], { timeZone: 'UTC' })} UTC</strong><br>O ${money(candle.open, 2)} &nbsp; H ${money(candle.high, 2)}<br>L ${money(candle.low, 2)} &nbsp; C ${money(candle.close, 2)}`;
  tooltip.style.display = 'block';
  const left = Math.min(rect.width - 205, Math.max(8, mouseX + 14));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 55)}px`;
  setText('chartCandleTime', new Date(candle.time * 1000).toLocaleString([], { timeZone: 'UTC' }) + ' UTC');
  drawChart();
});
canvas.addEventListener('mouseleave', () => {
  state.hoverIndex = null; byId('chartTooltip').style.display = 'none'; setText('chartCandleTime', 'All times UTC'); drawChart();
});

$$('.timeframe-tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.timeframe-tabs button').forEach(item => item.classList.remove('active'));
  button.classList.add('active'); state.timeframe = button.dataset.tf; state.hoverIndex = null; drawChart();
}));
$$('.overlay-toggles button').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('active'); state.overlays[button.dataset.overlay] = button.classList.contains('active'); drawChart();
}));

new ResizeObserver(() => requestAnimationFrame(drawChart)).observe(canvas.parentElement);

// --- Modals and position sizing -------------------------------------------------------------
function openModal(id) {
  const modal = byId(id); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('.modal-close', modal).focus(), 50);
}
function closeModal(modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
byId('methodButton').addEventListener('click', () => openModal('methodModal'));
byId('settingsButton').addEventListener('click', () => { openModal('methodModal'); toast('Aegis uses fixed, auditable rules.'); });
byId('riskButton').addEventListener('click', () => openModal('riskModal'));
$$('.modal-backdrop').forEach(backdrop => {
  $('.modal-close', backdrop).addEventListener('click', () => closeModal(backdrop));
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop); });
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal-backdrop.open').forEach(closeModal); });

function calculateRisk() {
  const equity = Number(byId('accountEquity').value);
  const riskPercent = Number(byId('riskPercent').value);
  const entry = Number(byId('calcEntry').value);
  const stop = Number(byId('calcStop').value);
  const capital = equity * riskPercent / 100;
  const distance = Math.abs(entry - stop);
  const size = distance > 0 ? capital / distance : 0;
  setText('capitalRisk', money(capital, 2));
  setText('positionBtc', Number.isFinite(size) ? `${size.toFixed(5)} BTC` : '— BTC');
  setText('notionalValue', Number.isFinite(size * entry) ? money(size * entry, 2) : '—');
}
$$('#riskModal input').forEach(input => input.addEventListener('input', calculateRisk));

byId('refreshButton').addEventListener('click', () => loadAnalysis(true));

// Keep navigation state synchronized with the viewed section.
const sections = ['overview', 'market-map', 'execution', 'confluence', 'protocol'].map(byId).filter(Boolean);
const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  $$('.rail nav .rail-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
}, { rootMargin: '-20% 0px -60% 0px', threshold: [0, .2, .5] });
sections.forEach(section => observer.observe(section));

loadAnalysis();
setInterval(() => loadAnalysis(false), 60_000);
