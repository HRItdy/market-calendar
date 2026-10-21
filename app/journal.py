"""Paper-trade log kept on the server, so every device sees the same orders.

Rules (simple and deterministic, so the log is easy to audit):
  - An order needs a BUY or SELL read with confidence above MIN_CONF; the viewer places it.
  - One active order per symbol + interval. A same-side order while one is active is refused;
    an opposite-side order closes the active one at market ("reversed") first.
  - Market entry when the plan's entry is the current price; otherwise a limit at the entry,
    cancelled if not filled within PENDING_BARS bars of its interval.
  - Exit at the stop or at Target 1, whichever price reaches first. If one bar spans both, the
    stop is assumed to have come first (conservative). Gaps fill at the gapped price.
  - Result: pnlPct = side × (exit − fill) / fill;  r = side × (exit − fill) / |fill − stop|.

The tracker checks active orders every TRACK_SEC on 1-minute candles (Binance for crypto, Yahoo
for the rest). It replays the candles it missed after the server sleeps, using coarser candles
for long gaps. Orders are stored as JSON with the same camelCase fields the browser reads.
"""
from __future__ import annotations

import json
import logging
import secrets
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict

from . import journal_store
from . import quotes as Q

log = logging.getLogger("journal")

MIN_CONF = 50
PENDING_BARS = 20
TRACK_SEC = 30
IV_SEC = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}
ACTIVE = ("open", "pending")
BINANCE_KLINES = "https://data-api.binance.vision/api/v3/klines"

_lock = threading.RLock()  # serialises read-modify-write between API calls and the tracker
_store: journal_store.Store | None = None


def store() -> journal_store.Store:
    global _store
    if _store is None:
        _store = journal_store.open_store()
    return _store


def set_store(s: journal_store.Store | None) -> None:
    global _store
    _store = s


def now_ms() -> int:
    return int(time.time() * 1000)


def is_active(o: dict) -> bool:
    return o.get("status") in ACTIVE


# ---------- rules ----------
def close_order(o: dict, price: float, reason: str, at: int) -> dict:
    if o["status"] == "pending":
        o.update(status="cancelled", exitReason=reason, exitAt=at)
        return o
    d = 1 if o["side"] == "buy" else -1
    risk = abs(o["fill"] - o["stop"])
    o.update(status="closed", exitReason=reason, exitAt=at, exitPrice=price, last=price,
             pnlPct=d * (price - o["fill"]) / o["fill"],
             r=d * (price - o["fill"]) / risk if risk > 0 else None)
    return o


def on_price(o: dict, high: float, low: float, close: float, at: int) -> bool:
    """Apply a bar (or a tick: high = low = close) that happened at `at` ms. True if the status changed."""
    if not is_active(o):
        return False
    d = 1 if o["side"] == "buy" else -1
    before = o["status"]
    if o["status"] == "pending":
        if at - o["placedAt"] > PENDING_BARS * IV_SEC.get(o["interval"], 60) * 1000:
            o.update(status="cancelled", exitReason="expired", exitAt=at)
            return True
        touched = low <= o["entry"] if d == 1 else high >= o["entry"]
        if not touched:
            o.update(last=close, seen=at)
            return False
        o.update(status="open", fill=min(o["entry"], high) if d == 1 else max(o["entry"], low), filledAt=at)
    hit_stop = low <= o["stop"] if d == 1 else high >= o["stop"]
    hit_target = high >= o["target"] if d == 1 else low <= o["target"]
    if hit_stop:
        close_order(o, min(o["stop"], high) if d == 1 else max(o["stop"], low), "stop", at)
    elif hit_target:
        close_order(o, max(o["target"], low) if d == 1 else min(o["target"], high), "target", at)
    else:
        o["last"] = close
    o["seen"] = at
    return o["status"] != before


class OrderRejected(Exception):
    pass


def place(sig: dict, at: int | None = None) -> dict:
    """sig: sym, label, group, interval, theories, bias, confidence, price, entry, stop, targets, rr, barTime, feed."""
    at = at or now_ms()
    if sig["bias"] not in ("buy", "sell") or not sig["confidence"] > MIN_CONF:
        raise OrderRejected(f"orders need a BUY or SELL read above {MIN_CONF}% confidence")
    d = 1 if sig["bias"] == "buy" else -1
    target = sig["targets"][0]
    if not ((sig["entry"] - sig["stop"]) * d > 0 and (target - sig["entry"]) * d > 0):
        raise OrderRejected("stop and target must be on opposite sides of the entry")
    key = f"{sig['sym']}|{sig['interval']}"
    with _lock:
        s = store()
        active = next((o for o in s.active() if o["key"] == key), None)
        if active and active["side"] == sig["bias"]:
            raise OrderRejected(f"a {sig['bias'].upper()} order is already active for {sig['sym']} {sig['interval']}")
        changed = []
        if active:
            changed.append(close_order(active, sig["price"], "reversed", at))
        market = sig["entry"] == sig["price"]
        o = {
            "id": f"{at:x}-{secrets.token_hex(3)}",
            "key": key, "sym": sig["sym"], "label": sig["label"], "group": sig["group"], "interval": sig["interval"],
            "theories": sig["theories"], "side": sig["bias"], "confidence": sig["confidence"], "rr": sig.get("rr"),
            "placedAt": at, "barTime": sig.get("barTime"), "placedPrice": sig["price"], "feed": sig["feed"],
            "type": "market" if market else "limit",
            "entry": sig["entry"], "stop": sig["stop"], "target": target,
            "status": "open" if market else "pending",
            "fill": sig["price"] if market else None, "filledAt": at if market else None,
            "exitPrice": None, "exitAt": None, "exitReason": None, "pnlPct": None, "r": None,
            "last": sig["price"], "seen": at,
        }
        changed.append(o)
        s.save(changed)
        return o


