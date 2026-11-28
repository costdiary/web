"""하루 메일 한도(100통)를 공격으로 다 써서 진짜 가입자가 인증번호를 못 받는 일이 없는지.

공격자는 IP(VPN)·기기 쿠키·이메일 주소를 마음대로 바꾼다고 보고, 여러 겹(app/mail_guard.py)이
각각 버티는지와 기존 사장님 몫(비밀번호 찾기)이 남는지를 본다.
"""
import hashlib
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
os.environ["API_BLOCK_UA"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, mail_guard, mailer, routes_account  # noqa: E402
from app.db import connect, init_db, now_iso  # noqa: E402
from app.main import app  # noqa: E402

init_db()
H = {"X-Requested-With": "fetch"}
PW = "password1234"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, body: sent.append((to, subject, body)))
    monkeypatch.setenv("EMAIL_VERIFY", "1")
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("MAIL_POW_BITS", "4")  # 시험이 빨리 끝나게 쉬운 문제
    monkeypatch.setattr(mail_guard, "ADDR_COOLDOWN", 0)
    routes_account.reset_rate_limits()
    yield sent
    routes_account.reset_rate_limits()


def solve(challenge, bits):
    n = 0
    while True:
        d = hashlib.sha256(f"{challenge}:{n}".encode()).digest()
        if mail_guard._leading_zero_bits(d) >= bits:
            return str(n)
        n += 1


class Attacker:
    """요청마다 새 기기(쿠키 없는 새 클라이언트)·원하는 IP로 접속한다."""

    def __init__(self):
        self.n = 0

    def client(self):
        return TestClient(app)

    def post(self, path, email, ip, c=None, extra=None):
        c = c or self.client()
        hdr = {**H, "X-Forwarded-For": ip}
        ch = c.get("/api/auth/mail-challenge", headers=hdr).json()
        body = {"email": email, "pow_challenge": ch["challenge"], "pow_nonce": solve(ch["challenge"], ch["bits"])}
        body.update(extra or {})
        return c.post(path, json=body, headers=hdr)


def _ip(i):
    # 매번 다른 /24 묶음(VPN 서버를 바꿔 가며)
    return f"{10 + i // 250}.{i % 250}.{(i * 7) % 250}.{i % 200 + 1}"


def _make_user(email):
    with connect() as db:
        db.execute(
            "INSERT INTO users(email, pw_hash, store_name, trial_ends_at, created_at, email_verified_at) VALUES (?,?,?,?,?,?)",
            (email, auth.hash_password(PW), "", now_iso(), now_iso(), now_iso()),
        )


def _fill_log(n, kind="signup"):
    with connect() as db:
        db.executemany("INSERT INTO mail_log(at, kind, addr_key) VALUES (?,?,?)",
                       [(now_iso(), kind, f"fill{i}") for i in range(n)])


def test_vpn_attack_with_100_addresses_cannot_drain_the_day(env):
    """IP·기기·주소를 모두 바꿔 가며 100번 요청해도 한 시간 상한(12통)에서 멈춘다."""
    a = Attacker()
    codes = [a.post("/api/auth/email-code", f"victim{i}@gmail.com", _ip(i)).status_code for i in range(100)]
    assert len(env) == mail_guard.signup_per_hour() == 12
    assert codes.count(200) == 12 and set(codes[12:]) == {503}
    # 진짜 사장님은 비밀번호 찾기 메일을 받을 수 있다(가입 몫과 따로).
    _make_user("owner@naver.com")
    r = a.post("/api/auth/password/forgot", "owner@naver.com", "203.0.113.9")
    assert r.status_code == 200 and env[-1][0] == "owner@naver.com"


def test_signup_share_of_the_day_keeps_room_for_existing_owners(env):
    _fill_log(60)  # 하루 100통 중 가입 몫(60%)을 이미 다 씀
    a = Attacker()
    r = a.post("/api/auth/email-code", "new@gmail.com", "198.51.100.1")
    assert r.status_code == 503 and "카카오" in r.json()["detail"]
    _make_user("owner2@naver.com")
    assert a.post("/api/auth/password/forgot", "owner2@naver.com", "198.51.100.2").status_code == 200
    assert env and env[-1][0] == "owner2@naver.com"


def test_reset_stops_before_total_limit_and_mailer_backstop(env):
    _fill_log(95, kind="reset")
    _make_user("owner3@naver.com")
    a = Attacker()
    assert a.post("/api/auth/password/forgot", "owner3@naver.com", "198.51.100.3").status_code == 200
    assert env == []  # 95%를 넘으면 비밀번호 찾기도 멈춘다(화면에는 똑같이 '보냈어요')
    assert not mail_guard.over_total()
    _fill_log(5)
    assert mail_guard.over_total()


def test_same_inbox_variants_count_as_one_address(env):
    a = Attacker()
    variants = ["kim.owner@gmail.com", "kimowner+1@gmail.com", "k.i.m.owner@googlemail.com", "KimOwner+x@gmail.com"]
    codes = [a.post("/api/auth/email-code", v, _ip(i)).status_code for i, v in enumerate(variants)]
    assert codes == [200, 200, 200, 429]


