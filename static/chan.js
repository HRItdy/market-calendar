/* Chan Lun (缠论) on OHLC bars (pure functions, browser + Node).
 *
 * Pipeline:
 *   包含处理 inclusion   merge bars where one bar's range contains the other's (direction-aware)
 *   分型     fractals    top: middle merged bar higher than both neighbours; bottom: lower
 *   笔       strokes     alternate top/bottom fractals ≥ 4 merged bars apart (≥ 5 bars incl. ends)
 *   线段     segments    ≥ 3 strokes; ends when the counter-move breaks the last swing that built it
 *                        (a simplified feature-sequence rule)
 *   中枢     pivots      overlap of ≥ 3 consecutive strokes: ZG = min(highs), ZD = max(lows)
 *   背驰     divergence  new extreme with smaller MACD-histogram area than the prior same-way stroke
 *   买卖点   points      1B/1S trend divergence after ≥ 2 same-way pivots; 2B/2S first pullback that holds;
 *                        3B/3S pullback after leaving a pivot that stays outside it
 *
 * Bars: {time, open, high, low, close}. All indices refer to the original bar array.
 */
(function (root) {
  "use strict";

  const MIN_GAP = 4; // merged-bar distance between the two fractals of a stroke

  function ema(values, n) {
    const k = 2 / (n + 1);
    let prev = values[0];
    return values.map((v, i) => (prev = i ? v * k + prev * (1 - k) : v));
  }

  function macd(bars) {
    const close = bars.map((b) => b.close);
    const e12 = ema(close, 12), e26 = ema(close, 26);
    const dif = close.map((_, i) => e12[i] - e26[i]);
    const dea = ema(dif, 9);
    return dif.map((d, i) => ({ dif: d, dea: dea[i], hist: 2 * (d - dea[i]) }));
  }

  function mergeBars(bars) {
    const m = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const last = m[m.length - 1];
      if (last) {
        const contains = (b.high <= last.high && b.low >= last.low) || (b.high >= last.high && b.low <= last.low);
        if (contains) {
          const prev = m[m.length - 2];
          const up = prev ? last.high > prev.high : true;
          if (up) {
            if (b.high >= last.high) last.hiIdx = i;
            if (b.low > last.low) last.loIdx = i;
            last.high = Math.max(last.high, b.high);
            last.low = Math.max(last.low, b.low);
          } else {
            if (b.low <= last.low) last.loIdx = i;
            if (b.high < last.high) last.hiIdx = i;
            last.high = Math.min(last.high, b.high);
            last.low = Math.min(last.low, b.low);
          }
          last.end = i;
          continue;
        }
      }
      m.push({ high: b.high, low: b.low, start: i, end: i, hiIdx: i, loIdx: i });
    }
    return m;
  }

  function fractals(m) {
    const out = [];
    for (let k = 1; k < m.length - 1; k++) {
      const a = m[k - 1], b = m[k], c = m[k + 1];
      if (b.high > a.high && b.high > c.high) out.push({ type: "top", k, idx: b.hiIdx, price: b.high });
      else if (b.low < a.low && b.low < c.low) out.push({ type: "bottom", k, idx: b.loIdx, price: b.low });
    }
    return out;
  }

  function strokeVertices(fx) {
    const v = [];
    for (const f of fx) {
      const last = v[v.length - 1];
      if (!last) { v.push(f); continue; }
      if (f.type === last.type) {
        // Same side: keep the more extreme fractal (extends the current stroke).
        const better = f.type === "top" ? f.price > last.price : f.price < last.price;
        const prev = v[v.length - 2];
        if (better && (!prev || f.k - prev.k >= MIN_GAP)) v[v.length - 1] = f;
        continue;
      }
      const valid = f.k - last.k >= MIN_GAP && (f.type === "top" ? f.price > last.price : f.price < last.price);
      if (valid) v.push(f);
    }
    return v;
  }

  function strokesFrom(v, hist) {
    const s = [];
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1], b = v[i];
      const dir = b.type === "top" ? 1 : -1;
      let area = 0;
      for (let j = a.idx + 1; j <= b.idx; j++) if (Math.sign(hist[j].hist) === dir) area += Math.abs(hist[j].hist);
      s.push({ i: i - 1, from: a, to: b, dir, high: Math.max(a.price, b.price), low: Math.min(a.price, b.price), area });
    }
    return s;
  }

  // Simplified segments: ≥ 3 strokes; an up segment ends at its highest vertex once a later
  // down stroke breaks the low that preceded that high (mirror for down segments).
  function segmentsFrom(v) {
    if (v.length < 4) return [];
    const segs = [];
    let start = 0;
    while (start < v.length - 1) {
      const dir = v[start + 1].price > v[start].price ? 1 : -1;
      let ext = start + 1;
      let end = null;
      for (let j = start + 2; j < v.length; j++) {
        const isExtType = dir === 1 ? v[j].type === "top" : v[j].type === "bottom";
        if (isExtType && (dir === 1 ? v[j].price > v[ext].price : v[j].price < v[ext].price)) ext = j;
        const breaksBack = dir === 1 ? v[j].type === "bottom" && v[j].price < v[ext - 1].price
                                     : v[j].type === "top" && v[j].price > v[ext - 1].price;
        if (j > ext && breaksBack && ext - start >= 3) { end = ext; break; }
      }
      if (end == null) { segs.push({ from: v[start], to: v[ext], dir, open: true }); break; }
      segs.push({ from: v[start], to: v[end], dir, open: false });
      start = end;
    }
    return segs;
  }

  function pivotsFrom(strokes) {
    const out = [];
    let i = 0;
    while (i + 2 < strokes.length) {
      const trio = strokes.slice(i, i + 3);
      const zg = Math.min(...trio.map((s) => s.high));
      const zd = Math.max(...trio.map((s) => s.low));
      if (zg > zd) {
        let j = i + 2;
        let gg = Math.max(...trio.map((st) => st.high)), dd = Math.min(...trio.map((st) => st.low));
        // Later strokes that overlap [ZD, ZG] extend the pivot, unless they end at a new extreme
        // beyond the pivot's whole range (GG/DD): that stroke is the one leaving it.
        for (let nx = strokes[j + 1]; nx && nx.low < zg && nx.high > zd; nx = strokes[j + 1]) {
          if (nx.to.price > gg || nx.to.price < dd) break;
          j++; gg = Math.max(gg, nx.high); dd = Math.min(dd, nx.low);
        }
        const members = strokes.slice(i, j + 1);
        out.push({ first: i, last: j, zg, zd, gg: Math.max(...members.map((s) => s.high)), dd: Math.min(...members.map((s) => s.low)),
                   startIdx: strokes[i].from.idx, endIdx: strokes[j].to.idx });
        // Stroke j+1 leaves this pivot and is the entering stroke of whatever comes next,
        // so the next pivot is built from the strokes after it.
        i = j + 2;
      } else i++;
    }
    return out;
  }

  function buySellPoints(strokes, pivots) {
    const pts = [];
    const pivotBefore = (k) => [...pivots].reverse().find((p) => p.last < k);
    for (let k = 2; k < strokes.length; k++) {
      const s = strokes[k], prev = strokes[k - 2];
      const p = pivotBefore(k);
      // 1st type: trend divergence (趋势背驰). Needs ≥ 2 pivots stepping the same way; the stroke
      // leaving the last pivot makes a new extreme with less MACD area than the stroke that entered it.
      const before = pivots.filter((q) => q.last < k);
      const [p1, p2] = before.slice(-2);
      if (p2 && p2.last === k - 1 && p2.first > 0) {
        const enter = strokes[p2.first - 1];
        const downTrend = p1 && p2.zg < p1.zd, upTrend = p1 && p2.zd > p1.zg;
        if (downTrend && s.dir === -1 && enter.dir === -1 && s.low < p2.dd && s.area < enter.area) pts.push({ type: "1B", k, idx: s.to.idx, price: s.low });
        if (upTrend && s.dir === 1 && enter.dir === 1 && s.high > p2.gg && s.area < enter.area) pts.push({ type: "1S", k, idx: s.to.idx, price: s.high });
      }
      // 3rd type: leave a pivot, pull back without re-entering it.
      if (p && p.last === k - 2) {
        const leave = strokes[k - 1];
        if (leave.dir === 1 && leave.high > p.zg && s.dir === -1 && s.low > p.zg) pts.push({ type: "3B", k, idx: s.to.idx, price: s.low, pivot: p });
        if (leave.dir === -1 && leave.low < p.zd && s.dir === 1 && s.high < p.zd) pts.push({ type: "3S", k, idx: s.to.idx, price: s.high, pivot: p });
      }
    }
    // 2nd type: first same-direction pullback after a 1st-type point that holds it.
    for (const one of pts.filter((x) => x.type === "1B" || x.type === "1S")) {
      const s = strokes[one.k + 2];
      if (!s) continue;
      if (one.type === "1B" && s.dir === -1 && s.low > one.price) pts.push({ type: "2B", k: one.k + 2, idx: s.to.idx, price: s.low });
      if (one.type === "1S" && s.dir === 1 && s.high < one.price) pts.push({ type: "2S", k: one.k + 2, idx: s.to.idx, price: s.high });
    }
    return pts.sort((a, b) => a.k - b.k);
  }

  function analyze(bars) {
    if (bars.length < 30) return null;
    const hist = macd(bars);
    const merged = mergeBars(bars);
    const fx = fractals(merged);
    const vertices = strokeVertices(fx);
    const strokes = strokesFrom(vertices, hist);
    const segments = segmentsFrom(vertices);
    const pivots = pivotsFrom(strokes);
    const points = buySellPoints(strokes, pivots);
    return { merged, fractals: fx, vertices, strokes, segments, pivots, points, macd: hist, read: read(bars, strokes, segments, pivots, points) };
  }

  /* Theory read for the combiner: score in [-max, max], reasons, levels, structural stops. */
  function read(bars, strokes, segments, pivots, points) {
    const price = bars[bars.length - 1].close;
    const reasons = [];
    let score = 0;
    const add = (pts, key, args = {}) => { score += pts; reasons.push({ key, args, sign: Math.sign(pts) }); };
    const levels = [];
    const stops = {};

    const seg = segments[segments.length - 1];
    if (seg) { if (seg.dir === 1) add(1, "chanSegUp"); else add(-1, "chanSegDown"); }

    const pv = pivots[pivots.length - 1];
    if (pv) {
      levels.push({ price: pv.zg, label: "ZG" }, { price: pv.zd, label: "ZD" });
      if (price > pv.zg) add(1, "chanAbovePivot", { zg: pv.zg, zd: pv.zd });
      else if (price < pv.zd) add(-1, "chanBelowPivot", { zg: pv.zg, zd: pv.zd });
      else add(0, "chanInPivot", { zg: pv.zg, zd: pv.zd });
      stops.long = pv.zd; stops.short = pv.zg;
    }

    const last = strokes[strokes.length - 1];
    if (last) {
      levels.push({ price: last.high, label: "stroke-high" }, { price: last.low, label: "stroke-low" });
      // Move since the last confirmed vertex: a new stroke may be forming against it.
      const from = last.to.price;
      if (last.dir === -1 && price > from) add(0.5, "chanNewUpStroke", { from });
      else if (last.dir === 1 && price < from) add(-0.5, "chanNewDownStroke", { from });
      else add(last.dir * 0.5, last.dir === 1 ? "chanStrokeUp" : "chanStrokeDown");
    }

    // Most recent buy/sell point within the last 3 strokes, unless price has invalidated it.
    const recent = [...points].reverse().find((p) => p.k >= strokes.length - 3);
    if (recent) {
      const buy = recent.type.endsWith("B");
      const weight = recent.type.startsWith("1") ? 1.5 : 2;
      const broken = buy ? price < recent.price : price > recent.price;
      const pending = recent.k === strokes.length - 1;
      if (broken) add(buy ? -0.5 : 0.5, "chanPointFailed", { type: recent.type, price: recent.price });
      else {
        add(buy ? weight : -weight, `chanPoint${recent.type}`, { price: recent.price, pending });
        if (buy) stops.long = recent.price; else stops.short = recent.price;
      }
      levels.push({ price: recent.price, label: recent.type });
    }

    return { theory: "chan", score, max: 5, reasons, levels, stops };
  }

  const api = { macd, mergeBars, fractals, strokeVertices, strokesFrom, segmentsFrom, pivotsFrom, buySellPoints, analyze };
  root.Chan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
