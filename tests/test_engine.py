import unittest

from ict_engine import Candle, _fair_value_gaps, analyze_market


def trending_candles(direction=1, count=180, step_seconds=900):
    candles = []
    price = 50_000.0
    for index in range(count):
        # A controlled trend with periodic pullbacks creates real pivots.
        impulse = direction * 68
        pullback = -direction * 95 if index % 11 in (0, 1) else 0
        open_price = price
        close = price + impulse + pullback
        candles.append(Candle(
            time=1_700_000_000 + index * step_seconds,
            open=open_price,
            high=max(open_price, close) + 32,
            low=min(open_price, close) - 30,
            close=close,
            volume=10 + index % 7,
        ))
        price = close
    return candles


class EngineTests(unittest.TestCase):
    def test_bullish_market_produces_bounded_probability(self):
        frames = {
            "5m": trending_candles(1, step_seconds=300),
            "15m": trending_candles(1, step_seconds=900),
            "30m": trending_candles(1, step_seconds=1800),
            "1h": trending_candles(1, step_seconds=3600),
            "4h": trending_candles(1, step_seconds=14400),
            "1d": trending_candles(1, step_seconds=86400),
            "1w": trending_candles(1, step_seconds=604800),
        }
        result = analyze_market(frames, "test", "fixture")
        self.assertEqual(result["direction"], "bullish")
        self.assertGreater(result["bullish_probability"], 50)
        self.assertLessEqual(result["bullish_probability"], 92)
        self.assertEqual(result["bullish_probability"] + result["bearish_probability"], 100)
        self.assertEqual(set(result["structures"]), {"5m", "15m", "30m", "1h", "4h", "1d", "1w"})
        self.assertTrue(all(item["action"] == "buy" for item in result["structures"].values()))
        self.assertEqual(len(result["trade_checklist"]), 8)
        self.assertLess(result["trade_plan"]["stop"], result["trade_plan"]["entry"])

    def test_bearish_market_has_stop_above_entry(self):
        frames = {
            "5m": trending_candles(-1, step_seconds=300),
            "15m": trending_candles(-1, step_seconds=900),
            "30m": trending_candles(-1, step_seconds=1800),
            "1h": trending_candles(-1, step_seconds=3600),
            "4h": trending_candles(-1, step_seconds=14400),
            "1d": trending_candles(-1, step_seconds=86400),
            "1w": trending_candles(-1, step_seconds=604800),
        }
        result = analyze_market(frames, "test", "fixture")
        self.assertEqual(result["direction"], "bearish")
        self.assertGreater(result["trade_plan"]["stop"], result["trade_plan"]["entry"])
        self.assertLess(result["trade_plan"]["target_1"], result["trade_plan"]["entry"])

    def test_rejects_short_timeframes(self):
        short = trending_candles(1, count=20)
        with self.assertRaisesRegex(ValueError, "At least 60 candles"):
            analyze_market({name: short for name in ("5m", "15m", "1h", "4h")})

    def test_detects_three_candle_bullish_gap(self):
        candles = trending_candles(1, count=80)
        base = candles[-3].close
        candles[-3] = Candle(candles[-3].time, base, base + 20, base - 20, base + 5, 10)
        candles[-2] = Candle(candles[-2].time, base + 5, base + 310, base, base + 290, 20)
        candles[-1] = Candle(candles[-1].time, base + 300, base + 350, base + 260, base + 330, 10)
        gaps = _fair_value_gaps(candles)
        self.assertTrue(any(gap["direction"] == "bullish" for gap in gaps))


if __name__ == "__main__":
    unittest.main()
