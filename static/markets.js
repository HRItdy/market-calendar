"use strict";

/* Live K-line (candlestick) panels for Web3, Gold and US stocks, with an order-flow layer.
 * - Binance symbols stream tick-by-tick over WebSocket straight from the browser, including
 *   taker-buy volume, so delta/CVD are real aggressor data.
 * - Yahoo symbols (gold futures, US stocks) come via /api/kline and refresh every 10s; their
 *   delta is estimated from candle shape (no aggressor data on that feed).
 * - Order flow (static/orderflow.js): volume profile (POC/VAH/VAL), session VWAP ±σ, delta + CVD
 *   pane, absorption/divergence markers, and a rule-based buy/sell/wait read with levels.
 * - High-impact calendar events for each market are drawn on the chart as markers. */

const I18N = {
  en: {
    title: "Live Markets", subtitle: "Real-time K-lines with order flow and the calendar events that move them",
    navCalendar: "Calendar", navMarkets: "Live markets",
    greenUp: "Green up", redUp: "Red up", orderFlow: "Order flow",
    web3: "Web3", gold: "Gold", us: "US stocks",
    live: "Live", polling: "Live · 10s refresh", delayed: (m) => `Delayed ~${m} min`,
    closed: (t) => `Market closed · last ${t}`, connecting: "Connecting…", error: "Data unavailable",
    upcoming: "Upcoming events for this market", noUpcoming: "No high-sensitivity events in the next 30 days.",
    vs: { "1d": "vs prev. close", crypto: "24h" },
    search: "Ticker, e.g. AMD", go: "Add",
    o: "O", h: "H", l: "L", c: "C", v: "Vol", delta: "Δ", cvd: "CVD",
    legendMarker: "Past high-impact events for that market (data-release dates are estimated and may be off by a few days)",
    legendTime: "Chart times are in your local time zone",
    disclaimer: "For education only, not investment advice. The order-flow read is a rule-based model, not a prediction; markets can ignore every level. Crypto data from Binance; gold futures and US stocks from Yahoo Finance.",
    ofTitle: (iv) => `Order-flow read · ${iv}`,
    bias: { buy: "BUY", sell: "SELL", wait: "WAIT" },
    biasSub: { buy: "Long bias", sell: "Short bias", wait: "No edge: let price come to a level" },
    confidence: "Confidence", score: "Score",
    entry: "Entry", stop: "Stop", t1: "Target 1", t2: "Target 2", rr: "R:R",
    entryNote: { pull: "pullback to support", mkt: "at market" },
    entrySell: { pull: "rally into resistance", mkt: "at market" },
    longAbove: "Long on acceptance above VAH", shortBelow: "Short on acceptance below VAL", magnet: "POC magnet",
    profileOf: (p) => `Volume profile: last ${p}`,
    deltaReal: "Delta: real taker buy/sell volume (Binance)",
    deltaEst: "Delta: estimated from candle shape; this feed has no buy/sell split, so treat signals as weaker",
    delayedNote: (m) => `Data is delayed ~${m} min; levels may already have been tested`,
    noVolume: "This symbol has no volume data, so order-flow analysis isn't available.",
    sig: { absorption: "Abs", divergence: "Div" },
    R: {
      aboveVwap: ({ vwap }) => `Price is above session VWAP (${vwap}): buyers hold the session average.`,
      belowVwap: ({ vwap }) => `Price is below session VWAP (${vwap}): sellers hold the session average.`,
      stretchedUp: ({ z }) => `Price is ${z}σ above VWAP: stretched; responsive sellers often fade moves this far.`,
      stretchedDown: ({ z }) => `Price is ${z}σ below VWAP: stretched; responsive buyers often step in this far out.`,
      aboveValue: ({ vah }) => `Trading above value (VAH ${vah}): acceptance up here means initiative buyers are in control.`,
      belowValue: ({ val }) => `Trading below value (VAL ${val}): acceptance down here means initiative sellers are in control.`,
      insideValue: ({ val, vah, poc }) => `Inside value (${val}–${vah}): rotational trade; the edges tend to reject back toward POC ${poc}.`,
      cvdConfirmUp: ({ pct }) => `Price up with rising CVD (net ${pct} of volume bought aggressively): buyers confirm the move.`,
      cvdConfirmDown: ({ pct }) => `Price down with falling CVD (net ${pct} of volume sold aggressively): sellers confirm the move.`,
      cvdDivergeUp: () => "Price rose but CVD fell: the rally isn't backed by aggressive buyers (passive bids / short covering), so follow-through is less reliable.",
      cvdDivergeDown: () => "Price fell but CVD rose: the drop isn't driven by aggressive sellers, so downside follow-through is less reliable.",
      cvdFlat: () => "CVD is flat: neither side is pressing with market orders.",
      absorption_buy: () => "Recent bullish absorption: heavy aggressive selling failed to push price lower (passive buyers absorbing).",
      absorption_sell: () => "Recent bearish absorption: heavy aggressive buying failed to lift price (passive sellers absorbing).",
      divergence_buy: () => "Recent bullish delta divergence: a new low without new selling pressure in CVD (seller exhaustion).",
      divergence_sell: () => "Recent bearish delta divergence: a new high without new buying pressure in CVD (buyer exhaustion).",
      buyersAggressive: ({ pct }) => `Last 5 bars: buyers aggressive (net delta ${pct}).`,
      sellersAggressive: ({ pct }) => `Last 5 bars: sellers aggressive (net delta ${pct}).`,
    },
  },
  zh: {
    title: "实时行情", subtitle: "实时K线、订单流分析，并标注影响行情的日历事件",
    navCalendar: "事件日历", navMarkets: "实时行情",
    greenUp: "绿涨红跌", redUp: "红涨绿跌", orderFlow: "订单流",
    web3: "Web3", gold: "黄金", us: "美股",
    live: "实时", polling: "实时 · 每10秒刷新", delayed: (m) => `延迟约${m}分钟`,
    closed: (t) => `已休市 · 最后更新 ${t}`, connecting: "连接中…", error: "数据暂不可用",
    upcoming: "该市场即将到来的事件", noUpcoming: "未来30天没有高敏感度事件。",
    vs: { "1d": "较前收盘", crypto: "24小时" },
    search: "代码，如 AMD", go: "添加",
    o: "开", h: "高", l: "低", c: "收", v: "量", delta: "Δ", cvd: "CVD",
    legendMarker: "该市场过往的高影响事件（数据发布日期为预估，可能有几天偏差）",
    legendTime: "图表时间为你的本地时区",
    disclaimer: "仅供学习参考，不构成投资建议。订单流解读基于规则模型，并非预测；市场可能无视任何价位。加密货币数据来自币安；黄金期货和美股数据来自雅虎财经。",
    ofTitle: (iv) => `订单流解读 · ${iv}`,
    bias: { buy: "做多", sell: "做空", wait: "观望" },
    biasSub: { buy: "偏多", sell: "偏空", wait: "暂无优势：等待价格到达关键位" },
    confidence: "置信度", score: "得分",
    entry: "入场", stop: "止损", t1: "目标1", t2: "目标2", rr: "盈亏比",
    entryNote: { pull: "回踩支撑", mkt: "市价" },
    entrySell: { pull: "反弹至阻力", mkt: "市价" },
    longAbove: "站稳VAH上方做多", shortBelow: "跌破VAL并站稳做空", magnet: "POC磁吸位",
    profileOf: (p) => `成交量分布：最近${p}`,
    deltaReal: "Delta：币安真实主动买卖量",
    deltaEst: "Delta：根据K线形态估算（该数据源无买卖拆分），信号可靠性较低",
    delayedNote: (m) => `数据延迟约${m}分钟，价位可能已被测试`,
    noVolume: "该品种没有成交量数据，无法进行订单流分析。",
    sig: { absorption: "吸收", divergence: "背离" },
    R: {
      aboveVwap: ({ vwap }) => `价格位于当日VWAP（${vwap}）上方：买方掌控当日均价。`,
      belowVwap: ({ vwap }) => `价格位于当日VWAP（${vwap}）下方：卖方掌控当日均价。`,
      stretchedUp: ({ z }) => `价格高于VWAP ${z}σ：偏离过大，回应型卖方常在此处反向操作。`,
      stretchedDown: ({ z }) => `价格低于VWAP ${z}σ：偏离过大，回应型买方常在此处入场。`,
      aboveValue: ({ vah }) => `价格在价值区上方（VAH ${vah}）：若在此被接受，说明主动买方占优。`,
      belowValue: ({ val }) => `价格在价值区下方（VAL ${val}）：若在此被接受，说明主动卖方占优。`,
      insideValue: ({ val, vah, poc }) => `价格处于价值区内（${val}–${vah}）：震荡行情，边缘易被拒绝并回归POC ${poc}。`,
      cvdConfirmUp: ({ pct }) => `价格上涨且CVD上升（主动净买入占成交量${pct}）：买方确认上涨。`,
      cvdConfirmDown: ({ pct }) => `价格下跌且CVD下降（主动净卖出占成交量${pct}）：卖方确认下跌。`,
      cvdDivergeUp: () => "价格上涨但CVD下降：上涨并非由主动买盘推动（被动买单/空头回补），延续性较弱。",
      cvdDivergeDown: () => "价格下跌但CVD上升：下跌并非由主动卖盘推动，下行延续性较弱。",
      cvdFlat: () => "CVD走平：多空双方都没有用市价单主动推进。",
      absorption_buy: () => "近期出现看涨吸收：大量主动卖单未能压低价格（被动买方在吸收）。",
      absorption_sell: () => "近期出现看跌吸收：大量主动买单未能推高价格（被动卖方在吸收）。",
      divergence_buy: () => "近期出现看涨Delta背离：价格创新低但CVD未创新低（卖方衰竭）。",
      divergence_sell: () => "近期出现看跌Delta背离：价格创新高但CVD未创新高（买方衰竭）。",
      buyersAggressive: ({ pct }) => `最近5根K线：买方主动（净Delta ${pct}）。`,
      sellersAggressive: ({ pct }) => `最近5根K线：卖方主动（净Delta ${pct}）。`,
    },
  },
};

