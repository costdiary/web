"""운영 현황: 첫 화면 방문을 하루 한 사람 한 번만 세고, 로봇은 빼고, 운영자만 숫자를 볼 수 있는지."""
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}
CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"


def _signup(c, email):
    r = c.post("/api/auth/signup", json={"email": email, "password": "password1234", "store_name": "테스트 식당", "code": ""},
               headers=H)
    assert r.status_code == 200, r.text


def test_visits_and_signups_for_admin_only():
    admin_email = f"admin{os.urandom(3).hex()}@example.com"
    os.environ["ADMIN_EMAILS"] = admin_email
    with TestClient(app) as anon:
        before = None
        with TestClient(app) as adm:
            _signup(adm, admin_email)
            before = adm.get("/api/admin/stats?days=7").json()

            anon.get("/", headers={"user-agent": CHROME, "referer": "https://www.instagram.com/p/abc"})
            anon.get("/", headers={"user-agent": CHROME})  # 같은 사람 다시: 조회만 +1
            anon.get("/?utm_source=threads", headers={"user-agent": PHONE})  # 다른 브라우저: 새 방문자
            anon.get("/", headers={"user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"})  # 로봇은 안 셈
            anon.get("/", headers={"user-agent": "GPTBot/1.1"})

            _signup(anon, f"u{os.urandom(3).hex()}@example.com")
            after = adm.get("/api/admin/stats?days=7").json()

        assert after["visits"]["today"] - before["visits"]["today"] == 2
        assert after["visits"]["today_views"] - before["visits"]["today_views"] == 3
        assert after["signups"]["total"] - before["signups"]["total"] == 1
        assert after["signups"]["today"] >= 2
        srcs = {r["source"]: r["visitors"] for r in after["sources"]}
        assert srcs.get("instagram.com", 0) >= 1 and srcs.get("threads", 0) >= 1
        assert len(after["series"]) == 7 and after["series"][-1]["day"] == after["today"]

        # 운영자가 아니면 숫자를 볼 수 없다
        assert anon.get("/api/admin/stats").status_code == 404
