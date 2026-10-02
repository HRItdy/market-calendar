"use strict";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
};
const MARKET_HOURS = new Set(["holiday", "early_close"]);
const MAX_PER_CELL = 4;

const state = {
  cursor: (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); })(),
  view: "month",
  importance: new Set(["high", "medium"]),
  events: [],
  risk: {},
  byId: new Map(),
};

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || r.statusText));
  }
  return r.status === 204 ? null : r.json();
}

const visible = (e) => MARKET_HOURS.has(e.type) || state.importance.has(e.importance);

// ---------- week ahead ----------
async function renderWeek() {
  const today = new Date();
  const data = await api(`/api/week?start=${iso(today)}`);
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
    div.innerHTML = `<div class="wk-head"><b>${d.toLocaleDateString(undefined, { weekday: "short" })}</b><span>${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>`;
    if (!evs.length) div.insertAdjacentHTML("beforeend", `<div class="wk-empty">${closed ? "Market closed" : "Quiet"}</div>`);
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
  const data = await api(`/api/events?start=${iso(start)}&end=${iso(end)}`);
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
  const el = $("#month");
  let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = iso(d);
    const evs = state.events.filter((e) => e.date === key && visible(e));
    const closed = evs.some((e) => e.type === "holiday");
    const weekend = d.getDay() % 6 === 0;
    const risk = state.risk[key]?.level;
    const cls = ["cell",
      d.getMonth() !== state.cursor.getMonth() && "out",
      weekend && "weekend",
      closed ? "closed" : risk && risk !== "low" && "risk-" + risk,
      key === todayKey && "today"].filter(Boolean).join(" ");
    const shown = evs.slice(0, MAX_PER_CELL);
    html += `<div class="${cls}"><span class="num">${d.getDate()}</span>${shown.map(evChip).join("")}` +
      (evs.length > MAX_PER_CELL ? `<button class="more" data-day="${key}">+${evs.length - MAX_PER_CELL} more</button>` : "") + `</div>`;
  }
  el.innerHTML = html;
}

