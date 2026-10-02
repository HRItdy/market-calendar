"use strict";

// ---------- i18n ----------
const I18N = {
  en: {
    title: "Market Events Calendar",
    subtitle: "Scheduled events that move US stocks, with each one's likely impact",
    export: "⤓ Export .ics", exportTip: "Subscribe in Google/Apple/Outlook calendar",
    navCalendar: "Calendar", navMarkets: "Live markets",
    add: "+ Add event", weekAhead: "Week ahead", today: "Today",
    high: "High", medium: "Medium", low: "Low", month: "Month", list: "List",
    legendConfirmed: "confirmed date",
    legendEstimated: "estimated from the usual release pattern; check the agency calendar",
    legendTz: "All times US Eastern",
    disclaimer: "For education only, not investment advice. Typical moves are rough historical tendencies, not forecasts.",
    addTitle: "Add a custom event", fTitle: "Title", fTitlePh: "e.g. TSLA earnings", fDate: "Date", fTime: "Time (ET)",
    fImportance: "Importance", fUseTemplate: "Use template", fTemplate: "Impact template", fNone: "None (custom)",
    fDesc: "Description", optional: "Optional", fNotes: "Your impact notes", fNotesPh: "Optional: why it matters to you",
    cancel: "Cancel", save: "Save",
    quiet: "Quiet", closed: "Market closed", allDay: "All day", more: (n) => `+${n} more`, noEvents: "No events match the filters.",
    impact: (lvl) => `${lvl} impact`, et: "ET",
    estimatedNote: "<b>Estimated date.</b> This date follows the usual release pattern. Confirm it on the official agency calendar.",
    sWhat: "What it is", sWhy: "Why it moves markets", sMove: "Typical market reaction", sMarkets: "Impact across markets",
    sScen: "Scenarios", sAssets: "Assets affected", sSectors: "Most sensitive sectors", sWatch: "What to watch",
    sensitivity: { high: "High", medium: "Medium", low: "Low" },
    marketsHint: "How strongly each market usually reacts, and in which direction.",
    del: "Delete this custom event", delConfirm: "Delete this custom event?", loadFail: "Failed to load: ",
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  zh: {
    title: "美股市场事件日历",
    subtitle: "影响美股的重要定期事件及其潜在影响",
    export: "⤓ 导出 .ics", exportTip: "订阅到 Google/Apple/Outlook 日历",
    navCalendar: "事件日历", navMarkets: "实时行情",
    add: "+ 添加事件", weekAhead: "未来一周", today: "今天",
    high: "高", medium: "中", low: "低", month: "月视图", list: "列表",
    legendConfirmed: "日期已确认",
    legendEstimated: "根据惯常发布规律预估，请以官方日程为准",
    legendTz: "所有时间均为美国东部时间",
    disclaimer: "仅供学习参考，不构成投资建议。典型波动为历史大致规律，并非预测。",
    addTitle: "添加自定义事件", fTitle: "标题", fTitlePh: "例如：特斯拉财报", fDate: "日期", fTime: "时间（美东）",
    fImportance: "重要性", fUseTemplate: "使用模板", fTemplate: "影响模板", fNone: "无（自定义）",
    fDesc: "描述", optional: "选填", fNotes: "你的影响备注", fNotesPh: "选填：这件事对你为何重要",
    cancel: "取消", save: "保存",
    quiet: "平静", closed: "休市", allDay: "全天", more: (n) => `还有 ${n} 项`, noEvents: "没有符合筛选条件的事件。",
    impact: (lvl) => `${lvl}影响`, et: "美东",
    estimatedNote: "<b>预估日期。</b>该日期依据惯常发布规律推算，请以官方机构日程为准。",
    sWhat: "事件说明", sWhy: "为何影响市场", sMove: "典型市场反应", sMarkets: "跨市场影响",
    sScen: "情景分析", sAssets: "受影响资产", sSectors: "最敏感板块", sWatch: "关注要点",
    sensitivity: { high: "高", medium: "中", low: "低" },
    marketsHint: "各市场通常的敏感程度及反应方向。",
    del: "删除此自定义事件", delConfirm: "确定删除此自定义事件？", loadFail: "加载失败：",
    dow: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  },
};
const LOCALE = { en: "en-US", zh: "zh-CN" };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const MARKET_HOURS = new Set(["holiday", "early_close"]);
const MAX_PER_CELL = 4;

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

const initialLang = new URLSearchParams(location.search).get("lang")
  || load("mc.lang", null)
  || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");

const state = {
  cursor: (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); })(),
  view: load("mc.view", "month"),
  importance: new Set(load("mc.importance", ["high", "medium"])),
  lang: I18N[initialLang] ? initialLang : "en",
  events: [],
  risk: {},
  byId: new Map(),
  readOnly: false,
  openId: null,
};
const t = (key) => I18N[state.lang][key];
const fmtDate = (d, opts) => d.toLocaleDateString(LOCALE[state.lang], opts);
const fmtTime = (s) => {
  if (!s) return "";
  if (state.lang === "zh") return s;
  const [h, m] = s.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || r.statusText));
  }
  return r.status === 204 ? null : r.json();
}
const withLang = (path) => path + (path.includes("?") ? "&" : "?") + "lang=" + state.lang;

