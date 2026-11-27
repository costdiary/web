"""비밀번호 해시, 로그인 세션, 체험/유료 상태 계산."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from . import config, identity
from .db import ISO, now_iso, parse_iso

COOKIE_NAME = "sid"
SESSION_DAYS = 30

WS_COOKIE_NAME = "wsid"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, dk_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32
        )
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


MAX_SESSIONS = 10
COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890", "11111111",
    "00000000", "qwerty123", "qwertyuiop", "abcd1234", "abc12345", "iloveyou", "admin123", "welcome1", "letmein1",
    "asdf1234", "1q2w3e4r", "1q2w3e4r5t", "qwer1234", "a1234567", "aa123456", "zxcvbnm1", "wongaenote", "원가노트",
}
_DUMMY = {}


def dummy_verify(password: str) -> None:
    """없는 이메일로 로그인할 때도 같은 시간이 걸리게 해서, 가입 여부를 시간 차이로 알아내지 못하게 합니다."""
    if "h" not in _DUMMY:
        _DUMMY["h"] = hash_password("dummy-password-for-timing")
    verify_password(password, _DUMMY["h"])


def password_problem(password: str, email: str = "") -> str | None:
    if len(password) < 8:
        return "비밀번호는 8자 이상으로 정해 주세요."
    low = password.lower()
    if low in COMMON_PASSWORDS or len(set(low)) <= 2:
        return "너무 흔한 비밀번호입니다. 다른 비밀번호로 정해 주세요."
    if password.isdigit():
        return "숫자만으로는 안 됩니다. 글자나 기호를 섞어 주세요."
    local = (email or "").split("@")[0].lower()
    if len(local) >= 4 and local in low:
        return "이메일 주소가 들어간 비밀번호는 쓸 수 없습니다."
    return None


def new_session(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime(ISO)
    db.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)",
        (_token_hash(token), user_id, expires, now_iso()),
    )
    # 한 계정으로 로그인 토큰을 무한히 만들어 두지 못하게, 가장 오래된 것부터 지웁니다.
    db.execute(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN "
        "(SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
        (user_id, user_id, MAX_SESSIONS))
    return token


def user_for_token(db, token: str | None):
    if not token:
        return None
    row = db.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?",
        (_token_hash(token), now_iso()),
    ).fetchone()
    return dict(row) if row else None


def drop_session(db, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def drop_all_sessions(db, user_id: int) -> None:
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def drop_other_sessions(db, user_id: int, keep_token: str | None) -> None:
    """비밀번호를 바꿀 때: 지금 쓰는 기기 말고 다른 기기의 로그인은 모두 해제합니다."""
    keep = _token_hash(keep_token) if keep_token else ""
    db.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user_id, keep))


# ---------------------------------------------------------------- 비밀번호 찾기
RESET_MINUTES = 30


def new_reset_token(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)).strftime(ISO)
    db.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))  # 이전 링크는 새 요청으로 무효화
    db.execute(
        "INSERT INTO password_resets(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)",
        (_token_hash(token), user_id, expires, now_iso()),
    )
    return token


def user_for_reset_token(db, token: str | None) -> dict | None:
    if not token:
        return None
    row = db.execute(
        "SELECT u.* FROM password_resets r JOIN users u ON u.id = r.user_id "
        "WHERE r.token_hash = ? AND r.expires_at > ?",
        (_token_hash(token), now_iso()),
    ).fetchone()
    return dict(row) if row else None


def consume_reset_token(db, token: str) -> None:
    db.execute("DELETE FROM password_resets WHERE token_hash = ?", (_token_hash(token),))


# ---------------------------------------------------------------- 소셜 로그인(카카오·네이버·구글)

def unusable_password_hash() -> str:
    """소셜 로그인으로만 가입한 계정에 들어가는, 아무도 알 수 없는 비밀번호 해시.
    users.pw_hash는 NOT NULL이라 값은 채워야 하지만, 이 값으로는 /api/auth/login이 통과할 수 없다."""
    return hash_password(secrets.token_urlsafe(32))


def oauth_user(db, provider: str, provider_uid: str, email: str | None) -> dict:
    """제공자 계정으로 기존 연결을 찾거나, 같은 이메일의 기존 가입을 연결하거나, 새로 가입시킨다."""
    row = db.execute(
        "SELECT u.* FROM oauth_accounts o JOIN users u ON u.id = o.user_id "
        "WHERE o.provider = ? AND o.provider_uid = ?",
        (provider, provider_uid),
    ).fetchone()
    if row:
        return dict(row)
    email = (email or "").strip().lower() or None
    existing = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone() if email else None
    if existing:
        uid = existing["id"]
        # 제공자가 확인해 준 이메일과 같은 계정이니, 그 계정의 이메일도 확인된 것으로 본다.
        if not existing["email_verified_at"]:
            db.execute("UPDATE users SET email_verified_at = ? WHERE id = ?", (now_iso(), uid))
    else:
        trial_end = (datetime.now(timezone.utc) + timedelta(days=36500)).strftime(ISO)
        placeholder_email = email or f"{provider}-{provider_uid}@oauth.wongaenote.local"
        cur = db.execute(
            "INSERT INTO users(email, pw_hash, store_name, trial_ends_at, created_at, identity_required, email_verified_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (placeholder_email, unusable_password_hash(), "", trial_end, now_iso(), int(identity.enabled()),
             now_iso() if email else None),
        )
        uid = cur.lastrowid
    db.execute(
        "INSERT INTO oauth_accounts(provider, provider_uid, user_id, created_at) VALUES (?,?,?,?)",
        (provider, provider_uid, uid, now_iso()),
    )
    return dict(db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())


# ---------------------------------------------------------------- 도매업체 세션(쌍둥이 함수)
# 사장님 쪽 users/sessions와 완전히 분리된 ws_accounts/ws_sessions 테이블을 쓴다. 비밀번호 해시·
# password_problem·dummy_verify는 공용이며, 세션 발급·조회·삭제만 테이블 이름이 다른 쌍둥이로 둔다.

def new_ws_session(db, ws_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).strftime(ISO)
    db.execute(
        "INSERT INTO ws_sessions(token_hash, ws_id, expires_at, created_at) VALUES (?,?,?,?)",
        (_token_hash(token), ws_id, expires, now_iso()),
    )
    db.execute(
        "DELETE FROM ws_sessions WHERE ws_id = ? AND token_hash NOT IN "
        "(SELECT token_hash FROM ws_sessions WHERE ws_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
        (ws_id, ws_id, MAX_SESSIONS))
    return token


def ws_for_token(db, token: str | None):
    if not token:
        return None
    row = db.execute(
        "SELECT w.* FROM ws_sessions s JOIN ws_accounts w ON w.id = s.ws_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?",
        (_token_hash(token), now_iso()),
    ).fetchone()
    return dict(row) if row else None


def drop_ws_session(db, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM ws_sessions WHERE token_hash = ?", (_token_hash(token),))


def plan_status(user: dict) -> dict:
    """원가노트는 모든 사장님에게 무료입니다. 체험·만료로 기능을 막지 않습니다.
    paid_until 컬럼과 'paid' 상태는 지우지 않고, 나중에 상권분석 등 개별 프리미엄 기능을
    따로 유료로 팔 때 쓸 자리로만 남겨 둡니다(지금은 어떤 기능도 이걸로 막지 않음)."""
    now = datetime.now(timezone.utc)
    paid_until = parse_iso(user.get("paid_until"))
    is_paid = bool(paid_until and paid_until > now)
    return {
        "state": "paid" if is_paid else "free",
        "days_left": 0,
        "writable": True,
        "ends_at": paid_until.strftime(ISO) if is_paid else None,
    }


def ocr_limit(state: str) -> int:
    """월 자동 인식 횟수 상한(비용 보호). 무료 요금제에도 상한은 둡니다."""
    if state == "paid":
        return config.env_int("OCR_LIMIT_PAID", 100)
    return config.env_int("OCR_LIMIT_FREE", config.env_int("OCR_LIMIT_TRIAL", 10))


def is_admin(email: str | None) -> bool:
    """앱에는 별도 role/관리자 개념이 없어서, ADMIN_EMAILS 환경변수(쉼표로 구분된 이메일 목록)에
    있는 계정만 운영자 화면(OCR 인식 로그 등)을 볼 수 있게 합니다. 설정이 비어 있으면 아무도
    통과하지 못합니다(설정 누락으로 전체 공개되는 사고를 막기 위함)."""
    if not email:
        return False
    admins = {e.strip().lower() for e in config.env_str("ADMIN_EMAILS", "").split(",") if e.strip()}
    return email.strip().lower() in admins


def is_admin_user(user: dict) -> bool:
    """운영자 화면 권한. ADMIN_EMAILS에 있는 이메일이면서, 그 이메일이 본인 것으로 확인된 계정만 통과한다.
    확인 안 된 이메일 가입 계정이면, 남이 운영자 이메일을 먼저 적어 가입해도 권한을 얻지 못한다."""
    return bool(user.get("email_verified_at")) and is_admin(user.get("email"))
