"""이메일 가입 인증번호: 남의 이메일로 가입하거나, 운영자 이메일을 먼저 적어 운영자 권한을 얻지 못하는지."""
import os
import re
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import email_verify, mailer, routes_account  # noqa: E402
from app.db import connect  # noqa: E402
from app.main import app  # noqa: E402

H = {"X-Requested-With": "fetch"}
PW = "password1234"


@pytest.fixture(autouse=True)
def _fresh_limits():
    # 다른 시험 파일과 같은 프로세스에서 돌므로, 여기서 쓴 가입 횟수 제한을 남기지 않는다.
    routes_account.reset_rate_limits()
    yield
    routes_account.reset_rate_limits()


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body: sent.append((to, subject, body)))
    monkeypatch.setenv("EMAIL_VERIFY", "1")
    routes_account.reset_rate_limits()
    yield sent
    routes_account.reset_rate_limits()


def _code(sent, to):
    for t, subject, body in reversed(sent):
        if t == to:
            m = re.search(r"인증번호 (\d{6})", subject)
            if m:
                return m.group(1)
    raise AssertionError(f"no code mail to {to}: {sent}")


def _mail():
    return f"u{os.urandom(4).hex()}@example.com"


def _signup(c, email, code=""):
    return c.post("/api/auth/signup", json={"email": email, "password": PW, "store_name": "테스트", "email_code": code}, headers=H)


def test_signup_needs_code_from_mail(outbox):
    email = _mail()
    with TestClient(app) as c:
        assert c.get("/api/public").json()["email_verify_required"] is True
        r = _signup(c, email)
        assert r.status_code == 400
        assert c.post("/api/auth/email-code", json={"email": email}, headers=H).status_code == 200
        code = _code(outbox, email)
        wrong = "000000" if code != "000000" else "111111"
        assert _signup(c, email, wrong).status_code == 400
        r = _signup(c, email, code)
        assert r.status_code == 200, r.text
        me = c.get("/api/me").json()
        assert me["email_verify"]["verified"] is True
    # 번호는 한 번 쓰면 사라진다
    conn = connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM email_codes WHERE email = ?", (email,)).fetchone()[0] == 0
    finally:
        conn.close()


def test_wrong_code_five_times_kills_code(outbox):
    email = _mail()
    with TestClient(app) as c:
        c.post("/api/auth/email-code", json={"email": email}, headers=H)
        code = _code(outbox, email)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(email_verify.MAX_ATTEMPTS):
            assert _signup(c, email, wrong).status_code == 400
            routes_account.reset_rate_limits()
        r = _signup(c, email, code)
        assert r.status_code == 400 and "만료" in r.json()["detail"]


def test_resend_cooldown_and_existing_email_not_revealed(outbox):
    email = _mail()
    with TestClient(app) as c:
        assert c.post("/api/auth/email-code", json={"email": email}, headers=H).status_code == 200
        assert c.post("/api/auth/email-code", json={"email": email}, headers=H).status_code == 429
        assert _signup(c, email, _code(outbox, email)).status_code == 200
    with TestClient(app) as other:
        r = other.post("/api/auth/email-code", json={"email": email}, headers=H)
        assert r.status_code == 200  # 가입된 주소여도 같은 응답
        assert "이미 가입된" in outbox[-1][1]


def test_admin_requires_verified_email(outbox, monkeypatch):
    email = _mail()
    # 메일 인증이 꺼진 상태에서 운영자 이메일로 먼저 가입해 둔 계정(확인 안 됨)
    monkeypatch.setenv("EMAIL_VERIFY", "0")
    monkeypatch.setenv("ADMIN_EMAILS", email)
    with TestClient(app) as c:
        assert _signup(c, email).status_code == 200
        me = c.get("/api/me").json()
        assert me["is_admin"] is False
        assert me["email_verify"]["verified"] is False
        assert c.get("/api/admin/stats").status_code == 404
        # 메일 인증을 켜면 설정 화면에서 자기 주소로 확인할 수 있고, 그 뒤에 운영자가 된다
        monkeypatch.setenv("EMAIL_VERIFY", "1")
        assert c.post("/api/me/email-code", headers=H).status_code == 200
        me = c.post("/api/me/email-verify", json={"code": _code(outbox, email)}, headers=H).json()
        assert me["email_verify"]["verified"] is True
        assert me["is_admin"] is True


def test_off_without_smtp_keeps_old_signup(monkeypatch):
    monkeypatch.delenv("EMAIL_VERIFY", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    routes_account.reset_rate_limits()
    with TestClient(app) as c:
        assert c.get("/api/public").json()["email_verify_required"] is False
        assert c.post("/api/auth/email-code", json={"email": _mail()}, headers=H).status_code == 404
        assert _signup(c, _mail()).status_code == 200
