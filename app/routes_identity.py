"""휴대폰 본인인증 API — 흐름 설명은 identity.py 맨 위에 있다.

로그인하지 않은 상태(가입 화면)에서도 부를 수 있어야 하므로 current_user를 강제하지 않고,
로그인돼 있으면 그 계정에 바로 붙인다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from . import auth, identity, security
from .db import get_db, transaction
from .routes_account import _record, _too_many, client_ip
from .schemas import IdentityCompleteIn, IdentityStartIn

router = APIRouter(prefix="/api/identity")


def _user_id(request: Request, db) -> int | None:
    user = auth.user_for_token(db, request.cookies.get(auth.COOKIE_NAME))
    return user["id"] if user else None


@router.post("/start")
def start(body: IdentityStartIn, request: Request, db=Depends(get_db)):
    if not identity.enabled():
        raise HTTPException(404, "본인인증을 쓰지 않는 설정입니다.")
    ip = client_ip(request)
    if _too_many(f"iv:{ip}", 20, 3600):
        raise HTTPException(429, "본인인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    _record(f"iv:{ip}")
    uid = _user_id(request, db)
    if body.purpose == "account" and uid is None:
        raise HTTPException(401, "로그인이 필요합니다.")
    return identity.start(db, uid if body.purpose == "account" else None, body.purpose)


@router.post("/complete")
def complete(body: IdentityCompleteIn, request: Request, db=Depends(get_db)):
    if not identity.enabled():
        raise HTTPException(404, "본인인증을 쓰지 않는 설정입니다.")
    row = db.execute("SELECT purpose FROM identity_verifications WHERE id = ?", (body.verification_id,)).fetchone()
    uid = _user_id(request, db) if row and row["purpose"] == "account" else None
    try:
        with transaction(db):
            result = identity.complete(db, body.verification_id, uid, body.mock.model_dump() if body.mock else None)
    except identity.IdentityError as e:
        # 중복 가입 등으로 'failed' 표시를 남겨야 하는 경우도 있어, 거절 사유만 따로 한 번 더 기록한다.
        if e.status == 409:
            db.execute("UPDATE identity_verifications SET status='failed' WHERE id = ?", (body.verification_id,))
        raise HTTPException(e.status, str(e))
    if uid is not None:
        security.audit("identity_verified", user_id=uid, ip=client_ip(request))
    return result
