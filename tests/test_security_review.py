"""2026-11 배포 전 보안 검토: 꾸민 결제 웹훅을 받지 않는지, 확인 안 된 소셜 이메일로 기존 계정에 붙지 않는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import oauth  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _signup(c, email):
    r = c.post("/api/auth/signup", json={"email": email, "password": "password1234", "store_name": "테스트 식당", "code": ""},
               headers=H)
    assert r.status_code == 200, r.text


def test_forged_webhook_cannot_mark_donation_paid():
    os.environ.pop("TOSS_SECRET_KEY", None)
    os.environ.pop("PAYMENTS_MOCK_WEBHOOK", None)
    os.environ["DONATION_ENABLED"] = "1"
    with TestClient(app) as c:
        _signup(c, f"d{os.urandom(3).hex()}@example.com")
        r = c.post("/api/donations", json={"nickname": "가짜", "amount": 1000, "message": "", "amount_public": True}, headers=H)
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]
        with TestClient(app) as anon:
            w = anon.post("/api/payments/toss/webhook",
                          json={"data": {"orderId": order_id, "status": "DONE", "totalAmount": 1000}})
            assert w.status_code == 404
        from app.db import connect
        conn = connect()
        try:
            st = conn.execute("SELECT status FROM donations WHERE pg_order_id = ?", (order_id,)).fetchone()[0]
        finally:
            conn.close()
        assert st == "requested"


class _Resp:
    status_code = 200

    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d


def test_unverified_social_email_is_ignored(monkeypatch):
    cases = {
        "kakao": {"id": 1, "kakao_account": {"email": "victim@example.com", "is_email_valid": True, "is_email_verified": False}},
        "google": {"sub": "g1", "email": "victim@example.com", "email_verified": False},
        "naver": {"response": {"id": "n1", "email": "victim@example.com"}},
    }
    for provider, data in cases.items():
        monkeypatch.setattr(oauth.httpx, "get", lambda *a, _d=data, **k: _Resp(_d))
        _uid, email = oauth._profile(provider, "tok")
        assert email is None, provider

    monkeypatch.setattr(oauth.httpx, "get", lambda *a, **k: _Resp({"sub": "g2", "email": "me@example.com", "email_verified": True}))
    assert oauth._profile("google", "tok")[1] == "me@example.com"
    monkeypatch.setattr(oauth.httpx, "get", lambda *a, **k: _Resp({"response": {"id": "n2", "email": "me@naver.com"}}))
    assert oauth._profile("naver", "tok")[1] == "me@naver.com"


def test_donations_hidden_by_default():
    os.environ.pop("DONATION_ENABLED", None)
    with TestClient(app) as c:
        _signup(c, f"h{os.urandom(3).hex()}@example.com")
        assert c.get("/api/public").json()["donation_enabled"] is False
        r = c.post("/api/donations", json={"nickname": "a", "amount": 1000, "message": "", "amount_public": False}, headers=H)
        assert r.status_code == 404
        assert c.get("/api/donations/leaderboard").status_code == 404