function applyStaticText() {
  document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll(".lang-toggle .seg").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
}

const visible = (e) => MARKET_HOURS.has(e.type) || state.importance.has(e.importance);

// ---------- week ahead ----------
async function renderWeek() {
  const today = new Date();
  const data = await api(withLang(`/api/week?start=${iso(today)}`));
  data.events.forEach((e) => state.byId.set(e.id, e));
  const strip = $("#weekStrip");
  strip.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const key = iso(d);
    const evs = data.events.filter((e) => e.date === key);
    const closed = evs.some((e) => e.type === "holiday") || d.getDay() % 6 === 0;
    const risk = data.risk[key]?.level;
    const div = document.createElement("div");
    div.className = `wk-day ${closed ? "closed" : risk ? "risk-" + risk : ""}`;
    div.innerHTML = `<div class="wk-head"><b>${fmtDate(d, { weekday: "short" })}</b><span>${fmtDate(d, { month: "short", day: "numeric" })}</span></div>`;
    if (!evs.length) div.insertAdjacentHTML("beforeend", `<div class="wk-empty">${closed ? t("closed") : t("quiet")}</div>`);
    for (const e of evs) {
      div.insertAdjacentHTML("beforeend",
        `<button class="wk-ev" data-id="${esc(e.id)}"><i class="dot ${e.importance}"></i> ${esc(e.title)}${e.time_et ? ` <span style="color:var(--muted)">${fmtTime(e.time_et)}</span>` : ""}</button>`);
    }
    strip.appendChild(div);
  }
}

// ---------- month / list ----------
function gridRange() {
  const first = state.cursor;
  const start = addDays(first, -first.getDay());
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = addDays(last, 6 - last.getDay());
  return [start, end];
}

async function loadMonth() {
  const [start, end] = gridRange();
  const data = await api(withLang(`/api/events?start=${iso(start)}&end=${iso(end)}`));
  state.events = data.events;
  state.risk = data.risk;
  data.events.forEach((e) => state.byId.set(e.id, e));
  $("#warnings").innerHTML = data.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  render();
}

function evChip(e) {
  return `<button class="ev ${e.importance}" data-id="${esc(e.id)}" title="${esc(e.title)}">` +
    (e.time_et ? `<span class="t">${fmtTime(e.time_et)}</span>` : "") +
    `<span>${esc(e.title)}</span>${e.confirmed ? "" : '<span class="est">~</span>'}</button>`;
}

function renderMonth() {
  const [start, end] = gridRange();
  const todayKey = iso(new Date());
  let html = t("dow").map((d) => `<div class="dow">${d}</div>`).join("");
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = iso(d);
    const evs = state.events.filter((e) => e.date === key && visible(e));
    const closed = evs.some((e) => e.type === "holiday");
    const risk = state.risk[key]?.level;
    const cls = ["cell",
      d.getMonth() !== state.cursor.getMonth() && "out",
      d.getDay() % 6 === 0 && "weekend",
      closed ? "closed" : risk && risk !== "low" && "risk-" + risk,
      key === todayKey && "today"].filter(Boolean).join(" ");
    html += `<div class="${cls}"><span class="num">${d.getDate()}</span>${evs.slice(0, MAX_PER_CELL).map(evChip).join("")}` +
      (evs.length > MAX_PER_CELL ? `<button class="more">${t("more")(evs.length - MAX_PER_CELL)}</button>` : "") + `</div>`;
  }
  $("#month").innerHTML = html;
}

