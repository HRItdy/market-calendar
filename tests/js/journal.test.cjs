const test = require("node:test");
const assert = require("node:assert/strict");
const J = require("../../static/journal.js");

const T0 = 1_700_000_000_000;
const sig = (over = {}) => ({
  key: "BTC|5m", sym: "BTC", label: "BTC", group: "web3", interval: "5m", theories: ["of"],
  bias: "buy", confidence: 70, price: 100, entry: 100, stop: 95, targets: [110, 115], rr: 2, barTime: 1, ...over,
});
const tick = (p) => ({ high: p, low: p, close: p });

test("orders need BUY/SELL and confidence above 50%", () => {
  const orders = [];
  assert.equal(J.onSignal(orders, sig({ bias: "wait" }), T0), null);
  assert.equal(J.onSignal(orders, sig({ confidence: 50 }), T0), null);
  assert.equal(orders.length, 0);
  const o = J.onSignal(orders, sig({ confidence: 51 }), T0);
  assert.equal(o.status, "open");
  assert.equal(o.fill, 100);
});

test("a same-side signal does not stack a second order", () => {
  const orders = [];
  J.onSignal(orders, sig(), T0);
  assert.equal(J.onSignal(orders, sig({ barTime: 2 }), T0 + 1), null);
  assert.equal(orders.length, 1);
  // A different interval is tracked separately.
  assert.ok(J.onSignal(orders, sig({ key: "BTC|1h", interval: "1h" }), T0 + 2));
});

test("target hit is a win, stop hit is a loss, with P&L and R", () => {
  const orders = [];
  const a = J.onSignal(orders, sig(), T0);
  J.onPrice(a, tick(105), T0 + 1);
  assert.equal(a.status, "open");
  J.onPrice(a, { high: 111, low: 104, close: 108 }, T0 + 2);
  assert.equal(a.exitReason, "target");
  assert.equal(J.outcome(a), "win");
  assert.ok(Math.abs(a.pnlPct - 0.1) < 1e-9);
  assert.ok(Math.abs(a.r - 2) < 1e-9);

  const b = J.onSignal(orders, sig({ key: "ETH|5m", bias: "sell", stop: 104, targets: [90] }), T0);
  J.onPrice(b, tick(106), T0 + 1); // gapped through the stop: fills at the gap price
  assert.equal(b.exitReason, "stop");
  assert.equal(b.exitPrice, 106);
  assert.equal(J.outcome(b), "loss");
  assert.ok(Math.abs(b.r + 1.5) < 1e-9);
});

test("a bar spanning both stop and target counts as stopped out", () => {
  const o = J.onSignal([], sig(), T0);
  J.onPrice(o, { high: 112, low: 94, close: 100 }, T0 + 1);
  assert.equal(o.exitReason, "stop");
  assert.equal(o.exitPrice, 95);
});

test("limit orders wait for the entry, then expire if never filled", () => {
  const a = J.onSignal([], sig({ entry: 98 }), T0);
  assert.equal(a.status, "pending");
  J.onPrice(a, tick(99), T0 + 1);
  assert.equal(a.status, "pending");
  J.onPrice(a, { high: 99, low: 97.5, close: 98.5 }, T0 + 2);
  assert.equal(a.status, "open");
  assert.equal(a.fill, 98);

  const b = J.onSignal([], sig({ entry: 98 }), T0);
  J.onPrice(b, tick(101), T0 + J.PENDING_BARS * 300_000 + 1);
  assert.equal(b.status, "cancelled");
  assert.equal(b.exitReason, "expired");
});

test("an opposite signal closes the active order and opens the new one", () => {
  const orders = [];
  const a = J.onSignal(orders, sig(), T0);
  const b = J.onSignal(orders, sig({ bias: "sell", price: 97, entry: 97, stop: 100, targets: [90], barTime: 2 }), T0 + 1);
  assert.equal(a.status, "closed");
  assert.equal(a.exitReason, "reversed");
  assert.ok(Math.abs(a.pnlPct + 0.03) < 1e-9);
  assert.equal(b.status, "open");
  assert.equal(orders.length, 2);
});

test("no re-entry on the same bar and side right after a stop-out", () => {
  const orders = [];
  const a = J.onSignal(orders, sig(), T0);
  J.onPrice(a, tick(94), T0 + 1);
  assert.equal(J.onSignal(orders, sig({ price: 94, entry: 94, stop: 90 }), T0 + 2), null);
  assert.ok(J.onSignal(orders, sig({ price: 94, entry: 94, stop: 90, barTime: 2 }), T0 + 3));
});

test("stats summarise wins, losses and open P&L; CSV has one row per order", () => {
  const orders = [];
  const w = J.onSignal(orders, sig({ key: "A" }), T0); J.onPrice(w, tick(110), T0 + 1);
  const l = J.onSignal(orders, sig({ key: "B" }), T0); J.onPrice(l, tick(95), T0 + 1);
  const o = J.onSignal(orders, sig({ key: "C" }), T0); J.onPrice(o, tick(102), T0 + 1);
  const s = J.stats(orders);
  assert.deepEqual([s.total, s.closed, s.wins, s.losses, s.open], [3, 2, 1, 1, 1]);
  assert.equal(s.winRate, 0.5);
  assert.ok(Math.abs(s.totalPct - 0.05) < 1e-9);
  assert.ok(Math.abs(s.profitFactor - 2) < 1e-9);
  assert.ok(Math.abs(s.openPct - 0.02) < 1e-9);
  assert.equal(J.toCsv(orders).trim().split("\n").length, 4);
});
