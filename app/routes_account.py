"""가입·로그인·내 계정·개선사항 요청."""
from __future__ import annotations

import hmac
import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from . import auth, config, email_verify, identity, mailer, market, notifications, oauth, security, services
from .db import ISO, get_db, now_iso, parse_iso, transaction
from .deps import current_user
from .routes_market import market_me_summary
from .schemas import (
    ChangePasswordIn, DeleteAccountIn, EmailCodeIn, EmailVerifyIn, FeedbackIn, ForgotPasswordIn, LoginIn, ResetPasswordIn, SettingsIn, SignupIn,
)

OAUTH_STATE_COOKIE = "oauth_state"

router = APIRouter(prefix="/api")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# 간단한 요청 횟수 제한(서버 한 대 기준, 메모리). 여러 대로 늘리면 Redis 등으로 옮기세요.
_hits: dict[str, list[float]] = defaultdict(list)


def reset_rate_limits() -> None:
    _hits.clear()
    security.reset()


def _too_many(key: str, limit: int, window: float) -> bool:
    now = time.time()
    arr = [t for t in _hits[key] if now - t < window]
    _hits[key] = arr
    return len(arr) >= limit


def _record(key: str) -> None:
    _hits[key].append(time.time())
    if len(_hits) > security.MAX_KEYS:  # 메모리가 끝없이 늘지 않게 오래된 기록을 정리합니다
        cut = time.time() - 3600
        for k in [k for k, v in _hits.items() if not v or v[-1] < cut]:
            _hits.pop(k, None)


client_ip = security.client_ip


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.COOKIE_NAME,
        token,
        max_age=auth.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=config.env_bool("COOKIE_SECURE"),
        path="/",
    )


def me_payload(db, user: dict) -> dict:
    ps = auth.plan_status(user)
    cfg = config.public_config()
    uid = user["id"]
    return {
        "email": user["email"],
        "store_name": user["store_name"],
        "is_admin": auth.is_admin_user(user),
        "email_verify": {
            "verified": bool(user.get("email_verified_at")),
            # 소셜로만 가입해 진짜 이메일이 없는 계정은 확인할 주소가 없다.
            "has_email": not email_verify.is_placeholder(user["email"]),
            # 메일을 보낼 수 있어야 설정 화면에서 인증하기 버튼을 보여 준다.
            "available": email_verify.required(),
        },
        "settings": {
            "target_cost_ratio": user["target_cost_ratio"],
            "alert_pct": user["alert_pct"],
            "vat_mode": user["vat_mode"],
        },
        "plan": {
            **ps,
            "contact_email": cfg["contact_email"],
        },
        "usage": {
            "ocr_used": services.ocr_used(db, uid),
            "ocr_limit": auth.ocr_limit(ps["state"]),
            "ocr_enabled": cfg["ocr_enabled"],
        },
        "counts": {
            "ingredients": db.execute("SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ?", (uid,)).fetchone()["c"],
            "menus": db.execute("SELECT COUNT(*) AS c FROM menus WHERE user_id = ?", (uid,)).fetchone()["c"],
        },
        "market": market_me_summary(db, uid),
        "notifications": {"unread": _notif_unread(db, user)},
        "identity": identity.me_summary(user),
    }


def _notif_unread(db, user: dict) -> int:
    """상단 종 배지 숫자. 상태 알림 만들기가 실패해도 /api/me는 살아 있어야 한다."""
    try:
        with transaction(db):
            notifications.sync(db, user)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notification sync failed")
    return notifications.unread_count(db, user["id"])


@router.get("/public")
def public(request: Request, db=Depends(get_db)):
    cfg = config.public_config()
    # 화면이 로그인 여부를 오류(401) 없이 알 수 있게 합니다.
    cfg["logged_in"] = auth.user_for_token(db, request.cookies.get(auth.COOKIE_NAME)) is not None
    return cfg


