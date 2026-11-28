"""메일 발송 한도 지키기: 한 사람이 가입·비밀번호 찾기를 수백 번 눌러 하루 메일 한도를 다 써 버리지 못하게.

메일 서비스(Resend 무료)는 하루 100통·한 달 3,000통까지만 보낸다. 한도를 다 쓰면 진짜 가입자도
인증번호를 못 받는다. 공격자는 IP(VPN)도, 기기 표시(쿠키)도, 이메일 주소도 마음대로 바꿀 수 있으므로
어느 한 가지만 세서는 막을 수 없다. 그래서 여러 겹으로 막는다.

1. 전체 예산을 용도별로 나눈다(가장 중요한 겹). 로그인 없이 누구나 보낼 수 있는 가입 인증번호는
   하루 한도의 60%까지만, 그리고 한 시간에 12통까지만 쓴다. 남은 40%는 이미 가입한 사장님 몫
   (설정의 이메일 확인 80%까지, 비밀번호 찾기 95%까지)이라, 가입 쪽이 공격받아도 기존 사장님은
   비밀번호를 찾을 수 있다. 한 시간 상한 덕분에 몰아서 공격해도 하루 중 다른 시간대 가입자 몫은 남는다.
   가입 쪽 예산이 다 차면 화면이 카카오·네이버·구글 가입을 안내한다(메일이 필요 없음).
2. 받는 쪽 제한: 같은 주소는 하루 3통(gmail의 점·+별칭은 같은 주소로 센다), 흔한 메일 서비스가 아닌
   도메인(공격자 자기 도메인 등)은 도메인 전체로 하루 5통.
3. 보내는 쪽 제한: 접속 주소(IP), 같은 동네 주소 묶음(IPv4 /24, IPv6 /48: VPN 업체는 주소를 묶음으로
   가짐), 기기 표시 쿠키마다 시간·하루 상한.
4. 사람 확인(작업 증명): 인증번호를 요청하기 전에 브라우저가 1초 안팎의 계산 문제를 풀어야 한다.
   한 문제는 한 번만 쓸 수 있고 그 기기에서만 통한다. 사람은 기다리는 줄도 모르지만, 수천 번 돌리는
   프로그램에는 비용이 된다. 가입 쪽 예산이 빠르게 줄면 문제를 더 어렵게 낸다. 숨긴 입력칸(사람은 못 봄)에
   값이 들어오면 프로그램으로 보고 조용히 무시한다.
5. 모든 발송은 mail_log 표에 남겨 서버를 다시 켜도(배포해도) 숫자가 이어진다. mailer.send()도 마지막으로
   전체 한도를 한 번 더 확인하므로, 나중에 새 메일 경로를 만들 때 이 파일을 깜빡해도 한도를 넘지 않는다.

숫자는 .env로 바꿀 수 있다: MAIL_DAY_LIMIT(100), MAIL_MONTH_LIMIT(3000), MAIL_SIGNUP_PER_HOUR(12),
MAIL_POW_BITS(17, 0이면 작업 증명 끔).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import time
from contextlib import closing
from dataclasses import dataclass

from . import config
from .db import connect, now_iso, parse_iso

log = logging.getLogger("wongaenote.mail_guard")

DEVICE_COOKIE = "dvc"

# 용도. ANON은 로그인 없이 누구나 부를 수 있는 것.
SIGNUP = "signup"              # 가입 인증번호
SIGNUP_EXISTS = "signup_exists"  # 이미 가입된 주소로 가입을 시도했다는 안내
ACCOUNT = "account"            # 로그인한 사장님이 설정에서 자기 주소 확인
RESET = "reset"                # 비밀번호 찾기
ANON = (SIGNUP, SIGNUP_EXISTS)

# 용도별로 하루(최근 24시간) 전체 발송이 한도의 몇 %일 때까지 보낼 수 있는지.
SHARE = {SIGNUP: 0.60, SIGNUP_EXISTS: 0.60, ACCOUNT: 0.80, RESET: 0.95}

ADDR_COOLDOWN = 60            # 같은 주소로 다시 보내려면 기다릴 초
ADDR_PER_DAY = 3
DOMAIN_PER_DAY = 5            # 흔한 메일 서비스가 아닌 도메인 전체
# (기준, 한 시간 상한, 하루 상한) — 로그인 없이 부르는 용도(가입·비밀번호 찾기)에만 적용
SOURCE_LIMITS = {"ip": (3, 6), "net": (6, 15), "device": (3, 6)}

COMMON_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com",
    "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "yahoo.com",
    "yahoo.co.kr", "hanmir.com", "korea.com", "empas.com", "dreamwiz.com", "proton.me", "protonmail.com",
})

POW_TTL = 600  # 문제를 받은 뒤 풀어서 낼 때까지 허용하는 초
_SECRET = secrets.token_bytes(32)  # 서버를 다시 켜면 바뀜(풀던 문제만 무효, 10분짜리라 괜찮음)
_used_pow: dict[str, float] = {}


class Blocked(Exception):
    """보내지 않는다. busy=True면 전체 예산 문제(사장님 잘못이 아님)."""

    def __init__(self, message: str, status: int = 429, busy: bool = False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.busy = busy


@dataclass
class Source:
    ip: str = ""
    device: str = ""

    @property
    def net(self) -> str:
        return network_of(self.ip)


# ---------------------------------------------------------------- 숫자 세는 기준

def day_limit() -> int:
    return max(1, config.env_int("MAIL_DAY_LIMIT", 100))


def month_limit() -> int:
    return max(1, config.env_int("MAIL_MONTH_LIMIT", 3000))


def signup_per_hour() -> int:
    return max(1, config.env_int("MAIL_SIGNUP_PER_HOUR", 12))


def normalize(email: str) -> str:
    """같은 받은편지함으로 가는 다른 표기를 하나로. gmail은 점·+뒤를 무시, 다른 곳은 +뒤만 무시."""
    email = (email or "").strip().lower()
    local, _, domain = email.rpartition("@")
    if not local:
        return email
    if domain == "googlemail.com":
        domain = "gmail.com"
    local = local.split("+", 1)[0]
    if domain == "gmail.com":
        local = local.replace(".", "")
    return f"{local}@{domain}"


def _key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def network_of(ip: str) -> str:
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return ip or ""
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    prefix = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{addr}/{prefix}", strict=False))


def _count(db, since_seconds: int, where: str = "", args: tuple = ()) -> int:
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - since_seconds))
    sql = "SELECT COUNT(*) FROM mail_log WHERE at >= ?" + (f" AND {where}" if where else "")  # nosec B608 (고정 문자열만)
    return db.execute(sql, (since, *args)).fetchone()[0]


def _last_to(db, addr_key: str) -> float | None:
    row = db.execute("SELECT MAX(at) FROM mail_log WHERE addr_key = ?", (addr_key,)).fetchone()
    sent = parse_iso(row[0]) if row and row[0] else None
    return sent.timestamp() if sent else None


# ---------------------------------------------------------------- 보내도 되는지

def check(db, kind: str, email: str, src: Source | None = None) -> None:
    """보내면 안 되면 Blocked. 확인만 하고 기록하지 않는다(record()가 기록)."""
    src = src or Source()
    norm = normalize(email)
    addr_key = _key(norm)
    domain = norm.rpartition("@")[2]

    # 1) 받는 주소: 방금 보냈거나 하루 상한
    last = _last_to(db, addr_key)
    if last is not None and time.time() - last < ADDR_COOLDOWN:
        raise Blocked(f"방금 보냈어요. {ADDR_COOLDOWN}초 뒤에 다시 받을 수 있어요.")
    if _count(db, 86400, "addr_key = ?", (addr_key,)) >= ADDR_PER_DAY:
        raise Blocked("이 주소로는 오늘 메일을 충분히 보냈어요. 메일함(스팸함 포함)을 확인하거나 내일 다시 시도해 주세요.")
    if kind in ANON and domain not in COMMON_DOMAINS:
        if _count(db, 86400, "domain_key = ? AND kind IN (?, ?)", (_key(domain), *ANON)) >= DOMAIN_PER_DAY:
            raise Blocked("이 메일 주소 쪽으로 오늘 요청이 너무 많아요. 내일 다시 시도하거나 다른 주소를 써 주세요.")

    # 2) 보내는 쪽(로그인 없이 부르는 용도만)
    if kind in ANON or kind == RESET:
        anon_kinds = (*ANON, RESET)
        marks = ",".join("?" * len(anon_kinds))
        for col, value in (("ip", src.ip), ("net", src.net), ("device", src.device)):
            if not value:
                continue
            per_hour, per_day = SOURCE_LIMITS[col]
            where = f"{col}_key = ? AND kind IN ({marks})"
            args = (_key(value), *anon_kinds)
            if _count(db, 3600, where, args) >= per_hour or _count(db, 86400, where, args) >= per_day:
                raise Blocked("메일 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")

    # 3) 전체 예산(용도별 몫)
    share = SHARE.get(kind, 0.5)
    day = _count(db, 86400)
    month = _count(db, 30 * 86400)
    over = day >= int(day_limit() * share) or month >= int(month_limit() * share)
    if not over and kind in ANON:
        marks = ",".join("?" * len(ANON))
        over = _count(db, 3600, f"kind IN ({marks})", ANON) >= signup_per_hour()
    if over:
        _alert_admins(db, kind)
        raise Blocked(busy_message(kind), status=503, busy=True)


def busy_message(kind: str) -> str:
    if kind in ANON:
        return ("지금 가입 인증 메일 요청이 몰려 잠시 쉬고 있어요. 카카오·네이버·구글로 가입하면 메일 없이 바로 "
                "가입되고, 이메일 가입은 한 시간쯤 뒤에 다시 시도해 주세요.")
    return "지금 메일 요청이 몰려 잠시 쉬고 있어요. 한 시간쯤 뒤에 다시 시도해 주세요."


def record(db, kind: str, email: str, src: Source | None = None) -> None:
    src = src or Source()
    norm = normalize(email)
    db.execute(
        "INSERT INTO mail_log(at, kind, addr_key, domain_key, ip_key, net_key, device_key) VALUES (?,?,?,?,?,?,?)",
        (now_iso(), kind, _key(norm), _key(norm.rpartition("@")[2]),
         _key(src.ip) if src.ip else None, _key(src.net) if src.net else None,
         _key(src.device) if src.device else None),
    )
    # 오래된 기록은 지운다(한 달 한도를 세려고 31일만 둔다).
    if secrets.randbelow(50) == 0:
        db.execute("DELETE FROM mail_log WHERE at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days')")


def over_total() -> bool:
    """mailer.send()의 마지막 안전장치: 이 파일을 거치지 않은 발송도 전체 한도는 넘기지 않게."""
    try:
        with closing(connect()) as db:
            return _count(db, 86400) >= day_limit() or _count(db, 30 * 86400) >= month_limit()
    except Exception:  # noqa: BLE001  기록 표를 못 읽어도 메일 자체는 막지 않는다
        log.exception("mail budget check failed")
        return False


def stats(db) -> dict:
    """운영 현황 화면용: 최근 24시간 보낸 메일 수와 한도."""
    rows = db.execute(
        "SELECT kind, COUNT(*) AS c FROM mail_log WHERE at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day') GROUP BY kind"
    ).fetchall()
    by_kind = {r["kind"]: r["c"] for r in rows}
    return {"day": sum(by_kind.values()), "day_limit": day_limit(), "by_kind": by_kind,
            "signup_cap": int(day_limit() * SHARE[SIGNUP])}


def _alert_admins(db, kind: str) -> None:
    """가입 쪽 예산이 찼을 때 운영자에게 알림 한 번(하루 한 번)."""
    if kind not in ANON:
        return
    try:
        from . import auth, notifications, security
        day = time.strftime("%Y-%m-%d", time.gmtime())
        security.audit("mail_budget_full", detail=kind, once=f"mbf:{day}")
        for row in db.execute("SELECT * FROM users WHERE email_verified_at IS NOT NULL").fetchall():
            if auth.is_admin_user(dict(row)):
                notifications.push(
                    db, row["id"], "notice", "가입 인증 메일 요청이 몰렸어요",
                    "한 시간 또는 하루 몫을 다 써서 이메일 가입 인증번호를 잠시 멈췄어요. 기존 사장님 비밀번호 찾기 몫은 "
                    "따로 남아 있어요. 누가 일부러 누르는 것일 수 있으니 운영 현황을 확인해 주세요.",
                    link="#/admin/stats", dedupe_key=f"mail_budget:{day}",
                )
    except Exception:  # noqa: BLE001
        log.exception("mail budget alert failed")


# ---------------------------------------------------------------- 사람 확인(작업 증명)

def pow_bits(db) -> int:
    """기본 17비트(보통 PC 0.1초, 휴대폰 0.5초 안팎). 가입 쪽 예산이 한 시간 몫의 절반을 넘으면 더 어렵게."""
    base = config.env_int("MAIL_POW_BITS", 17)
    if base <= 0:
        return 0
    marks = ",".join("?" * len(ANON))
    hour = _count(db, 3600, f"kind IN ({marks})", ANON)
    if hour >= signup_per_hour() // 2:
        base += 2
    return min(base, 24)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _sign(payload: str) -> str:
    return _b64(hmac.new(_SECRET, payload.encode(), hashlib.sha256).digest()[:18])


def new_challenge(db, device: str) -> dict:
    bits = pow_bits(db)
    payload = _b64(json.dumps({"t": int(time.time()), "r": secrets.token_hex(8), "d": _key(device), "b": bits},
                              separators=(",", ":")).encode())
    return {"challenge": f"{payload}.{_sign(payload)}", "bits": bits}


def _leading_zero_bits(digest: bytes) -> int:
    n = 0
    for byte in digest:
        if byte == 0:
            n += 8
            continue
        n += 8 - byte.bit_length()
        break
    return n


def verify_pow(challenge: str, nonce: str, device: str) -> bool:
    """맞게 풀었고, 이 기기에서 받은, 10분 안의, 처음 쓰는 문제인지."""
    if config.env_int("MAIL_POW_BITS", 17) <= 0:
        return True
    challenge = (challenge or "").strip()
    nonce = (nonce or "").strip()
    if not challenge or not nonce or len(nonce) > 32 or "." not in challenge:
        return False
    payload, sig = challenge.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(payload)):
        return False
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:  # noqa: BLE001
        return False
    now = time.time()
    if now - data.get("t", 0) > POW_TTL or data.get("d") != _key(device):
        return False
    digest = hashlib.sha256(f"{challenge}:{nonce}".encode()).digest()
    if _leading_zero_bits(digest) < int(data.get("b", 0)):
        return False
    for k in [k for k, t in _used_pow.items() if now - t > POW_TTL]:
        _used_pow.pop(k, None)
    if challenge in _used_pow:
        return False
    _used_pow[challenge] = now
    return True


def new_device_id() -> str:
    return secrets.token_urlsafe(16)


def reset() -> None:
    """시험용: 기록과 쓴 문제를 비운다."""
    _used_pow.clear()
    try:
        with closing(connect()) as db:
            db.execute("DELETE FROM mail_log")
    except Exception:  # noqa: BLE001
        pass
