"use strict";

/* Live K-line (candlestick) panels for Web3, Gold and US stocks.
 * - Binance symbols stream tick-by-tick over WebSocket straight from the browser.
 * - Yahoo symbols (gold futures, US stocks) come via /api/kline and refresh every 10s.
 * - High-impact calendar events for each market are drawn on the chart as markers. */

const I18N = {
  en: {
    title: "Live Markets", subtitle: "Real-time K-lines with the calendar events that move them",
    navCalendar: "Calendar", navMarkets: "Live markets",
    greenUp: "Green up", redUp: "Red up",
    web3: "Web3", gold: "Gold", us: "US stocks",
    live: "Live", polling: "Live · 10s refresh", delayed: (m) => `Delayed ~${m} min`,
    closed: (t) => `Market closed · last ${t}`, connecting: "Connecting…", error: "Data unavailable",
    upcoming: "Upcoming events for this market", noUpcoming: "No high-sensitivity events in the next 30 days.",
    sens: { high: "High", medium: "Medium", low: "Low" },
    vs: { "1d": "vs prev. close", crypto: "24h" },
    search: "Ticker, e.g. AMD", go: "Add",
    o: "O", h: "H", l: "L", c: "C", v: "Vol",
    legendMarker: "Past high-impact events for that market (data-release dates are estimated and may be off by a few days)",
    legendTime: "Chart times are in your local time zone",
    disclaimer: "For education only, not investment advice. Crypto data from Binance; gold futures and US stocks from Yahoo Finance.",
  },
  zh: {
    title: "实时行情", subtitle: "实时K线，并标注影响行情的日历事件",
    navCalendar: "事件日历", navMarkets: "实时行情",
    greenUp: "绿涨红跌", redUp: "红涨绿跌",
    web3: "Web3", gold: "黄金", us: "美股",
    live: "实时", polling: "实时 · 每10秒刷新", delayed: (m) => `延迟约${m}分钟`,
    closed: (t) => `已休市 · 最后更新 ${t}`, connecting: "连接中…", error: "数据暂不可用",
    upcoming: "该市场即将到来的事件", noUpcoming: "未来30天没有高敏感度事件。",
    sens: { high: "高", medium: "中", low: "低" },
    vs: { "1d": "较前收盘", crypto: "24小时" },
    search: "代码，如 AMD", go: "添加",
    o: "开", h: "高", l: "低", c: "收", v: "量",
    legendMarker: "该市场过往的高影响事件（数据发布日期为预估，可能有几天偏差）",
    legendTime: "图表时间为你的本地时区",
    disclaimer: "仅供学习参考，不构成投资建议。加密货币数据来自币安；黄金期货和美股数据来自雅虎财经。",
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
const INTERVAL_SEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

const initialLang = new URLSearchParams(location.search).get("lang") || load("mc.lang", null)
  || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");
const state = {
  lang: I18N[initialLang] ? initialLang : "en",
  interval: (() => {
    const q = new URLSearchParams(location.search).get("interval");
    return q in INTERVAL_SEC ? q : load("mc.interval", "5m");
  })(),
  colors: load("mc.colors", null), // null → follow language convention
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
  return { up, down, bg: css("--panel"), text: css("--muted"), grid: css("--line"), accent: css("--accent") };
}

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
const fmtVol = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v)));

