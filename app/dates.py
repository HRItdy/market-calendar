"""Date helpers: NYSE holidays, early closes, and business-day rules."""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """n-th (1-based) given weekday of a month; n=-1 means the last one."""
    if n > 0:
        d = date(year, month, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    nxt = date(year + month // 12, month % 12 + 1, 1)
    d = nxt - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def easter(year: int) -> date:
    """Gregorian Easter Sunday (anonymous Gregorian algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _observed(d: date) -> date:
    if d.weekday() == SAT:
        return d - timedelta(days=1)
    if d.weekday() == SUN:
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=None)
def nyse_holidays(year: int) -> dict[date, str]:
    hol: dict[date, str] = {}
    # NYSE does not observe New Year's on Friday Dec 31 when Jan 1 is a Saturday.
    ny = date(year, 1, 1)
    if ny.weekday() != SAT:
        hol[_observed(ny)] = "New Year's Day"
    hol[nth_weekday(year, 1, MON, 3)] = "Martin Luther King Jr. Day"
    hol[nth_weekday(year, 2, MON, 3)] = "Washington's Birthday"
    hol[easter(year) - timedelta(days=2)] = "Good Friday"
    hol[nth_weekday(year, 5, MON, -1)] = "Memorial Day"
    hol[_observed(date(year, 6, 19))] = "Juneteenth"
    hol[_observed(date(year, 7, 4))] = "Independence Day"
    hol[nth_weekday(year, 9, MON, 1)] = "Labor Day"
    hol[nth_weekday(year, 11, THU, 4)] = "Thanksgiving Day"
    hol[_observed(date(year, 12, 25))] = "Christmas Day"
    return hol


@lru_cache(maxsize=None)
def nyse_early_closes(year: int) -> dict[date, str]:
    """1:00 p.m. ET early closes."""
    out: dict[date, str] = {}
    cands = [
        (date(year, 7, 3), "Day before Independence Day"),
        (nth_weekday(year, 11, THU, 4) + timedelta(days=1), "Day after Thanksgiving"),
        (date(year, 12, 24), "Christmas Eve"),
    ]
    for d, name in cands:
        if is_trading_day(d):
            out[d] = name
    return out


def is_trading_day(d: date) -> bool:
    return d.weekday() < SAT and d not in nyse_holidays(d.year)


@lru_cache(maxsize=None)
def federal_only_holidays(year: int) -> set[date]:
    """Federal holidays when agencies don't publish but NYSE is open."""
    return {nth_weekday(year, 10, MON, 2), _observed(date(year, 11, 11))}


def is_business_day(d: date) -> bool:
    """Federal business day: no data releases on weekends or federal holidays."""
    if d.weekday() >= SAT or d in federal_only_holidays(d.year):
        return False
    hol = nyse_holidays(d.year)
    return d not in hol or hol[d] == "Good Friday"


def prev_business_day(d: date) -> date:
    while not is_business_day(d):
        d -= timedelta(days=1)
    return d


def next_business_day(d: date) -> date:
    while not is_business_day(d):
        d += timedelta(days=1)
    return d


def prev_trading_day(d: date) -> date:
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def nth_business_day(year: int, month: int, n: int) -> date:
    d = next_business_day(date(year, month, 1))
    for _ in range(n - 1):
        d = next_business_day(d + timedelta(days=1))
    return d


def last_trading_day(year: int, month: int) -> date:
    nxt = date(year + month // 12, month % 12 + 1, 1)
    return prev_trading_day(nxt - timedelta(days=1))


def weekday_in_window(year: int, month: int, weekday: int, lo: int, hi: int) -> date:
    """First given weekday whose day-of-month is in [lo, hi]."""
    d = date(year, month, lo)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    assert d.day <= hi, (year, month, weekday, lo, hi)
    return d
