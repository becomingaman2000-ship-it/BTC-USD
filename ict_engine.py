"""Deterministic ICT-inspired market structure analysis.

The engine intentionally produces decision support rather than guaranteed predictions.  It
uses only OHLCV data, so every conclusion can be reproduced and inspected by the UI.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from math import exp
from statistics import mean
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def public(self) -> dict:
        return {
            "time": self.time,
            "open": round(self.open, 2),
            "high": round(self.high, 2),
            "low": round(self.low, 2),
            "close": round(self.close, 2),
            "volume": round(self.volume, 4),
        }


def ema(values: Sequence[float], period: int) -> List[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    result = [float(values[0])]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def atr(candles: Sequence[Candle], period: int = 14) -> List[float]:
    if not candles:
        return []
    true_ranges: List[float] = []
    previous = candles[0].close
    for candle in candles:
        true_ranges.append(
            max(candle.high - candle.low, abs(candle.high - previous), abs(candle.low - previous))
        )
        previous = candle.close
    return ema(true_ranges, period)


def _swings(candles: Sequence[Candle], radius: int = 3) -> Tuple[List[dict], List[dict]]:
    highs: List[dict] = []
    lows: List[dict] = []
    for index in range(radius, len(candles) - radius):
        window = candles[index - radius : index + radius + 1]
        candle = candles[index]
        if candle.high == max(item.high for item in window):
            highs.append({"index": index, "time": candle.time, "price": candle.high})
        if candle.low == min(item.low for item in window):
            lows.append({"index": index, "time": candle.time, "price": candle.low})
    return highs, lows


def _timeframe_structure(candles: Sequence[Candle]) -> dict:
    closes = [item.close for item in candles]
    ema20 = ema(closes, 20)
    ema50 = ema(closes, 50)
    highs, lows = _swings(candles)
    current = closes[-1]
    volatility = atr(candles)[-1]

    recent_highs = highs[-3:]
    recent_lows = lows[-3:]
    high_pattern = (
        "HH" if len(recent_highs) >= 2 and recent_highs[-1]["price"] > recent_highs[-2]["price"] else "LH"
    ) if len(recent_highs) >= 2 else "—"
    low_pattern = (
        "HL" if len(recent_lows) >= 2 and recent_lows[-1]["price"] > recent_lows[-2]["price"] else "LL"
    ) if len(recent_lows) >= 2 else "—"

    momentum = 0
    reasons: List[str] = []
    if ema20[-1] > ema50[-1]:
        momentum += 1
        reasons.append("20 EMA above 50 EMA")
    else:
        momentum -= 1
        reasons.append("20 EMA below 50 EMA")
    if len(ema20) > 5 and ema20[-1] > ema20[-5]:
        momentum += 1
    else:
        momentum -= 1
    if high_pattern == "HH":
        momentum += 1
    elif high_pattern == "LH":
        momentum -= 1
    if low_pattern == "HL":
        momentum += 1
    elif low_pattern == "LL":
        momentum -= 1

    last_broken_high = next((s for s in reversed(highs[:-1]) if current > s["price"]), None)
    last_broken_low = next((s for s in reversed(lows[:-1]) if current < s["price"]), None)
    event = "Range holding"
    event_direction = "neutral"
    if last_broken_high and (not last_broken_low or last_broken_high["time"] > last_broken_low["time"]):
        event = "Bullish BOS"
        event_direction = "bullish"
        momentum += 1
    elif last_broken_low:
        event = "Bearish BOS"
        event_direction = "bearish"
        momentum -= 1

    if momentum >= 2:
        bias = "bullish"
    elif momentum <= -2:
        bias = "bearish"
    else:
        bias = "neutral"

    return {
        "bias": bias,
        "score": max(-5, min(5, momentum)),
        "event": event,
        "event_direction": event_direction,
        "high_pattern": high_pattern,
        "low_pattern": low_pattern,
        "ema20": round(ema20[-1], 2),
        "ema50": round(ema50[-1], 2),
        "atr": round(volatility, 2),
        "swing_highs": [{**s, "price": round(s["price"], 2)} for s in highs[-8:]],
        "swing_lows": [{**s, "price": round(s["price"], 2)} for s in lows[-8:]],
        "reason": reasons[0],
    }


def _fair_value_gaps(candles: Sequence[Candle]) -> List[dict]:
    volatility = atr(candles)
    gaps: List[dict] = []
    start = max(2, len(candles) - 100)
    for index in range(start, len(candles)):
        candle = candles[index]
        first = candles[index - 2]
        threshold = volatility[index] * 0.10
        if candle.low - first.high > threshold:
            low, high, direction = first.high, candle.low, "bullish"
            later = candles[index + 1 :]
            filled = any(item.low <= low for item in later)
        elif first.low - candle.high > threshold:
            low, high, direction = candle.high, first.low, "bearish"
            later = candles[index + 1 :]
            filled = any(item.high >= high for item in later)
        else:
            continue
        gaps.append({
            "direction": direction,
            "low": round(low, 2),
            "high": round(high, 2),
            "mid": round((low + high) / 2, 2),
            "time": candle.time,
            "index": index,
            "status": "filled" if filled else "open",
        })
    return gaps[-10:]


def _order_blocks(candles: Sequence[Candle]) -> List[dict]:
    volatility = atr(candles)
    blocks: List[dict] = []
    start = max(8, len(candles) - 120)
    for index in range(start, len(candles)):
        candle = candles[index]
        body = abs(candle.close - candle.open)
        spread = max(candle.high - candle.low, 1e-9)
        if body < volatility[index] * 1.25 or body / spread < 0.62:
            continue
        direction = "bullish" if candle.close > candle.open else "bearish"
        opposite = None
        for prior_index in range(index - 1, max(-1, index - 7), -1):
            prior = candles[prior_index]
            is_opposite = (direction == "bullish" and prior.close < prior.open) or (
                direction == "bearish" and prior.close > prior.open
            )
            if is_opposite:
                opposite = (prior_index, prior)
                break
        if not opposite:
            continue
        block_index, source = opposite
        if direction == "bullish":
            low, high = source.low, max(source.open, source.close)
            invalid = any(item.close < source.low for item in candles[index + 1 :])
        else:
            low, high = min(source.open, source.close), source.high
            invalid = any(item.close > source.high for item in candles[index + 1 :])
        blocks.append({
            "direction": direction,
            "low": round(low, 2),
            "high": round(high, 2),
            "mid": round((low + high) / 2, 2),
            "time": source.time,
            "index": block_index,
            "status": "invalidated" if invalid else "active",
        })
    # Deduplicate nearby detections of the same source candle.
    unique = {(block["time"], block["direction"]): block for block in blocks}
    return list(unique.values())[-8:]


def _liquidity_map(candles: Sequence[Candle], structure: dict) -> dict:
    current = candles[-1].close
    volatility = structure["atr"]
    highs = [item["price"] for item in structure["swing_highs"]]
    lows = [item["price"] for item in structure["swing_lows"]]
    lookback = candles[-80:]
    range_high = max(item.high for item in lookback)
    range_low = min(item.low for item in lookback)
    high_candidates = sorted(set(highs + [round(range_high, 2)]))
    low_candidates = sorted(set(lows + [round(range_low, 2)]))
    buy_side = next((level for level in high_candidates if level > current), high_candidates[-1] if high_candidates else range_high)
    sell_side = next((level for level in reversed(low_candidates) if level < current), low_candidates[0] if low_candidates else range_low)

    # A wick through a prior swing followed by a close back inside is treated as a sweep.
    sweep = None
    recent = candles[-8:]
    historical_highs = highs[:-1]
    historical_lows = lows[:-1]
    for candle in recent:
        swept_high = next((level for level in reversed(historical_highs) if candle.high > level and candle.close < level), None)
        swept_low = next((level for level in reversed(historical_lows) if candle.low < level and candle.close > level), None)
        if swept_low is not None:
            sweep = {"direction": "bullish", "label": "Sell-side liquidity swept", "level": swept_low}
        if swept_high is not None:
            sweep = {"direction": "bearish", "label": "Buy-side liquidity swept", "level": swept_high}

    equilibrium = (range_high + range_low) / 2
    zone = "discount" if current < equilibrium else "premium"
    return {
        "buy_side": round(buy_side, 2),
        "sell_side": round(sell_side, 2),
        "range_high": round(range_high, 2),
        "range_low": round(range_low, 2),
        "equilibrium": round(equilibrium, 2),
        "zone": zone,
        "sweep": sweep,
        "atr_distance_buy": round(abs(buy_side - current) / max(volatility, 1), 2),
        "atr_distance_sell": round(abs(current - sell_side) / max(volatility, 1), 2),
    }


def _session_state(timestamp: int) -> dict:
    hour = datetime.fromtimestamp(timestamp, tz=timezone.utc).hour
    minute = datetime.fromtimestamp(timestamp, tz=timezone.utc).minute
    decimal_hour = hour + minute / 60
    sessions = [
        (0, 5, "Asia accumulation"),
        (7, 10, "London kill zone"),
        (12, 15, "New York kill zone"),
        (15, 17, "London close"),
    ]
    for start, end, name in sessions:
        if start <= decimal_hour < end:
            return {"active": True, "name": name, "hour_utc": f"{hour:02d}:{minute:02d} UTC"}
    return {"active": False, "name": "Between key sessions", "hour_utc": f"{hour:02d}:{minute:02d} UTC"}


def _rr_target(entry: float, stop: float, direction: str, multiple: float) -> float:
    risk = abs(entry - stop)
    return entry + risk * multiple if direction == "bullish" else entry - risk * multiple


def _trade_plan(direction: str, confidence: int, candles: Sequence[Candle], structure: dict,
                liquidity: dict, fvgs: Sequence[dict], blocks: Sequence[dict]) -> dict:
    price = candles[-1].close
    volatility = structure["atr"]
    active_fvgs = [item for item in fvgs if item["status"] == "open" and item["direction"] == direction]
    active_blocks = [item for item in blocks if item["status"] == "active" and item["direction"] == direction]

    # Prefer nearby unmitigated arrays; never suggest chasing more than 1.25 ATR away.
    arrays = active_fvgs + active_blocks
    arrays.sort(key=lambda item: abs(item["mid"] - price))
    entry = price
    entry_type = "market area"
    if arrays and abs(arrays[0]["mid"] - price) <= volatility * 1.25:
        entry = arrays[0]["mid"]
        entry_type = "FVG midpoint" if arrays[0] in active_fvgs else "order-block mean threshold"

    recent = candles[-40:]
    if direction == "bullish":
        structural_stop = min(item.low for item in recent[-15:]) - volatility * 0.18
        stop = min(structural_stop, entry - volatility * 0.75)
        liquidity_target = liquidity["buy_side"]
        target_1 = max(_rr_target(entry, stop, direction, 1.5), min(liquidity_target, _rr_target(entry, stop, direction, 2.0)))
    else:
        structural_stop = max(item.high for item in recent[-15:]) + volatility * 0.18
        stop = max(structural_stop, entry + volatility * 0.75)
        liquidity_target = liquidity["sell_side"]
        target_1 = min(_rr_target(entry, stop, direction, 1.5), max(liquidity_target, _rr_target(entry, stop, direction, 2.0)))
    target_2 = _rr_target(entry, stop, direction, 3.0)
    risk = abs(entry - stop)
    reward = abs(target_1 - entry)
    rr = reward / risk if risk else 0

    status = "armed" if confidence >= 68 and arrays else "developing"
    if confidence < 60 or direction == "neutral":
        status = "stand_aside"

    invalidation = (
        f"15m close below {stop:,.0f}" if direction == "bullish" else f"15m close above {stop:,.0f}"
    )
    return {
        "status": status,
        "entry": round(entry, 2),
        "entry_type": entry_type,
        "stop": round(stop, 2),
        "target_1": round(target_1, 2),
        "target_2": round(target_2, 2),
        "risk_reward": round(rr, 2),
        "invalidation": invalidation,
        "risk_note": "Risk 0.25–0.50% only; reduce size during news or abnormal volatility.",
    }


def analyze_market(timeframes: Dict[str, Sequence[Candle]], data_mode: str = "live",
                   provider: str = "Coinbase") -> dict:
    """Analyze 5m/15m/1h/4h candle sets and return an explainable tactical brief."""
    required = ("5m", "15m", "1h", "4h")
    for name in required:
        if name not in timeframes or len(timeframes[name]) < 60:
            raise ValueError(f"At least 60 candles are required for {name}")

    structures = {name: _timeframe_structure(timeframes[name]) for name in required}
    execution = timeframes["15m"]
    fvgs = _fair_value_gaps(execution)
    blocks = _order_blocks(execution)
    liquidity = _liquidity_map(execution, structures["15m"])
    session = _session_state(execution[-1].time)

    timeframe_weights = {"4h": 24, "1h": 21, "15m": 13, "5m": 7}
    score = 0.0
    confluences: List[dict] = []
    for name in ("4h", "1h", "15m", "5m"):
        structure = structures[name]
        sign = 1 if structure["bias"] == "bullish" else -1 if structure["bias"] == "bearish" else 0
        points = timeframe_weights[name] * sign * min(abs(structure["score"]) / 4, 1)
        score += points
        confluences.append({
            "name": f"{name} market structure",
            "state": structure["bias"],
            "detail": f"{structure['high_pattern']} / {structure['low_pattern']} · {structure['event']}",
            "impact": round(abs(points)),
        })

    initial_direction = "bullish" if score > 0 else "bearish"
    open_fvgs = [gap for gap in fvgs if gap["status"] == "open"]
    aligned_fvgs = [gap for gap in open_fvgs if gap["direction"] == initial_direction]
    aligned_blocks = [block for block in blocks if block["status"] == "active" and block["direction"] == initial_direction]
    if aligned_fvgs:
        adjustment = 8 if initial_direction == "bullish" else -8
        score += adjustment
        confluences.append({"name": "Unmitigated fair value gap", "state": initial_direction,
                             "detail": f"15m imbalance at {aligned_fvgs[-1]['low']:,.0f}–{aligned_fvgs[-1]['high']:,.0f}", "impact": 8})
    else:
        confluences.append({"name": "Fair value gap", "state": "neutral", "detail": "No nearby aligned imbalance", "impact": 0})
    if aligned_blocks:
        adjustment = 7 if initial_direction == "bullish" else -7
        score += adjustment
        confluences.append({"name": "Institutional order block", "state": initial_direction,
                             "detail": f"Mean threshold {aligned_blocks[-1]['mid']:,.0f}", "impact": 7})
    else:
        confluences.append({"name": "Order block", "state": "neutral", "detail": "No active displacement origin nearby", "impact": 0})

    if liquidity["sweep"]:
        sweep = liquidity["sweep"]
        adjustment = 11 if sweep["direction"] == "bullish" else -11
        score += adjustment
        confluences.append({"name": "Liquidity raid", "state": sweep["direction"], "detail": sweep["label"], "impact": 11})
    else:
        confluences.append({"name": "Liquidity raid", "state": "neutral", "detail": "No confirmed sweep in last 8 candles", "impact": 0})

    zone_direction = "bullish" if liquidity["zone"] == "discount" else "bearish"
    zone_adjustment = 5 if zone_direction == "bullish" else -5
    score += zone_adjustment
    confluences.append({"name": "Dealing range", "state": zone_direction,
                         "detail": f"Price trades in {liquidity['zone']} vs. equilibrium", "impact": 5})

    if session["active"]:
        # Session is a quality modifier, not inherently directional.
        confluences.append({"name": "Session timing", "state": "active", "detail": session["name"], "impact": 4})
    else:
        confluences.append({"name": "Session timing", "state": "neutral", "detail": session["name"], "impact": 0})

    score = max(-95, min(95, score))
    direction = "bullish" if score >= 10 else "bearish" if score <= -10 else "neutral"
    # Smooth signed score into a probability. Keep away from false 0/100 certainty.
    bullish_probability = round(100 / (1 + exp(-score / 23)))
    bullish_probability = max(8, min(92, bullish_probability))
    bearish_probability = 100 - bullish_probability
    confidence = max(bullish_probability, bearish_probability) if direction != "neutral" else 50 + round(abs(score))
    confidence = max(50, min(92, confidence))

    plan_direction = direction if direction != "neutral" else initial_direction
    plan = _trade_plan(plan_direction, confidence if direction != "neutral" else 50, execution,
                       structures["15m"], liquidity, fvgs, blocks)
    current = execution[-1].close
    previous_day_proxy = execution[-min(97, len(execution))].close
    change = ((current / previous_day_proxy) - 1) * 100
    ranges = {
        "daily_open": round(timeframes["5m"][-min(289, len(timeframes["5m"]))].open, 2),
        "weekly_open": round(timeframes["4h"][-min(43, len(timeframes["4h"]))].open, 2),
        "previous_day_high": round(max(c.high for c in execution[-min(193, len(execution)):-96] or execution[-96:]), 2),
        "previous_day_low": round(min(c.low for c in execution[-min(193, len(execution)):-96] or execution[-96:]), 2),
    }

    if direction == "neutral":
        verdict = "No clean edge — preserve capital"
        summary = "Higher and lower timeframes are not aligned. Wait for a liquidity raid and displacement before committing risk."
    elif direction == "bullish":
        verdict = "Bullish delivery favored"
        summary = "Order flow favors expansion toward buy-side liquidity. Demand confirmation on a retracement; do not chase displacement."
    else:
        verdict = "Bearish delivery favored"
        summary = "Order flow favors expansion toward sell-side liquidity. Demand confirmation on a retracement; do not sell into exhaustion."

    generated_at = datetime.fromtimestamp(execution[-1].time, tz=timezone.utc).isoformat()
    return {
        "symbol": "BTC-USD",
        "data_mode": data_mode,
        "provider": provider,
        "generated_at": generated_at,
        "price": round(current, 2),
        "change_24h": round(change, 2),
        "direction": direction,
        "confidence": confidence,
        "bullish_probability": bullish_probability,
        "bearish_probability": bearish_probability,
        "raw_score": round(score, 1),
        "verdict": verdict,
        "summary": summary,
        "session": session,
        "structures": structures,
        "liquidity": liquidity,
        "fair_value_gaps": fvgs,
        "order_blocks": blocks,
        "confluences": confluences,
        "trade_plan": plan,
        "reference_levels": ranges,
        "candles": {name: [c.public() for c in candles] for name, candles in timeframes.items()},
        "disclaimer": "Educational decision support only. Probability is a rules-based estimate, not a guarantee or financial advice.",
    }