def test_same_ip_rotating_addresses_and_devices(env):
    a = Attacker()
    codes = [a.post("/api/auth/email-code", f"x{i}@gmail.com", "192.0.2.10").status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_same_vpn_block_rotating_ips(env):
    a = Attacker()
    codes = [a.post("/api/auth/email-code", f"y{i}@gmail.com", f"192.0.2.{i + 20}").status_code for i in range(8)]
    assert codes.count(200) == 6


def test_same_device_rotating_ips(env):
    a = Attacker()
    c = TestClient(app)
    codes = [a.post("/api/auth/email-code", f"z{i}@gmail.com", _ip(i + 50), c=c).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_attacker_own_domain_is_capped(env):
    a = Attacker()
    codes = [a.post("/api/auth/email-code", f"bot{i}@attacker.example", _ip(i + 100)).status_code for i in range(8)]
    assert codes.count(200) == mail_guard.DOMAIN_PER_DAY


def test_bot_check_required_single_use_and_bound_to_device(env):
    c = TestClient(app)
    assert c.post("/api/auth/email-code", json={"email": "p@gmail.com"}, headers=H).status_code == 400
    ch = c.get("/api/auth/mail-challenge", headers=H).json()
    body = {"email": "p@gmail.com", "pow_challenge": ch["challenge"], "pow_nonce": solve(ch["challenge"], ch["bits"])}
    other = TestClient(app)  # 다른 기기에서 같은 답을 쓰면 안 된다
    other.get("/api/auth/mail-challenge", headers=H)
    assert other.post("/api/auth/email-code", json=body, headers=H).status_code == 400
    assert c.post("/api/auth/email-code", json=body, headers=H).status_code == 200
    assert c.post("/api/auth/email-code", json={**body, "email": "q@gmail.com"}, headers=H).status_code == 400  # 재사용
    # 틀린 답
    ch = c.get("/api/auth/mail-challenge", headers=H).json()
    bad = next(str(n) for n in range(1000) if mail_guard._leading_zero_bits(
        hashlib.sha256(f"{ch['challenge']}:{n}".encode()).digest()) < ch["bits"])
    assert c.post("/api/auth/email-code", json={"email": "r@gmail.com", "pow_challenge": ch["challenge"], "pow_nonce": bad},
                  headers=H).status_code == 400


def test_challenge_gets_harder_under_pressure(env):
    c = TestClient(app)
    base = c.get("/api/auth/mail-challenge", headers=H).json()["bits"]
    _fill_log(mail_guard.signup_per_hour() // 2)
    assert c.get("/api/auth/mail-challenge", headers=H).json()["bits"] == base + 2


def test_honeypot_pretends_but_sends_nothing(env):
    a = Attacker()
    r = a.post("/api/auth/email-code", "hp@gmail.com", "192.0.2.77", extra={"website": "http://spam"})
    assert r.status_code == 200 and env == []


def test_registered_address_gets_same_answer_and_counts(env):
    _make_user("taken@naver.com")
    a = Attacker()
    r1 = a.post("/api/auth/email-code", "taken@naver.com", _ip(1))
    r2 = a.post("/api/auth/email-code", "free@naver.com", _ip(2))
    assert r1.status_code == r2.status_code == 200 and r1.json() == r2.json()
    # 이미 가입된 주소로 안내 메일을 무한히 보내던 구멍: 이제 하루 3통에서 멈춘다.
    codes = [a.post("/api/auth/email-code", "taken@naver.com", _ip(i + 10)).status_code for i in range(4)]
    assert codes == [200, 200, 429, 429]


def test_forgot_password_needs_bot_check_and_stays_silent_when_capped(env):
    _make_user("owner4@naver.com")
    c = TestClient(app)
    assert c.post("/api/auth/password/forgot", json={"email": "owner4@naver.com"}, headers=H).status_code == 400
    a = Attacker()
    codes = [a.post("/api/auth/password/forgot", "owner4@naver.com", _ip(i + 200)).status_code for i in range(6)]
    assert set(codes) == {200}  # 막혀도 응답은 같다(가입 여부를 알 수 없게)
    assert len(env) == mail_guard.ADDR_PER_DAY


def test_limits_survive_restart(env):
    """숫자는 DB에 남아서, 배포로 서버를 다시 켜도(메모리 초기화) 이어진다."""
    a = Attacker()
    for i in range(3):
        a.post("/api/auth/email-code", f"s{i}@gmail.com", "192.0.2.200")
    routes_account._hits.clear()  # 메모리 쪽만 지움(재시작 흉내)
    mail_guard._used_pow.clear()
    assert a.post("/api/auth/email-code", "s9@gmail.com", "192.0.2.200").status_code == 429


def test_admin_is_notified_once_when_signup_budget_fills(env, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "boss@naver.com")
    _make_user("boss@naver.com")
    _fill_log(60)
    a = Attacker()
    for i in range(3):
        a.post("/api/auth/email-code", f"n{i}@gmail.com", _ip(i + 300))
    with connect() as db:
        uid = db.execute("SELECT id FROM users WHERE email = 'boss@naver.com'").fetchone()[0]
        n = db.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND dedupe_key LIKE 'mail_budget:%'", (uid,)).fetchone()[0]
    assert n == 1
