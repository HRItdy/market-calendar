/* Paper-trading journal: when the combined read says BUY or SELL with confidence above MIN_CONF,
 * the viewer can place an order; it is recorded and followed to decide whether it made or lost money.
 *
 * Rules (simple and deterministic, so the log is easy to audit):
 *   - One active order per symbol + interval. A same-side signal while one is active is ignored;
 *     an opposite-side signal closes it at market ("reversed") and opens the new one.
 *   - Entry at market when the plan says so; otherwise a limit order at the plan's entry level,
 *     cancelled if not filled within PENDING_BARS bars of its interval.
 *   - Exit at the stop or at Target 1, whichever price reaches first. If one bar spans both,
 *     the stop is assumed to have come first (conservative). Gaps fill at the gapped price.
 *   - Result: P&L % = side × (exit − fill) / fill; R = side × (exit − fill) / |fill − stop|.
 */
(function (root) {
  "use strict";

  const MIN_CONF = 50;
  const PENDING_BARS = 20;
  const MAX_ORDERS = 500;
  const IV_SEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
  const dirOf = (side) => (side === "buy" ? 1 : -1);
  const isActive = (o) => o.status === "open" || o.status === "pending";

  function closeOrder(o, price, reason, at) {
    if (o.status === "pending") {
      Object.assign(o, { status: "cancelled", exitReason: reason, exitAt: at });
      return o;
    }
    const d = dirOf(o.side);
    o.status = "closed";
    o.exitReason = reason;
    o.exitAt = at;
    o.exitPrice = price;
    o.pnlPct = (d * (price - o.fill)) / o.fill;
    o.r = Math.abs(o.fill - o.stop) > 0 ? (d * (price - o.fill)) / Math.abs(o.fill - o.stop) : null;
    o.last = price;
    return o;
  }

  /* sig: {key, sym, label, group, interval, theories[], bias, confidence, price, entry, stop, targets[], rr, barTime}
   * Returns the new order, or null when no order is placed. Mutates `orders`. */
  function onSignal(orders, sig, at = Date.now()) {
    if ((sig.bias !== "buy" && sig.bias !== "sell") || !(sig.confidence > MIN_CONF)) return null;
    if (![sig.price, sig.entry, sig.stop, sig.targets?.[0]].every(Number.isFinite)) return null;
    const mine = orders.filter((o) => o.key === sig.key);
    const active = mine.find(isActive);
    if (active) {
      if (active.side === sig.bias) return null;
      closeOrder(active, sig.price, "reversed", at);
    }
    const market = sig.entry === sig.price;
    const o = {
      id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      key: sig.key, sym: sig.sym, label: sig.label, group: sig.group, interval: sig.interval,
      theories: sig.theories, side: sig.bias, confidence: sig.confidence, rr: sig.rr,
      placedAt: at, barTime: sig.barTime, placedPrice: sig.price,
      type: market ? "market" : "limit",
      entry: sig.entry, stop: sig.stop, target: sig.targets[0],
      status: market ? "open" : "pending",
      fill: market ? sig.price : null, filledAt: market ? at : null,
      exitPrice: null, exitAt: null, exitReason: null, pnlPct: null, r: null,
      last: sig.price, seen: at,
    };
    orders.push(o);
    if (orders.length > MAX_ORDERS) {
      // Drop the oldest finished orders first; active ones are always kept.
      const drop = orders.findIndex((x) => !isActive(x));
      orders.splice(drop >= 0 ? drop : 0, 1);
    }
    return o;
  }

  /* Price update for one order: a bar {high, low, close} or a tick (high = low = close).
   * `at` is when that price happened (ms). Returns true when the order changed state. */
  function onPrice(o, { high, low, close }, at = Date.now()) {
    if (!isActive(o)) return false;
    const d = dirOf(o.side);
    const before = o.status;
    if (o.status === "pending") {
      if (at - o.placedAt > PENDING_BARS * (IV_SEC[o.interval] || 60) * 1000) {
        Object.assign(o, { status: "cancelled", exitReason: "expired", exitAt: at });
        return true;
      }
      const touched = d === 1 ? low <= o.entry : high >= o.entry;
      if (!touched) { o.last = close; o.seen = at; return false; }
      o.status = "open";
      o.fill = d === 1 ? Math.min(o.entry, high) : Math.max(o.entry, low);
      o.filledAt = at;
    }
    const hitStop = d === 1 ? low <= o.stop : high >= o.stop;
    const hitTarget = d === 1 ? high >= o.target : low <= o.target;
    if (hitStop) closeOrder(o, d === 1 ? Math.min(o.stop, high) : Math.max(o.stop, low), "stop", at);
    else if (hitTarget) closeOrder(o, d === 1 ? Math.max(o.target, low) : Math.min(o.target, high), "target", at);
    else o.last = close;
    o.seen = at;
    return o.status !== before;
  }

  const unrealized = (o) => (o.status === "open" && Number.isFinite(o.last) ? (dirOf(o.side) * (o.last - o.fill)) / o.fill : null);
  const outcome = (o) => (o.status !== "closed" ? null : o.pnlPct > 0 ? "win" : o.pnlPct < 0 ? "loss" : "flat");

  function stats(orders) {
    const closed = orders.filter((o) => o.status === "closed");
    const wins = closed.filter((o) => outcome(o) === "win"), losses = closed.filter((o) => outcome(o) === "loss");
    const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
    const rs = closed.filter((o) => Number.isFinite(o.r));
    const open = orders.filter((o) => o.status === "open");
    return {
      total: orders.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
      totalPct: sum(closed, (o) => o.pnlPct),
      avgR: rs.length ? sum(rs, (o) => o.r) / rs.length : null,
      // Gross profit / gross loss (∞ with no losses, null with no closed trades).
      profitFactor: closed.length ? (losses.length ? sum(wins, (o) => o.pnlPct) / -sum(losses, (o) => o.pnlPct) : Infinity) : null,
      open: open.length,
      pending: orders.filter((o) => o.status === "pending").length,
      openPct: sum(open, (o) => unrealized(o) ?? 0),
    };
  }

  const CSV_COLS = ["placedAt", "label", "interval", "theories", "side", "confidence", "type", "entry", "fill", "stop", "target",
    "status", "exitReason", "exitPrice", "exitAt", "pnlPct", "r"];
  function toCsv(orders) {
    const cell = (k, v) => {
      if (v == null) return "";
      if (k === "placedAt" || k === "exitAt") return new Date(v).toISOString();
      if (Array.isArray(v)) return v.join("+");
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [CSV_COLS.join(","), ...orders.map((o) => CSV_COLS.map((k) => cell(k, o[k])).join(","))].join("\n") + "\n";
  }

  const api = { onSignal, onPrice, closeOrder, stats, unrealized, outcome, isActive, toCsv, MIN_CONF, PENDING_BARS, MAX_ORDERS };
  root.Journal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