// Short marker labels per event type.
const SHORT = {
  en: { fomc: "FOMC", fomc_sep: "FOMC", fomc_minutes: "Minutes", cpi: "CPI", ppi: "PPI", pce: "PCE", nfp: "NFP", jolts: "JOLTS",
        retail: "Retail", gdp: "GDP", ism_mfg: "ISM", ism_svc: "ISM", earnings_megacap: "Big Tech", earnings_nvda: "NVDA",
        earnings_banks: "Banks", jackson_hole: "J. Hole", election: "Election", refunding: "Refunding", umich: "UMich" },
  zh: { fomc: "议息", fomc_sep: "议息", fomc_minutes: "纪要", cpi: "CPI", ppi: "PPI", pce: "PCE", nfp: "非农", jolts: "JOLTS",
        retail: "零售", gdp: "GDP", ism_mfg: "ISM", ism_svc: "ISM", earnings_megacap: "科技财报", earnings_nvda: "英伟达",
        earnings_banks: "银行财报", jackson_hole: "央行年会", election: "选举", refunding: "再融资", umich: "密大" },
};

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
// How many bars the volume profile covers, and how that reads to a human.
const PROFILE_BARS = { "1m": 240, "5m": 288, "15m": 192, "1h": 168, "1d": 120 };
const PROFILE_SPAN = { en: { "1m": "4 hours", "5m": "24 hours", "15m": "2 days", "1h": "7 days", "1d": "120 days" },
                       zh: { "1m": "4小时", "5m": "24小时", "15m": "2天", "1h": "7天", "1d": "120天" } };
