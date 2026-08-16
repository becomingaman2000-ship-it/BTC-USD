import unittest

from ict_engine import Candle
from server import _aggregate_candles


class CandleAggregationTests(unittest.TestCase):
    def test_aggregates_ohlcv_without_losing_order(self):
        rows = [
            Candle(0, 100, 106, 98, 104, 10),
            Candle(900, 104, 110, 102, 108, 12),
            Candle(1800, 108, 109, 99, 101, 9),
            Candle(2700, 101, 105, 97, 103, 11),
        ]
        result = _aggregate_candles(rows, 1800)
        self.assertEqual(len(result), 2)
        self.assertEqual((result[0].open, result[0].high, result[0].low, result[0].close, result[0].volume),
                         (100, 110, 98, 108, 22))
        self.assertEqual((result[1].open, result[1].high, result[1].low, result[1].close, result[1].volume),
                         (108, 109, 97, 103, 20))


if __name__ == "__main__":
    unittest.main()