function renderList() {
  const days = new Map();
  for (const e of state.events) {
    if (!visible(e) || parse(e.date).getMonth() !== state.cursor.getMonth()) continue;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  if (!days.size) { $("#list").innerHTML = `<p style="padding:16px;color:var(--muted)">${t("noEvents")}</p>`; return; }
  $("#list").innerHTML = [...days].map(([key, evs]) => {
    const d = parse(key);
    return `<div class="list-day"><div class="list-date">${fmtDate(d, { month: "short", day: "numeric" })}<small>${fmtDate(d, { weekday: "long" })}</small></div><div class="list-evs">` +
      evs.map((e) => `<div class="list-ev" data-id="${esc(e.id)}" tabindex="0" role="button">
        <span class="t">${e.time_et ? fmtTime(e.time_et) : t("allDay")}</span>
        <div><div class="ttl">${esc(e.title)} ${e.confirmed ? "" : '<span class="estimated">~</span>'}</div><div class="sum">${esc(e.impact.typical_move || e.impact.summary)}</div>${marketDots(e)}</div>
        <span class="badge ${e.importance}">${t(e.importance)}</span></div>`).join("") + `</div></div>`;
  }).join("");
}

// Compact per-market sensitivity row used in the list view.
function marketDots(e) {
  const ms = e.impact.markets || [];
  if (!ms.length) return "";
  return `<div class="mk-dots">${ms.map((m) => `<span class="mk-dot ${m.level}" title="${esc(m.name)}: ${esc(t("sensitivity")[m.level])}">${esc(m.name.split(" (")[0].split(" ")[0])}</span>`).join("")}</div>`;
}

function render() {
  $("#monthLabel").textContent = fmtDate(state.cursor, { month: "long", year: "numeric" });
  $("#month").hidden = state.view !== "month";
  $("#list").hidden = state.view !== "list";
  renderMonth();
  renderList();
  const imps = [...state.importance].map((i) => `importance=${i}`).join("&");
  $("#icsLink").href = `/api/calendar.ics?${imps}&lang=${state.lang}`;
}

// ---------- detail drawer ----------
function openDrawer(id) {
  const e = state.byId.get(id);
  if (!e) return;
  state.openId = id;
  const im = e.impact;
  const d = parse(e.date);
  const section = (title, body, extra = "") => (body ? `<div class="d-sec ${extra}"><h4>${title}</h4>${body}</div>` : "");
  const markets = im.markets?.length
    ? `<p class="hint">${t("marketsHint")}</p><div class="mk-grid">${im.markets.map((m) => `
        <div class="mk ${m.level}">
          <div class="mk-head"><b>${esc(m.name)}</b><span class="meter" aria-label="${esc(t("sensitivity")[m.level])}"><i></i><i></i><i></i></span><span class="mk-lvl">${esc(t("sensitivity")[m.level])}</span></div>
          <p>${esc(m.text)}</p>
        </div>`).join("")}</div>`
    : "";
  $("#drawerBody").innerHTML = `
    <h3 class="d-title">${esc(e.title)}</h3>
    <div class="d-meta">
      <span class="badge ${e.importance}">${esc(t("impact")(t(e.importance)))}</span>
      <span>${fmtDate(d, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}${e.time_et ? " · " + fmtTime(e.time_et) + " " + t("et") : ""}</span>
      <span>· ${esc(e.category)}</span>
    </div>
    ${e.confirmed ? "" : `<div class="note">${t("estimatedNote")}</div>`}
    ${e.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
    ${section(t("sWhat"), `<p>${esc(im.summary)}</p>`)}
    ${section(t("sWhy"), im.why && `<p>${esc(im.why)}</p>`)}
    ${section(t("sMove"), im.typical_move && `<p class="move">${esc(im.typical_move)}</p>`)}
    ${section(t("sMarkets"), markets)}
    ${section(t("sScen"), im.scenarios.length && `<div class="scen">${im.scenarios.map((s) => `<div><b>${esc(s.case)}</b>${esc(s.detail)}</div>`).join("")}</div>`)}
    ${section(t("sAssets"), Object.keys(im.assets).length && `<dl class="assets">${Object.entries(im.assets).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`)}
    ${section(t("sSectors"), im.sectors.length && `<div class="tags">${im.sectors.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>`)}
    ${section(t("sWatch"), im.watch.length && `<ul>${im.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`)}
    ${e.custom && !state.readOnly ? `<button class="btn ghost" id="delCustom" data-id="${esc(e.id)}">${t("del")}</button>` : ""}`;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  $("#closeDrawer").focus();
}

function closeDrawer() {
  state.openId = null;
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

// ---------- custom events ----------
async function setupDialog() {
  const cfg = await api("/api/config");
  state.readOnly = cfg.read_only;
  $("#addBtn").hidden = cfg.read_only;
  if (cfg.read_only) return;
  const types = await api(withLang("/api/event-types"));
  $("#templateSelect").innerHTML = `<option value="">${esc(t("fNone"))}</option>` +
    Object.entries(types).filter(([k]) => !["custom", "holiday", "early_close"].includes(k))
      .map(([k, p]) => `<option value="${k}">${esc(p.category)}: ${esc(p.summary.split(/[.(:（。：]/)[0])}</option>`).join("");
}

$("#addBtn").onclick = () => {
  $("#addForm").reset();
  $("#formError").textContent = "";
  $("#addForm").date.value = iso(new Date());
  $("#addDialog").showModal();
};

$("#addForm").addEventListener("submit", async (ev) => {
  if (ev.submitter?.value !== "ok") return;
  ev.preventDefault();
  const body = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v !== ""));
  try {
    await api("/api/custom-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    $("#addDialog").close();
    const d = parse(body.date);
    state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    await Promise.all([loadMonth(), renderWeek()]);
  } catch (err) {
    $("#formError").textContent = err.message;
  }
});

// ---------- language ----------
async function setLang(lang) {
  if (lang === state.lang) return;
  state.lang = lang;
  save("mc.lang", lang);
  applyStaticText();
  const reopen = state.openId;
  await Promise.all([loadMonth(), renderWeek(), setupDialog()]);
  if (reopen) openDrawer(reopen);
}
document.querySelectorAll(".lang-toggle .seg").forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });

// ---------- wiring ----------
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-id], .more, #delCustom");
  if (!el) return;
  if (el.id === "delCustom") {
    if (!confirm(t("delConfirm"))) return;
    await api(`/api/custom-events/${encodeURIComponent(el.dataset.id)}`, { method: "DELETE" });
    closeDrawer();
    await Promise.all([loadMonth(), renderWeek()]);
  } else if (el.classList.contains("more")) {
    state.view = "list"; syncViewButtons(); render();
  } else {
    openDrawer(el.dataset.id);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeDrawer();
  if (ev.key === "Enter" && ev.target.classList?.contains("list-ev")) openDrawer(ev.target.dataset.id);
});
$("#closeDrawer").onclick = closeDrawer;
$("#scrim").onclick = closeDrawer;