def close_manual(order_id: str, price: float | None) -> dict | None:
    with _lock:
        s = store()
        o = s.get(order_id)
        if o is None:
            return None
        if is_active(o):
            p = price if price is not None and price > 0 else o["last"]
            close_order(o, p, "manual", now_ms())
            s.save([o])
        return o


def import_orders(orders: list[dict]) -> int:
    """Bulk-add orders saved in a browser before the log moved to the server; existing ids are kept."""
    with _lock:
        s = store()
        have = {o["id"] for o in s.all()}
        new = [o for o in orders if o["id"] not in have]
        for o in new:
            o.setdefault("key", f"{o['sym']}|{o['interval']}")
            o.setdefault("seen", o.get("placedAt"))
        s.save(new)
        return len(new)


# ---------- price tracking ----------
def _pick_interval(gap_sec: float) -> str:
    # Yahoo serves 1m candles for the last ~7 days and 5m for ~60 days.
    return "1m" if gap_sec < 6.5 * 86400 else "5m" if gap_sec < 55 * 86400 else "1h"


def yahoo_bars(sym: str, since: int) -> list[dict]:
    if not Q.SYMBOL_RE.match(sym):
        raise Q.QuoteError("invalid symbol")
    now = int(time.time())
    iv = _pick_interval(now - since)
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?interval={'60m' if iv == '1h' else iv}&period1={since - 60}&period2={now + 60}&includePrePost=false")
    res = ((Q._fetch(url).get("chart") or {}).get("result") or [None])[0]
    if not res:
        raise Q.QuoteError("unknown symbol")
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(res.get("timestamp") or []):
        h, l, c = (q.get(k, [None])[i] for k in ("high", "low", "close"))
        if None not in (h, l, c):
            out.append({"time": t, "high": h, "low": l, "close": c})
    return out


def binance_bars(sym: str, since: int) -> list[dict]:
    if not sym.isalnum() or not sym.isupper():
        raise Q.QuoteError("invalid symbol")
    iv = _pick_interval(time.time() - since)
    start, out = since * 1000, []
    for _ in range(30):  # 1000 candles per page
        qs = urllib.parse.urlencode({"symbol": sym, "interval": iv, "startTime": start, "limit": 1000})
        with urllib.request.urlopen(urllib.request.Request(f"{BINANCE_KLINES}?{qs}"), timeout=8) as r:
            rows = json.load(r)
        out += [{"time": k[0] // 1000, "high": float(k[2]), "low": float(k[3]), "close": float(k[4])} for k in rows]
        if len(rows) < 1000:
            break
        start = rows[-1][0] + 1
    return out


def feed_bars(feed: dict, since: int) -> list[dict]:
    if feed.get("src") == "binance":
        try:
            return binance_bars(feed["sym"], since)
        except Exception:
            if not feed.get("yahoo"):
                raise
            return yahoo_bars(feed["yahoo"], since)  # Binance unreachable: same asset on Yahoo
    return yahoo_bars(feed["sym"], since)


def track_once(fetch=feed_bars) -> int:
    """Bring every active order up to date. Returns how many orders changed status."""
    with _lock:
        active = store().active()
    by_feed: dict[str, list[dict]] = defaultdict(list)
    for o in active:
        if o.get("feed"):
            by_feed[json.dumps(o["feed"], sort_keys=True)].append(o)
    changed = 0
    for fkey, orders in by_feed.items():
        # From a little earlier so the candle in progress (the latest price) is always included.
        since = min(o["seen"] for o in orders) // 1000 - 120
        try:
            bars = fetch(json.loads(fkey), since)
        except Exception as exc:  # network or symbol trouble: keep the orders, retry next round
            log.warning("journal: no prices for %s: %s", fkey, exc)
            continue
        if not bars:
            continue
        with _lock:
            s = store()
            fresh = [x for x in (s.get(o["id"]) for o in orders) if x and is_active(x)]
            for o in fresh:
                # Only candles that started after the order was last checked; then the latest price as a tick.
                for b in bars:
                    if b["time"] * 1000 > o["seen"] and is_active(o):
                        changed += on_price(o, b["high"], b["low"], b["close"], b["time"] * 1000)
                # The latest candle's current price as a tick, dated at the candle so that delayed
                # feeds (gold futures, ~10 min) don't skip candles that arrive late.
                if is_active(o):
                    c = bars[-1]["close"]
                    changed += on_price(o, c, c, c, max(bars[-1]["time"] * 1000, o["seen"]))
            s.save(fresh)
    return changed