@router.post("/auth/signup")
def signup(body: SignupIn, request: Request, response: Response, db=Depends(get_db)):
    ip = client_ip(request)
    if _too_many(f"signup:{ip}", 10, 3600):
        raise HTTPException(429, "가입 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "이메일 형식을 확인해 주세요.")
    problem = auth.password_problem(body.password, email)
    if problem:
        raise HTTPException(400, problem)
    required = config.env_str("SIGNUP_CODE")
    if required and not hmac.compare_digest(body.code.strip().encode("utf-8"), required.encode("utf-8")):
        raise HTTPException(403, "가입 코드가 맞지 않습니다.")
    _record(f"signup:{ip}")
    need_email_code = email_verify.required()
    if need_email_code:
        # 번호 확인은 가입과 따로 저장한다: 틀린 횟수는 남아야 하고, 맞아도 아래 가입이 다른 이유로
        # 실패하면(본인인증 등) 같은 번호로 다시 시도할 수 있게 여기서는 지우지 않는다.
        with transaction(db):
            problem = email_verify.attempt(db, email, email_verify.PURPOSE_SIGNUP, body.email_code, consume=False)
        if problem:
            raise HTTPException(400, problem)
    need_identity = identity.enabled()
    # trial_ends_at 컬럼은 과거 체험 요금제에서 남은 것으로, 더는 기능을 막는 데 쓰지 않습니다
    # (원가노트는 무료). NOT NULL이라 값은 계속 채우되, 의미 없는 먼 미래 날짜를 넣습니다.
    trial_end = (datetime.now(timezone.utc) + timedelta(days=36500)).strftime(ISO)
    pw_hash = auth.hash_password(body.password)
    with transaction(db):
        if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.")
        if need_identity:
            try:
                iv = identity.claim_for_signup(db, body.identity_verification_id)
            except identity.IdentityError as e:
                raise HTTPException(e.status, str(e))
        cur = db.execute(
            "INSERT INTO users(email, pw_hash, store_name, trial_ends_at, created_at, email_verified_at) VALUES (?,?,?,?,?,?)",
            (email, pw_hash, body.store_name.strip(), trial_end, now_iso(), now_iso() if need_email_code else None),
        )
        if need_identity:
            identity.attach(db, iv["id"], cur.lastrowid)
        if need_email_code:
            email_verify.consume_code(db, email, email_verify.PURPOSE_SIGNUP)
        token = auth.new_session(db, cur.lastrowid)
    security.audit("signup", user_id=cur.lastrowid, ip=ip)
    _set_cookie(response, token)
    return {"ok": True}


@router.post("/auth/email-code")
def signup_email_code(body: EmailCodeIn, request: Request, db=Depends(get_db)):
    """가입 화면의 '인증번호 받기'. 이미 가입된 주소여도 같은 응답을 주고, 메일로만 알려 준다."""
    if not email_verify.required():
        raise HTTPException(404)
    ip = client_ip(request)
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "이메일 형식을 확인해 주세요.")
    # 남의 주소로 메일 폭탄을 보내지 못하게 주소마다, 접속 주소마다 횟수를 묶는다.
    if _too_many(f"ecode:{ip}", 10, 3600) or _too_many(f"ecodemail:{email}", 5, 3600):
        raise HTTPException(429, "인증번호 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
    with transaction(db):
        exists = db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        code = None if exists else email_verify.issue(db, email, email_verify.PURPOSE_SIGNUP)
    if not exists and code is None:
        raise HTTPException(429, f"방금 보냈어요. {email_verify.RESEND_SECONDS}초 뒤에 다시 받을 수 있어요.")
    _record(f"ecode:{ip}")
    _record(f"ecodemail:{email}")
    if exists:
        email_verify.send_already_registered(email)
    else:
        email_verify.send_code(email, code)
    security.audit("email_code_sent", ip=ip, detail=email[:80])
    return {"ok": True, "expires_minutes": email_verify.CODE_MINUTES, "resend_seconds": email_verify.RESEND_SECONDS}


@router.post("/me/email-code")
def account_email_code(request: Request, user: dict = Depends(current_user), db=Depends(get_db)):
    """이 기능 전에 이메일로 가입한 계정이 설정 화면에서 자기 주소를 확인할 때."""
    if not email_verify.required() or email_verify.is_placeholder(user["email"]):
        raise HTTPException(404)
    if user.get("email_verified_at"):
        return {"ok": True, "verified": True}
    if _too_many(f"ecodeuser:{user['id']}", 5, 3600):
        raise HTTPException(429, "인증번호 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
    with transaction(db):
        code = email_verify.issue(db, user["email"], email_verify.PURPOSE_ACCOUNT)
    if code is None:
        raise HTTPException(429, f"방금 보냈어요. {email_verify.RESEND_SECONDS}초 뒤에 다시 받을 수 있어요.")
    _record(f"ecodeuser:{user['id']}")
    email_verify.send_code(user["email"], code)
    security.audit("email_code_sent", user_id=user["id"], ip=client_ip(request))
    return {"ok": True, "expires_minutes": email_verify.CODE_MINUTES, "resend_seconds": email_verify.RESEND_SECONDS}


@router.post("/me/email-verify")
def account_email_verify(body: EmailVerifyIn, request: Request, user: dict = Depends(current_user), db=Depends(get_db)):
    if email_verify.is_placeholder(user["email"]):
        raise HTTPException(404)
    if not user.get("email_verified_at"):
        with transaction(db):
            problem = email_verify.attempt(db, user["email"], email_verify.PURPOSE_ACCOUNT, body.code)
            if not problem:
                db.execute("UPDATE users SET email_verified_at = ? WHERE id = ?", (now_iso(), user["id"]))
        if problem:
            raise HTTPException(400, problem)
        security.audit("email_verified", user_id=user["id"], ip=client_ip(request))
    fresh = dict(db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    return me_payload(db, fresh)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    email = body.email.strip().lower()
    ip = client_ip(request)
    key = f"login:{ip}:{email}"
    # 주소를 바꿔 가며 한 계정을 계속 찍어 보는 공격도 막기 위해 계정(이메일) 기준 한도를 따로 둡니다.
    if _too_many(key, 8, 900) or _too_many(f"loginmail:{email}", 20, 900):
        security.audit("login_locked", ip=ip, detail=email[:80], once=f"ll:{email}")
        raise HTTPException(429, "로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.")
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        auth.dummy_verify(body.password)
    if not row or not auth.verify_password(body.password, row["pw_hash"]):
        _record(key)
        _record(f"loginmail:{email}")
        security.audit("login_fail", user_id=row["id"] if row else None, ip=ip, detail=email[:80], once=f"lf:{ip}:{email}")
        raise HTTPException(401, "이메일 또는 비밀번호가 맞지 않습니다.")
    _hits.pop(key, None)
    token = auth.new_session(db, row["id"])
    security.audit("login_ok", user_id=row["id"], ip=ip)
    _set_cookie(response, token)
    return {"ok": True}


@router.get("/auth/oauth/{provider}")
def oauth_start(provider: str):
    if provider not in oauth.PROVIDERS or not oauth.client_id(provider):
        raise HTTPException(404, "지원하지 않는 로그인 방법입니다.")
    state = oauth.new_state()
    resp = RedirectResponse(oauth.authorize_url(provider, state), status_code=302)
    resp.set_cookie(
        OAUTH_STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
        secure=config.env_bool("COOKIE_SECURE"), path="/",
    )
    return resp


@router.get("/auth/oauth/{provider}/callback")
def oauth_callback(
    provider: str, request: Request, db=Depends(get_db),
    code: str | None = None, state: str | None = None, error: str | None = None,
):
    fail_url = f"{config.env_str('APP_BASE_URL').rstrip('/')}/?login_error=1"
    saved_state = request.cookies.get(OAUTH_STATE_COOKIE)
    if error or not code or not saved_state or not state or not hmac.compare_digest(saved_state, state):
        resp = RedirectResponse(fail_url, status_code=302)
        resp.delete_cookie(OAUTH_STATE_COOKIE, path="/")
        return resp
    ip = client_ip(request)
    try:
        provider_uid, email = oauth.resolve(provider, code)
    except oauth.OAuthError:
        resp = RedirectResponse(fail_url, status_code=302)
        resp.delete_cookie(OAUTH_STATE_COOKIE, path="/")
        return resp
    with transaction(db):
        user = auth.oauth_user(db, provider, provider_uid, email)
    token = auth.new_session(db, user["id"])
    security.audit("login_ok", user_id=user["id"], ip=ip, detail=provider)
    # 화면(analytics.js)이 GA4에 가입/로그인을 알릴 수 있게 표시만 붙인다. 개인정보는 없음(제공자 이름뿐).
    created = parse_iso(user.get("created_at"))
    is_new = created is not None and (datetime.now(timezone.utc) - created).total_seconds() < 120
    flag = "joined" if is_new else "login"
    resp = RedirectResponse(f"{config.env_str('APP_BASE_URL').rstrip('/')}/?{flag}={provider}", status_code=302)
    resp.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    _set_cookie(resp, token)
    return resp


@router.post("/auth/password/forgot")
def forgot_password(body: ForgotPasswordIn, request: Request, db=Depends(get_db)):
    ip = client_ip(request)
    if _too_many(f"forgot:{ip}", 5, 3600):
        raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    _record(f"forgot:{ip}")
    email = body.email.strip().lower()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        token = auth.new_reset_token(db, row["id"])
        link = f"{config.env_str('APP_BASE_URL').rstrip('/')}/?reset_token={token}"
        mailer.send(email, "원가노트 비밀번호 재설정", f"아래 링크에서 30분 안에 새 비밀번호를 정해 주세요.\n\n{link}")
        security.audit("password_forgot", user_id=row["id"], ip=ip)
    # 가입된 이메일인지 응답으로 알려주지 않기 위해 계정이 있든 없든 같은 응답을 돌려줍니다.
    return {"ok": True}


@router.post("/auth/password/reset")
def reset_password(body: ResetPasswordIn, request: Request, db=Depends(get_db)):
    ip = client_ip(request)
    if _too_many(f"reset:{ip}", 10, 3600):
        raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    user = auth.user_for_reset_token(db, body.token)
    if not user:
        _record(f"reset:{ip}")
        raise HTTPException(400, "링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요.")
    problem = auth.password_problem(body.new_password, user["email"])
    if problem:
        raise HTTPException(400, problem)
    with transaction(db):
        db.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (auth.hash_password(body.new_password), user["id"]))
        auth.consume_reset_token(db, body.token)
        auth.drop_all_sessions(db, user["id"])
    security.audit("password_reset", user_id=user["id"], ip=ip)
    return {"ok": True}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db=Depends(get_db)):
    auth.drop_session(db, request.cookies.get(auth.COOKIE_NAME))
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/auth/logout-all")
def logout_all(request: Request, response: Response, user: dict = Depends(current_user), db=Depends(get_db)):
    """모든 기기(지금 쓰는 기기 포함)에서 로그아웃합니다. 로그인을 도난당한 것 같을 때 씁니다."""
    auth.drop_all_sessions(db, user["id"])
    security.audit("logout_all", user_id=user["id"], ip=client_ip(request))
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user), db=Depends(get_db)):
    return me_payload(db, user)


