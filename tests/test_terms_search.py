"""분류·등급·부위 자동완성: 정육 밖 분류에도 후보가 넉넉하고, 빈칸이면 그 분류 것만, 검색하면 맞는 것만 온다."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import market_catalog  # noqa: E402
from app.main import app  # noqa: E402
from app.routes_account import reset_rate_limits  # noqa: E402

H = {"X-Requested-With": "fetch"}


def _terms(c, kind, q="", category=""):
    r = c.get("/api/market/terms", params={"kind": kind, "q": q, "category": category}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["terms"]


def test_seed_is_valid():
    seed = market_catalog.TERMS_SEED
    assert len(seed) == len(set(seed))
    cats = {t for k, _, t in seed if k == "category"}
    for k, cat, t in seed:
        assert t == t.strip() and t
        if k == "grade":
            assert len(t) <= 10, t
        if k == "cut":
            assert len(t) <= 40, t
        if k != "category":
            assert cat in cats, (cat, t)
    # 정육 밖의 분류도 후보가 넉넉하다
    for cat in ("채소", "수산", "과일", "곡류", "양념", "가공", "유제품"):
        assert sum(1 for k, c, _ in seed if c == cat) >= 10, cat


def test_search_filters_by_keyword_and_category():
    reset_rate_limits()
    with TestClient(app) as c:
        r = c.post("/api/auth/signup", json={"email": f"terms{os.urandom(3).hex()}@example.com", "password": "password1234",
                                             "store_name": "테스트 식당", "code": ""}, headers=H)
        assert r.status_code == 200, r.text

        # 빈칸: 그 분류 후보만(정육 부위가 채소 칸에 섞이지 않는다)
        veg = _terms(c, "cut", "", "채소")
        assert veg and all((("cut", "채소", t) in set(market_catalog.TERMS_SEED)) for t in veg), veg
        # 검색: 글자가 들어간 것만, 띄어쓰기 무시
        hits = _terms(c, "cut", "슬라이스", "수산")
        assert hits and all("슬라이스" in t for t in hits)
        assert _terms(c, "grade", "msa9", "정육")[0] == "MSA 9"
        # 초성 검색
        assert "삼겹살" in _terms(c, "cut", "ㅅㄱㅅ", "정육")
        # 분류 칸에 새 분류도 나온다
        assert "해조류" in _terms(c, "category", "해조")
        # 맞는 게 없으면 빈 목록
        assert _terms(c, "cut", "zzzz없는말") == []