function renderList() {
  const days = new Map();
  for (const e of state.events) {
    if (!visible(e) || parse(e.date).getMonth() !== state.cursor.getMonth()) continue;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  if (!days.size) { $("#list").innerHTML = `<p style="padding:16px;color:var(--muted)">No events match the filters.</p>`; return; }
  $("#list").innerHTML = [...days].map(([key, evs]) => {
    const d = parse(key);
    return `<div class="list-day"><div class="list-date">${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}<small>${d.toLocaleDateString(undefined, { weekday: "long" })}</small></div><div class="list-evs">` +
      evs.map((e) => `<div class="list-ev" data-id="${esc(e.id)}" tabindex="0" role="button">
        <span class="t">${e.time_et ? fmtTime(e.time_et) : "All day"}</span>
        <div><div class="ttl">${esc(e.title)} ${e.confirmed ? "" : '<span class="estimated" title="Estimated date">~</span>'}</div><div class="sum">${esc(e.impact.typical_move || e.impact.summary)}</div></div>
        <span class="badge ${e.importance}">${e.importance}</span></div>`).join("") + `</div></div>`;
  }).join("");
}

function render() {
  $("#monthLabel").textContent = state.cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("#month").hidden = state.view !== "month";
  $("#list").hidden = state.view !== "list";
  renderMonth();
  renderList();
  const imps = [...state.importance].map((i) => `importance=${i}`).join("&");
  $("#icsLink").href = `/api/calendar.ics?${imps}`;
}

// ---------- detail drawer ----------
function openDrawer(id) {
  const e = state.byId.get(id);
  if (!e) return;
  const im = e.impact;
  const d = parse(e.date);
  const section = (title, body) => (body ? `<div class="d-sec"><h4>${title}</h4>${body}</div>` : "");
  $("#drawerBody").innerHTML = `
    <h3 class="d-title">${esc(e.title)}</h3>
    <div class="d-meta">
      <span class="badge ${e.importance}">${e.importance} impact</span>
      <span>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}${e.time_et ? " · " + fmtTime(e.time_et) + " ET" : ""}</span>
      <span>· ${esc(e.category)}</span>
    </div>
    ${e.confirmed ? "" : `<div class="note"><span class="estimated">Estimated date.</span> This date follows the usual release pattern. Confirm it on the official agency calendar.</div>`}
    ${e.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
    ${section("What it is", `<p>${esc(im.summary)}</p>`)}
    ${section("Why it moves markets", im.why && `<p>${esc(im.why)}</p>`)}
    ${section("Typical market reaction", im.typical_move && `<p class="move">${esc(im.typical_move)}</p>`)}
    ${section("Scenarios", im.scenarios.length && `<div class="scen">${im.scenarios.map((s) => `<div><b>${esc(s.case)}</b>${esc(s.detail)}</div>`).join("")}</div>`)}
    ${section("Assets affected", Object.keys(im.assets).length && `<dl class="assets">${Object.entries(im.assets).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`)}
    ${section("Most sensitive sectors", im.sectors.length && `<div class="tags">${im.sectors.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>`)}
    ${section("What to watch", im.watch.length && `<ul>${im.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`)}
    ${e.custom && !state.readOnly ? `<button class="btn ghost" id="delCustom" data-id="${esc(e.id)}">Delete this custom event</button>` : ""}`;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  $("#closeDrawer").focus();
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

// ---------- custom events ----------
async function setupDialog() {
  const cfg = await api("/api/config");
  state.readOnly = cfg.read_only;
  if (cfg.read_only) { $("#addBtn").hidden = true; return; }
  const types = await api("/api/event-types");
  $("#templateSelect").innerHTML = `<option value="">None (custom)</option>` +
    Object.entries(types).filter(([k]) => !["custom", "holiday", "early_close"].includes(k))
      .map(([k, p]) => `<option value="${k}">${esc(p.category)}: ${esc(p.summary.split(/[.(:]/)[0])}</option>`).join("");
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
  const f = new FormData(ev.target);
  const body = Object.fromEntries([...f].filter(([, v]) => v !== ""));
  try {
    await api("/api/custom-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    $("#addDialog").close();
    state.cursor = new Date(parse(body.date).getFullYear(), parse(body.date).getMonth(), 1);
    await Promise.all([loadMonth(), renderWeek()]);
  } catch (err) {
    $("#formError").textContent = err.message;
  }
});

// ---------- wiring ----------
document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-id], .more, #delCustom");
  if (!t) return;
  if (t.id === "delCustom") {
    if (!confirm("Delete this custom event?")) return;
    await api(`/api/custom-events/${encodeURIComponent(t.dataset.id)}`, { method: "DELETE" });
    closeDrawer();
    await Promise.all([loadMonth(), renderWeek()]);
  } else if (t.classList.contains("more")) {
    state.view = "list"; syncViewButtons(); render();
  } else {
    openDrawer(t.dataset.id);
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
$("#today").onclick = () => { const t = new Date(); state.cursor = new Date(t.getFullYear(), t.getMonth(), 1); loadMonth(); };

document.querySelectorAll("#filters .chip").forEach((chip) => {
  chip.onclick = () => {
    const imp = chip.dataset.imp;
    state.importance.has(imp) ? state.importance.delete(imp) : state.importance.add(imp);
    chip.classList.toggle("on", state.importance.has(imp));
    save("mc.importance", [...state.importance]);
    render();
  };
});

function syncViewButtons() {
  document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  save("mc.view", state.view);
}
document.querySelectorAll(".seg").forEach((b) => { b.onclick = () => { state.view = b.dataset.view; syncViewButtons(); render(); }; });

// restore preferences
state.importance = new Set(load("mc.importance", ["high", "medium"]));
state.view = load("mc.view", "month");
document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("on", state.importance.has(c.dataset.imp)));
syncViewButtons();

// Deep link: /?event=<id> opens that event (e.g. /?event=fomc-2026-10-28).
const deepLink = new URLSearchParams(location.search).get("event");
if (deepLink) {
  const m = deepLink.match(/(\d{4})-(\d{2})-\d{2}$/);
  if (m) state.cursor = new Date(+m[1], +m[2] - 1, 1);
}

Promise.all([loadMonth(), renderWeek(), setupDialog()]).then(() => {
  if (deepLink) openDrawer(deepLink);
}).catch((err) => {
  $("#warnings").innerHTML = `<div class="warn">Failed to load: ${esc(err.message)}</div>`;
});
