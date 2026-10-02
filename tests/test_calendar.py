from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import dates as D
from app import events as E
from app.main import app


@pytest.fixture(autouse=True)
def isolated_custom(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "CUSTOM_FILE", tmp_path / "custom.json")


client = TestClient(app)


def test_nyse_holidays_2026():
    hol = D.nyse_holidays(2026)
    assert hol[date(2026, 4, 3)] == "Good Friday"
    assert hol[date(2026, 7, 3)] == "Independence Day"  # Jul 4 is a Saturday
    assert hol[date(2026, 11, 26)] == "Thanksgiving Day"
    assert date(2026, 11, 27) in D.nyse_early_closes(2026)
    assert date(2026, 7, 2) not in D.nyse_early_closes(2026)


def test_new_year_on_saturday_not_observed_friday():
    assert date(2021, 12, 31) not in D.nyse_holidays(2022)
    assert date(2021, 12, 31) not in D.nyse_holidays(2021)


def test_easter():
    assert D.easter(2026) == date(2026, 4, 5)
    assert D.easter(2027) == date(2027, 3, 28)


def test_fomc_and_minutes():
    evs = E.build(date(2026, 10, 1), date(2026, 12, 31))
    fomc = [e for e in evs if e["type"] in ("fomc", "fomc_sep")]
    assert [e["date"] for e in fomc] == ["2026-10-28", "2026-12-09"]
    assert fomc[1]["type"] == "fomc_sep"
    assert any(e["type"] == "fomc_minutes" and e["date"] == "2026-11-18" for e in evs)


def test_midterms_and_no_release_on_federal_holiday():
    evs = E.build(date(2026, 11, 1), date(2026, 11, 30))
    assert any(e["type"] == "election" and e["date"] == "2026-11-03" for e in evs)
    releases = [e for e in evs if e["type"] in ("cpi", "ppi", "nfp", "retail", "pce", "claims")]
    for e in releases:
        assert D.is_business_day(date.fromisoformat(e["date"])), e


def test_every_event_has_impact_and_valid_importance():
    for e in E.build(date(2026, 1, 1), date(2027, 12, 31)):
        assert e["importance"] in ("high", "medium", "low")
        assert e["impact"]["summary"]
        if e["type"] not in ("holiday", "early_close"):
            assert e["impact"]["why"] and e["impact"]["typical_move"], e["type"]


def test_quad_witching_quarterly_only():
    evs = E.build(date(2026, 1, 1), date(2026, 12, 31))
    months = sorted(int(e["date"][5:7]) for e in evs if e["type"] == "quad_witching")
    assert months == [3, 6, 9, 12]


def test_api_events_and_filter():
    r = client.get("/api/events", params={"start": "2026-10-01", "end": "2026-10-31", "importance": "high"})
    assert r.status_code == 200
    body = r.json()
    assert body["events"] and all(e["importance"] == "high" for e in body["events"])
    assert body["risk"]["2026-10-28"]["level"] == "high"


def test_api_warns_on_missing_fomc_year():
    r = client.get("/api/events", params={"start": "2027-01-01", "end": "2027-01-31"})
    assert r.json()["warnings"]


def test_api_rejects_bad_range():
    assert client.get("/api/events", params={"start": "2026-10-10", "end": "2026-10-01"}).status_code == 400


def test_custom_event_roundtrip():
    r = client.post("/api/custom-events", json={"date": "2026-10-21", "title": "TSLA earnings", "template": "earnings_megacap", "time_et": "16:05"})
    assert r.status_code == 201
    cid = r.json()["id"]
    evs = client.get("/api/events", params={"start": "2026-10-21", "end": "2026-10-21"}).json()["events"]
    ev = next(e for e in evs if e["id"] == cid)
    assert ev["custom"] and ev["importance"] == "high" and ev["impact"]["scenarios"]
    assert client.delete(f"/api/custom-events/{cid}").status_code == 204
    assert client.delete(f"/api/custom-events/{cid}").status_code == 404


def test_custom_event_rejects_unknown_template():
    assert client.post("/api/custom-events", json={"date": "2026-10-21", "title": "x", "template": "nope"}).status_code == 400


def test_ics_export():
    r = client.get("/api/calendar.ics", params={"start": "2026-10-01", "end": "2026-10-31"})
    assert r.status_code == 200
    assert r.text.startswith("BEGIN:VCALENDAR")
    assert "FOMC rate decision" in r.text and "ESTIMATED DATE" in r.text


def test_index_served():
    assert "Market Events Calendar" in client.get("/").text


