"""여러 가게가 등록한 메뉴로 늘어나는 메뉴 추천(app/menu_community.py)."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import menu_community  # noqa: E402
from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402
from tests.menu_store import H, build  # noqa: E402


def _signup(c, store="동네 가게"):
    reset_rate_limits()
    c.cookies.clear()
    r = c.post("/api/auth/signup", json={"email": f"com{os.urandom(4).hex()}@example.com", "password": "password1234",
                                         "store_name": store, "code": ""}, headers=H)
    assert r.status_code == 200, r.text


def _store(c, store, menus):
    """menus: [(메뉴 이름, [(식자재 이름, 양 g)])]"""
    _signup(c, store)
    ids = {}
    for _menu, items in menus:
        for name, _q in items:
            if name in ids:
                continue
            r = c.post("/api/ingredients", json={"name": name, "pack_size": 1, "pack_unit": "kg", "pack_price": 10000, "category": ""}, headers=H)
            assert r.status_code == 200, r.text
            ids[name] = r.json()["item"]["id"]
    for menu, items in menus:
        r = c.post("/api/menus", json={"name": menu, "price": 12000, "category": "볶음",
                                       "items": [{"ingredient_id": ids[n], "qty": q, "unit": "g"} for n, q in items]}, headers=H)
        assert r.status_code == 200, r.text


def test_shared_menus_become_ideas():
    with TestClient(app) as c:
        # 세 가게가 '목살김치볶음'을 판다. 양은 가게마다 다르고, 한 가게만 쓰는 비밀 재료가 있다.
        _store(c, "가게A", [("목살김치볶음", [("국내산 돼지 목살 1kg", 180), ("배추김치", 120), ("양파", 40), ("특제 비밀소스", 30)]),
                          ("두 곳만 파는 볶음", [("돼지 목살", 100), ("양파", 50)])])
        _store(c, "가게B", [("목살 김치볶음(1인)", [("돼지 목살", 200), ("포기김치", 100), ("양파", 50)]),
                          ("두 곳만 파는 볶음", [("돼지 목살", 100), ("양파", 50)])])
        _store(c, "가게C", [("목살김치볶음", [("목살", 160), ("김치", 140), ("양파", 30), ("대파", 10)])])
        # 체험용 예시 데이터는 셈에 넣지 않는다
        for _ in range(3):
            _signup(c, "예시 가게")
            r = c.post("/api/demo/seed", headers=H)
            assert r.status_code == 200, r.text
        menu_community.clear()
        from app.db import connect
        conn = connect()
        try:
            assert not any(r["name"] == "돈까스" for r in menu_community.recipes(conn))
        finally:
            conn.close()

        # 고깃집(목살·김치·양파가 있음)에서 추천을 본다
        _signup(c, "동네 고깃집")
        build(c, with_sales=False)
        menu_community.clear()
        res = c.get("/api/menu-ideas", headers=H).json()
        by = {x["name"]: x for x in res["items"]}
        assert "목살김치볶음" in by, list(by)
        x = by["목살김치볶음"]
        assert x["src"] == "stores" and x["stores"] == 3
        assert "3곳" in x["pitch"]
        names = {ln["name"] for ln in x["lines"]}
        # 세 곳 모두 쓰는 재료만, 재료 가족 이름으로
        assert names == {"돼지고기", "배추김치", "양파"}, names
        assert not any("비밀" in n or "대파" == n for n in names)
        qty = {ln["name"]: ln["qty"] for ln in x["lines"]}
        assert qty["돼지고기"] == 180 and qty["배추김치"] == 120 and qty["양파"] == 40  # 가운데 값
        assert not any(s in str(x) for s in ("가게A", "가게B", "가게C", "비밀소스"))
        assert "두 곳만 파는 볶음" not in by
        assert res["summary"]["from_stores"] >= 1


def test_own_store_not_counted():
    with TestClient(app) as c:
        for s in ("갑", "을"):
            _store(c, s, [("우리끼리 덮밥", [("돼지 목살", 150), ("양파", 40), ("배추김치", 50)])])
        # 세 번째 가게 자신이 파는 메뉴는 '3곳'으로 세지 않는다(자기 빼면 2곳)
        _store(c, "병", [("우리끼리 덮밥", [("돼지 목살", 150), ("양파", 40), ("배추김치", 50)])])
        menu_community.clear()
        from app.db import connect
        conn = connect()
        try:
            me = conn.execute("SELECT id FROM users ORDER BY id DESC LIMIT 1").fetchone()["id"]
            assert not any(r["name"] == "우리끼리 덮밥" for r in menu_community.recipes(conn, exclude_user_id=me))
            assert any(r["name"] == "우리끼리 덮밥" for r in menu_community.recipes(conn))
        finally:
            conn.close()
