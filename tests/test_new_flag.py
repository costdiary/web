"""새로 추가한 식자재·프렙은 created_at이 채워져 화면에서 맨 위 NEW로 보인다.
예시 데이터와 기존 DB의 옛 행은 비워 둔다(NEW 아님)."""
import os
import sqlite3
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import db as dbm  # noqa: E402
from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _signup(c):
    r = c.post("/api/auth/signup", json={"email": f"nf{os.urandom(3).hex()}@example.com", "password": "password1234",
                                         "store_name": "테스트 식당", "code": ""}, headers=H)
    assert r.status_code == 200, r.text


def test_new_items_get_created_at_and_demo_does_not():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c)
        assert c.post("/api/demo/seed", headers=H).status_code == 200
        items = c.get("/api/ingredients").json()["items"]
        assert items and all(i["created_at"] is None for i in items)

        ing = c.post("/api/ingredients", json={"name": "새양파", "supplier": "", "category": "", "pack_size": 10,
                                                "pack_unit": "kg", "pack_price": 10000, "yield_pct": 100}, headers=H)
        assert ing.status_code == 200, ing.text
        assert ing.json()["item"]["created_at"] and dbm.parse_iso(ing.json()["item"]["created_at"])

        prep = c.post("/api/preps", json={"name": "새육수", "unit_kind": "g", "yield_qty": 5, "yield_unit": "kg",
                                          "items": [{"ingredient_id": ing.json()["item"]["id"], "qty": 1, "unit": "kg"}]}, headers=H)
        assert prep.status_code == 200, prep.text
        assert prep.json()["item"]["created_at"]
        # 프렙 결과물 식자재 줄도 새것
        by_name = {i["name"]: i for i in c.get("/api/ingredients").json()["items"]}
        assert by_name["새육수"]["created_at"]


def test_upgrade_from_v21_keeps_old_rows_blank():
    path = os.path.join(tempfile.mkdtemp(), "old.db")
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE ingredients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")
    conn.execute("CREATE TABLE preps (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")
    conn.execute("INSERT INTO ingredients(name) VALUES ('옛것')")
    conn.execute("PRAGMA user_version = 21")
    dbm.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == dbm.SCHEMA_VERSION
    assert conn.execute("SELECT created_at FROM ingredients WHERE name='옛것'").fetchone()[0] is None
    conn.execute("INSERT INTO ingredients(name) VALUES ('새것')")
    conn.execute("INSERT INTO preps(name) VALUES ('새프렙')")
    assert dbm.parse_iso(conn.execute("SELECT created_at FROM ingredients WHERE name='새것'").fetchone()[0])
    assert dbm.parse_iso(conn.execute("SELECT created_at FROM preps WHERE name='새프렙'").fetchone()[0])
