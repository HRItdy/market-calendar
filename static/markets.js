"use strict";

/* Live K-line panels for Web3, Gold and US stocks, analysed with up to three theories the
 * viewer switches on: Order flow (orderflow.js), Chan Lun (chan.js) and Price action (pa.js).
 * combine.js merges the selected theories into one BUY / SELL / WAIT read with a plan.
 *
 * Data: Binance symbols stream over WebSocket in the browser (real taker-buy volume);
 * Yahoo symbols (gold futures, US stocks) come via /api/kline every 10s.
 * High-impact calendar events for each market are marked on the chart. */

const I18N = window.MKT_I18N;
const SHORT = window.MKT_SHORT;
const THEORIES = ["of", "chan", "pa"];

const GROUPS = [
  { key: "web3", market: "btc", symbols: [
    { id: "BTC", label: "BTC", src: "binance", sym: "BTCUSDT", yahoo: "BTC-USD" },
    { id: "ETH", label: "ETH", src: "binance", sym: "ETHUSDT", yahoo: "ETH-USD" },
    { id: "SOL", label: "SOL", src: "binance", sym: "SOLUSDT", yahoo: "SOL-USD" },
    { id: "BNB", label: "BNB", src: "binance", sym: "BNBUSDT", yahoo: "BNB-USD" },
    { id: "XRP", label: "XRP", src: "binance", sym: "XRPUSDT", yahoo: "XRP-USD" },
    { id: "DOGE", label: "DOGE", src: "binance", sym: "DOGEUSDT", yahoo: "DOGE-USD" },
  ] },
  { key: "gold", market: "gold", symbols: [
    { id: "GC", label: { en: "COMEX Gold", zh: "COMEX黄金" }, src: "yahoo", sym: "GC=F" },
    { id: "PAXG", label: { en: "PAXG · 24/7", zh: "PAXG · 24小时" }, src: "binance", sym: "PAXGUSDT", yahoo: "PAXG-USD" },
    { id: "SI", label: { en: "Silver", zh: "白银" }, src: "yahoo", sym: "SI=F" },
  ] },
  { key: "us", market: "us", search: true, symbols: [
    { id: "SPX", label: { en: "S&P 500", zh: "标普500" }, src: "yahoo", sym: "^GSPC" },
    { id: "NDX", label: { en: "Nasdaq", zh: "纳斯达克" }, src: "yahoo", sym: "^IXIC" },
    { id: "DJI", label: { en: "Dow", zh: "道琼斯" }, src: "yahoo", sym: "^DJI" },
    { id: "SPY", label: "SPY", src: "yahoo", sym: "SPY" },
    { id: "QQQ", label: "QQQ", src: "yahoo", sym: "QQQ" },
    { id: "NVDA", label: "NVDA", src: "yahoo", sym: "NVDA" },
    { id: "AAPL", label: "AAPL", src: "yahoo", sym: "AAPL" },
    { id: "TSLA", label: "TSLA", src: "yahoo", sym: "TSLA" },
  ] },
];

const BINANCE_REST = "https://data-api.binance.vision/api/v3";
const BINANCE_WS = "wss://data-stream.binance.vision/stream?streams=";
const POLL_MS = 10_000;
const ANALYSIS_THROTTLE_MS = 1500;
const INTERVAL_SEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
const PROFILE_BARS = { "1m": 240, "5m": 288, "15m": 192, "1h": 168, "1d": 120 };
const PROFILE_SPAN = { en: { "1m": "4 hours", "5m": "24 hours", "15m": "2 days", "1h": "7 days", "1d": "120 days" },
                       zh: { "1m": "4小时", "5m": "24小时", "15m": "2天", "1h": "7天", "1d": "120天" } };
const SCALE_WIDTH = 78;         // shared min price-scale width keeps the panes aligned
const PA_LABEL_SWINGS = 8;      // HH/HL/LH/LL labels on the most recent swings only
const PA_PATTERN_BARS = 30;     // pattern markers within the most recent bars only

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

const params = new URLSearchParams(location.search);
const initialLang = params.get("lang") || load("mc.lang", null) || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");
const initialTheories = params.has("t") ? params.get("t").split(",") : load("mc.theories", ["of"]);
const state = {
  lang: I18N[initialLang] ? initialLang : "en",
  interval: params.get("interval") in INTERVAL_SEC ? params.get("interval") : load("mc.interval", "5m"),
  colors: load("mc.colors", null), // null → follow language convention
  theories: new Set(initialTheories.filter((x) => THEORIES.includes(x))),
  events: [],
};
const on = (th) => state.theories.has(th);
const t = (k) => I18N[state.lang][k];
const LOCALE = () => (state.lang === "zh" ? "zh-CN" : "en-US");
const labelOf = (s) => (typeof s.label === "string" ? s.label : s.label[state.lang]);
const colorMode = () => state.colors || (state.lang === "zh" ? "red-up" : "green-up");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function palette() {
  const green = "#16a34a", red = "#dc2626";
  const [up, down] = colorMode() === "red-up" ? [red, green] : [green, red];
  return { up, down, bg: css("--panel"), text: css("--muted"), grid: css("--line"), accent: css("--accent"), ink: css("--ink"),
           vwap: "#f59e0b", poc: "#8b5cf6", stroke: "#0891b2", segment: "#db2777", pivot: "#0891b2", ema: "#0d9488", zone: "#a16207" };
}
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");