const SCALE_WIDTH = 78; // shared min price-scale width keeps the main and delta panes aligned

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

const params = new URLSearchParams(location.search);
const initialLang = params.get("lang") || load("mc.lang", null) || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");
const state = {
  lang: I18N[initialLang] ? initialLang : "en",
  interval: params.get("interval") in INTERVAL_SEC ? params.get("interval") : load("mc.interval", "5m"),
  colors: load("mc.colors", null), // null → follow language convention
  of: params.has("of") ? params.get("of") !== "0" : load("mc.of", true),
  events: [],
};
const t = (k) => I18N[state.lang][k];
const LOCALE = () => (state.lang === "zh" ? "zh-CN" : "en-US");
const labelOf = (s) => (typeof s.label === "string" ? s.label : s.label[state.lang]);
const colorMode = () => state.colors || (state.lang === "zh" ? "red-up" : "green-up");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function palette() {
  const green = "#16a34a", red = "#dc2626";
  const [up, down] = colorMode() === "red-up" ? [red, green] : [green, red];
  return { up, down, bg: css("--panel"), text: css("--muted"), grid: css("--line"), accent: css("--accent"),
           vwap: "#f59e0b", poc: "#8b5cf6", va: "#8b5cf6" };
}
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");

// Lightweight Charts renders UTC; shift epoch seconds so the axis shows the viewer's local time.
const toLocal = (sec) => sec - new Date(sec * 1000).getTimezoneOffset() * 60;
const toDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const chartTime = (sec, interval) => (interval === "1d" ? toDay(sec) : toLocal(sec));
// Crosshair events may report daily times as {year, month, day}; normalise to one key format.
const timeKey = (tm) => (typeof tm === "object" ? `${tm.year}-${String(tm.month).padStart(2, "0")}-${String(tm.day).padStart(2, "0")}` : String(tm));

