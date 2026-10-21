const test = require("node:test");
const assert = require("node:assert/strict");
const J = require("../../static/journal.js");

// Order rules are tested in tests/test_journal.py; these cover the page's summary helpers.
const order = (over) => ({ side: "buy", status: "closed", fill: 100, stop: 95, ...over });

test("outcome and unrealized P&L", () => {
  assert.equal(J.outcome(order({ pnlPct: 0.02 })), "win");
  assert.equal(J.outcome(order({ pnlPct: -0.01 })), "loss");
  assert.equal(J.outcome(order({ status: "open" })), null);
  assert.ok(Math.abs(J.unrealized(order({ status: "open", last: 102 })) - 0.02) < 1e-9);
  assert.ok(Math.abs(J.unrealized(order({ status: "open", side: "sell", last: 102 })) + 0.02) < 1e-9);
  assert.equal(J.unrealized(order({ status: "pending", last: 102 })), null);
});

test("stats summarise wins, losses and open P&L; CSV has one row per order", () => {
  const orders = [
    order({ pnlPct: 0.1, r: 2, exitPrice: 110 }),
    order({ pnlPct: -0.05, r: -1, exitPrice: 95 }),
    order({ status: "open", last: 102 }),
    order({ status: "pending" }),
  ];
  const s = J.stats(orders);
  assert.deepEqual([s.total, s.closed, s.wins, s.losses, s.open, s.pending], [4, 2, 1, 1, 1, 1]);
  assert.equal(s.winRate, 0.5);
  assert.ok(Math.abs(s.totalPct - 0.05) < 1e-9);
  assert.ok(Math.abs(s.avgR - 0.5) < 1e-9);
  assert.ok(Math.abs(s.profitFactor - 2) < 1e-9);
  assert.ok(Math.abs(s.openPct - 0.02) < 1e-9);
  assert.equal(J.toCsv(orders).trim().split("\n").length, 5);
});
