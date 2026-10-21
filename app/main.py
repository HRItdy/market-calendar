"""US Market Events Calendar — FastAPI service."""
from __future__ import annotations

import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import backups as B
from . import events as E
from . import journal as J
from . import quotes as Q
from .impact import PROFILES, profile

Lang = Literal["en", "zh"]

STATIC = Path(__file__).resolve().parent.parent / "static"
MAX_RANGE_DAYS = 800
# Public deployments set MC_READ_ONLY=1 so visitors can't add or delete events.
READ_ONLY = os.environ.get("MC_READ_ONLY", "").lower() in ("1", "true", "yes")
# The trade log is private to whoever holds this key (entered once per device in the page).
JOURNAL_KEY = os.environ.get("MC_JOURNAL_KEY", "").strip()


async def _track_journal():
    while True:
        try:
            await asyncio.to_thread(J.track_once)
        except Exception as exc:  # never let the tracker die
            J.log.warning("journal tracker: %s", exc)
        try:
            await asyncio.to_thread(B.daily, lambda: J.store().all())
        except Exception as exc:
            J.log.warning("journal backup: %s", exc)
        await asyncio.sleep(J.TRACK_SEC)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_track_journal())
    yield
    task.cancel()


app = FastAPI(title="US Market Events Calendar", version="1.0.0", lifespan=lifespan)


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    today = date.today()
    start = start or today.replace(day=1)
    end = end or start + timedelta(days=62)
    if end < start:
        raise HTTPException(400, "end must be on or after start")
    if (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(400, f"range limited to {MAX_RANGE_DAYS} days")
    return start, end


def _warnings(start: date, end: date, lang: str) -> list[str]:
    known = set(E.fomc_years())
    missing = [y for y in range(start.year, end.year + 1) if y not in known]
    if missing:
        years = ", ".join(map(str, missing))
        if lang == "zh":
            return [f"尚未载入{years}年的官方FOMC会议日程。美联储公布后请添加到 app/data/fomc.json。"]
        return [f"No official FOMC schedule loaded for {years}. "
                "Add it to app/data/fomc.json once the Fed publishes it."]
    return []


@app.get("/api/events")
def list_events(
    start: date | None = None,
    end: date | None = None,
    importance: list[Literal["high", "medium", "low"]] | None = Query(None),
    category: list[str] | None = Query(None),
    lang: Lang = "en",
):
    start, end = _range(start, end)
    evs = E.build(start, end, lang)
    if importance:
        evs = [e for e in evs if e["importance"] in importance]
    if category:
        evs = [e for e in evs if e["category"] in category]
    return {
        "start": start, "end": end,
        "events": evs,
        "risk": E.daily_risk(evs),
        "warnings": _warnings(start, end, lang),
    }


@app.get("/api/week")
def week_ahead(start: date | None = None, lang: Lang = "en"):
    """Next 7 days: the 'what matters this week' view."""
    start = start or date.today()
    end = start + timedelta(days=6)
    evs = [e for e in E.build(start, end, lang) if e["importance"] != "low" or e["type"] in ("holiday", "early_close")]
    return {"start": start, "end": end, "events": evs, "risk": E.daily_risk(evs)}


@app.get("/api/config")
def config():
    return {"read_only": READ_ONLY}


def _require_writable():
    if READ_ONLY:
        raise HTTPException(403, "this calendar is read-only")


@app.get("/api/event-types")
def event_types(lang: Lang = "en"):
    return {k: profile(k, lang) for k in PROFILES}


class CustomEvent(BaseModel):
    date: date
    title: str = Field(min_length=1, max_length=120)
    time_et: str | None = Field(None, pattern=r"^\d{2}:\d{2}$")
    importance: Literal["high", "medium", "low"] | None = None
    template: str | None = Field(None, description="Reuse an impact profile, e.g. 'earnings_megacap'")
    description: str | None = Field(None, max_length=500)
    impact_notes: str | None = Field(None, max_length=1000)


@app.post("/api/custom-events", status_code=201)
def create_custom(ev: CustomEvent):
    _require_writable()
    if ev.template and ev.template not in PROFILES:
        raise HTTPException(400, f"unknown template '{ev.template}'")
    return E.add_custom(ev.model_dump(mode="json"))


@app.delete("/api/custom-events/{event_id}", status_code=204)
def remove_custom(event_id: str):
    _require_writable()
    if not E.delete_custom(event_id):
        raise HTTPException(404, "not found")


ICS_LABELS = {
    "en": {"why": "Why it matters", "move": "Typical move", "est": "ESTIMATED DATE: confirm with the official release calendar."},
    "zh": {"why": "为何重要", "move": "典型波动", "est": "预估日期：请以官方发布日程为准。"},
}


def _ics_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,").replace("\n", r"\n")


@app.get("/api/calendar.ics", response_class=PlainTextResponse)
def ics(start: date | None = None, end: date | None = None,
        importance: list[Literal["high", "medium", "low"]] = Query(["high", "medium"]),
        lang: Lang = "en"):
    """Subscribe from Google Calendar / Outlook / Apple Calendar."""
    start, end = _range(start, end or (start or date.today()) + timedelta(days=180))
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//market-calendar//EN",
             "X-WR-CALNAME:US Market Events", "X-WR-TIMEZONE:America/New_York"]
    L = ICS_LABELS[lang]
    for e in E.build(start, end, lang):
        if e["importance"] not in importance:
            continue
        d = e["date"].replace("-", "")
        im = e["impact"]
        desc = f"{im['summary']}\n\n{L['why']}: {im['why']}\n\n{L['move']}: {im['typical_move']}"
        if im["markets"]:
            desc += "\n\n" + "\n".join(f"• {m['name']}: {m['text']}" for m in im["markets"])
        if not e["confirmed"]:
            desc = L["est"] + "\n\n" + desc
        lines += ["BEGIN:VEVENT", f"UID:{e['id']}@market-calendar", f"DTSTAMP:{stamp}"]
        if e["time_et"]:
            lines.append(f"DTSTART;TZID=America/New_York:{d}T{e['time_et'].replace(':', '')}00")
            lines.append("DURATION:PT30M")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{d}")
        lines += [f"SUMMARY:{_ics_escape(('[' + e['importance'].upper() + '] ') + e['title'])}",
                  f"DESCRIPTION:{_ics_escape(desc)}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines) + "\r\n", media_type="text/calendar")


@app.get("/api/kline")
def kline(symbol: str = Query(..., max_length=16), interval: Literal["1m", "5m", "15m", "1h", "1d"] = "5m"):
    """Candles for gold futures and US stocks/indices (crypto streams from Binance in the browser)."""
    try:
        return Q.candles(symbol, interval)
    except Q.QuoteError as exc:
        msg = str(exc)
        raise HTTPException(400 if msg.startswith("invalid") or msg == "unknown symbol" else 502, msg)


# ---------- trade log ----------
def _journal_auth(key: str | None) -> None:
    if JOURNAL_KEY:
        if not key or not hmac.compare_digest(key.encode(), JOURNAL_KEY.encode()):
            raise HTTPException(401, "journal key required")
    elif READ_ONLY:
        raise HTTPException(403, "the trade log is disabled: set MC_JOURNAL_KEY on the server")


def _journal_info() -> dict:
    s = J.store()
    return {"persistent": s.persistent, "storage": s.kind, "backups": B.enabled(), "min_conf": J.MIN_CONF, "track_sec": J.TRACK_SEC}


Interval = Literal["1m", "5m", "15m", "1h", "1d"]


class Feed(BaseModel):
    src: Literal["binance", "yahoo"]
    sym: str = Field(pattern=r"^[A-Z0-9^][A-Z0-9.^=\-]{0,19}$")
    yahoo: str | None = Field(None, pattern=r"^[A-Z0-9^][A-Z0-9.^=\-]{0,15}$")


class OrderIn(BaseModel):
    sym: str = Field(min_length=1, max_length=16)
    label: str | dict[str, str]
    group: str = Field(max_length=16)
    interval: Interval
    theories: list[Literal["of", "chan", "pa"]] = Field(min_length=1)
    bias: Literal["buy", "sell"]
    confidence: int = Field(ge=0, le=100)
    price: float = Field(gt=0)
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    targets: list[float] = Field(min_length=1)
    rr: float | None = None
    barTime: int | None = None
    feed: Feed


class CloseIn(BaseModel):
    price: float | None = Field(None, gt=0)


class ImportIn(BaseModel):
    orders: list[dict] = Field(max_length=1000)


@app.get("/api/journal")
def journal_list(x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    return {**_journal_info(), "orders": J.store().all()}


@app.post("/api/journal/orders", status_code=201)
def journal_place(order: OrderIn, x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    try:
        return J.place(order.model_dump())
    except J.OrderRejected as exc:
        raise HTTPException(409, str(exc))


@app.post("/api/journal/orders/{order_id}/close")
def journal_close(order_id: str, body: CloseIn, x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    o = J.close_manual(order_id, body.price)
    if o is None:
        raise HTTPException(404, "not found")
    return o


@app.post("/api/journal/import")
def journal_import(body: ImportIn, x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    need = {"id", "sym", "interval", "side", "placedAt", "status", "entry", "stop", "target"}
    if any(not isinstance(o, dict) or not need <= o.keys() for o in body.orders):
        raise HTTPException(400, f"each order needs {sorted(need)}")
    return {"added": J.import_orders(body.orders)}


@app.delete("/api/journal", status_code=204)
def journal_clear(x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    with J._lock:
        orders = J.store().all()
        if orders:
            try:
                B.save(orders, "before-clear")  # so "Clear log" can be undone
            except Exception as exc:
                raise HTTPException(502, f"backup before clearing failed, log kept: {exc}")
        J.store().clear()


@app.get("/api/journal/backups")
def journal_backups(x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    return {"enabled": B.enabled(), "bucket": B.BUCKET, "backups": B.list_backups()}


@app.get("/api/journal/backups/{key:path}")
def journal_backup(key: str, x_journal_key: str | None = Header(None)):
    _journal_auth(x_journal_key)
    if not B.enabled():
        raise HTTPException(404, "backups are not configured")
    try:
        return B.load(key)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(404, f"backup not found: {exc}")


@app.get("/markets", include_in_schema=False)
def markets_page():
    return FileResponse(STATIC / "markets.html")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