// Convert an ET wall-clock date/time to a UTC epoch (DST-aware via Intl).
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

function precisionFor(price) {
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 6;
}
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
    this.extra = load(`mc.extra.${group.key}`, []); // user-added tickers (US panel)
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
      <div class="chart-wrap"><div class="chart"></div><canvas class="profile-canvas"></canvas><div class="ohlc"></div></div>
      <div class="delta-wrap"><div class="delta-chart"></div><div class="delta-legend"><span class="dl-delta">${t("delta")}</span> <span class="dl-cvd">${t("cvd")}</span></div></div>
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
    this.vwapLine = line({ lineWidth: 2 });
    this.bands = [1, 2].flatMap((k) => [line({ lineWidth: 1, lineStyle: k === 1 ? 2 : 1 }), line({ lineWidth: 1, lineStyle: k === 1 ? 2 : 1 })]);

    // Delta + CVD pane, kept in lockstep with the main chart's time axis.
    this.sub = LC.createChart($(".delta-chart", this.el), {
      autoSize: true,
      timeScale: { visible: false, rightOffset: 6 },
      rightPriceScale: { minimumWidth: SCALE_WIDTH, scaleMargins: { top: 0.1, bottom: 0.1 } },
      crosshair: { mode: LC.CrosshairMode.Normal, horzLine: { visible: false, labelVisible: false } },
      handleScale: false, handleScroll: false,
    });
    this.deltaSeries = this.sub.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    this.cvdSeries = this.sub.addLineSeries({ priceScaleId: "cvd", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.sub.priceScale("cvd").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) this.sub.timeScale().setVisibleLogicalRange(r);
      this.requestProfileDraw();
    });
    this.chart.subscribeCrosshairMove((p) => this.onHover(p));
    new ResizeObserver(() => this.requestProfileDraw()).observe($(".chart", this.el));
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
    this.sub.applyOptions({ ...base, timeScale: { visible: false } });
    this.candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
    this.vwapLine.applyOptions({ color: p.vwap });
    this.bands.forEach((s, i) => s.applyOptions({ color: alpha(p.vwap, i < 2 ? 0.55 : 0.35) }));
    this.cvdSeries.applyOptions({ color: p.accent });
    $(".dl-cvd", this.el).style.color = p.accent;
    if (this.bars) this.setBars(this.bars, true);
    this.renderQuote();
    this.applyOrderFlowVisibility();
  }

  applyOrderFlowVisibility() {
    const on = state.of;
    [this.vwapLine, ...this.bands].forEach((s) => s.applyOptions({ visible: on }));
    $(".delta-wrap", this.el).hidden = !on;
    $(".of-card", this.el).hidden = !on;
    $(".profile-canvas", this.el).hidden = !on;
    this.renderAnalysis();
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
    this.analysis = null;
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
    [this.candles, this.vwapLine, ...this.bands].forEach((s) => s.applyOptions(fmt));
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
    // Full re-analysis on bar close; throttled while the live bar is forming.
    if (closed) this.runAnalysis();
    else if (!this.analysisTimer) this.analysisTimer = setTimeout(() => { this.analysisTimer = null; this.runAnalysis(); }, ANALYSIS_THROTTLE_MS);
  }

  // ----- order flow -----
  runAnalysis() {
    if (!this.bars?.length || !this.feed) { this.drawMarkers(); return; }
    const iv = state.interval;
    const profileBars = PROFILE_BARS[iv];
    let sessionOf = this.feed.sessionOf;
    if (iv === "1d") { // daily: anchor VWAP at the start of the profile window
      const anchor = this.bars[Math.max(0, this.bars.length - profileBars)].time;
      sessionOf = (b) => (b.time >= anchor ? 1 : 0);
    }
    this.sessionOf = sessionOf;
    this.analysis = OrderFlow.analyze(this.bars, { sessionOf, profileBars, delayed: this.feed.delayed > 0 });
    this.byTime = new Map(this.analysis.bars.map((b) => [timeKey(chartTime(b.time, iv)), b]));
    this.drawOrderFlow();
    this.drawMarkers();
    this.renderAnalysis();
  }

  drawOrderFlow() {
    const a = this.analysis;
    if (!a) return;
    const iv = state.interval;
    const p = palette();
    const sess = this.sessionOf;
    // VWAP and bands; whitespace at session ends so lines don't join across resets.
    const series = [[this.vwapLine, 0], [this.bands[0], 1], [this.bands[1], -1], [this.bands[2], 2], [this.bands[3], -2]];
    for (const [s, k] of series) {
      s.setData(a.bars.map((b, i) => {
        const time = chartTime(b.time, iv);
        const v = a.vw[i];
        const sessionEnd = i < a.bars.length - 1 && sess(a.bars[i + 1]) !== sess(b);
        if (!v.vwap || sessionEnd) return { time };
        return { time, value: v.vwap + k * v.sd };
      }));
    }
    this.deltaSeries.setData(a.bars.map((b) => ({ time: chartTime(b.time, iv), value: b.delta, color: alpha(b.delta >= 0 ? p.up : p.down, 0.75) })));
    this.cvdSeries.setData(a.bars.map((b) => ({ time: chartTime(b.time, iv), value: b.cvd })));
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (r) this.sub.timeScale().setVisibleLogicalRange(r);
    this.renderDeltaLegend(a.bars.at(-1));

    // Profile + plan levels as price lines.
    this.priceLines.forEach((l) => this.candles.removePriceLine(l));
    this.priceLines = [];
    if (!state.of) { this.requestProfileDraw(); return; }
    const pl = (price, color, title, style = 0, width = 1) => {
      if (price == null || !Number.isFinite(price)) return;
      this.priceLines.push(this.candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (a.profile) {
      pl(a.profile.poc, p.poc, "POC", 0, 2);
      pl(a.profile.vah, alpha(p.va, 0.8), "VAH", 2);
      pl(a.profile.val, alpha(p.va, 0.8), "VAL", 2);
    }
    const s = a.suggestion;
    if (s && s.bias !== "wait") {
      const L = I18N[state.lang];
      pl(s.entry, p.accent, L.entry, 1, 2);
      pl(s.stop, "#ef4444", L.stop, 1, 2);
      s.targets.forEach((x, i) => pl(x, "#10b981", i ? L.t2 : L.t1, 1, 2));
    }
    this.requestProfileDraw();
  }

  requestProfileDraw() {
    if (this.profileRaf) return;
    this.profileRaf = requestAnimationFrame(() => { this.profileRaf = null; this.drawProfile(); });
  }

  // Volume-at-price histogram on the right of the plot, split into sell (left) and buy (right) volume.
  drawProfile() {
    const canvas = $(".profile-canvas", this.el);
    const host = $(".chart", this.el);
    const w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const prof = this.analysis?.profile;
    if (!state.of || !prof) return;
    const p = palette();
    const paneW = this.chart.timeScale().width();
    const maxLen = paneW * 0.2;
    const maxTotal = Math.max(...prof.levels.map((L) => L.total));
    for (const L of prof.levels) {
      if (!L.total) continue;
      const y1 = this.candles.priceToCoordinate(L.hi), y2 = this.candles.priceToCoordinate(L.lo);
      if (y1 == null || y2 == null) continue;
      const top = Math.min(y1, y2), height = Math.max(1, Math.abs(y2 - y1) - 1);
      const len = (L.total / maxTotal) * maxLen;
      const inVA = L.lo >= prof.val - 1e-9 && L.hi <= prof.vah + 1e-9;
      const isPoc = prof.poc >= L.lo && prof.poc <= L.hi;
      const a = isPoc ? 0.75 : inVA ? 0.4 : 0.18;
      const sellLen = len * (L.sell / L.total);
      const x0 = paneW - len;
      ctx.fillStyle = alpha(p.down, a);
      ctx.fillRect(x0, top, sellLen, height);
      ctx.fillStyle = alpha(p.up, a);
      ctx.fillRect(x0 + sellLen, top, len - sellLen, height);
      if (isPoc) { ctx.strokeStyle = p.poc; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, top + 0.5, len - 1, height - 1); }
    }
  }

  // Calendar events (high sensitivity for this market) + order-flow signals.
  drawMarkers() {
    if (!this.bars?.length) return;
    const iv = state.interval;
    const p = palette();
    const first = this.bars[0].time;
    const end = this.bars.at(-1).time + INTERVAL_SEC[iv];
    const now = Date.now() / 1000;
    this.eventAt = new Map();
    const markers = [];
    for (const e of state.events) {
      const m = e.impact.markets.find((x) => x.key === this.g.market);
      if (!m || m.level !== "high") continue;
      const ts = etToEpoch(e.date, e.time_et);
      if (ts < first || ts >= end || ts > now) continue;
      let lo = 0, hi = this.bars.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.bars[mid].time <= ts) lo = mid; else hi = mid - 1; }
      const raw = this.bars[lo].time;
      const time = chartTime(raw, iv);
      const key = timeKey(time);
      if (this.eventAt.has(key)) { this.eventAt.get(key).push(e); continue; }
      this.eventAt.set(key, [e]);
      markers.push({ raw, time, position: "aboveBar", color: p.accent, shape: "arrowDown", text: SHORT[state.lang][e.type] || e.title });
    }
    if (state.of && this.analysis) {
      for (const s of this.analysis.signals) {
        markers.push({
          raw: s.time,
          time: chartTime(s.time, iv),
          position: s.side === "buy" ? "belowBar" : "aboveBar",
          color: s.side === "buy" ? p.up : p.down,
          shape: s.type === "absorption" ? "circle" : s.side === "buy" ? "arrowUp" : "arrowDown",
          text: t("sig")[s.type],
          size: s.type === "absorption" ? 0.6 : 1,
        });
      }
    }
    markers.sort((a, b) => a.raw - b.raw);
    this.candles.setMarkers(markers.map(({ raw, ...m }) => m));
  }

  renderAnalysis() {
    const card = $(".of-card", this.el);
    const a = this.analysis;
    if (!state.of || !a) { card.innerHTML = ""; return; }
    const L = I18N[state.lang];
    const prec = this.prec ?? 2;
    const f = (x) => fmtNum(x, prec);
    if (!a.hasVolume || !a.suggestion) {
      card.innerHTML = `<p class="of-empty">${esc(L.noVolume)}</p>`;
      return;
    }
    const s = a.suggestion;
    const v = a.vw.at(-1);
    const fmtArgs = (args) => Object.fromEntries(Object.entries(args).map(([k, x]) => [k, k === "pct" ? fmtPct(x) : k === "z" ? Math.abs(x).toFixed(1) : f(x)]));
    const notes = [a.estimated ? L.deltaEst : L.deltaReal];
    if (this.feed?.delayed) notes.push(L.delayedNote(this.feed.delayed));
    const atMarket = Math.abs(s.entry - s.price) < 1e-12;
    const plan = s.bias === "wait"
      ? `<div class="plan-row"><span>${esc(L.longAbove)}</span><b>${f(s.triggers.longAbove)}</b></div>
         <div class="plan-row"><span>${esc(L.shortBelow)}</span><b>${f(s.triggers.shortBelow)}</b></div>
         <div class="plan-row"><span>${esc(L.magnet)}</span><b>${f(s.triggers.poc)}</b></div>`
      : `<div class="plan-row"><span>${esc(L.entry)} <small>${esc((s.bias === "buy" ? L.entryNote : L.entrySell)[atMarket ? "mkt" : "pull"])}</small></span><b>${f(s.entry)}</b></div>
         <div class="plan-row stop"><span>${esc(L.stop)}</span><b>${f(s.stop)}</b></div>
         ${s.targets.map((x, i) => `<div class="plan-row tgt"><span>${esc(i ? L.t2 : L.t1)}</span><b>${f(x)}</b></div>`).join("")}
         <div class="plan-row"><span>${esc(L.rr)}</span><b>${s.rr ? s.rr.toFixed(1) : "–"}</b></div>`;
    card.innerHTML = `
      <div class="of-head"><h4>${esc(L.ofTitle(state.interval === "1d" ? "1D" : state.interval))}</h4><span class="of-sub">${esc(L.profileOf(PROFILE_SPAN[state.lang][state.interval]))}</span></div>
      <div class="of-grid">
        <div class="of-bias ${s.bias}">
          <div class="bias-pill">${esc(L.bias[s.bias])}</div>
          <div class="bias-sub">${esc(L.biasSub[s.bias])}</div>
          <div class="conf"><span>${esc(L.confidence)}</span><div class="conf-bar"><i style="width:${s.confidence}%"></i></div><b>${s.confidence}%</b></div>
          <div class="of-score">${esc(L.score)} ${s.score > 0 ? "+" : ""}${s.score}</div>
        </div>
        <div class="of-plan">${plan}
          <div class="of-levels"><span class="lvl poc">POC ${f(a.profile.poc)}</span><span class="lvl va">VAH ${f(a.profile.vah)}</span><span class="lvl va">VAL ${f(a.profile.val)}</span>${v?.vwap ? `<span class="lvl vw">VWAP ${f(v.vwap)}</span>` : ""}</div>
        </div>
        <ul class="of-reasons">${s.reasons.map((r) => `<li class="${r.sign > 0 ? "pos" : r.sign < 0 ? "neg" : "neu"}">${esc(L.R[r.key](fmtArgs(r.args)))}</li>`).join("")}</ul>
      </div>
      <p class="of-note">${notes.map(esc).join(" · ")}</p>`;
  }

  onHover(p) {
    const box = $(".ohlc", this.el);
    const d = p?.time !== undefined && p.seriesData.get(this.candles);
    try {
      if (p?.time !== undefined) this.sub.setCrosshairPosition(0, p.time, this.deltaSeries);
      else this.sub.clearCrosshairPosition();
    } catch { /* not supported by this library version */ }
    if (!d) { box.innerHTML = ""; this.renderDeltaLegend(this.analysis?.bars.at(-1)); return; }
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
    this.renderDeltaLegend(this.byTime?.get(key));
  }

  renderDeltaLegend(b) {
    const pal = palette();
    const dl = $(".dl-delta", this.el), cl = $(".dl-cvd", this.el);
    if (!b) { dl.textContent = t("delta"); cl.textContent = t("cvd"); return; }
    dl.innerHTML = `${t("delta")} <b style="color:${b.delta >= 0 ? pal.up : pal.down}">${fmtVol(b.delta)}</b>`;
    cl.innerHTML = `${t("cvd")} <b>${fmtVol(b.cvd)}</b>`;
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
    this.sub.remove();
  }
}

