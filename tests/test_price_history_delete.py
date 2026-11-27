"""가격 이력 한 줄 지우기: 예전 기록은 그냥 지우고, 가장 최근 기록을 지우면 지금 단가와 메뉴 원가가
바로 전 기록으로 돌아간다. 마지막 한 줄은 지울 수 없다."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _signup(c):
    r = c.post("/api/auth/signup", json={"email": f"ph{os.urandom(3).hex()}@example.com", "password": "password1234",
                                         "store_name": "테스트 식당", "code": ""}, headers=H)
    assert r.status_code == 200, r.text


def _ing(name, size, price):
    return {"name": name, "supplier": "", "category": "", "pack_size": size, "pack_unit": "kg", "pack_price": price, "yield_pct": 100}


def test_delete_price_history():
    reset_rate_limits()
    with TestClient(app) as c, TestClient(app) as other:
        _signup(c)
        _signup(other)
        iid = c.post("/api/ingredients", json=_ing("양파테스트", 10, 10000), headers=H).json()["item"]["id"]
        c.put(f"/api/ingredients/{iid}", json=_ing("양파테스트", 10, 12000), headers=H)
        c.put(f"/api/ingredients/{iid}", json=_ing("양파테스트", 10, 15000), headers=H)
        menu = c.post("/api/menus", json={"name": "양파볶음테스트", "price": 5000,
                                           "items": [{"ingredient_id": iid, "qty": 1, "unit": "kg"}]}, headers=H)
        assert menu.status_code == 200, menu.text
        mid = menu.json()["item"]["id"] if "item" in menu.json() else menu.json()["menu"]["id"]

        def cost():
            j = c.get(f"/api/menus/{mid}").json()
            return (j.get("item") or j.get("menu") or j)["cost"]
        assert cost() == 1500  # 15,000원/10kg × 1kg
        before = cost()

        hist = c.get(f"/api/ingredients/{iid}").json()["history"]
        assert [x["pack_price"] for x in hist] == [15000, 12000, 10000]
        assert all("id" in x for x in hist)

        # 다른 사람은 못 지운다
        assert other.delete(f"/api/ingredients/{iid}/history/{hist[1]['id']}", headers=H).status_code == 404

        # 예전 기록(12,000원)을 지우면 지금 단가는 그대로
        r = c.delete(f"/api/ingredients/{iid}/history/{hist[1]['id']}", headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["rolled_back"] is False
        assert r.json()["item"]["pack_price"] == 15000
        assert [x["pack_price"] for x in r.json()["history"]] == [15000, 10000]
        assert cost() == before

        # 가장 최근 기록(15,000원)을 지우면 10,000원으로 돌아가고 메뉴 원가도 바뀐다
        r = c.delete(f"/api/ingredients/{iid}/history/{hist[0]['id']}", headers=H)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rolled_back"] is True
        assert body["item"]["pack_price"] == 10000
        assert body["item"]["display_price"] == 1000
        assert [x["pack_price"] for x in body["history"]] == [10000]
        assert cost() == 1000  # 메뉴 원가도 10,000원/10kg 기준으로

        # 마지막 한 줄은 못 지운다
        r = c.delete(f"/api/ingredients/{iid}/history/{hist[2]['id']}", headers=H)
        assert r.status_code == 409
        # 없는 기록
        assert c.delete(f"/api/ingredients/{iid}/history/999999", headers=H).status_code == 404

