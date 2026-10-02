/* Price action on OHLC bars (pure functions, browser + Node).
 *
 *   swings      pivot highs/lows (n bars each side), labelled HH / LH / HL / LL
 *   structure   BOS (close through the last swing in the trend's direction) and
 *               CHoCH (close through it against the trend: first sign of reversal)
 *   zones       support/resistance from clusters of swing points (≥ 2 touches)
 *   EMA 20      trend filter (Al Brooks' reference average)
 *   patterns    pin bar, engulfing, inside bar; counted as signals when they form at a zone
 */
(function (root) {
  "use strict";

  function ema(values, n) {
    const k = 2 / (n + 1);
    let prev = values[0];
    return values.map((v, i) => (prev = i ? v * k + prev * (1 - k) : v));
  }

  function atr(bars, n = 14) {
    const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
    const r = tr.slice(-n);
    return r.reduce((s, x) => s + x, 0) / (r.length || 1);
  }

  function swings(bars, n = 3) {
    const out = [];
    for (let i = n; i < bars.length - n; i++) {
      // Highest/lowest in the window; ties go to the first bar (strict on the left).
      const left = bars.slice(i - n, i), right = bars.slice(i + 1, i + n + 1);
      const b = bars[i];
      if (left.every((x) => x.high < b.high) && right.every((x) => x.high <= b.high)) out.push({ type: "high", idx: i, price: b.high });
      if (left.every((x) => x.low > b.low) && right.every((x) => x.low >= b.low)) out.push({ type: "low", idx: i, price: b.low });
    }
    // Label against the previous swing of the same type.
    let lastH = null, lastL = null;
    for (const s of out) {
      if (s.type === "high") { s.label = lastH == null ? null : s.price > lastH ? "HH" : "LH"; lastH = s.price; }
      else { s.label = lastL == null ? null : s.price > lastL ? "HL" : "LL"; lastL = s.price; }
    }
    return out;
  }

  // Walk bars; a swing is usable once confirmed (n bars after it).
  function structure(bars, sw, n = 3) {
    const events = [];
    let trend = 0, hi = null, lo = null;
    let next = 0;
    for (let i = 0; i < bars.length; i++) {
      while (next < sw.length && sw[next].idx + n <= i) {
        if (sw[next].type === "high") hi = { ...sw[next], broken: false }; else lo = { ...sw[next], broken: false };
        next++;
      }
      const c = bars[i].close;
      if (hi && !hi.broken && c > hi.price) {
        events.push({ type: trend === -1 ? "CHoCH" : "BOS", dir: 1, idx: i, level: hi.price, from: hi.idx });
        hi.broken = true; trend = 1;
      } else if (lo && !lo.broken && c < lo.price) {
        events.push({ type: trend === 1 ? "CHoCH" : "BOS", dir: -1, idx: i, level: lo.price, from: lo.idx });
        lo.broken = true; trend = -1;
      }
    }
    return { events, trend };
  }

  function zones(bars, sw, a) {
    const pts = sw.map((s) => s.price).sort((x, y) => x - y);
    const tol = 0.6 * a;
    const clusters = [];
    for (const p of pts) {
      const c = clusters[clusters.length - 1];
      // Anchor each cluster at its first point so zones can't chain into a wide band.
      if (c && p - c.lo <= tol) { c.hi = p; c.touches++; c.sum += p; } else clusters.push({ lo: p, hi: p, touches: 1, sum: p });
    }
    const price = bars[bars.length - 1].close;
    return clusters.filter((c) => c.touches >= 2)
      .map((c) => ({ lo: c.lo - 0.15 * a, hi: c.hi + 0.15 * a, mid: c.sum / c.touches, touches: c.touches }))
      .sort((x, y) => Math.abs(x.mid - price) - Math.abs(y.mid - price))
      .slice(0, 6);
  }

  function pattern(bars, i) {
    const b = bars[i], p = bars[i - 1];
    if (!p) return null;
    const range = b.high - b.low;
    if (range <= 0) return null;
    const body = Math.abs(b.close - b.open);
    const upper = b.high - Math.max(b.open, b.close), lower = Math.min(b.open, b.close) - b.low;
    if (lower >= 2 * body && lower >= 0.6 * range && (b.close - b.low) / range >= 0.6) return { name: "pin", dir: 1 };
    if (upper >= 2 * body && upper >= 0.6 * range && (b.high - b.close) / range >= 0.6) return { name: "pin", dir: -1 };
    const pBody = Math.abs(p.close - p.open);
    if (p.close < p.open && b.close > b.open && b.close >= p.open && b.open <= p.close && body > pBody) return { name: "engulf", dir: 1 };
    if (p.close > p.open && b.close < b.open && b.close <= p.close - pBody && b.open >= p.close && body > pBody) return { name: "engulf", dir: -1 };
    if (b.high < p.high && b.low > p.low) return { name: "inside", dir: 0 };
    return null;
  }

  const inZone = (price, z, pad = 0) => price >= z.lo - pad && price <= z.hi + pad;

  function analyze(bars, { n = 3 } = {}) {
    if (bars.length < 30) return null;
    const a = atr(bars);
    const sw = swings(bars, n);
    const { events, trend } = structure(bars, sw, n);
    const zs = zones(bars, sw, a);
    const e20 = ema(bars.map((b) => b.close), 20);
    // Signal patterns: bullish at support (bar low tags a zone), bearish at resistance.
    const patterns = [];
    for (let i = Math.max(1, bars.length - 150); i < bars.length; i++) {
      const pt = pattern(bars, i);
      if (!pt) continue;
      const z = zs.find((zz) => (pt.dir >= 0 ? inZone(bars[i].low, zz, 0.1 * a) : inZone(bars[i].high, zz, 0.1 * a)));
      if (z || i >= bars.length - 3) patterns.push({ ...pt, idx: i, zone: z || null });
    }
    return { atr: a, swings: sw, events, trend, zones: zs, ema20: e20, patterns, read: read(bars, { a, sw, events, trend, zs, e20, patterns }) };
  }

  function read(bars, { a, sw, events, zs, e20, patterns }) {
    const n = bars.length;
    const price = bars[n - 1].close;
    const reasons = [];
    let score = 0;
    const add = (pts, key, args = {}) => { score += pts; reasons.push({ key, args, sign: Math.sign(pts) }); };

    // Structure: last two swing highs and lows.
    const highs = sw.filter((s) => s.type === "high" && s.label).slice(-2);
    const lows = sw.filter((s) => s.type === "low" && s.label).slice(-2);
    const hh = highs.at(-1)?.label === "HH", hl = lows.at(-1)?.label === "HL";
    const lh = highs.at(-1)?.label === "LH", ll = lows.at(-1)?.label === "LL";
    if (hh && hl) add(1.5, "paUptrend");
    else if (lh && ll) add(-1.5, "paDowntrend");
    else add(0, "paRange", { hi: highs.at(-1)?.label || "–", lo: lows.at(-1)?.label || "–" });

    // Latest break of structure within the last 30 bars.
    const ev = events.filter((e) => e.idx >= n - 30).at(-1);
    if (ev) add(ev.dir, `pa${ev.type}${ev.dir === 1 ? "Up" : "Down"}`, { level: ev.level });

    // 20 EMA: side and slope.
    const e = e20[n - 1], slope = e - e20[Math.max(0, n - 6)];
    if (price > e && slope > 0) add(1, "paAboveEma", { ema: e });
    else if (price < e && slope < 0) add(-1, "paBelowEma", { ema: e });
    else add(price > e ? 0.25 : -0.25, "paEmaFlat", { ema: e });

    // Signal bar in the last 3 bars.
    const sig = patterns.filter((p) => p.idx >= n - 3).at(-1);
    if (sig) {
      if (sig.dir !== 0 && sig.zone) add(1.5 * sig.dir, `paSignal_${sig.name}_${sig.dir > 0 ? "bull" : "bear"}_zone`, { zone: sig.zone.mid });
      else if (sig.dir !== 0) add(0.5 * sig.dir, `paSignal_${sig.name}_${sig.dir > 0 ? "bull" : "bear"}`);
      else add(0, "paInside", { hi: bars[sig.idx].high, lo: bars[sig.idx].low });
    }

    const levels = zs.map((z) => ({ price: z.mid, label: `S/R×${z.touches}` }));
    const lastHi = sw.filter((s) => s.type === "high").at(-1), lastLo = sw.filter((s) => s.type === "low").at(-1);
    if (lastHi) levels.push({ price: lastHi.price, label: "swing-high" });
    if (lastLo) levels.push({ price: lastLo.price, label: "swing-low" });
    const stops = { long: lastLo && lastLo.price < price ? lastLo.price : undefined, short: lastHi && lastHi.price > price ? lastHi.price : undefined };
    return { theory: "pa", score, max: 5, reasons, levels, stops };
  }

  const api = { ema, atr, swings, structure, zones, pattern, analyze };
  root.PriceAction = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