def test_read_only_blocks_writes(monkeypatch):
    import app.main as M
    monkeypatch.setattr(M, "READ_ONLY", True)
    assert client.get("/api/config").json() == {"read_only": True}
    assert client.post("/api/custom-events", json={"date": "2026-10-21", "title": "x"}).status_code == 403
    assert client.delete("/api/custom-events/anything").status_code == 403


# --- i18n and cross-market impact ---------------------------------------

from app.impact import PROFILES, profile  # noqa: E402
from app.markets import MARKET_KEYS  # noqa: E402


@pytest.mark.parametrize("etype", list(PROFILES))
def test_chinese_profile_matches_english_shape(etype):
    en, zh = profile(etype, "en"), profile(etype, "zh")
    for field in ("assets", "sectors", "scenarios", "watch"):
        assert len(en[field]) == len(zh[field]), (etype, field)
    for field in ("summary", "why", "typical_move"):
        assert bool(en[field]) == bool(zh[field]), (etype, field)
        assert en[field] != zh[field] or not en[field], (etype, field)
    assert en["category"] != zh["category"]


@pytest.mark.parametrize("etype", [k for k in PROFILES if k != "custom"])
def test_every_event_type_covers_all_five_markets(etype):
    for lang in ("en", "zh"):
        ms = profile(etype, lang)["markets"]
        assert [m["key"] for m in ms] == list(MARKET_KEYS)
        assert all(m["level"] in ("high", "medium", "low") and m["text"] for m in ms)


def test_api_chinese():
    body = client.get("/api/events", params={"start": "2026-11-01", "end": "2026-11-30", "lang": "zh"}).json()
    titles = {e["type"]: e["title"] for e in body["events"]}
    assert titles["election"] == "美国中期选举"
    assert titles["holiday"] == "休市：感恩节"
    nvda = next(e for e in body["events"] if e["type"] == "earnings_nvda")
    assert nvda["category"] == "财报" and nvda["impact"]["markets"][0]["name"] == "黄金"
    assert "同日" in nvda["notes"][0]


def test_api_rejects_unknown_lang():
    assert client.get("/api/events", params={"lang": "fr"}).status_code == 422


# --- live quotes ----------------------------------------------------------

from app import quotes as Q  # noqa: E402

FAKE_YAHOO = {"chart": {"result": [{
    "meta": {"symbol": "GC=F", "shortName": "Gold Dec 26", "currency": "USD", "fullExchangeName": "COMEX",
             "regularMarketPrice": 103.0, "regularMarketTime": 1790932800, "gmtoffset": -14400, "chartPreviousClose": 50.0},
    # Two bars on Oct 1 (ET), two on Oct 2 (ET); one bar with missing data.
    "timestamp": [1790798400, 1790802000, 1790884800, 1790888400, 1790892000],
    "indicators": {"quote": [{"open": [99, 100, None, 102, 103], "high": [100, 101, None, 103, 104],
                              "low": [98, 99, None, 101, 102], "close": [100, 101, None, 102, 103], "volume": [5, 6, None, 7, None]}]},
}]}}


@pytest.fixture
def fake_yahoo(monkeypatch):
    calls = []
    monkeypatch.setattr(Q, "_fetch", lambda url: calls.append(url) or FAKE_YAHOO)
    Q._cache.clear()
    yield calls
    Q._cache.clear()


def test_kline_parses_and_computes_prev_close(fake_yahoo):
    body = client.get("/api/kline", params={"symbol": "GC=F", "interval": "5m"}).json()
    assert [b["close"] for b in body["bars"]] == [100, 101, 102, 103]  # null bar dropped
    assert body["bars"][-1]["volume"] == 0
    assert body["prev_close"] == 101  # last close of the previous exchange-local day
    assert body["delayed_min"] == 10 and body["name"] == "Gold Dec 26"


def test_kline_is_cached(fake_yahoo):
    client.get("/api/kline", params={"symbol": "SPY", "interval": "1m"})
    client.get("/api/kline", params={"symbol": "spy", "interval": "1m"})
    assert len(fake_yahoo) == 1


@pytest.mark.parametrize("symbol", ["../etc", "A B", "x" * 20, "http://evil"])
def test_kline_rejects_bad_symbols(fake_yahoo, symbol):
    assert client.get("/api/kline", params={"symbol": symbol}).status_code in (400, 422)
    assert not fake_yahoo


def test_kline_rejects_bad_interval(fake_yahoo):
    assert client.get("/api/kline", params={"symbol": "SPY", "interval": "3m"}).status_code == 422


def test_markets_page_served():
    assert "lightweight-charts" in client.get("/markets").text