// Lightweight Charts renders UTC; shift epoch seconds so the axis shows the viewer's local time.
const toLocal = (sec) => sec - new Date(sec * 1000).getTimezoneOffset() * 60;
const toDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const chartTime = (sec, interval) => (interval === "1d" ? toDay(sec) : toLocal(sec));
const timeKey = (tm) => (typeof tm === "object" ? `${tm.year}-${String(tm.month).padStart(2, "0")}-${String(tm.day).padStart(2, "0")}` : String(tm));

function etToEpoch(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "09:30").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return (guess + (guess - wall)) / 1000;
}

const precisionFor = (price) => (price >= 1 ? 2 : price >= 0.01 ? 4 : 6);
const fmtNum = (n, p = 2) => (n == null || Number.isNaN(n) ? "–" : n.toLocaleString(LOCALE(), { minimumFractionDigits: p, maximumFractionDigits: p }));
const fmtVol = (v) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return s + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(a < 10 ? 2 : 0));
};
const fmtPct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

// ---------- data sources ----------
async function binanceBars(sym, interval) {
  const r = await fetch(`${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=500`);
  if (!r.ok) throw new Error("binance " + r.status);
  // [openTime, o, h, l, c, volume, closeTime, quoteVol, trades, takerBuyBase, ...]
  return (await r.json()).map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], buy: +k[9] }));
}
async function binance24h(sym) {
  const r = await fetch(`${BINANCE_REST}/ticker/24hr?symbol=${sym}`);
  if (!r.ok) throw new Error("binance " + r.status);
  const j = await r.json();
  return { price: +j.lastPrice, ref: +j.openPrice };
}
async function yahooData(sym, interval) {
  const r = await fetch(`/api/kline?symbol=${encodeURIComponent(sym)}&interval=${interval}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

// ---------- panel ----------
class Panel {
  constructor(group) {
    this.g = group;
    this.selected = load(`mc.sym.${group.key}`, group.symbols[0].id);
    this.extra = load(`mc.extra.${group.key}`, []);
    this.priceLines = [];
    this.el = document.createElement("section");
    this.el.className = "mkt-panel";
    $("#panels").appendChild(this.el);
    this.renderShell();
    this.buildCharts();
    this.applyTheme();
  }

  get symbols() { return [...this.g.symbols, ...this.extra.map((s) => ({ id: s, label: s, src: "yahoo", sym: s }))]; }
  get sym() { return this.symbols.find((s) => s.id === this.selected) || this.symbols[0]; }

  renderShell() {
    this.el.innerHTML = `
      <div class="mkt-head">
        <h2>${esc(t(this.g.key))}</h2>
        <div class="sym-chips" role="tablist"></div>
        ${this.g.search ? `<form class="sym-search"><input maxlength="12" placeholder="${esc(t("search"))}" aria-label="${esc(t("search"))}" /><button class="btn ghost">${esc(t("go"))}</button></form>` : ""}
      </div>
      <div class="quote">
        <span class="q-name"></span><span class="q-price"></span><span class="q-chg"></span><span class="q-ref"></span>
        <span class="status"><i></i><span></span></span>
      </div>
      <div class="chart-wrap"><div class="chart"></div><canvas class="overlay-canvas"></canvas><div class="ohlc"></div></div>
      <div class="sub-wrap" data-pane="of"><div class="sub-chart"></div><div class="sub-legend"><span class="dl-a">${t("delta")}</span> <span class="dl-b">${t("cvd")}</span></div></div>
      <div class="sub-wrap" data-pane="chan"><div class="sub-chart"></div><div class="sub-legend"><span class="dl-a">${t("macd")}</span> <span class="dl-b"></span></div></div>
      <div class="of-card"></div>
      <div class="upcoming"><h4>${esc(t("upcoming"))}</h4><div class="up-list"></div></div>`;
    this.renderChips();
    const form = $(".sym-search", this.el);
    if (form) form.onsubmit = (ev) => {
      ev.preventDefault();
      const v = form.querySelector("input").value.trim().toUpperCase();
      if (!/^[A-Z0-9.^=-]{1,12}$/.test(v)) return;
      if (!this.symbols.some((s) => s.id === v)) { this.extra = [...this.extra, v].slice(-6); save(`mc.extra.${this.g.key}`, this.extra); }
      form.reset();
      this.select(v);
    };
  }

  buildCharts() {
    const LC = LightweightCharts;
    this.chart = LC.createChart($(".chart", this.el), {
      autoSize: true,
      crosshair: { mode: LC.CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 6 },
      rightPriceScale: { minimumWidth: SCALE_WIDTH },
    });
    this.candles = this.chart.addCandlestickSeries({ borderVisible: false });
    this.candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    this.volume = this.chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const line = (opts) => this.chart.addLineSeries({ lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...opts });
    // Order flow
    this.vwapLine = line({ lineWidth: 2 });
    this.bands = [1, 1, 2, 2].map((k) => line({ lineWidth: 1, lineStyle: k === 1 ? 2 : 1 }));
    // Chan Lun: strokes (笔) and segments (线段) as zig-zags through the fractal vertices
    this.strokeLine = line({ lineWidth: 1 });
    this.segmentLine = line({ lineWidth: 3 });
    // Price action: 20 EMA
    this.emaLine = line({ lineWidth: 2, lineStyle: 0 });

    const sub = (host) => LC.createChart(host, {
      autoSize: true,
      timeScale: { visible: false, rightOffset: 6 },
      rightPriceScale: { minimumWidth: SCALE_WIDTH, scaleMargins: { top: 0.1, bottom: 0.1 } },
      crosshair: { mode: LC.CrosshairMode.Normal, horzLine: { visible: false, labelVisible: false } },
      handleScale: false, handleScroll: false,
    });
    const [ofHost, chanHost] = this.el.querySelectorAll(".sub-chart");
    this.ofPane = sub(ofHost);
    this.deltaSeries = this.ofPane.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    this.cvdSeries = this.ofPane.addLineSeries({ priceScaleId: "cvd", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.ofPane.priceScale("cvd").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    this.chanPane = sub(chanHost);
    this.macdHist = this.chanPane.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    this.difLine = this.chanPane.addLineSeries({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.deaLine = this.chanPane.addLineSeries({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.subs = [this.ofPane, this.chanPane];

    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) this.subs.forEach((s) => s.timeScale().setVisibleLogicalRange(r));
      this.requestOverlay();
    });
    this.chart.subscribeCrosshairMove((p) => this.onHover(p));
    new ResizeObserver(() => this.requestOverlay()).observe($(".chart", this.el));
  }

  renderChips() {
    $(".sym-chips", this.el).innerHTML = this.symbols.map((s) =>
      `<button class="chip ${s.id === this.sym.id ? "on" : ""}" data-sym="${esc(s.id)}">${esc(labelOf(s))}</button>`).join("");
    this.el.querySelectorAll(".sym-chips .chip").forEach((b) => { b.onclick = () => this.select(b.dataset.sym); });
  }

  select(id) {
    this.selected = id;
    save(`mc.sym.${this.g.key}`, id);
    this.renderChips();
    this.start();
  }

  applyTheme() {
    const p = palette();
    const base = {
      layout: { background: { type: "solid", color: p.bg }, textColor: p.text, fontFamily: "Inter, 'Noto Sans SC', system-ui, sans-serif" },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.grid },
      timeScale: { borderColor: p.grid },
      localization: { locale: LOCALE() },
    };
    this.chart.applyOptions(base);
    this.subs.forEach((s) => s.applyOptions({ ...base, timeScale: { visible: false } }));
    this.candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
    this.vwapLine.applyOptions({ color: p.vwap });
    this.bands.forEach((s, i) => s.applyOptions({ color: alpha(p.vwap, i < 2 ? 0.55 : 0.35) }));
    this.strokeLine.applyOptions({ color: p.stroke });
    this.segmentLine.applyOptions({ color: alpha(p.segment, 0.8) });
    this.emaLine.applyOptions({ color: p.ema });
    this.cvdSeries.applyOptions({ color: p.accent });
    this.difLine.applyOptions({ color: p.accent });
    this.deaLine.applyOptions({ color: p.vwap });
    if (this.bars) this.setBars(this.bars, true);
    this.renderQuote();
    this.applyVisibility();
  }

  applyVisibility() {
    [this.vwapLine, ...this.bands].forEach((s) => s.applyOptions({ visible: on("of") }));
    [this.strokeLine, this.segmentLine].forEach((s) => s.applyOptions({ visible: on("chan") }));
    this.emaLine.applyOptions({ visible: on("pa") });
    this.el.querySelectorAll(".sub-wrap").forEach((w) => { w.hidden = !on(w.dataset.pane); });
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this.analysisTimer);
    this.analysisTimer = null;
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    clearTimeout(this.reconnect);
  }

  async start() {
    this.stop();
    const run = (this.runId = Symbol());
    const s = this.sym;
    this.quote = null;
    this.bars = null;
    this.res = null;
    this.status("connecting");
    $(".q-name", this.el).textContent = labelOf(s);
    try {
      if (s.src === "binance") await this.startBinance(s, run);
      else await this.startYahoo(s.sym, run);
    } catch (err) {
      // Binance can be blocked in some regions: fall back to the server's Yahoo feed.
      if (s.src === "binance" && s.yahoo && run === this.runId) {
        try { await this.startYahoo(s.yahoo, run); return; } catch { /* fall through */ }
      }
      if (run === this.runId) { this.status("error"); console.warn(s.sym, err); }
    }
  }

  async startBinance(s, run) {
    const iv = state.interval;
    const [bars, tick] = await Promise.all([binanceBars(s.sym, iv), binance24h(s.sym)]);
    if (run !== this.runId) return;
    this.feed = { sessionOf: (b) => Math.floor(b.time / 86400), delayed: 0 };
    this.setBars(bars);
    this.quote = { price: tick.price, ref: tick.ref, refLabel: t("vs").crypto };
    this.renderQuote();
    const lower = s.sym.toLowerCase();
    const connect = () => {
      const ws = (this.ws = new WebSocket(`${BINANCE_WS}${lower}@kline_${iv}/${lower}@miniTicker`));
      ws.onopen = () => this.status("live");
      ws.onmessage = (msg) => {
        const { data } = JSON.parse(msg.data);
        if (data.e === "kline") {
          const k = data.k;
          this.upsert({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, buy: +k.V }, k.x);
        } else if (data.e === "24hrMiniTicker") {
          this.quote = { price: +data.c, ref: +data.o, refLabel: t("vs").crypto };
          this.renderQuote();
        }
      };
      ws.onclose = () => {
        if (run !== this.runId) return;
        this.status("connecting");
        this.reconnect = setTimeout(connect, 3000);
      };
    };
    connect();
  }

  async startYahoo(sym, run) {
    const iv = state.interval;
    const first = await yahooData(sym, iv);
    if (run !== this.runId) return;
    const off = first.gmtoffset || 0;
    this.feed = { sessionOf: (b) => Math.floor((b.time + off) / 86400), delayed: first.delayed_min || 0 };
    this.applyYahoo(first, true);
    this.timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const d = await yahooData(sym, iv);
        if (run === this.runId) this.applyYahoo(d, false);
      } catch { /* keep last data; next tick retries */ }
    }, POLL_MS);
  }

  applyYahoo(d, initial) {
    if (initial) {
      this.setBars(d.bars);
      if (this.extra.includes(this.sym.id)) $(".q-name", this.el).textContent = d.name;
    } else {
      const last = this.bars.at(-1)?.time ?? 0;
      const fresh = d.bars.filter((b) => b.time >= last);
      fresh.forEach((b, i) => this.upsert(b, i < fresh.length - 1));
    }
    this.quote = { price: d.price, ref: d.prev_close, refLabel: t("vs")["1d"], currency: d.currency };
    this.renderQuote();
    const ageMin = (Date.now() / 1000 - d.market_time) / 60;
    if (d.delayed_min) this.status("delayed", d.delayed_min);
    else if (ageMin > 20) this.status("closed", d.market_time);
    else this.status("polling");
  }

  setBars(bars, keepView) {
    this.bars = bars;
    const iv = state.interval;
    const p = palette();
    const prec = precisionFor(bars.at(-1)?.close ?? 1);
    this.prec = prec;
    const fmt = { priceFormat: { type: "price", precision: prec, minMove: 10 ** -prec } };
    [this.candles, this.vwapLine, ...this.bands, this.strokeLine, this.segmentLine, this.emaLine].forEach((s) => s.applyOptions(fmt));
    const range = keepView ? this.chart.timeScale().getVisibleLogicalRange() : null;
    this.candles.setData(bars.map((b) => ({ time: chartTime(b.time, iv), open: b.open, high: b.high, low: b.low, close: b.close })));
    this.volume.setData(bars.map((b) => ({ time: chartTime(b.time, iv), value: b.volume, color: alpha(b.close >= b.open ? p.up : p.down, 0.33) })));
    if (range) this.chart.timeScale().setVisibleLogicalRange(range);
    this.runAnalysis();
  }

  upsert(b, closed) {
    if (!this.bars) return;
    const last = this.bars.at(-1);
    if (last && b.time < last.time) return;
    if (last && b.time === last.time) this.bars[this.bars.length - 1] = b;
    else this.bars.push(b);
    const iv = state.interval;
    const p = palette();
    this.candles.update({ time: chartTime(b.time, iv), open: b.open, high: b.high, low: b.low, close: b.close });
    this.volume.update({ time: chartTime(b.time, iv), value: b.volume, color: alpha(b.close >= b.open ? p.up : p.down, 0.33) });
    if (this.quote) { this.quote.price = b.close; this.renderQuote(); }
    if (closed) this.runAnalysis();
    else if (!this.analysisTimer) this.analysisTimer = setTimeout(() => { this.analysisTimer = null; this.runAnalysis(); }, ANALYSIS_THROTTLE_MS);
  }

  // ----- analysis -----
  runAnalysis() {
    if (!this.bars?.length || !this.feed) { this.drawMarkers(); return; }
    const iv = state.interval;
    const bars = this.bars;
    const res = { combined: null };
    if (on("of")) {
      const profileBars = PROFILE_BARS[iv];
      let sessionOf = this.feed.sessionOf;
      if (iv === "1d") { // daily: anchor VWAP at the start of the profile window
        const anchor = bars[Math.max(0, bars.length - profileBars)].time;
        sessionOf = (b) => (b.time >= anchor ? 1 : 0);
      }
      res.of = OrderFlow.analyze(bars, { sessionOf, profileBars, delayed: this.feed.delayed > 0 });
      res.sessionOf = sessionOf;
      res.ofByTime = new Map(res.of.bars.map((b) => [timeKey(chartTime(b.time, iv)), b]));
    }
    if (on("chan")) res.chan = Chan.analyze(bars);
    if (on("pa")) res.pa = PriceAction.analyze(bars);
    const reads = [res.of?.read, res.chan?.read, res.pa?.read].filter(Boolean);
    if (state.theories.size) {
      res.combined = Combine.combine(reads, {
        price: bars.at(-1).close,
        atr: PriceAction.atr(bars),
        delayed: this.feed.delayed,
        estimatedDelta: !!res.of?.estimated,
      });
    }
    this.res = res;
    this.drawSeries();
    this.drawPriceLines();
    this.drawMarkers();
    this.renderAnalysis();
    this.requestOverlay();
  }

  drawSeries() {
    const r = this.res, iv = state.interval, p = palette();
    const T = (i) => chartTime(this.bars[i].time, iv);
    // Order flow: VWAP ± bands (whitespace at session ends so lines don't join across resets), delta/CVD.
    if (r.of) {
      const a = r.of, sess = r.sessionOf;
      [[this.vwapLine, 0], [this.bands[0], 1], [this.bands[1], -1], [this.bands[2], 2], [this.bands[3], -2]].forEach(([s, k]) => {
        s.setData(a.bars.map((b, i) => {
          const v = a.vw[i];
          const sessionEnd = i < a.bars.length - 1 && sess(a.bars[i + 1]) !== sess(b);
          return !v.vwap || sessionEnd ? { time: T(i) } : { time: T(i), value: v.vwap + k * v.sd };
        }));
      });
      this.deltaSeries.setData(a.bars.map((b, i) => ({ time: T(i), value: b.delta, color: alpha(b.delta >= 0 ? p.up : p.down, 0.75) })));
      this.cvdSeries.setData(a.bars.map((b, i) => ({ time: T(i), value: b.cvd })));
    } else [this.vwapLine, ...this.bands, this.deltaSeries, this.cvdSeries].forEach((s) => s.setData([]));
    // Chan: stroke and segment zig-zags; MACD pane.
    if (r.chan) {
      const c = r.chan;
      const zig = (pts) => {
        const out = [];
        for (const v of pts) { const time = T(v.idx); if (!out.length || timeKey(out.at(-1).time) !== timeKey(time)) out.push({ time, value: v.price }); }
        return out;
      };
      this.strokeLine.setData(zig(c.vertices));
      this.segmentLine.setData(zig(c.segments.length ? [c.segments[0].from, ...c.segments.map((s) => s.to)] : []));
      this.macdHist.setData(c.macd.map((m, i) => ({ time: T(i), value: m.hist, color: alpha(m.hist >= 0 ? p.up : p.down, 0.7) })));
      this.difLine.setData(c.macd.map((m, i) => ({ time: T(i), value: m.dif })));
      this.deaLine.setData(c.macd.map((m, i) => ({ time: T(i), value: m.dea })));
    } else [this.strokeLine, this.segmentLine, this.macdHist, this.difLine, this.deaLine].forEach((s) => s.setData([]));
    // Price action: 20 EMA.
    this.emaLine.setData(r.pa ? r.pa.ema20.map((v, i) => ({ time: T(i), value: v })) : []);
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (range) this.subs.forEach((s) => s.timeScale().setVisibleLogicalRange(range));
    this.renderSubLegends();
  }

  drawPriceLines() {
    this.priceLines.forEach((l) => this.candles.removePriceLine(l));
    this.priceLines = [];
    const r = this.res, p = palette(), L = I18N[state.lang];
    const pl = (price, color, title, style = 0, width = 1) => {
      if (price == null || !Number.isFinite(price)) return;
      this.priceLines.push(this.candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (r.of?.profile) {
      pl(r.of.profile.poc, p.poc, "POC", 0, 2);
      pl(r.of.profile.vah, alpha(p.poc, 0.8), "VAH", 2);
      pl(r.of.profile.val, alpha(p.poc, 0.8), "VAL", 2);
    }
    const pv = r.chan?.pivots.at(-1);
    if (pv) { pl(pv.zg, alpha(p.pivot, 0.9), "ZG", 2); pl(pv.zd, alpha(p.pivot, 0.9), "ZD", 2); }
    const c = r.combined;
    if (c && c.bias !== "wait") {
      pl(c.entry, p.accent, L.entry, 1, 2);
      pl(c.stop, "#ef4444", L.stop, 1, 2);
      c.targets.forEach((x, i) => pl(x, "#10b981", i ? L.t2 : L.t1, 1, 2));
    }
  }

  requestOverlay() {
    if (this.overlayRaf) return;
    this.overlayRaf = requestAnimationFrame(() => { this.overlayRaf = null; this.drawOverlay(); });
  }

  // Canvas overlay: volume profile (OF), pivot boxes (Chan), S/R zones and BOS/CHoCH lines (PA).
  drawOverlay() {
    const canvas = $(".overlay-canvas", this.el);
    const host = $(".chart", this.el);
    const w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const r = this.res;
    if (!r) return;
    const p = palette();
    const ts = this.chart.timeScale();
    const paneW = ts.width();
    const X = (i) => ts.logicalToCoordinate(i);
    const Y = (price) => this.candles.priceToCoordinate(price);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, paneW, h); ctx.clip();
    ctx.font = "11px Inter, 'Noto Sans SC', sans-serif";

    if (r.pa) {
      for (const z of r.pa.zones) {
        const y1 = Y(z.hi), y2 = Y(z.lo);
        if (y1 == null || y2 == null) continue;
        ctx.fillStyle = alpha(p.zone, 0.1);
        ctx.fillRect(0, Math.min(y1, y2), paneW, Math.abs(y2 - y1));
        ctx.fillStyle = alpha(p.zone, 0.9);
        ctx.fillText(`S/R ×${z.touches}`, 6, Math.min(y1, y2) + 11);
      }
      const recent = r.pa.events.slice(-3);
      for (const e of recent) {
        const x1 = X(e.from), x2 = X(e.idx), y = Y(e.level);
        if (x1 == null || x2 == null || y == null) continue;
        const col = e.dir === 1 ? p.up : p.down;
        ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.fillText(e.type, (x1 + x2) / 2 - 12, y + (e.dir === 1 ? -4 : 12));
      }
    }
    if (r.chan) {
      for (const pv of r.chan.pivots) {
        const x1 = X(pv.startIdx), x2 = X(pv.endIdx), y1 = Y(pv.zg), y2 = Y(pv.zd);
        if ([x1, x2, y1, y2].some((v) => v == null)) continue;
        ctx.fillStyle = alpha(p.pivot, 0.12);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeStyle = alpha(p.pivot, 0.7); ctx.lineWidth = 1;
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
      }
    }
    ctx.restore();

    const prof = r.of?.profile;
    if (prof) {
      const maxLen = paneW * 0.2;
      const maxTotal = Math.max(...prof.levels.map((L) => L.total));
      for (const L of prof.levels) {
        if (!L.total) continue;
        const y1 = Y(L.hi), y2 = Y(L.lo);
        if (y1 == null || y2 == null) continue;
        const top = Math.min(y1, y2), height = Math.max(1, Math.abs(y2 - y1) - 1);
        const len = (L.total / maxTotal) * maxLen;
        const inVA = L.lo >= prof.val - 1e-9 && L.hi <= prof.vah + 1e-9;
        const isPoc = prof.poc >= L.lo && prof.poc <= L.hi;
        const a = isPoc ? 0.75 : inVA ? 0.4 : 0.18;
        const sellLen = len * (L.sell / L.total);
        const x0 = paneW - len;
        ctx.fillStyle = alpha(p.down, a); ctx.fillRect(x0, top, sellLen, height);
        ctx.fillStyle = alpha(p.up, a); ctx.fillRect(x0 + sellLen, top, len - sellLen, height);
        if (isPoc) { ctx.strokeStyle = p.poc; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, top + 0.5, len - 1, height - 1); }
      }
    }
  }

  // Calendar events + each active theory's signals as chart markers.
  drawMarkers() {
    if (!this.bars?.length) return;
    const iv = state.interval, p = palette(), L = I18N[state.lang], r = this.res || {};
    const n = this.bars.length;
    const first = this.bars[0].time, end = this.bars.at(-1).time + INTERVAL_SEC[iv], now = Date.now() / 1000;
    this.eventAt = new Map();
    const markers = [];
    const mk = (idx, m) => markers.push({ raw: this.bars[idx].time, time: chartTime(this.bars[idx].time, iv), ...m });
    for (const e of state.events) {
      const m = e.impact.markets.find((x) => x.key === this.g.market);
      if (!m || m.level !== "high") continue;
      const ts = etToEpoch(e.date, e.time_et);
      if (ts < first || ts >= end || ts > now) continue;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.bars[mid].time <= ts) lo = mid; else hi = mid - 1; }
      const key = timeKey(chartTime(this.bars[lo].time, iv));
      if (this.eventAt.has(key)) { this.eventAt.get(key).push(e); continue; }
      this.eventAt.set(key, [e]);
      mk(lo, { position: "aboveBar", color: p.accent, shape: "arrowDown", text: SHORT[state.lang][e.type] || e.title });
    }
    if (r.of) {
      for (const s of r.of.signals) {
        mk(s.i, { position: s.side === "buy" ? "belowBar" : "aboveBar", color: s.side === "buy" ? p.up : p.down,
                  shape: s.type === "absorption" ? "circle" : s.side === "buy" ? "arrowUp" : "arrowDown",
                  text: L.sig[s.type], size: s.type === "absorption" ? 0.6 : 1 });
      }
    }
    if (r.chan) {
      for (const pt of r.chan.points) {
        const buy = pt.type.endsWith("B");
        mk(pt.idx, { position: buy ? "belowBar" : "aboveBar", color: buy ? p.up : p.down, shape: buy ? "arrowUp" : "arrowDown", text: L.chanPt[pt.type], size: 1.4 });
      }
    }
    if (r.pa) {
      for (const s of r.pa.swings.filter((x) => x.label).slice(-PA_LABEL_SWINGS)) {
        mk(s.idx, { position: s.type === "high" ? "aboveBar" : "belowBar", color: alpha(p.ink, 0.6), shape: "circle", size: 0.1, text: s.label });
      }
      for (const pt of r.pa.patterns.filter((x) => x.idx >= n - PA_PATTERN_BARS && x.dir !== 0 && x.zone)) {
        mk(pt.idx, { position: pt.dir > 0 ? "belowBar" : "aboveBar", color: pt.dir > 0 ? p.up : p.down, shape: "square", size: 0.5, text: L.pat[pt.name] });
      }
    }
    markers.sort((a, b) => a.raw - b.raw);
    this.candles.setMarkers(markers.map(({ raw, ...m }) => m));
  }

  renderAnalysis() {
    const card = $(".of-card", this.el);
    const L = I18N[state.lang];
    if (!state.theories.size) { card.innerHTML = `<p class="of-empty">${esc(L.pickTheory)}</p>`; return; }
    const r = this.res, c = r?.combined;
    if (!c) { card.innerHTML = r?.of && !r.of.hasVolume && state.theories.size === 1 ? `<p class="of-empty">${esc(L.noVolume)}</p>` : ""; return; }
    const prec = this.prec ?? 2;
    const f = (x) => fmtNum(x, prec);
    const fmtArgs = (args = {}) => Object.fromEntries(Object.entries(args).map(([k, x]) =>
      [k, typeof x !== "number" ? x : k === "pct" ? fmtPct(x) : k === "z" ? Math.abs(x).toFixed(1) : f(x)]));
    const notes = [];
    if (r.of) notes.push(r.of.hasVolume ? (r.of.estimated ? L.deltaEst : L.deltaReal) : L.noVolume);
    if (this.feed?.delayed) notes.push(L.delayedNote(this.feed.delayed));
    if (r.of) notes.push(L.profileOf(PROFILE_SPAN[state.lang][state.interval]));

    const plan = c.bias === "wait"
      ? `<div class="plan-row"><span>${esc(L.longAbove)}</span><b>${c.triggers.longAbove != null ? f(c.triggers.longAbove) : "–"}</b></div>
         <div class="plan-row"><span>${esc(L.shortBelow)}</span><b>${c.triggers.shortBelow != null ? f(c.triggers.shortBelow) : "–"}</b></div>`
      : `<div class="plan-row"><span>${esc(L.entry)} <small>${esc(c.atLevel ? L.entryNote[c.bias] : L.entryNote.mkt)}</small></span><b>${f(c.entry)}</b></div>
         <div class="plan-row stop"><span>${esc(L.stop)} ${c.stopFrom ? `<small>${esc(L.stopFrom(L.theoryShort[c.stopFrom]))}</small>` : ""}</span><b>${f(c.stop)}</b></div>
         ${c.targets.map((x, i) => `<div class="plan-row tgt"><span>${esc(i ? L.t2 : L.t1)}</span><b>${f(x)}</b></div>`).join("")}
         <div class="plan-row"><span>${esc(L.rr)}</span><b>${c.rr ? c.rr.toFixed(1) : "–"}</b></div>`;
    const agreeing = c.per.filter((x) => x.lean === c.bias).length;
    const groups = c.per.map((pt) => {
      const rs = c.reasons.filter((x) => x.theory === pt.theory);
      return `<div class="th-group">
        <div class="th-head"><span class="th-name">${esc(L.theory[pt.theory])}</span><span class="th-lean ${pt.lean}">${esc(L.bias[pt.lean])}</span><span class="th-norm">${pt.norm > 0 ? "+" : ""}${pt.norm.toFixed(2)}</span></div>
        <ul class="of-reasons">${rs.map((x) => `<li class="${x.sign > 0 ? "pos" : x.sign < 0 ? "neg" : "neu"}">${esc(L.R[x.key] ? L.R[x.key](fmtArgs(x.args)) : x.key)}</li>`).join("")}</ul>
      </div>`;
    }).join("");
    card.innerHTML = `
      <div class="of-head"><h4>${esc(L.readTitle(state.interval === "1d" ? "1D" : state.interval))}</h4>
        <span class="th-chips">${THEORIES.filter(on).map((th) => `<span class="th-chip ${th}">${esc(L.theory[th])}</span>`).join("")}</span></div>
      <div class="of-grid">
        <div class="of-bias ${c.bias}">
          <div class="bias-pill">${esc(L.bias[c.bias])}</div>
          <div class="bias-sub">${esc(c.conflict ? L.conflict : L.biasSub[c.bias])}</div>
          <div class="conf"><span>${esc(L.confidence)}</span><div class="conf-bar"><i style="width:${c.confidence}%"></i></div><b>${c.confidence}%</b></div>
          <div class="of-score">${esc(L.score)} ${c.mean > 0 ? "+" : ""}${c.mean.toFixed(2)}${c.bias !== "wait" && c.per.length > 1 ? ` · ${esc(L.agreeN(agreeing, c.per.length))}` : ""}</div>
        </div>
        <div class="of-plan">${plan}</div>
        <div class="th-groups">${groups}</div>
      </div>
      ${notes.length ? `<p class="of-note">${notes.map(esc).join(" · ")}</p>` : ""}`;
  }

  onHover(p) {
    const box = $(".ohlc", this.el);
    const d = p?.time !== undefined && p.seriesData.get(this.candles);
    for (const [pane, series] of [[this.ofPane, this.deltaSeries], [this.chanPane, this.macdHist]]) {
      try { if (p?.time !== undefined) pane.setCrosshairPosition(0, p.time, series); else pane.clearCrosshairPosition(); } catch { /* unsupported */ }
    }
    if (!d) { box.innerHTML = ""; this.renderSubLegends(); return; }
    const prec = precisionFor(d.close);
    const v = p.seriesData.get(this.volume)?.value;
    const key = timeKey(p.time);
    const evs = this.eventAt?.get(key) || [];
    const pal = palette();
    const col = d.close >= d.open ? pal.up : pal.down;
    box.innerHTML = `<span>${t("o")} <b style="color:${col}">${fmtNum(d.open, prec)}</b></span><span>${t("h")} <b style="color:${col}">${fmtNum(d.high, prec)}</b></span>` +
      `<span>${t("l")} <b style="color:${col}">${fmtNum(d.low, prec)}</b></span><span>${t("c")} <b style="color:${col}">${fmtNum(d.close, prec)}</b></span>` +
      (v ? `<span>${t("v")} <b>${fmtVol(v)}</b></span>` : "") +
      evs.map((e) => `<a class="ohlc-ev" href="/?event=${encodeURIComponent(e.id)}&lang=${state.lang}">◆ ${esc(e.title)}</a>`).join("");
    this.renderSubLegends(key, p.logical);
  }

  renderSubLegends(key, logical) {
    const pal = palette(), r = this.res;
    const [ofW, chanW] = this.el.querySelectorAll(".sub-wrap");
    const ofBar = r?.of && (key ? r.ofByTime.get(key) : r.of.bars.at(-1));
    $(".dl-a", ofW).innerHTML = ofBar ? `${t("delta")} <b style="color:${ofBar.delta >= 0 ? pal.up : pal.down}">${fmtVol(ofBar.delta)}</b>` : t("delta");
    $(".dl-b", ofW).innerHTML = ofBar ? `${t("cvd")} <b style="color:${pal.accent}">${fmtVol(ofBar.cvd)}</b>` : t("cvd");
    const m = r?.chan && r.chan.macd[logical != null && logical >= 0 ? Math.min(logical, r.chan.macd.length - 1) : r.chan.macd.length - 1];
    const dp = this.prec ?? 2;
    $(".dl-a", chanW).innerHTML = m ? `${t("macd")} <b style="color:${m.hist >= 0 ? pal.up : pal.down}">${fmtNum(m.hist, dp)}</b>` : t("macd");
    $(".dl-b", chanW).innerHTML = m ? `DIF <b style="color:${pal.accent}">${fmtNum(m.dif, dp)}</b> DEA <b style="color:${pal.vwap}">${fmtNum(m.dea, dp)}</b>` : "";
  }

  renderQuote() {
    const q = this.quote;
    if (!q) { $(".q-price", this.el).textContent = ""; $(".q-chg", this.el).textContent = ""; $(".q-ref", this.el).textContent = ""; return; }
    const prec = precisionFor(q.price);
    const chg = q.price - q.ref;
    const pct = (chg / q.ref) * 100;
    const pal = palette();
    $(".q-price", this.el).textContent = fmtNum(q.price, prec);
    const c = $(".q-chg", this.el);
    c.textContent = q.ref ? `${chg >= 0 ? "+" : ""}${fmtNum(chg, prec)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : "";
    c.style.color = chg >= 0 ? pal.up : pal.down;
    $(".q-ref", this.el).textContent = q.ref ? q.refLabel : "";
  }

  status(kind, arg) {
    const el = $(".status", this.el);
    el.className = "status " + kind;
    const fmtT = (sec) => new Date(sec * 1000).toLocaleString(LOCALE(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const text = { live: t("live"), polling: t("polling"), connecting: t("connecting"), error: t("error"),
      delayed: kind === "delayed" && t("delayed")(arg), closed: kind === "closed" && t("closed")(fmtT(arg)) }[kind];
    $("span", el).textContent = text;
  }

  renderUpcoming() {
    const today = new Date().toISOString().slice(0, 10);
    const list = state.events
      .filter((e) => e.date >= today)
      .map((e) => ({ e, m: e.impact.markets.find((x) => x.key === this.g.market) }))
      .filter(({ m }) => m && m.level === "high")
      .slice(0, 5);
    $(".up-list", this.el).innerHTML = list.length ? list.map(({ e, m }) => {
      const d = new Date(e.date + "T12:00:00");
      return `<a class="up-ev" href="/?event=${encodeURIComponent(e.id)}&lang=${state.lang}" title="${esc(m.text)}">
        <span class="up-date">${d.toLocaleDateString(LOCALE(), { month: "short", day: "numeric", weekday: "short" })}</span>
        <span class="up-title">${esc(e.title)}${e.confirmed ? "" : ' <span class="estimated">~</span>'}</span>
        <span class="up-why">${esc(m.text)}</span></a>`;
    }).join("") : `<p class="wk-empty">${esc(t("noUpcoming"))}</p>`;
  }

  destroy() {
    this.stop();
    this.chart.remove();
    this.subs.forEach((s) => s.remove());
  }
}

// ---------- page ----------
let panels = [];

async function loadEvents() {
  const days = state.interval === "1d" ? 760 : 100;
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  try {
    const r = await fetch(`/api/events?start=${start}&end=${end}&lang=${state.lang}`);
    state.events = (await r.json()).events;
  } catch { state.events = []; }
  panels.forEach((p) => { p.drawMarkers(); p.renderUpcoming(); });
}

function applyStaticText() {
  document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-theory]").forEach((b) => {
    $("span", b).textContent = t("theory")[b.dataset.theory];
    b.classList.toggle("on", on(b.dataset.theory));
    b.setAttribute("aria-pressed", String(on(b.dataset.theory)));
  });
  document.querySelectorAll(".lang-toggle .seg").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
  document.querySelectorAll("#intervals .seg").forEach((b) => b.classList.toggle("on", b.dataset.int === state.interval));
  document.querySelectorAll("#colorMode .seg").forEach((b) => b.classList.toggle("on", b.dataset.colors === colorMode()));
}

