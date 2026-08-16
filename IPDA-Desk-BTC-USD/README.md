# IPDA Desk — BTC/USD

Institutional web terminal that reads **BTC/USD** through the full **Inner Circle Trader (ICT)** playbook and publishes a live desk memorandum: bias, liquidity draws, PD arrays, kill-zone timing, model setups, and multi-horizon predictions.

> This is a dedicated **BTC/USD** build of the IPDA Desk, duplicated from the EUR/USD system with the same ICT strategy but re-tuned for a 24/7 crypto cash tape. It is configured as a static GitHub Pages project at **https://becomingaman2000-ship-it.github.io/BTC-USD/**. The repository-root publish mirror is ready for the current Pages source, while `node server.js` remains available for local development.

## What it does

- Rebuilds the 2025–2026 BTC/USD tape from published prints (Jan 2026 high **121,400**, Jun 2026 low **79,400**, 14 Aug 2026 spot **~92,400**) and expands it into session-aware M15 / H1 / H4 / D1 / W1 candles.
- Runs an **IPDA / ICT engine** on that tape:
  - Market structure (BOS / CHoCH / MSS)
  - Buy-side & sell-side liquidity, equal highs/lows, PDH/PDL, PWH/PWL
  - Fair value gaps, inversion FVGs, order blocks, breaker blocks
  - Premium / discount / equilibrium dealing ranges and OTE
  - Power of Three (AMD) and Judas swings
  - Kill zones & Silver Bullet windows (New York time)
  - SMT versus **ETH**
  - ICT 2022 model, HTF discount OTE, Unicorn
- Renders a dark interbank-style desk: interactive ICT chart, confluence gauge, predictions, setups with entry / stop / targets, and a written read.
- **Realtime tape:** the browser pulls a live BTC/USD order book (Binance BTCUSDT first, Kraken XBT/USD fallback), then streams ticks over WebSocket (1s REST poll if the socket drops). The last candle updates on every tick; ICT rescans on a new bar or every 20s.
- If every venue is blocked, the desk keeps a dated composite tape and keeps retrying.

> Price units are US dollars. **1 pip = $10** (BTC's smallest meaningful swing increment) — the whole engine, backtester and UI share that unit.

## Run locally

```bash
node server.js
```

Opens on `http://0.0.0.0:4173`. No build step, no dependencies.

Keys `1–5` switch M15 / H1 / H4 / D1 / W1.

## Email alerts

Entry alerts go to **becomingaman2000@gmail.com** when the desk flips to ENTER (BUY or SELL) with entry, stop, TP1 and TP2. The first alert sends a FormSubmit confirmation — open that mail once. After that, live entries arrive automatically. Cooldown is 40 minutes per setup so the inbox is not flooded.

## Honest scope

This is a **research / education terminal**, not a broker and not a signal service. Crypto can lose money. The engine is a rules-based ICT reading of structure, time, and liquidity — it is not a guarantee of future prices.
