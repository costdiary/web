"""이메일 주소 확인(인증번호 6자리).

남의 이메일을 적어 가입하지 못하게, 이메일로 가입할 때는 그 주소로 보낸 6자리 번호를 넣어야 가입된다.
이미 가입한 계정(이 기능 전에 이메일로 가입한 계정)은 설정 > 이용 현황에서 같은 방식으로 확인할 수 있다.
운영자 권한(ADMIN_EMAILS)은 주소가 확인된 계정에만 준다(auth.is_admin_user).

켜지는 조건: 메일을 실제로 보낼 수 있을 때(SMTP_HOST가 있을 때) 자동으로 켜진다. 메일 설정 없이 켜면
아무도 번호를 받을 수 없어 가입이 막히기 때문이다. EMAIL_VERIFY=1이면 메일 설정이 없어도 강제로 켜고
(번호는 서버 로그에만 남음, 시험용), EMAIL_VERIFY=0이면 끈다.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from . import config, mailer
from .db import ISO, now_iso, parse_iso

CODE_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_SECONDS = 60

PURPOSE_SIGNUP = "signup"
PURPOSE_ACCOUNT = "account"


def required() -> bool:
    """이메일 가입에 인증번호가 꼭 필요한지."""
    flag = config.env_str("EMAIL_VERIFY").strip()
    if flag in ("0", "false", "off"):
        return False
    if flag in ("1", "true", "on"):
        return True
    return mailer.enabled()


def is_placeholder(email: str | None) -> bool:
    """이메일 없이 소셜로 가입한 계정에 넣어 둔 가짜 주소."""
    return not email or email.endswith("@oauth.wongaenote.local")


def _hash(email: str, purpose: str, code: str) -> str:
    return hashlib.sha256(f"{purpose}:{email}:{code}".encode("utf-8")).hexdigest()


def issue(db, email: str, purpose: str) -> str | None:
    """새 번호를 만들어 저장하고 돌려준다. 방금 보냈으면(RESEND_SECONDS 안) None."""
    row = db.execute("SELECT created_at FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose)).fetchone()
    now = datetime.now(timezone.utc)
    if row:
        sent = parse_iso(row["created_at"])
        if sent and (now - sent).total_seconds() < RESEND_SECONDS:
            return None
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = (now + timedelta(minutes=CODE_MINUTES)).strftime(ISO)
    db.execute(
        "INSERT INTO email_codes(email, purpose, code_hash, attempts, expires_at, created_at) VALUES (?,?,?,0,?,?) "
        "ON CONFLICT(email, purpose) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, "
        "expires_at = excluded.expires_at, created_at = excluded.created_at",
        (email, purpose, _hash(email, purpose, code), expires, now_iso()),
    )
    return code


def attempt(db, email: str, purpose: str, code: str, consume: bool = True) -> str | None:
    """번호를 맞춰 본다. 맞으면 None(consume이면 번호를 지움), 틀리면 사장님께 보여 줄 문구.
    예외를 던지지 않는 이유: 틀린 횟수가 트랜잭션 롤백으로 지워지면 번호를 무한히 찍어 볼 수 있다.
    부르는 쪽은 transaction() 안에서 부르고, 문구가 돌아오면 트랜잭션을 마친 뒤에 거절한다."""
    code = (code or "").strip().replace(" ", "")
    if not code:
        return "메일로 받은 인증번호 6자리를 넣어 주세요."
    row = db.execute("SELECT * FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose)).fetchone()
    if not row:
        return "먼저 '인증번호 받기'를 눌러 주세요."
    expires = parse_iso(row["expires_at"])
    if row["attempts"] >= MAX_ATTEMPTS or not expires or expires < datetime.now(timezone.utc):
        db.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose))
        return "인증번호가 만료되었어요. 새 번호를 받아 주세요."
    if not hmac.compare_digest(row["code_hash"], _hash(email, purpose, code)):
        db.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?", (email, purpose))
        left = MAX_ATTEMPTS - row["attempts"] - 1
        return f"인증번호가 맞지 않아요. ({left}번 더 시도할 수 있어요)" if left > 0 else "인증번호가 만료되었어요. 새 번호를 받아 주세요."
    if consume:
        consume_code(db, email, purpose)
    return None


def consume_code(db, email: str, purpose: str) -> None:
    db.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose))


def send_code(email: str, code: str) -> None:
    mailer.send(
        email,
        f"[원가다이어리] 인증번호 {code}",
        f"원가다이어리 이메일 인증번호입니다.\n\n    {code}\n\n"
        f"{CODE_MINUTES}분 안에 화면에 입력해 주세요.\n"
        "직접 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 누군가 주소를 잘못 적었을 수 있어요.",
    )


def send_already_registered(email: str) -> None:
    """이미 가입된 주소로 번호를 요청한 경우. 응답은 똑같이 하고, 메일로만 알려 준다(가입 여부 노출 방지)."""
    base = config.env_str("APP_BASE_URL").rstrip("/")
    mailer.send(
        email,
        "[원가다이어리] 이미 가입된 이메일이에요",
        "이 이메일로 원가다이어리 가입을 시도했어요. 이 주소는 이미 가입되어 있습니다.\n\n"
        f"로그인: {base or '원가다이어리'}\n"
        "비밀번호가 기억나지 않으면 로그인 화면의 '비밀번호를 잊으셨나요?'를 눌러 주세요.\n\n"
        "직접 시도하지 않았다면 이 메일은 무시하셔도 됩니다.",
    )
