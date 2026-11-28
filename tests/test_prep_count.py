"""미리 만든 재료(프렙)를 장·국자 수로 세기, 그리고 예전 DB(preps.unit_kind에 'ea'가 없던 표) 옮기기."""
import os
import sqlite3
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _signup(c):
    r = c.post("/api/auth/signup", json={"email": f"pc{os.urandom(3).hex()}@example.com", "password": "password1234",
                                         "store_name": "전집", "code": ""}, headers=H)
    assert r.status_code == 200, r.text


def test_kimchijeon_batter_by_sheet_and_ladle():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c)
        kimchi = c.post("/api/ingredients", json={"name": "김치", "pack_size": 10, "pack_unit": "kg", "pack_price": 30000,
                                                  "yield_pct": 100}, headers=H).json()["item"]
        flour = c.post("/api/ingredients", json={"name": "부침가루", "pack_size": 1, "pack_unit": "kg", "pack_price": 4000,
                                                 "yield_pct": 100}, headers=H).json()["item"]
        items = [{"ingredient_id": kimchi["id"], "qty": 2, "unit": "kg"}, {"ingredient_id": flour["id"], "qty": 1, "unit": "kg"}]
        # 재료비 = 2kg×3,000 + 1kg×4,000 = 10,000원

        r = c.post("/api/preps", json={"name": "김치전 반죽", "unit_kind": "ea", "yield_qty": 20, "yield_unit": "개",
                                       "count_label": "장", "items": items}, headers=H)
        assert r.status_code == 200, r.text
        p = r.json()["item"]
        assert p["count_label"] == "장" and p["unit_price"] == 500  # 10,000원 ÷ 20장

        ing = next(i for i in c.get("/api/ingredients", headers=H).json()["items"] if i["name"] == "김치전 반죽")
        assert ing["kind"] == "ea" and ing["unit_label"] == "장" and ing["display_unit"] == "장"

        m = c.post("/api/menus", json={"name": "김치전", "price": 8000,
                                       "items": [{"ingredient_id": ing["id"], "qty": 2, "unit": "개"}]}, headers=H)
        assert m.status_code == 200, m.text
        assert round(m.json()["item"]["cost"]) == 1000

        # 같은 '개수' 안에서는 장 ↔ 국자로 바꿀 수 있다
        r = c.put(f"/api/preps/{p['id']}", json={"name": "김치전 반죽", "unit_kind": "ea", "yield_qty": 25, "yield_unit": "개",
                                                 "count_label": "국자", "items": items}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["item"]["count_label"] == "국자" and r.json()["item"]["unit_price"] == 400

        # 무게로 바꾸는 건 안 된다(이미 메뉴에 '몇 개'로 들어가 있으므로)
        r = c.put(f"/api/preps/{p['id']}", json={"name": "김치전 반죽", "unit_kind": "g", "yield_qty": 3, "yield_unit": "kg",
                                                 "items": items}, headers=H)
        assert r.status_code == 409


def test_old_preps_table_is_rebuilt_without_losing_links():
    path = os.path.join(tempfile.mkdtemp(), "old.db")
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(dbmod.SCHEMA.replace("CHECK (unit_kind IN ('g', 'ml', 'ea')),\n  yield_qty", "CHECK (unit_kind IN ('g', 'ml')),\n  yield_qty"))
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='preps'").fetchone()[0]
    assert "'ea'" not in sql
    dbmod.migrate(conn)  # 처음부터 24번까지 + 25번
    conn.close()

    # 25번 이전 상태를 만들고 데이터를 넣은 뒤 25번만 다시 돌린다
    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript(
        "DROP TABLE preps;"
        "CREATE TABLE preps (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
        " name TEXT NOT NULL, unit_kind TEXT NOT NULL CHECK (unit_kind IN ('g', 'ml')), yield_qty REAL NOT NULL DEFAULT 0,"
        " ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE, updated_at TEXT NOT NULL, created_at TEXT, UNIQUE (user_id, name));"
    )
    conn.execute("PRAGMA foreign_keys = ON")
    ucols = {r["name"]: r for r in conn.execute("PRAGMA table_info(users)")}
    vals = {c: ("x" if r["type"] == "TEXT" else 0) for c, r in ucols.items() if r["notnull"] and r["dflt_value"] is None and c != "id"}
    vals["email"] = "old@example.com"
    conn.execute(f"INSERT INTO users(id, {', '.join(vals)}) VALUES (1, {', '.join('?' * len(vals))})", list(vals.values()))
    t = "2026-01-01T00:00:00Z"
    conn.execute("INSERT INTO ingredients(id, user_id, name, unit_kind, unit_price, updated_at, created_at) VALUES (10,1,'멸치',  'g', 20, ?, ?)", (t, t))
    conn.execute("INSERT INTO ingredients(id, user_id, name, unit_kind, unit_price, updated_at, created_at) VALUES (11,1,'멸치육수','ml', 1, ?, ?)", (t, t))
    conn.execute("INSERT INTO preps(id, user_id, name, unit_kind, yield_qty, ingredient_id, updated_at, created_at) VALUES (5,1,'멸치육수','ml',5000,11,?,?)", (t, t))
    conn.execute("UPDATE ingredients SET from_prep_id = 5 WHERE id = 11")
    conn.execute("INSERT INTO prep_items(prep_id, ingredient_id, qty) VALUES (5, 10, 250)")
    conn.execute("PRAGMA user_version = 24")

    dbmod.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == dbmod.SCHEMA_VERSION
    assert "'ea'" in conn.execute("SELECT sql FROM sqlite_master WHERE name='preps'").fetchone()[0]
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("SELECT name, yield_qty FROM preps WHERE id = 5").fetchone()["yield_qty"] == 5000
    assert conn.execute("SELECT COUNT(*) FROM prep_items WHERE prep_id = 5").fetchone()[0] == 1  # 재료 줄이 안 지워졌다
    assert conn.execute("SELECT from_prep_id FROM ingredients WHERE id = 11").fetchone()[0] == 5  # 연결된 식자재도 그대로
    assert "unit_label" in {r["name"] for r in conn.execute("PRAGMA table_info(ingredients)")}
    assert not conn.execute("PRAGMA foreign_key_check").fetchall()
    conn.close()
