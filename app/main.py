"""US Market Events Calendar — FastAPI service."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import events as E
from . import quotes as Q
from .impact import PROFILES, profile

Lang = Literal["en", "zh"]

STATIC = Path(__file__).resolve().parent.parent / "static"
MAX_RANGE_DAYS = 800
# Public deployments set MC_READ_ONLY=1 so visitors can't add or delete events.
READ_ONLY = os.environ.get("MC_READ_ONLY", "").lower() in ("1", "true", "yes")

app = FastAPI(title="US Market Events Calendar", version="1.0.0")


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


@app.get("/markets", include_in_schema=False)
def markets_page():
    return FileResponse(STATIC / "markets.html")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