@router.patch("/me/settings")
def update_settings(body: SettingsIn, user: dict = Depends(current_user), db=Depends(get_db)):
    fields = body.model_dump(exclude_none=True)
    if fields:
        # 키는 SettingsIn 모델에 정의된 이름만 올 수 있어 SQL에 그대로 써도 안전합니다.
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE users SET {sets} WHERE id = ?", (*fields.values(), user["id"]))  # nosec B608
    fresh = dict(db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    return me_payload(db, fresh)


@router.post("/feedback")
def create_feedback(body: FeedbackIn, request: Request, db=Depends(get_db)):
    """개선사항 요청. 로그인하지 않아도 보낼 수 있고, 로그인했으면 계정이 함께 붙는다(운영자만 본다)."""
    ip = client_ip(request)
    user = auth.user_for_token(db, request.cookies.get(auth.COOKIE_NAME))
    key = f"feedback:{user['id']}" if user else f"feedback:{ip}"
    if _too_many(key, 8, 3600):
        raise HTTPException(429, "요청이 너무 많이 접수되었습니다. 잠시 후 다시 보내 주세요.")
    message = body.message.strip()
    if len(message) < 5:
        raise HTTPException(400, "내용을 5자 이상 적어 주세요.")
    _record(key)
    db.execute(
        "INSERT INTO feedback(user_id, category, message, contact, page, created_at) VALUES (?,?,?,?,?,?)",
        (user["id"] if user else None, body.category, message, body.contact.strip(), body.page.strip(), now_iso()),
    )
    return {"ok": True}


@router.post("/me/password")
def change_password(body: ChangePasswordIn, request: Request, user: dict = Depends(current_user), db=Depends(get_db)):
    key = f"pw:{user['id']}"
    if _too_many(key, 8, 900):
        raise HTTPException(429, "시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.")
    if not auth.verify_password(body.current_password, user["pw_hash"]):
        _record(key)
        raise HTTPException(403, "현재 비밀번호가 맞지 않습니다.")
    problem = auth.password_problem(body.new_password, user["email"])
    if problem:
        raise HTTPException(400, problem)
    if body.new_password == body.current_password:
        raise HTTPException(400, "현재와 다른 비밀번호로 정해 주세요.")
    with transaction(db):
        db.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (auth.hash_password(body.new_password), user["id"]))
        auth.drop_other_sessions(db, user["id"], request.cookies.get(auth.COOKIE_NAME))
    security.audit("password_change", user_id=user["id"], ip=client_ip(request))
    return {"ok": True}


