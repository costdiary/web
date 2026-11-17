"""가입·로그인·내 계정·도입 문의."""
from __future__ import annotations

import hmac
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from . import auth, config, mailer, market, oauth, security, services
from .db import ISO, get_db, now_iso, transaction
from .deps import current_user
from .routes_market import market_me_summary
from .schemas import (
    ChangePasswordIn, DeleteAccountIn, ForgotPasswordIn, LeadIn, LoginIn, ResetPasswordIn, SettingsIn, SignupIn,
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
    }


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
    # trial_ends_at 컬럼은 과거 체험 요금제에서 남은 것으로, 더는 기능을 막는 데 쓰지 않습니다
    # (원가노트는 무료). NOT NULL이라 값은 계속 채우되, 의미 없는 먼 미래 날짜를 넣습니다.
    trial_end = (datetime.now(timezone.utc) + timedelta(days=36500)).strftime(ISO)
    pw_hash = auth.hash_password(body.password)
    with transaction(db):
        if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.")
        cur = db.execute(
            "INSERT INTO users(email, pw_hash, store_name, trial_ends_at, created_at) VALUES (?,?,?,?,?)",
            (email, pw_hash, body.store_name.strip(), trial_end, now_iso()),
        )
        token = auth.new_session(db, cur.lastrowid)
    security.audit("signup", user_id=cur.lastrowid, ip=ip)
    _set_cookie(response, token)
    return {"ok": True}


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
    resp = RedirectResponse(f"{config.env_str('APP_BASE_URL').rstrip('/')}/", status_code=302)
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


@router.post("/leads")
def create_lead(body: LeadIn, request: Request, db=Depends(get_db)):
    ip = client_ip(request)
    if _too_many(f"lead:{ip}", 5, 3600):
        raise HTTPException(429, "문의가 너무 많이 접수되었습니다. 잠시 후 다시 시도해 주세요.")
    _record(f"lead:{ip}")
    db.execute(
        "INSERT INTO leads(name, contact, biz_type, message, created_at) VALUES (?,?,?,?,?)",
        (body.name, body.contact, body.biz_type, body.message, now_iso()),
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
        ):
            db.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))  # nosec B608
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.execute("UPDATE audit_log SET user_id = NULL WHERE user_id = ?", (uid,))  # 기록은 남기되 계정과의 연결은 끊습니다
        for key in mk_keys:
            market.refresh_public_key(db, key)
    security.audit("account_deleted", ip=client_ip(request))
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}