const shift = (n) => { state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + n, 1); loadMonth(); };
$("#prev").onclick = () => shift(-1);
$("#next").onclick = () => shift(1);
$("#today").onclick = () => { const d = new Date(); state.cursor = new Date(d.getFullYear(), d.getMonth(), 1); loadMonth(); };

document.querySelectorAll("#filters .chip").forEach((chip) => {
  chip.classList.toggle("on", state.importance.has(chip.dataset.imp));
  chip.onclick = () => {
    const imp = chip.dataset.imp;
    state.importance.has(imp) ? state.importance.delete(imp) : state.importance.add(imp);
    chip.classList.toggle("on", state.importance.has(imp));
    save("mc.importance", [...state.importance]);
    render();
  };
});

function syncViewButtons() {
  document.querySelectorAll(".view-toggle .seg").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  save("mc.view", state.view);
}
document.querySelectorAll(".view-toggle .seg").forEach((b) => { b.onclick = () => { state.view = b.dataset.view; syncViewButtons(); render(); }; });

// Deep link: /?event=<id> opens that event (e.g. /?event=fomc-2026-10-28); add &lang=zh for Chinese.
const deepLink = new URLSearchParams(location.search).get("event");
if (deepLink) {
  const m = deepLink.match(/(\d{4})-(\d{2})-\d{2}$/);
  if (m) state.cursor = new Date(+m[1], +m[2] - 1, 1);
}

applyStaticText();
syncViewButtons();
Promise.all([loadMonth(), renderWeek(), setupDialog()]).then(() => {
  if (deepLink) openDrawer(deepLink);
}).catch((err) => {
  $("#warnings").innerHTML = `<div class="warn">${esc(t("loadFail") + err.message)}</div>`;
});
