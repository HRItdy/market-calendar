/* Trade log display helpers. Orders are placed, stored and tracked on the server (app/journal.py,
 * which documents the rules); the page only summarises them. */
(function (root) {
  "use strict";

  const MIN_CONF = 50; // the server's /api/journal reports the value in force
  const dirOf = (side) => (side === "buy" ? 1 : -1);
  const isActive = (o) => o.status === "open" || o.status === "pending";
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

  const api = { stats, unrealized, outcome, isActive, toCsv, MIN_CONF };
  root.Journal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
