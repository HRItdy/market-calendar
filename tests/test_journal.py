import pytest
from fastapi.testclient import TestClient

from app import backups as B
from app import journal as J
from app import journal_store
from app import main

T0 = 1_700_000_000_000
client = TestClient(main.app)


@pytest.fixture(autouse=True)
def fresh_store(tmp_path, monkeypatch):
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT_URL_S3"):
        monkeypatch.delenv(k, raising=False)  # unit tests never touch the real bucket
    J.set_store(journal_store.SqliteStore(tmp_path / "j.db"))
    monkeypatch.setattr(main, "JOURNAL_KEY", "")
    monkeypatch.setattr(main, "READ_ONLY", False)
    yield
    J.set_store(None)


def sig(**over):
    s = dict(sym="BTC", label="BTC", group="web3", interval="5m", theories=["of"], bias="buy", confidence=70,
             price=100.0, entry=100.0, stop=95.0, targets=[110.0, 115.0], rr=2.0, barTime=1,
             feed={"src": "binance", "sym": "BTCUSDT", "yahoo": "BTC-USD"})
    s.update(over)
    return s


def tick(o, p, at):
    return J.on_price(o, p, p, p, at)


def test_orders_need_buy_sell_above_50():
    with pytest.raises(J.OrderRejected):
        J.place(sig(confidence=50), T0)
    with pytest.raises(J.OrderRejected):
        J.place(sig(bias="wait"), T0)
    o = J.place(sig(confidence=51), T0)
    assert (o["status"], o["fill"], o["type"]) == ("open", 100.0, "market")


def test_same_side_refused_opposite_reverses():
    a = J.place(sig(), T0)
    with pytest.raises(J.OrderRejected):
        J.place(sig(), T0 + 1)
    J.place(sig(interval="1h"), T0 + 2)  # a different timeframe is separate
    b = J.place(sig(bias="sell", price=97.0, entry=97.0, stop=100.0, targets=[90.0]), T0 + 3)
    a = J.store().get(a["id"])
    assert (a["status"], a["exitReason"]) == ("closed", "reversed")
    assert a["pnlPct"] == pytest.approx(-0.03)
    assert b["status"] == "open"


def test_stop_and_target_outcomes():
    a = J.place(sig(), T0)
    tick(a, 105, T0 + 1)
    J.on_price(a, 111, 104, 108, T0 + 2)
    assert (a["exitReason"], a["pnlPct"], a["r"]) == ("target", pytest.approx(0.1), pytest.approx(2))
    b = J.place(sig(sym="ETH", bias="sell", stop=104.0, targets=[90.0]), T0)
    tick(b, 106, T0 + 1)  # gapped through the stop: exits at the gap price
    assert (b["exitReason"], b["exitPrice"], b["r"]) == ("stop", 106, pytest.approx(-1.5))
    c = J.place(sig(sym="SOL"), T0)
    J.on_price(c, 112, 94, 100, T0 + 1)  # one bar spans both: counted as the stop
    assert (c["exitReason"], c["exitPrice"]) == ("stop", 95.0)


def test_limit_fills_or_expires():
    a = J.place(sig(entry=98.0), T0)
    assert a["status"] == "pending"
    tick(a, 99, T0 + 1)
    assert a["status"] == "pending"
    J.on_price(a, 99, 97.5, 98.5, T0 + 2)
    assert (a["status"], a["fill"]) == ("open", 98.0)
    b = J.place(sig(sym="ETH", entry=98.0), T0)
    tick(b, 101, T0 + J.PENDING_BARS * 300_000 + 1)
    assert (b["status"], b["exitReason"]) == ("cancelled", "expired")


def test_tracker_replays_missed_candles_then_ticks():
    o = J.place(sig(), T0)
    bars = [{"time": T0 // 1000 - 30, "high": 200, "low": 1, "close": 100},  # started before the order: ignored
            {"time": T0 // 1000 + 60, "high": 104, "low": 99, "close": 103},
            {"time": T0 // 1000 + 120, "high": 111, "low": 102, "close": 109}]
    seen = []
    assert J.track_once(lambda feed, since: seen.append((feed, since)) or bars) == 1
    assert seen == [({"src": "binance", "sym": "BTCUSDT", "yahoo": "BTC-USD"}, T0 // 1000 - 120)]
    o = J.store().get(o["id"])
    assert (o["status"], o["exitReason"], o["exitAt"]) == ("closed", "target", (T0 // 1000 + 120) * 1000)


def test_tracker_survives_feed_errors():
    o = J.place(sig(), T0)

    def boom(feed, since):
        raise OSError("offline")

    assert J.track_once(boom) == 0
    assert J.store().get(o["id"])["status"] == "open"


def test_api_flow_and_auth(monkeypatch):
    body = sig()
    r = client.post("/api/journal/orders", json=body)
    assert r.status_code == 201
    oid = r.json()["id"]
    assert client.post("/api/journal/orders", json=body).status_code == 409
    assert client.post("/api/journal/orders", json={**body, "confidence": 40}).status_code == 409
    assert client.post("/api/journal/orders", json={**body, "stop": 120}).status_code == 409
    r = client.get("/api/journal")
    assert r.json()["min_conf"] == 50 and len(r.json()["orders"]) == 1
    r = client.post(f"/api/journal/orders/{oid}/close", json={"price": 103})
    assert r.json()["exitReason"] == "manual" and r.json()["pnlPct"] == pytest.approx(0.03)
    assert client.post("/api/journal/import", json={"orders": [{**r.json(), "id": "old-1"}, r.json()]}).json() == {"added": 1}
    assert client.delete("/api/journal").status_code == 204
    assert client.get("/api/journal").json()["orders"] == []

    monkeypatch.setattr(main, "JOURNAL_KEY", "s3cret")
    assert client.get("/api/journal").status_code == 401
    assert client.get("/api/journal", headers={"X-Journal-Key": "nope"}).status_code == 401
    assert client.get("/api/journal", headers={"X-Journal-Key": "s3cret"}).status_code == 200
    assert client.post("/api/journal/orders", json=body).status_code == 401

    monkeypatch.setattr(main, "JOURNAL_KEY", "")
    monkeypatch.setattr(main, "READ_ONLY", True)  # public site without a key: log disabled
    assert client.get("/api/journal").status_code == 403


def test_tracker_skips_the_database_while_nothing_is_active(monkeypatch):
    calls = []
    real_active = J.store().active
    monkeypatch.setattr(J.store(), "active", lambda: calls.append(1) or real_active())
    assert J.track_once(lambda f, s: []) == 0 and J.track_once(lambda f, s: []) == 0
    assert len(calls) == 1  # second round skipped: no orders exist
    J.place(sig(), T0)
    before = len(calls)
    J.track_once(lambda f, s: [])
    assert len(calls) == before + 1  # a new order wakes the tracker up


def test_clear_snapshots_the_log_first(monkeypatch):
    saved = []
    monkeypatch.setattr(B, "save", lambda orders, reason: saved.append((len(orders), reason)) or "k")
    client.post("/api/journal/orders", json=sig())
    assert client.delete("/api/journal").status_code == 204
    assert saved == [(1, "before-clear")]

    def fail(orders, reason):
        raise OSError("bucket down")

    client.post("/api/journal/orders", json=sig())
    monkeypatch.setattr(B, "save", fail)
    assert client.delete("/api/journal").status_code == 502
    assert len(client.get("/api/journal").json()["orders"]) == 1  # nothing lost when the backup fails
