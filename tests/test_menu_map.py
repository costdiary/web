"""재료·메뉴 연결표(/api/menu-map)와 메뉴 추천(/api/menu-ideas)."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.menu_map import family_of, key  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402
from tests.menu_store import H, build  # noqa: E402


def _signup(c):
    r = c.post("/api/auth/signup", json={"email": f"map{os.urandom(3).hex()}@example.com", "password": "password1234",
                                         "store_name": "동네 고깃집", "code": ""}, headers=H)
    assert r.status_code == 200, r.text


def test_family_matching():
    assert family_of("국내산 삼겹살 1kg") == "삼겹살"
    assert family_of("돼지 앞다리살") == "돼지고기"
    assert family_of("청정원 고추장(3kg)") == "고추장"
    assert family_of("배추김치") == "배추김치"
    assert family_of("김치") == "배추김치"
    assert family_of("김") == "김"
    assert family_of("쌀 20kg") == "쌀"
    assert family_of("쌀국수면") != "쌀"
    assert family_of("돼지불고기") == "돼지고기"
    assert family_of("국물용 멸치") is None  # 멸치 자체는 육수가 아니다
    assert family_of("멸치육수") == "육수"
    assert key("돼지 삼겹살(국내산) 1kg") == "돼지삼겹살"


def test_map_counts_preps_and_core():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c)
        build(c)
        m = c.get("/api/menu-map", headers=H).json()
        by = {i["name"]: i for i in m["ingredients"]}
        # 고추장은 메뉴에 직접 안 넣고 '제육 양념장' 프렙을 거쳐 제육볶음에 들어간다
        gochu = by["고추장"]
        assert gochu["menu_count"] == 1 and gochu["menus"][0]["name"] == "제육볶음"
        assert gochu["menus"][0]["via"] == ["제육 양념장"]
        assert gochu["preps"] == ["제육 양념장"]
        # 대파는 직접 5개 메뉴에 들어가고, 그중 국물 메뉴에는 멸치육수를 거쳐서도 들어간다
        assert by["대파"]["menu_count"] == 5
        assert any(x["via"] == ["멸치육수"] for x in by["대파"]["menus"])
        # 메뉴에 안 쓰는 식자재
        assert by["냉면 사리"]["tier"] == "unused"
        # 판매 수량이 있으면 한 달 사용량·금액을 계산
        assert m["summary"]["by_sales"] is True
        assert by["돼지 삼겹살"]["monthly_cost"] > 0
        core = [i["name"] for i in m["ingredients"] if i["tier"] == "core"]
        assert core and len(core) <= 6
        assert "돼지 삼겹살" in core or "돼지 앞다리살" in core
        assert "소금" not in core
        # 정렬: 쓰는 메뉴 수가 많은 순
        counts = [i["menu_count"] for i in m["ingredients"]]
        assert counts == sorted(counts, reverse=True)
        assert {p["name"] for p in m["preps"]} == {"제육 양념장", "멸치육수"}


def test_ideas_bean_sprout_bulgogi():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c)
        build(c, with_sales=False)
        res = c.get("/api/menu-ideas", headers=H).json()
        names = [x["name"] for x in res["items"]]
        assert "콩나물불고기" in names, names
        k = next(x for x in res["items"] if x["name"] == "콩나물불고기")
        assert k["missing"] == []
        src = {s["name"] for s in k["sources"]}
        assert "콩나물국" in src and "제육볶음" in src
        assert k["cost"] > 0 and k["price"] and k["price"] % 500 == 0
        # 이미 파는 메뉴(제육볶음·김치찌개·된장찌개·계란찜)는 추천하지 않는다
        for sold in ("제육볶음", "김치찌개", "차돌 된장찌개", "계란찜"):
            assert sold not in names
        # 새로 살 재료가 적은 것부터
        miss = [len(x["missing"]) for x in res["items"]]
        assert miss == sorted(miss)
        assert all(len(x["missing"]) <= 2 for x in res["items"])


def test_empty_store():
    reset_rate_limits()
    with TestClient(app) as c:
        _signup(c)
        m = c.get("/api/menu-map", headers=H).json()
        assert m["ingredients"] == [] and m["menus"] == []
        assert c.get("/api/menu-ideas", headers=H).json()["items"] == []
