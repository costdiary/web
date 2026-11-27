"""메뉴 검색으로 그릇 채우기: 외부 API 없이 검색되고, 1인분 재료가 범위와 함께 오며, 내 식자재와 연결되는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import menu_presets, ocr, refdata, routes_account  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _client(seed=True):
    routes_account.reset_rate_limits()  # 이 파일은 가입을 여러 번 하므로 IP 당 가입 제한을 풀어 둠
    c = TestClient(app)
    c.__enter__()
    r = c.post("/api/auth/signup", json={"email": f"m{os.urandom(4).hex()}@example.com", "password": "password1234",
                                         "store_name": "테스트 식당", "code": ""}, headers=H)
    assert r.status_code == 200, r.text
    if seed:
        assert c.post("/api/demo/seed", headers=H).status_code == 200
    return c


def test_presets_are_sane():
    names = set()
    for p in menu_presets.all_presets():
        assert p["name"] not in names
        names.add(p["name"])
        assert len(p["lines"]) >= (1 if p["name"] == "공깃밥" else 2)
        for ln in p["lines"]:
            assert ln["unit"] in ("g", "ml", "개") and ln["qty"] > 0


def test_search_and_template_without_api(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("메뉴 검색은 외부 API 를 부르면 안 됩니다")
    monkeypatch.setattr(ocr, "vision_json", boom)
    c = _client()
    items = c.get("/api/recipe/search", params={"q": "제육"}, headers=H).json()["items"]
    assert items and items[0]["name"].startswith("제육")
    # 빈 검색은 기본 레시피 목록
    assert len(c.get("/api/recipe/search", headers=H).json()["items"]) == 8
    # 다른 이름(별칭)으로도 찾는다
    assert any(i["name"] == "짜장면" for i in c.get("/api/recipe/search", params={"q": "자장면"}, headers=H).json()["items"])

    t = c.get("/api/recipe/template", params={"id": items[0]["id"]}, headers=H).json()
    assert t["lines"]
    for ln in t["lines"]:
        assert ln["qty_low"] <= ln["qty"] <= ln["qty_high"]
    by = {ln["name"]: ln for ln in t["lines"]}
    # 예시 데이터의 식자재와 이름이 같은 재료는 자동으로 연결된다
    assert by["양파"]["match"] and by["양파"]["match"]["name"] == "양파"
    assert by["돼지 앞다리살"]["match"]["priced"] is True

    assert c.get("/api/recipe/template", params={"id": "p9999"}, headers=H).status_code == 404
    assert c.get("/api/recipe/template", params={"id": "x1"}, headers=H).status_code == 404


def _save(c, name, lines):
    body = {"name": name, "price": 9000, "category": "찌개", "lines": [
        {"apply": True, "ingredient_id": None, "name": n, "alias": n, "qty": q, "unit": u, "estimated": False} for n, q, u in lines]}
    r = c.post("/api/recipe/confirm", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_search_keeps_to_the_asked_menu():
    c = _client()
    names = [i["name"] for i in c.get("/api/recipe/search", params={"q": "김치찌개"}, headers=H).json()["items"]]
    assert "김치찌개" in names and "김치전" not in names
    # 오타는 받아 준다
    assert "김치찌개" in [i["name"] for i in c.get("/api/recipe/search", params={"q": "김치찌게"}, headers=H).json()["items"]]


def test_my_menu_comes_back_with_my_amounts():
    c = _client()  # 예시 데이터에 김치찌개 메뉴가 있음
    items = c.get("/api/recipe/search", params={"q": "김치찌개"}, headers=H).json()["items"]
    assert items[0]["source"] == "내 메뉴"
    t = c.get("/api/recipe/template", params={"id": items[0]["id"]}, headers=H).json()
    by = {ln["name"]: ln for ln in t["lines"]}
    assert by["배추김치"]["qty"] == 200 and by["배추김치"]["confirmed"] is True
    assert by["배추김치"]["match"]["name"] == "배추김치"


def test_other_stores_menu_shows_only_after_three_stores():
    name = f"우리동네순두부{os.urandom(2).hex()}"
    amounts = [(300, 20), (350, 25), (400, 30)]
    viewer = _client(seed=False)
    for i, (tofu, pepper) in enumerate(amounts):
        _save(_client(seed=False), name, [("순두부", tofu, "g"), ("고춧가루", pepper, "g"), ("바지락", 50, "g")] + ([("달걀", 1, "개")] if i == 0 else []))
        items = viewer.get("/api/recipe/search", params={"q": name}, headers=H).json()["items"]
        shared = [x for x in items if x["source"].startswith("다른 사장님들 메뉴")]
        assert bool(shared) == (i == 2)  # 세 가게째에 처음 보임
    t = viewer.get("/api/recipe/template", params={"id": shared[0]["id"]}, headers=H).json()
    by = {ln["name"]: ln for ln in t["lines"]}
    assert by["순두부"]["qty"] == 350  # 가운데 값
    assert "달걀" not in by  # 한 가게만 넣는 재료는 빠짐
    assert "3곳" in t["source"]


def test_single_confirmed_recipe_is_not_listed_alone():
    c = _client()
    lines = [("소불고기 특제", 200.0, "g"), ("양파", 60.0, "g"), ("대파", 20.0, "g")]
    refdata.contribute(f"우리집 특제 불고기 {os.urandom(2).hex()}", lines)
    items = c.get("/api/recipe/search", params={"q": "특제 불고기"}, headers=H).json()["items"]
    assert not [i for i in items if i["source"] == "사장님들이 확정한 레시피"]


def test_template_saves_through_confirm():
    c = _client()
    body = {"name": "제육볶음 테스트", "price": 9500, "category": "볶음", "lines": [
        {"apply": True, "ingredient_id": ln["match"]["id"] if ln["match"] else None, "name": ln["match"]["name"] if ln["match"] else ln["name"],
         "alias": ln["name"], "qty": ln["qty"], "unit": ln["unit"], "estimated": True, "qty_low": ln["qty_low"], "qty_high": ln["qty_high"]}
        for ln in c.get("/api/recipe/template", params={"id": "p15"}, headers=H).json()["lines"]]}
    r = c.post("/api/recipe/confirm", json=body, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["item"]["item_count"] == len(body["lines"])


def test_public_recipe_is_scaled_to_one_serving():
    c = _client(seed=False)
    conn = refdata.connect(create=True)
    try:
        rec = refdata.from_cookrcp01({"RCP_SEQ": f"t{os.urandom(3).hex()}", "RCP_NM": "테스트 된장국수", "INFO_WGT": "300",
                                      "RCP_PARTS_DTLS": "된장국수 재료 소면 400g, 된장 100g, 애호박 100g"})
        rid = refdata.upsert(conn, rec)
    finally:
        conn.close()
    t = c.get("/api/recipe/template", params={"id": f"r{rid}"}, headers=H).json()
    by = {ln["name"]: ln["qty"] for ln in t["lines"]}
    assert by["소면"] == 200 and by["된장"] == 50  # 600g -> 1인분 300g
    assert "1인분" in t["serving_note"]
