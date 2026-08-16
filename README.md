# Aegis — BTC-USD ICT Command Center

Aegis is an explainable, multi-timeframe BTC-USD decision-support system. It turns public OHLCV candles into a directional thesis, probability matrix, liquidity map, and risk-defined execution plan using rules inspired by ICT market concepts.

> **Important:** Aegis does not guarantee or autonomously place trades. Its probability is a transparent rules-based score, not calibrated certainty. Crypto trading can result in substantial loss.

## What is included

- **1W → 1D → 4H → 1H → 30M → 15M → 5M chain of command** with BUY, SELL, or WAIT status on every timeframe
- Swing classification, market structure breaks, EMA regime, and ATR-normalized filters
- Three-candle fair value gap detection with mitigation state
- Displacement-origin order blocks and invalidation tracking
- Buy-side/sell-side liquidity, dealing-range equilibrium, premium/discount, and sweep detection
- 62–79% optimal trade entry (OTE) bands plus BOS/CHOCH structure events
- UTC session/kill-zone context
- Bounded bull/bear probabilities with a fully visible confluence stack
- Entry, structural stop, two objectives, R:R, and a browser-side position-size calculator
- Live public data adapters for Coinbase and Kraken, with a clearly labeled deterministic demo fallback
- Responsive, dependency-free command-center UI with a high-DPI Canvas candlestick chart

## Run locally

Aegis has no runtime package dependencies beyond Python 3.10+.

```bash
python server.py
```

Open [http://localhost:8000](http://localhost:8000). The server binds to `0.0.0.0` and respects the `PORT` environment variable.

```bash
PORT=9000 python server.py
```

## Deploy

The repository includes three production entry points:

- `render.yaml` — Render Blueprint with automated tests and `/api/health` monitoring
- `Dockerfile` — portable OCI image definition with an application health check
- `Procfile` — compatible with Railway and other Procfile-based platforms

### Render

After the deployment changes are on the repository's default branch, create a **New Blueprint** in Render and select this repository. Render reads `render.yaml`, runs the test suite, starts `python server.py`, and assigns an HTTPS `onrender.com` URL. No environment secrets are required.

### Docker

```bash
docker build -t aegis-btc-usd .
docker run --rm -p 8000:8000 -e PORT=8000 aegis-btc-usd
```

The application stores no user data and requires no database. A production platform only needs to supply its assigned `PORT`.

## Test

```bash
python -m unittest discover -s tests -v
python -m py_compile server.py ict_engine.py
```

## API

### `GET /api/analysis`

Returns the current market brief and candles for all seven timeframes. Add `?refresh=1` to bypass the 55-second in-memory cache.

Key response fields:

- `data_mode`: `live` or `demo`; never infer this from the price itself
- `direction`: `bullish`, `bearish`, or `neutral` market narrative
- `trade_status`: strict `buy`, `sell`, or `wait` execution gate
- `bullish_probability` / `bearish_probability`: bounded weighted estimates
- `structures`: BUY/SELL/WAIT status, strength, BOS/CHOCH, and swings for every timeframe
- `liquidity`, `fair_value_gaps`, `order_blocks`: liquidity, OTE, and detected ICT arrays
- `trade_plan`: conditional entry, invalidation, objectives, and risk/reward
- `trade_checklist`: strategic alignment, execution, raid, PD array, OTE, session, R:R, and manual news gate
- `confluences`: the evidence used by the score

### `GET /api/health`

Returns a small service health response.

## Scoring doctrine

Higher timeframes deliberately receive more authority: 1W (20 points), 1D (19), 4H (17), 1H (13), 30M (10), 15M (8), and 5M (5). Active fair value gaps, order blocks, liquidity raids, and premium/discount location adjust that signed score. The result is compressed through a logistic function and bounded to 8–92%; the UI never presents 100% certainty. A separate trade gate remains at **WAIT** until execution and risk requirements are satisfied.

A setup is **armed** only when directional confidence is at least 68% and a nearby, active price-delivery array exists. Otherwise it remains **developing** or **stand aside**. The latter is an intended outcome—not a system failure.

## Data behavior

The server tries Kraken first because it natively supplies every required interval, then Coinbase with deterministic aggregation for 30M, 4H, and 1W candles. If both public APIs are inaccessible, it supplies deterministic synthetic OHLCV data so the interface and analysis remain testable. The UI shows a persistent **Demo feed active** notice and `DEMO` label in that state; simulated prices are never represented as live.

## Project layout

```text
ict_engine.py       deterministic analysis engine
server.py           data adapters, cache, JSON API, static server
public/index.html   dashboard and accessible dialogs
public/styles.css   responsive visual system
public/app.js       rendering, Canvas chart, interactions
 tests/             engine regression tests
```

## Operational limits

- ICT terminology is interpretive; these are explicit computational definitions, not claims of institutional order visibility.
- OHLCV alone cannot know news, exchange flows, options positioning, or a trader's personal constraints.
- Public feed candles can differ across venues.
- Always validate fees, funding, slippage, liquidation mechanics, and stop behavior independently.
