"""라우트에서 공통으로 쓰는 의존성(로그인 확인, 쓰기 가능 여부)."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from . import auth
from .db import get_db


def current_user(request: Request, db=Depends(get_db)) -> dict:
    user = auth.user_for_token(db, request.cookies.get(auth.COOKIE_NAME))
    if not user:
        raise HTTPException(401, "로그인이 필요합니다.")
    return user


def writable_user(user: dict = Depends(current_user)) -> dict:
    if not auth.plan_status(user)["writable"]:
        raise HTTPException(402, "체험 기간이 끝났습니다. 계속 쓰시려면 이용 신청이 필요합니다.")
    return user


def current_admin(user: dict = Depends(current_user)) -> dict:
    if not auth.is_admin(user["email"]):
        raise HTTPException(404)  # 운영자 화면이 있다는 사실 자체를 드러내지 않습니다(403 대신 404).
    return user


def current_wholesaler(request: Request, db=Depends(get_db)) -> dict:
    ws = auth.ws_for_token(db, request.cookies.get(auth.WS_COOKIE_NAME))
    if not ws:
        raise HTTPException(401, "도매업체 로그인이 필요합니다.")
    return ws


def verified_wholesaler(ws: dict = Depends(current_wholesaler)) -> dict:
    if ws["status"] != "verified":
        raise HTTPException(403, "사업자 인증을 먼저 마쳐 주세요.")
    return ws
