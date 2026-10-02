"""OHLC candles from Yahoo Finance's public chart endpoint (no API key).

Used for gold futures and US stocks/indices, which have no free CORS-enabled
real-time feed. Crypto is streamed by the browser straight from Binance instead.
Responses are cached briefly so many viewers share one upstream request.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={range}&includePrePost=false"
SYMBOL_RE = re.compile(r"^[A-Z0-9^][A-Z0-9.^=\-]{0,14}$")

# interval -> (Yahoo interval, Yahoo range)
INTERVALS = {
    "1m": ("1m", "1d"),
    "5m": ("5m", "5d"),
    "15m": ("15m", "1mo"),
    "1h": ("60m", "3mo"),
    "1d": ("1d", "2y"),
}
CACHE_TTL = 8  # seconds
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_lock = threading.Lock()


class QuoteError(Exception):
    pass


def _fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (market-calendar)"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def _prev_close(bars: list[dict], meta: dict) -> float | None:
    """Close of the last bar on the trading day before the latest bar (exchange-local days)."""
    if not bars:
        return meta.get("chartPreviousClose")
    off = meta.get("gmtoffset") or 0
    day = lambda b: (b["time"] + off) // 86400  # noqa: E731
    last_day = day(bars[-1])
    for b in reversed(bars):
        if day(b) < last_day:
            return b["close"]
    return meta.get("chartPreviousClose")  # only today's bars, e.g. 1m with range=1d


def candles(symbol: str, interval: str) -> dict:
    symbol = symbol.upper()
    if not SYMBOL_RE.match(symbol):
        raise QuoteError("invalid symbol")
    if interval not in INTERVALS:
        raise QuoteError("invalid interval")

    key = (symbol, interval)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]

    y_int, y_range = INTERVALS[interval]
    url = YAHOO_URL.format(symbol=urllib.parse.quote(symbol), interval=y_int, range=y_range)
    try:
        raw = _fetch(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise QuoteError("unknown symbol") from exc
        raise QuoteError(f"upstream error: {exc}") from exc
    except Exception as exc:  # network, HTTP 4xx/5xx, bad JSON
        raise QuoteError(f"upstream error: {exc}") from exc

    result = (raw.get("chart") or {}).get("result")
    if not result:
        raise QuoteError("unknown symbol")
    res = result[0]
    meta = res.get("meta", {})
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    bars = []
    for i, t in enumerate(res.get("timestamp") or []):
        o, h, l, c = (q.get(k, [None])[i] for k in ("open", "high", "low", "close"))
        if None in (o, h, l, c):
            continue
        bars.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": (q.get("volume") or [0] * (i + 1))[i] or 0})

    data = {
        "symbol": symbol,
        "name": meta.get("shortName") or meta.get("longName") or symbol,
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "exchange_tz": meta.get("exchangeTimezoneName"),
        "gmtoffset": meta.get("gmtoffset") or 0,
        "price": meta.get("regularMarketPrice"),
        "prev_close": _prev_close(bars, meta),
        "market_time": meta.get("regularMarketTime"),
        # CME/COMEX futures are delayed ~10 min on the free feed; US equities/indices are near real-time.
        "delayed_min": 10 if symbol.endswith("=F") else 0,
        "interval": interval,
        "bars": bars,
    }
    with _lock:
        _cache[key] = (now, data)
        if len(_cache) > 500:  # keep memory bounded on a public deployment
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:250]:
                _cache.pop(k, None)
    return data
