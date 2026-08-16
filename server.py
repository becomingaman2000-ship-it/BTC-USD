#!/usr/bin/env python3
"""Small zero-dependency web server for the Aegis BTC command center."""

from __future__ import annotations

import json
import math
import mimetypes
import os
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Tuple

from ict_engine import Candle, analyze_market

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
CACHE_LOCK = threading.Lock()
CACHE: dict = {"at": 0.0, "payload": None}
CACHE_TTL_SECONDS = 55
TIMEFRAMES = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
}


def _request_json(url: str, timeout: float = 4.0):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "AegisICT/1.0 (+educational-market-dashboard)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _coinbase_candles(granularity: int) -> List[Candle]:
    url = "https://api.exchange.coinbase.com/products/BTC-USD/candles?" + urllib.parse.urlencode(
        {"granularity": granularity}
    )
    payload = _request_json(url)
    if not isinstance(payload, list) or len(payload) < 60:
        raise ValueError("Coinbase returned insufficient candle data")
    # Coinbase: [timestamp, low, high, open, close, volume], newest first.
    rows = sorted(payload, key=lambda row: row[0])
    return [
        Candle(int(row[0]), float(row[3]), float(row[2]), float(row[1]), float(row[4]), float(row[5]))
        for row in rows[-300:]
    ]


def _kraken_candles(interval_minutes: int) -> List[Candle]:
    url = "https://api.kraken.com/0/public/OHLC?" + urllib.parse.urlencode(
        {"pair": "XBTUSD", "interval": interval_minutes}
    )
    payload = _request_json(url)
    if payload.get("error"):
        raise ValueError("Kraken API error")
    result = payload.get("result", {})
    key = next((name for name in result if name != "last"), None)
    rows = result.get(key, []) if key else []
    if len(rows) < 60:
        raise ValueError("Kraken returned insufficient candle data")
    # Kraken: [timestamp, open, high, low, close, vwap, volume, count].
    return [
        Candle(int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[6]))
        for row in rows[-300:]
    ]


def _aggregate_candles(candles: List[Candle], target_seconds: int) -> List[Candle]:
    """Aggregate lower-timeframe candles into exchange-aligned larger bars."""
    buckets: Dict[int, List[Candle]] = {}
    for candle in candles:
        bucket = candle.time // target_seconds * target_seconds
        buckets.setdefault(bucket, []).append(candle)
    result: List[Candle] = []
    for timestamp, rows in sorted(buckets.items()):
        result.append(Candle(
            timestamp,
            rows[0].open,
            max(row.high for row in rows),
            min(row.low for row in rows),
            rows[-1].close,
            sum(row.volume for row in rows),
        ))
    return result


