"""도매마켓과 원가다이어리 분리: 결제 키·웹훅이 서비스별로 나뉘고, 공개 설정에 서로의 주소만 있는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import payments  # noqa: E402
from app.main import app  # noqa: E402


def test_payment_keys_are_separate(monkeypatch):
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_wongae")
    monkeypatch.delenv("MARKET_TOSS_SECRET_KEY", raising=False)
    assert payments.get_provider().name == "toss"
    # 원가다이어리 키만 있으면 도매마켓은 그 키를 빌리지 않고 모의 결제로 돈다.
    assert payments.get_provider("market").name == "mock"
    monkeypatch.setenv("MARKET_TOSS_SECRET_KEY", "test_sk_market")
    p = payments.get_provider("market")
    assert p.name == "toss" and p.secret_key == "test_sk_market"


def test_order_id_prefix():
    assert payments.make_order_id("don", 3) == "wongae-don-3"
    assert payments.make_order_id("ad", 7, "market") == "domae-ad-7"


def test_webhooks_only_take_their_own_orders(monkeypatch):
    monkeypatch.setenv("PAYMENTS_MOCK_WEBHOOK", "1")  # 키 없는 모의 결제에서도 웹훅을 받게 해서 주문번호 구분만 본다
    monkeypatch.delenv("TOSS_SECRET_KEY", raising=False)
    monkeypatch.delenv("MARKET_TOSS_SECRET_KEY", raising=False)
    with TestClient(app) as c:
        body = {"data": {"orderId": "domae-ad-999", "status": "DONE", "paymentKey": "k", "totalAmount": 1}}
        r = c.post("/api/payments/toss/webhook", json=body)
        assert r.status_code == 404 and "주문번호" in r.json()["detail"]
        body = {"data": {"orderId": "wongae-don-999", "status": "DONE", "paymentKey": "k", "totalAmount": 1}}
        r = c.post("/api/ws/payments/toss/webhook", json=body)
        assert r.status_code == 404 and "주문번호" in r.json()["detail"]
        # 자기 주문번호 모양이면 통과해서 실제 결제를 찾는다(없으니 404지만 메시지가 다르다).
        r = c.post("/api/ws/payments/toss/webhook", json={"data": {"orderId": "domae-ad-999", "status": "DONE"}})
        assert r.status_code == 404 and "주문번호" not in r.json()["detail"]


def test_public_config_links(monkeypatch):
    monkeypatch.delenv("MARKET_HOSTS", raising=False)
    with TestClient(app) as c:
        pub = c.get("/api/public").json()
        assert pub["market_url"] == "/partner"
        monkeypatch.setenv("MARKET_HOSTS", "domae.example.com")
        assert c.get("/api/public").json()["market_url"] == "https://domae.example.com/"