// ---------- page ----------
let panels = [];

async function loadEvents() {
  // From the start of the longest chart history (1D ≈ 2 years) to 30 days ahead.
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
  document.querySelectorAll(".lang-toggle .seg").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
  document.querySelectorAll("#intervals .seg").forEach((b) => b.classList.toggle("on", b.dataset.int === state.interval));
  document.querySelectorAll("#colorMode .seg").forEach((b) => b.classList.toggle("on", b.dataset.colors === colorMode()));
  $("#ofToggle").classList.toggle("on", state.of);
  $("#ofToggle").setAttribute("aria-pressed", String(state.of));
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
$("#ofToggle").onclick = () => {
  state.of = !state.of;
  save("mc.of", state.of);
  applyStaticText();
  panels.forEach((p) => { p.applyOrderFlowVisibility(); p.drawOrderFlow(); p.drawMarkers(); });
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => panels.forEach((p) => p.applyTheme()));
// Refresh Yahoo panels promptly when the tab becomes visible again.
document.addEventListener("visibilitychange", () => { if (!document.hidden) panels.filter((p) => p.timer).forEach((p) => p.start()); });

applyStaticText();
if (window.LightweightCharts && window.OrderFlow) build();
else $("#panels").innerHTML = `<div class="warn">Chart library failed to load.</div>`;
