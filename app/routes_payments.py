"""PG(결제) 웹훅 — 로그인한 도매업체가 아니라 PG사 서버가 직접 호출하는 경로라
``/api/ws/*``가 아닌 별도 라우터에 둡니다. 서명 검증은 ``payments.parse_webhook``이 맡는다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import market, payments
from .db import get_db

log = logging.getLogger("wongaenote.routes_payments")

router = APIRouter(prefix="/api/payments")


@router.post("/toss/webhook", include_in_schema=False)
async def toss_webhook(request: Request, db=Depends(get_db)):
    body = await request.body()
    provider = payments.get_provider()
    payload = provider.parse_webhook(dict(request.headers), body)
    if payload is None:
        return JSONResponse({"detail": "서명을 확인하지 못했습니다."}, status_code=400)

    # 토스 웹훅 payload 모양(기억 기준 — 실제 연동 전 문서로 재확인할 것):
    # {"eventType": "PAYMENT_STATUS_CHANGED", "data": {"orderId": "...", "paymentKey": "...",
    #  "status": "DONE"|"CANCELED"|..., "totalAmount": 12345}}
    data = payload.get("data") or payload
    order_id = str(data.get("orderId") or data.get("order_id") or "")
    status = str(data.get("status") or "")
    if not order_id:
        return JSONResponse({"detail": "orderId가 없습니다."}, status_code=400)

    try:
        if status in ("DONE", "WAITING_FOR_DEPOSIT"):
            result = market.confirm_pg_payment(
                db, order_id, str(data.get("paymentKey") or data.get("payment_key") or ""),
                data.get("totalAmount") or data.get("amount"),
            )
        else:
            result = market.fail_pg_payment(db, order_id, f"webhook status={status}")
    except ValueError as e:
        log.warning("toss 웹훅 처리 실패(%s): %s", order_id, e)
        return JSONResponse({"detail": str(e)}, status_code=404)
    return {"ok": True, **result}
