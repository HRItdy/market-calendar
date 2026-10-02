const test = require("node:test");
const assert = require("node:assert/strict");
const Chan = require("../../static/chan.js");
const PA = require("../../static/pa.js");
const { combine, pickTargets } = require("../../static/combine.js");

// Build bars that follow a list of price waypoints, one bar per unit step.
function path(points, step = 1) {
  const bars = [];
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.round(Math.abs(b - a) / step));
    for (let k = 0; k < n; k++) {
      const o = a + ((b - a) * k) / n, c = a + ((b - a) * (k + 1)) / n;
      bars.push({ time: t++ * 60, open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c, volume: 100 });
    }
  }
  return bars;
}

test("inclusion merges contained bars in the trend direction", () => {
  const bars = [
    { high: 10, low: 8 }, { high: 12, low: 9 },   // up
    { high: 11.5, low: 9.5 },                      // inside → merged up: high max, low max
    { high: 13, low: 10 },
  ].map((b, i) => ({ ...b, time: i, open: b.low, close: b.high }));
  const m = Chan.mergeBars(bars);
  assert.equal(m.length, 3);
  assert.deepEqual([m[1].high, m[1].low], [12, 9.5]);
});

test("strokes alternate and respect the minimum fractal gap", () => {
  const bars = path([100, 110, 103, 115, 106, 120, 112]); // final reversal confirms the last top
  const r = Chan.analyze(bars);
  assert.ok(r.strokes.length >= 4, `strokes ${r.strokes.length}`);
  for (let i = 1; i < r.strokes.length; i++) assert.equal(r.strokes[i].dir, -r.strokes[i - 1].dir);
  for (const s of r.strokes) assert.ok(s.to.k - s.from.k >= 4);
});

test("pivot is the overlap of three strokes (ZG > ZD)", () => {
  const bars = path([100, 110, 104, 112, 103, 111, 105]);
  const r = Chan.analyze(bars);
  assert.ok(r.pivots.length >= 1);
  const p = r.pivots[0];
  assert.ok(p.zg > p.zd && p.zg <= 112 && p.zd >= 103, JSON.stringify(p));
});

test("third buy point: leave the pivot up, pull back without re-entering", () => {
  // Pivot from 110/104/112/103, leave up to 125, pull back to 115 (> ZG 110), then 130 → 120.
  const bars = path([100, 110, 104, 112, 103, 125, 115, 130, 120]);
  const r = Chan.analyze(bars);
  const p3 = r.points.find((x) => x.type === "3B");
  assert.ok(p3, JSON.stringify(r.points));
  assert.ok(p3.price > p3.pivot.zg);
  assert.ok(r.read.reasons.some((x) => x.key === "chanPoint3B" || x.key === "chanAbovePivot"));
});

test("first buy point: downtrend with two falling pivots, new low on weaker MACD area", () => {
  // Pivot A (124–129), fast 30-point drop into pivot B (101–106), then a short, weak new low at 95.
  const bars = path([150, 130, 124, 131, 123, 129, 99, 107, 101, 106, 100, 105, 95, 103, 98, 104]);
  const r = Chan.analyze(bars);
  assert.ok(r.pivots.length >= 2, JSON.stringify(r.pivots.map((p) => [p.zd, p.zg])));
  const one = r.points.find((p) => p.type === "1B");
  assert.ok(one, JSON.stringify(r.points.map((p) => p.type)));
  assert.ok(!r.points.some((p) => p.type === "1S"));
  assert.ok(r.points.some((p) => p.type === "2B" && p.price > one.price), JSON.stringify(r.points)); // higher low after 1B
});

test("no first-type point without a two-pivot trend", () => {
  const r = Chan.analyze(path([100, 110, 104, 112, 103, 125, 115, 130, 120]));
  assert.ok(!r.points.some((p) => p.type === "1S" || p.type === "1B"));
});

test("price action labels swings and detects BOS / CHoCH", () => {
  const bars = path([100, 110, 105, 115, 108, 120, 112, 104, 109, 98]);
  const r = PA.analyze(bars);
  const labels = r.swings.map((s) => s.label).filter(Boolean);
  assert.ok(labels.includes("HH") && labels.includes("HL"), labels.join(","));
  assert.ok(r.events.some((e) => e.type === "BOS" && e.dir === 1));
  assert.ok(r.events.some((e) => e.type === "CHoCH" && e.dir === -1), JSON.stringify(r.events));
});

test("price action patterns", () => {
  const bar = (o, h, l, c) => ({ time: 0, open: o, high: h, low: l, close: c });
  assert.deepEqual(PA.pattern([bar(10, 10.5, 9.5, 10), bar(10, 10.2, 8, 10.1)], 1), { name: "pin", dir: 1 });
  assert.deepEqual(PA.pattern([bar(10, 10.2, 9.4, 9.5), bar(9.4, 10.6, 9.3, 10.4)], 1), { name: "engulf", dir: 1 });
  assert.deepEqual(PA.pattern([bar(10, 11, 9, 10.5), bar(10.2, 10.8, 9.5, 10.4)], 1), { name: "inside", dir: 0 });
});

test("price action read: uptrend above a rising EMA leans buy", () => {
  const pts = [100];
  for (let i = 0; i < 8; i++) pts.push(pts.at(-1) + 8, pts.at(-1) + 4);
  const r = PA.analyze(path(pts));
  assert.ok(r.read.score / r.read.max >= 0.4, JSON.stringify(r.read.reasons));
});

const mk = (theory, score, levels = [], stops = {}) => ({ theory, score, max: 5, reasons: [{ key: "x", sign: Math.sign(score) }], levels, stops });

test("combine: agreement → call with boosted confidence and ≥1R plan", () => {
  const ctx = { price: 100, atr: 1 };
  const one = combine([mk("of", 3, [{ price: 99, label: "VAL" }, { price: 103, label: "VAH" }], { long: 98.5 })], ctx);
  const two = combine([mk("of", 3, [{ price: 99, label: "VAL" }, { price: 103, label: "VAH" }], { long: 98.5 }), mk("pa", 3, [{ price: 105, label: "S/R" }], { long: 98 })], ctx);
  assert.equal(two.bias, "buy");
  assert.ok(two.confidence > one.confidence);
  assert.equal(two.entry, 99);
  assert.ok(two.stop < 99 && two.stop > 98);   // tightest structural stop (98.5) minus buffer
  assert.ok(two.rr >= 1);
});

test("combine: opposing theories → conflict → wait", () => {
  const r = combine([mk("of", 4), mk("chan", -3)], { price: 100, atr: 1 });
  assert.equal(r.bias, "wait");
  assert.equal(r.conflict, true);
  assert.ok(r.confidence <= 35);
});

test("combine: neutral theories dilute a lone signal", () => {
  const r = combine([mk("of", 2.5), mk("chan", 0), mk("pa", 0)], { price: 100, atr: 1 });
  assert.equal(r.bias, "wait");
});

test("pickTargets falls back to measured moves", () => {
  assert.deepEqual(pickTargets(100, 98, [], 1), [103, 105]);
  assert.deepEqual(pickTargets(100, 98, [101, 102.5, 104], 1), [102.5, 104]);
});

test("S/R zones stay narrow (no chaining across a trend)", () => {
  const pts = [100];
  for (let i = 0; i < 12; i++) pts.push(pts.at(-1) + 6, pts.at(-1) + 3); // staircase: many swings close together
  const r = PA.analyze(path(pts));
  for (const z of r.zones) assert.ok(z.hi - z.lo <= 0.6 * r.atr + 0.3 * r.atr + 1e-9, JSON.stringify(z));
});
