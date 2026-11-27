"""개선사항 요청: 로그인 없이도 보낼 수 있고, 운영자만 목록을 보고 상태를 바꾼다. 예전 도입 문의 주소는 없어졌다."""
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


def test_feedback_flow():
    reset_rate_limits()
    admin_email = f"fb{os.urandom(3).hex()}@example.com"
    os.environ["ADMIN_EMAILS"] = admin_email
    with TestClient(app) as anon, TestClient(app) as owner, TestClient(app) as adm:
        # 로그인 안 한 방문자
        r = anon.post("/api/feedback", json={"category": "idea", "message": "메뉴 원가를 엑셀로 뽑고 싶어요", "contact": "010-0000-0000",
                                             "page": "landing"}, headers=H)
        assert r.status_code == 200, r.text
        # 너무 짧거나 이상한 종류는 거절
        assert anon.post("/api/feedback", json={"message": "   a  "}, headers=H).status_code in (400, 422)
        assert anon.post("/api/feedback", json={"category": "hack", "message": "내용 다섯자 이상"}, headers=H).status_code == 422
        # 예전 도입 문의는 없어짐
        assert anon.post("/api/leads", json={"contact": "010-1111-2222"}, headers=H).status_code in (404, 405)

        # 로그인한 사장님: 계정이 붙는다
        owner_email = f"o{os.urandom(3).hex()}@example.com"
        _signup(owner, owner_email)
        assert owner.post("/api/feedback", json={"category": "bug", "message": "명세서 날짜가 틀려요", "page": "app"}, headers=H).status_code == 200

        # 운영자가 아니면 목록을 못 본다
        assert owner.get("/api/admin/feedback").status_code == 404
        assert anon.get("/api/admin/feedback").status_code in (401, 404)

        _signup(adm, admin_email)
        res = adm.get("/api/admin/feedback?status=new").json()
        mine = [i for i in res["items"] if i["message"] in ("메뉴 원가를 엑셀로 뽑고 싶어요", "명세서 날짜가 틀려요")]
        assert len(mine) == 2
        bug = next(i for i in mine if i["category"] == "bug")
        idea = next(i for i in mine if i["category"] == "idea")
        assert bug["email"] == owner_email and bug["user_id"]
        assert idea["user_id"] is None and idea["contact"] == "010-0000-0000"
        assert adm.get("/api/admin/stats?days=7").json()["feedback_new"] >= 2

        # 상태·메모 바꾸기
        r = adm.patch(f"/api/admin/feedback/{bug['id']}", json={"status": "done", "admin_note": "12월 업데이트"}, headers=H)
        assert r.status_code == 200 and r.json()["status"] == "done"
        assert owner.patch(f"/api/admin/feedback/{bug['id']}", json={"status": "new"}, headers=H).status_code == 404
        assert adm.patch(f"/api/admin/feedback/{bug['id']}", json={"status": "weird"}, headers=H).status_code == 422
        done = adm.get("/api/admin/feedback?status=done").json()
        assert any(i["id"] == bug["id"] and i["admin_note"] == "12월 업데이트" for i in done["items"])
        assert all(i["id"] != bug["id"] for i in adm.get("/api/admin/feedback?status=new").json()["items"])


def test_feedback_rate_limit():
    reset_rate_limits()
    with TestClient(app) as anon:
        codes = [anon.post("/api/feedback", json={"message": f"요청 내용 {i}번째"}, headers=H).status_code for i in range(9)]
        assert codes[:8] == [200] * 8 and codes[8] == 429
    reset_rate_limits()
