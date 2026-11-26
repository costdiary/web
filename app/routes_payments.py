"""PG(결제) 웹훅 — 로그인한 도매업체가 아니라 PG사 서버가 직접 호출하는 경로라
``/api/ws/*``가 아닌 별도 라우터에 둡니다. 서명 검증은 ``payments.parse_webhook``이 맡는다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import config, donations, market, payments
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
    if provider.name == "mock":
        # 실제 결제사 키가 없을 때는 웹훅을 받지 않는다. 서명도 조회할 곳도 없어서, 누구나 "결제 완료"를
        # 꾸며 보내 후원·광고를 공짜로 확정할 수 있기 때문이다(테스트에서만 PAYMENTS_MOCK_WEBHOOK=1).
        if not config.env_bool("PAYMENTS_MOCK_WEBHOOK"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
    else:
        # 웹훅 본문은 믿지 않고, 토스에 결제 키로 직접 물어본 결과만 쓴다.
        fetched = provider.lookup(str(data.get("paymentKey") or data.get("payment_key") or ""))
        if not fetched:
            return JSONResponse({"detail": "결제를 확인하지 못했습니다."}, status_code=400)
        data = fetched
    order_id = str(data.get("orderId") or data.get("order_id") or "")
    status = str(data.get("status") or "")
    if not order_id:
        return JSONResponse({"detail": "orderId가 없습니다."}, status_code=400)

    # order_id는 payments.make_order_id("kind", row_id) 모양("wongae-kind-id")이라, kind로
    # 어느 기능의 결제인지 구분한다. 후원(don)이 아니면 기존처럼 떨이 광고(market)로 보낸다.
    is_donation = order_id.startswith("wongae-don-")
    confirm_fn = donations.confirm_pg_payment if is_donation else market.confirm_pg_payment
    fail_fn = donations.fail_pg_payment if is_donation else market.fail_pg_payment

    try:
        if status in ("DONE", "WAITING_FOR_DEPOSIT"):
            result = confirm_fn(
                db, order_id, str(data.get("paymentKey") or data.get("payment_key") or ""),
                data.get("totalAmount") or data.get("amount"),
            )
        else:
            result = fail_fn(db, order_id, f"webhook status={status}")
    except ValueError as e:
        log.warning("toss 웹훅 처리 실패(%s): %s", order_id, e)
        return JSONResponse({"detail": str(e)}, status_code=404)
    return {"ok": True, **result}