// ---------- data sources ----------
async function binanceBars(sym, interval) {
  const r = await fetch(`${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=500`);
  if (!r.ok) throw new Error("binance " + r.status);
  return (await r.json()).map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
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
    this.el = document.createElement("section");
    this.el.className = "mkt-panel";
    $("#panels").appendChild(this.el);
    this.renderShell();
    this.chart = LightweightCharts.createChart($(".chart", this.el), {
      autoSize: true,
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { locale: LOCALE() },
    });
    this.candles = this.chart.addCandlestickSeries({ borderVisible: false });
    this.candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    this.volume = this.chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    this.chart.subscribeCrosshairMove((p) => this.onHover(p));
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
      <div class="chart-wrap"><div class="chart"></div><div class="ohlc"></div></div>
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
    this.chart.applyOptions({
      layout: { background: { type: "solid", color: p.bg }, textColor: p.text, fontFamily: "Inter, 'Noto Sans SC', system-ui, sans-serif" },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.grid },
      timeScale: { borderColor: p.grid },
      localization: { locale: LOCALE() },
    });
    this.candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
    if (this.bars) this.setBars(this.bars, true);
    this.renderQuote();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    clearTimeout(this.reconnect);
  }

  async start() {
    this.stop();
    const run = (this.runId = Symbol());
    const s = this.sym;
    this.quote = null;
    this.bars = null;
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
          this.upsert({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
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
      if (this.sym.src === "yahoo" && this.extra.includes(this.sym.id)) $(".q-name", this.el).textContent = d.name;
    } else {
      const last = this.bars.at(-1)?.time ?? 0;
      d.bars.filter((b) => b.time >= last).forEach((b) => this.upsert(b));
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
    const price = bars.at(-1)?.close ?? 1;
    const prec = precisionFor(price);
    this.candles.applyOptions({ priceFormat: { type: "price", precision: prec, minMove: 10 ** -prec } });
    const range = keepView ? this.chart.timeScale().getVisibleLogicalRange() : null;
    this.candles.setData(bars.map((b) => ({ ...b, time: chartTime(b.time, iv) })));
    this.volume.setData(bars.map((b) => ({ time: chartTime(b.time, iv), value: b.volume, color: (b.close >= b.open ? p.up : p.down) + "55" })));
    if (range) this.chart.timeScale().setVisibleLogicalRange(range);
    this.drawMarkers();
  }

  upsert(b) {
    if (!this.bars) return;
    const last = this.bars.at(-1);
    if (last && b.time < last.time) return;
    if (last && b.time === last.time) this.bars[this.bars.length - 1] = b;
    else this.bars.push(b);
    const iv = state.interval;
    const p = palette();
    this.candles.update({ ...b, time: chartTime(b.time, iv) });
    this.volume.update({ time: chartTime(b.time, iv), value: b.volume, color: (b.close >= b.open ? p.up : p.down) + "55" });
    if (!this.quote) return;
    this.quote.price = b.close;
    this.renderQuote();
  }

  // Events for this market with high sensitivity, as markers on the bar they happened in.
  drawMarkers() {
    if (!this.bars?.length) return;
    const iv = state.interval;
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
      // Snap to the last bar starting at or before the event.
      let lo = 0, hi = this.bars.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.bars[mid].time <= ts) lo = mid; else hi = mid - 1; }
      const time = chartTime(this.bars[lo].time, iv);
      const key = timeKey(time);
      if (this.eventAt.has(key)) { this.eventAt.get(key).push(e); continue; }
      this.eventAt.set(key, [e]);
      markers.push({ time, position: "aboveBar", color: css("--accent"), shape: "arrowDown", text: SHORT[state.lang][e.type] || e.title });
    }
    markers.sort((a, b) => (a.time < b.time ? -1 : 1));
    this.candles.setMarkers(markers);
  }

  onHover(p) {
    const box = $(".ohlc", this.el);
    const d = p?.time !== undefined && p.seriesData.get(this.candles);
    if (!d) { box.innerHTML = ""; return; }
    const prec = precisionFor(d.close);
    const v = p.seriesData.get(this.volume)?.value;
    const evs = this.eventAt?.get(timeKey(p.time)) || [];
    const pal = palette();
    const col = d.close >= d.open ? pal.up : pal.down;
    box.innerHTML = `<span>${t("o")} <b style="color:${col}">${fmtNum(d.open, prec)}</b></span><span>${t("h")} <b style="color:${col}">${fmtNum(d.high, prec)}</b></span>` +
      `<span>${t("l")} <b style="color:${col}">${fmtNum(d.low, prec)}</b></span><span>${t("c")} <b style="color:${col}">${fmtNum(d.close, prec)}</b></span>` +
      (v ? `<span>${t("v")} <b>${fmtVol(v)}</b></span>` : "") +
      evs.map((e) => `<a class="ohlc-ev" href="/?event=${encodeURIComponent(e.id)}&lang=${state.lang}">◆ ${esc(e.title)}</a>`).join("");
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
}

function build() {
  panels.forEach((p) => { p.stop(); p.chart.remove(); });
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
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => panels.forEach((p) => p.applyTheme()));
// Refresh Yahoo panels promptly when the tab becomes visible again.
document.addEventListener("visibilitychange", () => { if (!document.hidden) panels.filter((p) => p.timer).forEach((p) => p.start()); });

applyStaticText();
if (window.LightweightCharts) build();
else $("#panels").innerHTML = `<div class="warn">Chart library failed to load.</div>`;