function build() {
  panels.forEach((p) => p.destroy());
  $("#panels").innerHTML = "";
  panels = GROUPS.map((g) => new Panel(g));
  panels.forEach((p) => p.start());
  loadEvents();
}

document.querySelectorAll(".lang-toggle .seg").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.lang === state.lang) return;
    state.lang = b.dataset.lang;
    save("mc.lang", state.lang);
    applyStaticText();
    build();
  };
});
document.querySelectorAll("#intervals .seg").forEach((b) => {
  b.onclick = () => {
    state.interval = b.dataset.int;
    save("mc.interval", state.interval);
    applyStaticText();
    panels.forEach((p) => p.start());
    loadEvents();
  };
});
document.querySelectorAll("#colorMode .seg").forEach((b) => {
  b.onclick = () => {
    state.colors = b.dataset.colors;
    save("mc.colors", state.colors);
    applyStaticText();
    panels.forEach((p) => p.applyTheme());
  };
});
document.querySelectorAll("[data-theory]").forEach((b) => {
  b.onclick = () => {
    const th = b.dataset.theory;
    if (on(th)) state.theories.delete(th); else state.theories.add(th);
    save("mc.theories", [...state.theories]);
    applyStaticText();
    panels.forEach((p) => { p.applyVisibility(); p.runAnalysis(); });
  };
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => panels.forEach((p) => p.applyTheme()));
document.addEventListener("visibilitychange", () => { if (!document.hidden) panels.filter((p) => p.timer).forEach((p) => p.start()); });

applyStaticText();
if (window.LightweightCharts && window.OrderFlow && window.Chan && window.PriceAction && window.Combine) build();
else $("#panels").innerHTML = `<div class="warn">Chart library failed to load.</div>`;
