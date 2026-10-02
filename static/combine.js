/* Combine theory reads (order flow, Chan Lun, price action) into one call.
 *
 * Each read: {theory, score, max, reasons[], levels[{price,label}], stops{long?, short?}}
 *   norm = score / max ∈ [−1, 1];  a theory leans buy at ≥ +0.4, sell at ≤ −0.4.
 * Combined:
 *   - any buy-leaning and sell-leaning theory at the same time → conflict → WAIT
 *   - otherwise the mean norm decides: ≥ +0.35 BUY, ≤ −0.35 SELL, else WAIT
 *   - plan: entry at the nearest supporting level (≤ 1.5 ATR away) else market;
 *     stop just beyond the tightest structural stop from the agreeing theories;
 *     targets from all theories' levels, at least 1R away.
 */
(function (root) {
  "use strict";

  const LEAN = 0.4, CALL = 0.35;
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const leanOf = (n) => (n >= LEAN ? "buy" : n <= -LEAN ? "sell" : "wait");

  function pickTargets(entry, stop, levels, dir) {
    const risk = Math.abs(entry - stop);
    const ok = levels.filter((x) => (x - entry) * dir >= risk);
    const t1 = ok[0] ?? entry + dir * 1.5 * risk;
    const t2 = ok.find((x) => (x - t1) * dir >= 0.5 * risk) ?? t1 + dir * risk;
    return [t1, t2];
  }

  function combine(reads, { price, atr, delayed = 0, estimatedDelta = false }) {
    const active = reads.filter(Boolean);
    if (!active.length || !(atr > 0)) return null;
    const per = active.map((r) => ({ theory: r.theory, norm: clamp(r.score / r.max), lean: leanOf(clamp(r.score / r.max)) }));
    const mean = per.reduce((s, p) => s + p.norm, 0) / per.length;
    const buys = per.filter((p) => p.lean === "buy").length, sells = per.filter((p) => p.lean === "sell").length;
    const conflict = buys > 0 && sells > 0;
    const bias = conflict ? "wait" : mean >= CALL ? "buy" : mean <= -CALL ? "sell" : "wait";
    const agree = bias === "buy" ? buys : bias === "sell" ? sells : 0;

    let confidence = 30 + Math.abs(mean) * 60 + Math.max(0, agree - 1) * 8;
    if (conflict) confidence = Math.min(confidence, 35);
    if (estimatedDelta && active.some((r) => r.theory === "of")) confidence -= 15;
    if (delayed) confidence -= 10;
    // Agreement earns confidence: one theory alone tops out at 75%.
    const cap = agree >= 3 ? 90 : agree === 2 ? 85 : 75;
    confidence = Math.round(Math.max(10, Math.min(cap, confidence)));

    // Level pool from every selected theory, de-duplicated within ¼ ATR.
    const pool = [];
    for (const r of active) for (const l of r.levels) {
      if (!Number.isFinite(l.price)) continue;
      const near = pool.find((p) => Math.abs(p.price - l.price) < 0.25 * atr);
      if (near) near.labels.push(`${r.theory}:${l.label}`); else pool.push({ price: l.price, labels: [`${r.theory}:${l.label}`] });
    }
    const above = pool.filter((l) => l.price > price + 0.2 * atr).sort((a, b) => a.price - b.price);
    const below = pool.filter((l) => l.price < price - 0.2 * atr).sort((a, b) => b.price - a.price);

    let entry = null, stop = null, targets = [], stopFrom = null;
    if (bias === "buy" || bias === "sell") {
      const dir = bias === "buy" ? 1 : -1;
      const side = dir === 1 ? below : above;
      const lvl = side.find((l) => Math.abs(price - l.price) <= 1.5 * atr);
      entry = lvl ? lvl.price : price;
      // Structural stops from agreeing theories that sit beyond the entry.
      const agreeing = active.filter((r) => leanOf(clamp(r.score / r.max)) === bias || per.length === 1);
      const cands = agreeing.map((r) => ({ theory: r.theory, price: r.stops?.[dir === 1 ? "long" : "short"] }))
        .filter((c) => Number.isFinite(c.price) && (entry - c.price) * dir >= 0.3 * atr && (entry - c.price) * dir <= 3 * atr);
      if (cands.length) {
        const tight = cands.sort((a, b) => (b.price - a.price) * dir)[0];
        stop = tight.price - dir * 0.1 * atr;
        stopFrom = tight.theory;
      } else stop = entry - dir * atr;
      const beyond = (dir === 1 ? above : below).map((l) => l.price).filter((x) => (x - entry) * dir > 0);
      targets = pickTargets(entry, stop, beyond, dir);
    }
    const rr = entry != null ? Math.abs(targets[0] - entry) / Math.abs(entry - stop) : null;

    const reasons = active.flatMap((r) => r.reasons.map((x) => ({ ...x, theory: r.theory })));
    return {
      bias, mean: Math.round(mean * 100) / 100, confidence, conflict, per, reasons,
      price, entry, stop, stopFrom, targets, rr, atLevel: entry != null && entry !== price,
      triggers: { longAbove: above[0]?.price ?? null, shortBelow: below[0]?.price ?? null },
      levels: pool,
    };
  }

  const api = { combine, pickTargets, LEAN, CALL };
  root.Combine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
