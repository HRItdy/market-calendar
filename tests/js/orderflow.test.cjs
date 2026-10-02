const test = require("node:test");
const assert = require("node:assert/strict");
const OF = require("../../static/orderflow.js");

const bar = (i, o, h, l, c, v, buy) => ({ time: i * 60, open: o, high: h, low: l, close: c, volume: v, buy });

test("delta uses taker-buy volume when present", () => {
  const { bars, estimated } = OF.withDelta([bar(0, 10, 11, 9, 10, 100, 70), bar(1, 10, 11, 9, 10, 50, 10)]);
  assert.equal(estimated, false);
  assert.deepEqual(bars.map((b) => b.delta), [40, -30]);
  assert.deepEqual(bars.map((b) => b.cvd), [40, 10]);
});

test("delta is estimated from close location without taker data", () => {
  const { bars, estimated } = OF.withDelta([bar(0, 9, 11, 9, 11, 100), bar(1, 10, 10, 10, 10, 40)]);
  assert.equal(estimated, true);
  assert.equal(bars[0].delta, 100); // closed on the high → all buying
  assert.equal(bars[1].delta, 0);   // zero range → split evenly
});

test("VWAP resets each session and computes sd", () => {
  const bars = OF.withDelta([bar(0, 1, 1, 1, 1, 10), bar(1, 3, 3, 3, 3, 10), bar(2, 5, 5, 5, 5, 10)]).bars;
  const vw = OF.vwap(bars, (b) => (b.time < 120 ? "a" : "b"));
  assert.equal(vw[1].vwap, 2);
  assert.equal(vw[1].sd, 1);
  assert.equal(vw[2].vwap, 5); // new session
});

test("volume profile finds POC and a 70% value area around it", () => {
  const raw = [];
  for (let i = 0; i < 10; i++) raw.push(bar(i, 100, 101, 99, 100, 1000)); // broad volume 99–101
  for (let i = 0; i < 10; i++) raw.push(bar(20 + i, 100, 100.2, 100.05, 100.1, 1000)); // peak near 100.1
  raw.push(bar(40, 105, 110, 104, 109, 50)); // light volume up high
  const p = OF.volumeProfile(OF.withDelta(raw).bars, 22);
  assert.ok(Math.abs(p.poc - 100.1) <= p.step, `poc ${p.poc}`);
  assert.ok(p.val >= 99 - p.step && p.vah <= 101 + p.step, `${p.val}-${p.vah}`);
  const inVA = p.levels.filter((L) => L.lo >= p.val - 1e-9 && L.hi <= p.vah + 1e-9).reduce((s, L) => s + L.total, 0);
  assert.ok(inVA / p.total >= 0.7);
});

function trend(n, slope, buyShare) {
  const out = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px; px += slope;
    out.push(bar(i, o, Math.max(o, px) + 0.2, Math.min(o, px) - 0.2, px, 100, 100 * buyShare));
  }
  return out;
}

test("bullish absorption: heavy selling that fails to push price down", () => {
  const raw = trend(25, 0, 0.5);
  raw.push(bar(25, 100, 100.5, 99, 100.4, 500, 100)); // 5x volume, delta −300, close near high
  const { bars } = OF.withDelta(raw);
  const sig = OF.detectSignals(bars);
  assert.ok(sig.some((s) => s.type === "absorption" && s.side === "buy" && s.i === 25));
});

test("bearish CVD divergence on a new high with weaker delta", () => {
  const raw = [];
  for (let i = 0; i < 20; i++) raw.push(bar(i, 100 + i * 0.5, 100.6 + i * 0.5, 99.9 + i * 0.5, 100.5 + i * 0.5, 100, 80)); // rally, strong buying
  for (let i = 0; i < 5; i++) raw.push(bar(20 + i, 110 - i * 0.3, 110.1 - i * 0.3, 109.6 - i * 0.3, 109.7 - i * 0.3, 100, 50)); // shallow pullback, neutral
  raw.push(bar(25, 108.5, 111, 108.4, 110.8, 300, 30)); // new high on net selling → CVD lower
  const { bars } = OF.withDelta(raw);
  const sig = OF.detectSignals(bars);
  assert.ok(sig.some((s) => s.type === "divergence" && s.side === "sell" && s.i === 25), JSON.stringify(sig));
  assert.ok(!sig.some((s) => s.type === "divergence" && s.side === "buy"));
});

test("suggest: confirmed uptrend → buy with stop below entry and target above", () => {
  const raw = trend(60, 0.3, 0.75);
  const r = OF.analyze(raw, { sessionOf: () => "s", profileBars: 60 });
  assert.equal(r.suggestion.bias, "buy");
  assert.ok(r.suggestion.stop < r.suggestion.entry && r.suggestion.targets[0] > r.suggestion.entry);
  assert.ok(r.suggestion.reasons.some((x) => x.key === "cvdConfirmUp"));
});

test("suggest: confirmed downtrend → sell", () => {
  const r = OF.analyze(trend(60, -0.3, 0.25), { sessionOf: () => "s", profileBars: 60 });
  assert.equal(r.suggestion.bias, "sell");
  assert.ok(r.suggestion.stop > r.suggestion.entry && r.suggestion.targets[0] < r.suggestion.entry);
});

test("suggest: estimated + delayed data lowers confidence", () => {
  const raw = trend(60, 0.3, 0.75);
  const real = OF.analyze(raw, { sessionOf: () => "s", profileBars: 60 }).suggestion.confidence;
  const est = OF.analyze(raw.map(({ buy, ...b }) => b), { sessionOf: () => "s", profileBars: 60, delayed: true }).suggestion;
  assert.ok(est.confidence < real);
});

test("no volume → no suggestion", () => {
  const r = OF.analyze(trend(40, 0.1, 0.5).map((b) => ({ ...b, volume: 0, buy: 0 })), { sessionOf: () => "s", profileBars: 40 });
  assert.equal(r.suggestion, null);
  assert.equal(r.hasVolume, false);
});

test("plans always pay at least 1R to the first target", () => {
  for (const [slope, share] of [[0.3, 0.75], [-0.3, 0.25], [0.05, 0.7], [-0.05, 0.3]]) {
    const s = OF.analyze(trend(80, slope, share), { sessionOf: (b) => Math.floor(b.time / 1800), profileBars: 60 }).suggestion;
    if (s.bias === "wait") continue;
    const risk = Math.abs(s.entry - s.stop);
    assert.ok(Math.abs(s.targets[0] - s.entry) >= risk - 1e-9, JSON.stringify(s));
    assert.ok(s.rr >= 1 - 1e-9);
    assert.ok(Math.abs(s.targets[1] - s.entry) > Math.abs(s.targets[0] - s.entry));
  }
});
