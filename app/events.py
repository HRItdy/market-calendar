"""Generate market-moving events for a date range.

Each event has `confirmed: bool`. Confirmed events come from official schedules (FOMC
data file) or fixed exchange rules (holidays, OpEx, ISM business-day rules). Everything
else is a rule-based *estimate* of when the agency usually publishes, so check the
official release calendar (BLS, BEA, Census) before trading around it.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

from . import dates as D
from .impact import IMPORTANCE_WEIGHT, profile

DATA = Path(__file__).parent / "data"
FOMC_FILE = DATA / "fomc.json"
CUSTOM_FILE = Path(os.environ.get("MC_CUSTOM_FILE", DATA / "custom_events.json"))


def _event(d: date, etype: str, title: str, time: str | None, confirmed: bool, **extra) -> dict:
    p = profile(etype)
    ev = {
        "id": f"{etype}-{d.isoformat()}",
        "date": d.isoformat(),
        "time_et": time,
        "title": title,
        "type": etype,
        "category": p["category"],
        "importance": extra.pop("importance", p["importance"]),
        "confirmed": confirmed,
        "impact": {k: p[k] for k in ("summary", "why", "typical_move", "assets", "sectors", "scenarios", "watch")},
        "notes": [],
    }
    ev.update(extra)
    return ev


def _months(start: date, end: date):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def load_fomc() -> dict[str, list[dict]]:
    raw = json.loads(FOMC_FILE.read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def fomc_events(start: date, end: date) -> list[dict]:
    out = []
    for year, meetings in load_fomc().items():
        for mtg in meetings:
            d = date.fromisoformat(mtg["end"])
            etype = "fomc_sep" if mtg["sep"] else "fomc"
            label = "FOMC decision + dot plot" if mtg["sep"] else "FOMC rate decision"
            out.append(_event(d, etype, label, "14:00", True, meeting_start=mtg["start"]))
            # Minutes: three weeks after the decision day.
            out.append(_event(d + timedelta(weeks=3), "fomc_minutes", "FOMC minutes", "14:00", True))
    return [e for e in out if start.isoformat() <= e["date"] <= end.isoformat()]


def monthly_events(year: int, month: int) -> list[dict]:
    ev: list[dict] = []
    nb = D.next_business_day

    # Rule-exact (confirmed) releases
    ev.append(_event(D.nth_business_day(year, month, 1), "ism_mfg", "ISM Manufacturing PMI", "10:00", True))
    ev.append(_event(D.nth_business_day(year, month, 3), "ism_svc", "ISM Services PMI", "10:00", True))

    opex = D.prev_trading_day(D.nth_weekday(year, month, D.FRI, 3))
    if month in (3, 6, 9, 12):
        ev.append(_event(opex, "quad_witching", "Quad witching (quarterly OpEx)", None, True))
        ev.append(_event(D.last_trading_day(year, month), "quarter_end", "Quarter-end rebalancing", "16:00", True))
    else:
        ev.append(_event(opex, "opex", "Monthly options expiration", None, True))

    # Estimated releases (typical scheduling patterns)
    jobs = nb(D.nth_weekday(year, month, D.FRI, 1))
    ev.append(_event(jobs, "nfp", "Jobs report (Nonfarm Payrolls)", "08:30", False))
    ev.append(_event(nb(jobs - timedelta(days=3)), "jolts", "JOLTS job openings", "10:00", False))

    cpi = nb(D.weekday_in_window(year, month, D.WED, 10, 16))
    ev.append(_event(cpi, "cpi", "CPI inflation", "08:30", False))
    ev.append(_event(nb(cpi + timedelta(days=1)), "ppi", "PPI producer prices", "08:30", False))
    ev.append(_event(nb(D.weekday_in_window(year, month, D.TUE, 14, 20)), "retail", "Retail sales", "08:30", False))
    ev.append(_event(nb(D.nth_weekday(year, month, D.FRI, 2)), "umich", "UMich consumer sentiment (prelim)", "10:00", False))
    pce = D.prev_business_day(D.nth_weekday(year, month, D.FRI, -1))
    if pce in D.nyse_early_closes(year):  # e.g. the day after Thanksgiving
        pce = D.prev_business_day(pce - timedelta(days=1))
    ev.append(_event(pce, "pce", "PCE inflation (Fed's target gauge)", "08:30", False))

    if month in (1, 4, 7, 10):
        ev.append(_event(D.nth_weekday(year, month, D.THU, -1), "gdp", f"GDP advance estimate (Q{(month - 2) % 12 // 3 + 1})", "08:30", False))
        ev.append(_event(nb(D.weekday_in_window(year, month, D.FRI, 10, 16)), "earnings_banks", "Earnings season kickoff: big banks", "07:00", False))
        megacap_wed = D.nth_weekday(year, month, D.WED, -1)
        ev.append(_event(megacap_wed, "earnings_megacap", "Mega-cap tech earnings week", "16:00", False))
    if month in (2, 5, 8, 11):
        ev.append(_event(D.nth_weekday(year, month, D.WED, 1), "refunding", "Treasury quarterly refunding", "08:30", False))
        ev.append(_event(D.nth_weekday(year, month, D.WED, 4), "earnings_nvda", "NVIDIA earnings", "16:20", False))
    if month == 8:
        ev.append(_event(D.nth_weekday(year, month, D.FRI, 4), "jackson_hole", "Jackson Hole: Fed chair speech", "10:00", False))
    if month == 11 and year % 2 == 0:
        election = D.nth_weekday(year, 11, D.MON, 1) + timedelta(days=1)
        label = "US presidential election" if year % 4 == 0 else "US midterm elections"
        ev.append(_event(election, "election", label, None, True))
    if month == 6:
        ev.append(_event(D.prev_trading_day(D.nth_weekday(year, month, D.FRI, 4)), "russell_recon", "Russell reconstitution", "16:00", False))
    return ev


def weekly_claims(start: date, end: date) -> list[dict]:
    out = []
    d = start + timedelta(days=(D.THU - start.weekday()) % 7)
    while d <= end:
        rel = d if D.is_business_day(d) else d - timedelta(days=1)
        out.append(_event(rel, "claims", "Initial jobless claims", "08:30", True))
        d += timedelta(weeks=1)
    return out


def market_hours(start: date, end: date) -> list[dict]:
    out = []
    for y in range(start.year, end.year + 1):
        for d, name in D.nyse_holidays(y).items():
            out.append(_event(d, "holiday", f"Market closed: {name}", None, True))
        for d, name in D.nyse_early_closes(y).items():
            out.append(_event(d, "early_close", f"Early close (1 p.m.): {name}", "13:00", True))
    return out


# --- custom events -------------------------------------------------------

def load_custom() -> list[dict]:
    return json.loads(CUSTOM_FILE.read_text()) if CUSTOM_FILE.exists() else []


def save_custom(items: list[dict]) -> None:
    CUSTOM_FILE.write_text(json.dumps(items, indent=2))


def add_custom(payload: dict) -> dict:
    items = load_custom()
    item = {"id": f"custom-{uuid.uuid4().hex[:8]}", **payload}
    items.append(item)
    save_custom(items)
    return item


def delete_custom(event_id: str) -> bool:
    items = load_custom()
    kept = [i for i in items if i["id"] != event_id]
    save_custom(kept)
    return len(kept) != len(items)


def custom_events(start: date, end: date) -> list[dict]:
    out = []
    for c in load_custom():
        d = date.fromisoformat(c["date"])
        if not (start <= d <= end):
            continue
        base = c.get("template") or "custom"
        ev = _event(d, base, c["title"], c.get("time_et"), True, importance=c.get("importance") or profile(base)["importance"])
        ev["id"] = c["id"]
        ev["custom"] = True
        ev["category"] = "Custom" if base == "custom" else ev["category"]
        if c.get("description"):
            ev["impact"]["summary"] = c["description"]
        if c.get("impact_notes"):
            ev["impact"]["why"] = c["impact_notes"]
        out.append(ev)
    return out


# --- assembly ------------------------------------------------------------

def _annotate(events: list[dict]) -> None:
    """Add cross-event context: holiday shifts, crowded weeks, data in Fed blackout."""
    by_date: dict[str, list[dict]] = {}
    for e in events:
        by_date.setdefault(e["date"], []).append(e)

    fomc_days = [date.fromisoformat(e["meeting_start"]) for e in events if e["type"] in ("fomc", "fomc_sep")]
    for e in events:
        d = date.fromisoformat(e["date"])
        if e["type"] not in ("holiday", "early_close") and not D.is_trading_day(d):
            e["notes"].append("Released while US equity markets are closed; futures will price it first.")
        if e["type"] in ("cpi", "ppi", "nfp", "pce", "retail", "jolts"):
            for s in fomc_days:
                # Fed blackout: from the second Saturday before the meeting until the day after.
                blackout_start = s - timedelta(days=(s.weekday() - D.SAT) % 7 + 7)
                if blackout_start <= d < s:
                    e["notes"].append(f"Lands in the Fed blackout before the {s:%b %d} FOMC. "
                                      "Fed officials can't comment on it, so markets price it straight into the decision.")
        same_day = [o for o in by_date[e["date"]] if o is not e and o["importance"] == "high"]
        if e["importance"] == "high" and same_day:
            e["notes"].append("Shares the day with " + ", ".join(o["title"] for o in same_day) + ", so volatility can compound.")


def build(start: date, end: date) -> list[dict]:
    events: list[dict] = []
    events += fomc_events(start, end)
    for y, m in _months(start, end):
        events += monthly_events(y, m)
    events += weekly_claims(start, end)
    events += market_hours(start, end)
    events += custom_events(start, end)

    events = [e for e in events if start.isoformat() <= e["date"] <= end.isoformat()]
    _annotate(events)
    rank = {"high": 0, "medium": 1, "low": 2}
    events.sort(key=lambda e: (e["date"], rank[e["importance"]], e["time_et"] or "99"))
    return events


def daily_risk(events: list[dict]) -> dict[str, dict]:
    """Per-day risk score from the importance weights of that day's events."""
    out: dict[str, dict] = {}
    for e in events:
        if e["type"] in ("holiday", "early_close"):
            continue
        day = out.setdefault(e["date"], {"score": 0, "high": 0})
        day["score"] += IMPORTANCE_WEIGHT[e["importance"]]
        day["high"] += e["importance"] == "high"
    for v in out.values():
        v["level"] = "high" if v["high"] or v["score"] >= 5 else "medium" if v["score"] >= 3 else "low"
    return out


def fomc_years() -> list[int]:
    return sorted(int(y) for y in load_fomc())
