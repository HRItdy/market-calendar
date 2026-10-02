/* Order-flow analytics on OHLCV bars (pure functions, browser + Node).
 *
 * Bars: {time (epoch s), open, high, low, close, volume, buy?}
 *   buy = aggressive (taker) buy volume when the feed provides it (Binance).
 *   Without it, buy volume is estimated from where the close sits in the bar's range.
 *
 * Concepts:
 *   delta      buy − sell volume per bar (who was aggressive)
 *   CVD        cumulative delta
 *   VWAP       session volume-weighted average price, ±1σ/±2σ bands
 *   profile    volume at price: POC (most traded), VAH/VAL (70% value area)
 *   absorption heavy aggressive volume one way, but price doesn't follow → passive side absorbing
 *   divergence price makes a new swing extreme but CVD doesn't confirm it
 */
(function (root) {
  "use strict";

  const VALUE_AREA = 0.7;

  function withDelta(bars) {
    let cvd = 0;
    const estimated = !bars.some((b) => b.buy != null);
    const out = bars.map((b) => {
      let buy = b.buy;
      if (buy == null) {
        const range = b.high - b.low;
        buy = range > 0 ? b.volume * (b.close - b.low) / range : b.volume / 2;
      }
      const delta = 2 * buy - b.volume;
      cvd += delta;
      return { ...b, buy, sell: b.volume - buy, delta, cvd };
    });
    return { bars: out, estimated };
  }

  // sessionOf(bar) → key; VWAP resets when the key changes.
  function vwap(bars, sessionOf) {
    let key = null, pv = 0, v = 0, p2v = 0;
    return bars.map((b) => {
      const k = sessionOf(b);
      if (k !== key) { key = k; pv = 0; v = 0; p2v = 0; }
      const p = (b.high + b.low + b.close) / 3;
      pv += p * b.volume; v += b.volume; p2v += p * p * b.volume;
      if (v <= 0) return { time: b.time, vwap: null, sd: null };
      const mean = pv / v;
      return { time: b.time, vwap: mean, sd: Math.sqrt(Math.max(p2v / v - mean * mean, 0)) };
    });
  }

  function volumeProfile(bars, rows = 48) {
    if (!bars.length) return null;
    const lo = Math.min(...bars.map((b) => b.low));
    const hi = Math.max(...bars.map((b) => b.high));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / rows;
    const levels = Array.from({ length: rows }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, buy: 0, sell: 0, total: 0 }));
    for (const b of bars) {
      if (!b.volume) continue;
      const span = b.high - b.low;
      const first = Math.min(rows - 1, Math.floor((b.low - lo) / step));
      const last = Math.min(rows - 1, Math.floor((b.high - lo) / step));
      for (let i = first; i <= last; i++) {
        const L = levels[i];
        const share = span > 0 ? (Math.min(b.high, L.hi) - Math.max(b.low, L.lo)) / span : 1 / (last - first + 1);
        if (share <= 0) continue;
        L.buy += b.buy * share; L.sell += b.sell * share; L.total += b.volume * share;
      }
    }
    const total = levels.reduce((s, L) => s + L.total, 0);
    if (!total) return null;
    let poc = 0;
    levels.forEach((L, i) => { if (L.total > levels[poc].total) poc = i; });
    // Value area: grow from the POC towards the heavier neighbour until 70% of volume.
    let a = poc, z = poc, acc = levels[poc].total;
    while (acc < VALUE_AREA * total && (a > 0 || z < rows - 1)) {
      const down = a > 0 ? levels[a - 1].total : -1;
      const up = z < rows - 1 ? levels[z + 1].total : -1;
      if (up >= down) acc += levels[++z].total; else acc += levels[--a].total;
    }
    return { levels, step, poc: (levels[poc].lo + levels[poc].hi) / 2, vah: levels[z].hi, val: levels[a].lo, total };
  }

  function atr(bars, n = 14) {
    const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
    const recent = tr.slice(-n);
    return recent.reduce((s, x) => s + x, 0) / (recent.length || 1);
  }

  function detectSignals(bars, lookback = 20) {
    const signals = [];
    let lastDiv = -Infinity;
    for (let i = lookback; i < bars.length; i++) {
      const b = bars[i];
      const win = bars.slice(i - lookback, i);
      const avgVol = win.reduce((s, x) => s + x.volume, 0) / lookback;
      const range = b.high - b.low;
      const closePos = range > 0 ? (b.close - b.low) / range : 0.5;
      if (avgVol > 0 && b.volume > 1.8 * avgVol) {
        if (b.delta < -0.2 * b.volume && closePos >= 0.5) signals.push({ i, time: b.time, type: "absorption", side: "buy" });
        else if (b.delta > 0.2 * b.volume && closePos <= 0.5) signals.push({ i, time: b.time, type: "absorption", side: "sell" });
      }
      if (i - lastDiv < 5) continue;
      // Compare with the prior swing extreme 5..lookback bars back.
      const prior = bars.slice(i - lookback, i - 4);
      const hiBar = prior.reduce((m, x) => (x.high > m.high ? x : m));
      const loBar = prior.reduce((m, x) => (x.low < m.low ? x : m));
      const newHigh = b.high > hiBar.high && b.high >= Math.max(...bars.slice(i - 4, i).map((x) => x.high));
      const newLow = b.low < loBar.low && b.low <= Math.min(...bars.slice(i - 4, i).map((x) => x.low));
      if (newHigh && b.cvd < hiBar.cvd) { signals.push({ i, time: b.time, type: "divergence", side: "sell" }); lastDiv = i; }
      else if (newLow && b.cvd > loBar.cvd) { signals.push({ i, time: b.time, type: "divergence", side: "buy" }); lastDiv = i; }
    }
    return signals;
  }

  // Targets are structural levels that pay at least 1R; otherwise measured moves (1.5R, 2.5R).
  function pickTargets(entry, stop, levels, dir) {
    const risk = Math.abs(entry - stop);
    const ok = levels.filter((x) => (x - entry) * dir >= risk);
    const t1 = ok[0] ?? entry + dir * 1.5 * risk;
    const t2 = ok.find((x) => (x - t1) * dir >= 0.5 * risk) ?? t1 + dir * risk;
    return [t1, t2];
  }

  /* Combine the read into a bias with levels.
   * Returns {bias: "buy"|"sell"|"wait", score, confidence, entry, stop, targets[], rr, reasons[{key, args, sign}]} */
  function suggest({ bars, vw, profile, signals, estimated, delayed }) {
    const n = bars.length;
    if (n < 30 || !profile) return null;
    const last = bars[n - 1];
    const price = last.close;
    const v = vw[n - 1];
    const a = atr(bars);
    const reasons = [];
    let score = 0;
    const add = (pts, key, args = {}) => { score += pts; reasons.push({ key, args, sign: Math.sign(pts) }); };

    // 1. Location vs VWAP
    if (v && v.vwap) {
      const z = v.sd ? (price - v.vwap) / v.sd : 0;
      if (price > v.vwap) add(1, "aboveVwap", { vwap: v.vwap }); else add(-1, "belowVwap", { vwap: v.vwap });
      if (z > 2) add(-0.75, "stretchedUp", { z });
      else if (z < -2) add(0.75, "stretchedDown", { z });
    }
    // 2. Location vs value area
    if (price > profile.vah) add(1, "aboveValue", { vah: profile.vah });
    else if (price < profile.val) add(-1, "belowValue", { val: profile.val });
    else add(0, "insideValue", { poc: profile.poc, vah: profile.vah, val: profile.val });

    // 3. CVD vs price over the last 20 bars
    const k = Math.min(20, n - 1);
    const dPrice = price - bars[n - 1 - k].close;
    const dCvd = last.cvd - bars[n - 1 - k].cvd;
    const volK = bars.slice(n - k).reduce((s, b) => s + b.volume, 0) || 1;
    const cvdPct = dCvd / volK;
    const flat = Math.abs(cvdPct) < 0.03;
    if (!flat && dPrice > 0 && dCvd > 0) add(1.5, "cvdConfirmUp", { pct: cvdPct });
    else if (!flat && dPrice < 0 && dCvd < 0) add(-1.5, "cvdConfirmDown", { pct: cvdPct });
    else if (!flat && dPrice > 0 && dCvd < 0) add(-0.75, "cvdDivergeUp", { pct: cvdPct });
    else if (!flat && dPrice < 0 && dCvd > 0) add(0.75, "cvdDivergeDown", { pct: cvdPct });
    else add(0, "cvdFlat", { pct: cvdPct });

    // 4. Recent signals (last 10 bars)
    const recent = signals.filter((s) => s.i >= n - 10);
    for (const type of ["absorption", "divergence"]) {
      for (const side of ["buy", "sell"]) {
        if (recent.some((s) => s.type === type && s.side === side)) add(side === "buy" ? 1 : -1, `${type}_${side}`);
      }
    }
    // 5. Short-term aggression (last 5 bars)
    const last5 = bars.slice(-5);
    const d5 = last5.reduce((s, b) => s + b.delta, 0) / (last5.reduce((s, b) => s + b.volume, 0) || 1);
    if (d5 > 0.15) add(0.5, "buyersAggressive", { pct: d5 });
    else if (d5 < -0.15) add(-0.5, "sellersAggressive", { pct: d5 });

    const bias = score >= 2 ? "buy" : score <= -2 ? "sell" : "wait";
    let confidence = Math.min(85, 35 + Math.abs(score) * 9);
    if (estimated) confidence -= 15;
    if (delayed) confidence -= 10;
    confidence = Math.max(10, Math.round(confidence));

    // Levels: supports/resistances from the profile, VWAP bands and the recent range.
    const swingHi = Math.max(...bars.slice(-20).map((b) => b.high));
    const swingLo = Math.min(...bars.slice(-20).map((b) => b.low));
    const lv = [profile.poc, profile.vah, profile.val, swingHi, swingLo];
    if (v && v.vwap) lv.push(v.vwap, v.vwap + v.sd, v.vwap - v.sd, v.vwap + 2 * v.sd, v.vwap - 2 * v.sd);
    const uniq = (arr) => arr.filter((x, i) => arr.findIndex((y) => Math.abs(y - x) < a * 0.25) === i);
    const above = uniq(lv.filter((x) => x > price + a * 0.2).sort((p, q) => p - q));
    const below = uniq(lv.filter((x) => x < price - a * 0.2).sort((p, q) => q - p));

    let entry = null, stop = null, targets = [];
    if (bias === "buy") {
      const sup = below.find((x) => price - x <= 1.5 * a);
      entry = sup ?? price;
      stop = entry - Math.max(a, (sup ? 0.6 : 1) * a);
      targets = pickTargets(entry, stop, above, 1);
    } else if (bias === "sell") {
      const res = above.find((x) => x - price <= 1.5 * a);
      entry = res ?? price;
      stop = entry + Math.max(a, (res ? 0.6 : 1) * a);
      targets = pickTargets(entry, stop, below, -1);
    }
    const rr = entry != null && targets.length ? Math.abs(targets[0] - entry) / Math.abs(entry - stop) : null;
    return {
      bias, score: Math.round(score * 100) / 100, confidence, price, atr: a,
      entry, stop, targets, rr,
      // For "wait": the levels that would flip the read.
      triggers: { longAbove: profile.vah, shortBelow: profile.val, poc: profile.poc },
      reasons,
    };
  }

  // One call for the chart: everything derived from raw bars.
  function analyze(rawBars, { sessionOf, profileBars, delayed = false }) {
    const { bars, estimated } = withDelta(rawBars);
    const vw = vwap(bars, sessionOf);
    const profile = volumeProfile(bars.slice(-profileBars));
    const signals = detectSignals(bars);
    const hasVolume = bars.some((b) => b.volume > 0);
    const suggestion = hasVolume ? suggest({ bars, vw, profile, signals, estimated, delayed }) : null;
    return { bars, estimated, vw, profile, signals, suggestion, hasVolume };
  }

  const api = { withDelta, vwap, volumeProfile, atr, detectSignals, suggest, analyze };
  root.OrderFlow = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
