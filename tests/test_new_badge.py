"""새로 추가한 식자재·프렙은 3일 동안 목록 맨 위에 NEW(is_new)로 온다. 예시 데이터와 오래된 항목은 이름순."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _signup(c, email):
    r = c.post("/api/auth/signup", json={"email": email, "password": "password1234", "store_name": "테스트 식당", "code": ""},
               headers=H)
    assert r.status_code == 200, r.text


def _age(table, name, days):
    from app.db import connect
    conn = connect()
    try:
        conn.execute(
            f"UPDATE {table} SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) WHERE name = ?",
            (f"-{days} days", name),
        )
    finally:
        conn.close()


def test_new_items_float_to_top():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c, f"new{os.urandom(3).hex()}@example.com")
        assert c.post("/api/demo/seed", headers=H).status_code == 200

        items = c.get("/api/ingredients", headers=H).json()["items"]
        assert items and not any(i["is_new"] for i in items), "예시 데이터는 NEW가 아니다"
        names = [i["name"] for i in items]
        assert names == sorted(names)

        for nm in ("가나다 새재료", "하하 새재료"):
            r = c.post("/api/ingredients", json={"name": nm, "pack_size": 1, "pack_unit": "kg", "pack_price": 5000,
                                                 "yield_pct": 100}, headers=H)
            assert r.status_code == 200, r.text
            assert r.json()["item"]["is_new"] is True
        _age("ingredients", "가나다 새재료", 1)  # 하루 전에 추가한 것으로

        items = c.get("/api/ingredients", headers=H).json()["items"]
        assert [i["name"] for i in items[:2]] == ["하하 새재료", "가나다 새재료"]  # 최근 것부터
        assert items[0]["is_new"] and items[1]["is_new"] and not items[2]["is_new"]

        # 프렙: 만들면 프렙 목록 맨 위에 NEW, 결과물 식자재 줄도 NEW
        base = next(i for i in items if not i["is_new"] and i["kind"] == "g")
        r = c.post("/api/preps", json={"name": "멸치육수 새", "unit_kind": "g", "yield_qty": 5, "yield_unit": "kg",
                                       "items": [{"ingredient_id": base["id"], "qty": 100, "unit": "g"}]}, headers=H)
        assert r.status_code == 200, r.text
        preps = c.get("/api/preps", headers=H).json()["items"]
        assert preps[0]["name"] == "멸치육수 새" and preps[0]["is_new"]
        assert all(not p["is_new"] for p in preps[1:])
        items = c.get("/api/ingredients", headers=H).json()["items"]
        assert items[0]["name"] == "멸치육수 새" and items[0]["is_new"]

        # 3일이 지나면 NEW가 사라지고 이름순 자리로 돌아간다
        _age("ingredients", "하하 새재료", 4)
        _age("preps", "멸치육수 새", 4)
        items = c.get("/api/ingredients", headers=H).json()["items"]
        hh = next(i for i in items if i["name"] == "하하 새재료")
        assert not hh["is_new"]
        rest = [i["name"] for i in items if not i["is_new"]]
        assert rest == sorted(rest)
        preps = c.get("/api/preps", headers=H).json()["items"]
        assert not any(p["is_new"] for p in preps)
