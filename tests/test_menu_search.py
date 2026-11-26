"""메뉴 검색으로 그릇 채우기: 외부 API 없이 검색되고, 1인분 재료가 범위와 함께 오며, 내 식자재와 연결되는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import menu_presets, ocr, refdata  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _client(seed=True):
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
        assert len(p["lines"]) >= 2
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


def test_confirmed_recipe_is_searchable_and_saves():
    c = _client()
    lines = [("소불고기 특제", 200.0, "g"), ("양파", 60.0, "g"), ("대파", 20.0, "g")]
    assert refdata.contribute("우리집 특제 불고기", lines)
    items = c.get("/api/recipe/search", params={"q": "특제 불고기"}, headers=H).json()["items"]
    mine = [i for i in items if i["source"] == "사장님들이 확정한 레시피"]
    assert mine
    t = c.get("/api/recipe/template", params={"id": mine[0]["id"]}, headers=H).json()
    assert {ln["name"] for ln in t["lines"]} == {n for n, _, _ in lines}

    # 기존 저장 API 로 메뉴가 만들어진다
    body = {"name": "제육볶음 테스트", "price": 9500, "category": "볶음", "lines": [
        {"apply": True, "ingredient_id": ln["match"]["id"] if ln["match"] else None, "name": ln["match"]["name"] if ln["match"] else ln["name"],
         "alias": ln["name"], "qty": ln["qty"], "unit": ln["unit"], "estimated": True, "qty_low": ln["qty_low"], "qty_high": ln["qty_high"]}
        for ln in c.get("/api/recipe/template", params={"id": "p15"}, headers=H).json()["lines"]]}
    r = c.post("/api/recipe/confirm", json=body, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["item"]["item_count"] == len(body["lines"])
