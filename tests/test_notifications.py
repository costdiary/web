"""알림 센터 기본 동작: 예시 데이터로 단가 상승 알림이 생기고, 읽음·분류 끄기·중복 방지가 되는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import notifications  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _client():
    c = TestClient(app)
    c.__enter__()
    r = c.post("/api/auth/signup", json={"email": f"n{os.urandom(4).hex()}@example.com", "password": "password1234",
                                         "store_name": "테스트 식당", "code": ""}, headers=H)
    assert r.status_code == 200, r.text
    assert c.post("/api/demo/seed", headers=H).status_code == 200
    notifications.reset_sync_cache()
    return c


def test_price_alerts_dedupe_and_read():
    c = _client()
    d = c.get("/api/notifications").json()
    kinds = {i["kind"] for i in d["items"]}
    assert "price_up" in kinds
    assert d["unread"] == len(d["items"]) > 0
    # 다시 불러도 같은 알림이 또 생기지 않는다
    again = c.get("/api/notifications").json()
    assert len(again["items"]) == len(d["items"])
    first = d["items"][0]["id"]
    r = c.post("/api/notifications/read", json={"ids": [first]}, headers=H).json()
    assert r["unread"] == d["unread"] - 1
    r = c.post("/api/notifications/read", json={}, headers=H).json()
    assert r["unread"] == 0
    assert c.get("/api/me").json()["notifications"]["unread"] == 0


def test_category_off_hides_and_stops():
    c = _client()
    before = c.get("/api/notifications").json()
    assert any(i["category"] == "cost" for i in before["items"])
    p = c.put("/api/notifications/prefs", json={"cost": False}, headers=H).json()["prefs"]
    assert p["cost"] is False and p["sales"] is True
    after = c.get("/api/notifications").json()
    assert not any(i["category"] == "cost" for i in after["items"])
    assert c.get("/api/notifications?category=cost").json()["items"] == []


def test_push_unknown_kind_and_no_market_category():
    """도매마켓은 원가다이어리와 다른 서비스라, 원가다이어리 알림 센터에는 '도매' 분류·종류가 없다."""
    c = _client()
    from contextlib import closing

    from app.db import connect
    me = c.get("/api/me").json()
    with closing(connect()) as db:
        uid = db.execute("SELECT id FROM users WHERE email = ?", (me["email"],)).fetchone()["id"]
        nid = notifications.push(db, uid, "notice", "공지", dedupe_key="n:1")
        assert nid
        assert notifications.push(db, uid, "notice", "중복", dedupe_key="n:1") is None
        for kind in ("nope", "ws_offer", "ws_order"):
            try:
                notifications.push(db, uid, kind, "x")
                raise AssertionError(f"unknown kind must fail: {kind}")
            except ValueError:
                pass
    assert "market" not in notifications.CATEGORIES
    assert not any(k.cat == "market" for k in notifications.KINDS.values())