def _fetch_provider(provider: str) -> Dict[str, List[Candle]]:
    if provider == "Coinbase":
        # Coinbase supports only specific granularities. Derive 30M, 4H, and 1W
        # bars from supported lower frames rather than issuing invalid API calls.
        source_intervals = (300, 900, 3600, 86400)
        with ThreadPoolExecutor(max_workers=4) as executor:
            sources = dict(executor.map(lambda seconds: (seconds, _coinbase_candles(seconds)), source_intervals))
        return {
            "5m": sources[300],
            "15m": sources[900],
            "30m": _aggregate_candles(sources[900], 1800),
            "1h": sources[3600],
            "4h": _aggregate_candles(sources[3600], 14400),
            "1d": sources[86400],
            "1w": _aggregate_candles(sources[86400], 604800),
        }
    worker = lambda item: (item[0], _kraken_candles(item[1] // 60))
    with ThreadPoolExecutor(max_workers=7) as executor:
        return dict(executor.map(worker, list(TIMEFRAMES.items())))


def _demo_candles(label: str, seconds: int, count: int = 300) -> List[Candle]:
    """Create deterministic, realistic candles for an explicitly labeled demo fallback."""
    end_time = int(time.time() // seconds * seconds)
    # Keep the demo stable within each candle and coherent across all timeframes.
    seed = 9_104_001 + seconds + end_time // seconds
    random.seed(seed)
    start_price = 67_400.0 - math.log2(max(seconds / 300, 1)) * 175
    prices = [start_price]
    volatility = 0.00125 * math.sqrt(seconds / 300)
    for index in range(count):
        cycle = math.sin((index + end_time / seconds) / 19) * volatility * 0.22
        macro = 0.00010 if index > count * 0.52 else -0.000025
        shock = random.gauss(0, volatility)
        close = max(10_000, prices[-1] * (1 + macro + cycle + shock))
        prices.append(close)

    # Normalize every timeframe to the same representative last price.
    anchor = 68_420.0 + math.sin(end_time / 18_000) * 315
    factor = anchor / prices[-1]
    prices = [price * factor for price in prices]
    candles: List[Candle] = []
    for index in range(count):
        open_price = prices[index]
        close_price = prices[index + 1]
        wick_scale = open_price * volatility * random.uniform(0.12, 0.72)
        high = max(open_price, close_price) + wick_scale * random.uniform(0.35, 1.0)
        low = min(open_price, close_price) - wick_scale * random.uniform(0.35, 1.0)
        volume_base = 17 * (300 / seconds) ** 0.15
        volume = max(0.1, volume_base * random.lognormvariate(0, 0.52))
        candle_time = end_time - (count - 1 - index) * seconds
        candles.append(Candle(candle_time, open_price, high, low, close_price, volume))
    return candles


def _demo_market() -> Dict[str, List[Candle]]:
    return {label: _demo_candles(label, seconds) for label, seconds in TIMEFRAMES.items()}


def market_payload(force: bool = False) -> dict:
    now = time.time()
    with CACHE_LOCK:
        if not force and CACHE["payload"] and now - CACHE["at"] < CACHE_TTL_SECONDS:
            result = dict(CACHE["payload"])
            result["cache_age_seconds"] = round(now - CACHE["at"])
            return result

    candles = None
    errors = []
    provider = ""
    # Kraken natively exposes all seven required intervals. Coinbase remains a
    # resilient fallback with deterministic candle aggregation.
    for candidate in ("Kraken", "Coinbase"):
        try:
            candles = _fetch_provider(candidate)
            provider = candidate
            break
        except Exception as exc:  # Network failures must not take down the dashboard.
            errors.append(f"{candidate}: {type(exc).__name__}")

    mode = "live"
    if candles is None:
        candles = _demo_market()
        provider = "Deterministic demo feed"
        mode = "demo"

    payload = analyze_market(candles, data_mode=mode, provider=provider)
    payload["cache_age_seconds"] = 0
    if errors:
        payload["feed_notes"] = errors
    with CACHE_LOCK:
        CACHE["at"] = now
        CACHE["payload"] = payload
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "Aegis/1.0"

    def _json(self, payload, status=200):
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self._json({"status": "ok", "service": "aegis-ict"})
            return
        if parsed.path == "/api/analysis":
            query = urllib.parse.parse_qs(parsed.query)
            try:
                self._json(market_payload(force=query.get("refresh") == ["1"]))
            except Exception as exc:
                self._json({"error": "Analysis unavailable", "detail": str(exc)}, 500)
            return

        relative = "index.html" if parsed.path in ("", "/") else parsed.path.lstrip("/")
        file_path = (PUBLIC / relative).resolve()
        try:
            file_path.relative_to(PUBLIC.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not file_path.is_file():
            # SPA-style fallback for friendly paths, while missing assets stay 404.
            if "." not in Path(relative).name:
                file_path = PUBLIC / "index.html"
            else:
                self.send_error(404)
                return
        body = file_path.read_bytes()
        mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if file_path.suffix == ".js":
            mime = "application/javascript"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith("text/") or mime.endswith("javascript") else mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main():
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Aegis ICT command center listening on http://0.0.0.0:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