@router.post("/me/delete")
def delete_account(body: DeleteAccountIn, request: Request, response: Response, user: dict = Depends(current_user), db=Depends(get_db)):
    if not auth.verify_password(body.password, user["pw_hash"]):
        raise HTTPException(403, "비밀번호가 맞지 않습니다.")
    uid = user["id"]
    with transaction(db):
        db.execute("DELETE FROM menu_items WHERE menu_id IN (SELECT id FROM menus WHERE user_id = ?)", (uid,))
        # 마켓 신호를 지우기 전에 키를 모아 둡니다(지운 뒤 공개 집계를 다시 계산해 즉시 반영해야 함, G8).
        mk_keys = [
            (r["item_id"], r["origin"], r["grade"], r["region_code"])
            for r in db.execute("SELECT item_id, origin, grade, region_code FROM mk_demand_signals WHERE user_id = ? AND active = 1", (uid,))
        ]
        for table in (
            "menus", "ingredient_aliases", "price_history", "invoice_lines", "mk_matches", "mk_demand_signals",
            "mk_buyer_settings", "ws_ad_deliveries", "mk_connections", "ingredients", "invoices", "ocr_usage",
            "channels", "fixed_costs", "shop_profile", "daily_sales", "shop_location", "staff", "sessions",
            "notifications", "notification_prefs",
            "identity_verifications",  # 본인인증 결과(이름·휴대폰)도 탈퇴하면 남기지 않는다.
            "ocr_logs",  # 올린 명세서·요리 사진도 "입력 자료"이므로 탈퇴 시 함께 지운다(개인정보처리방침과 일치).
        ):
            db.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))  # nosec B608
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.execute("UPDATE audit_log SET user_id = NULL WHERE user_id = ?", (uid,))  # 기록은 남기되 계정과의 연결은 끊습니다
        for key in mk_keys:
            market.refresh_public_key(db, key)
    security.audit("account_deleted", ip=client_ip(request))
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}
