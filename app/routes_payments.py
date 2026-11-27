"""PG(결제) 웹훅 — 로그인한 사람이 아니라 PG사 서버가 직접 호출하는 경로입니다.
서명 검증은 ``payments.parse_webhook``이 맡습니다.

원가다이어리와 도매마켓은 서로 다른 서비스라 결제 가맹점(키)과 웹훅 주소를 따로 둡니다.
  - 원가다이어리 후원:   POST /api/payments/toss/webhook      (TOSS_* 키)
  - 도매마켓 떨이 광고: POST /api/ws/payments/toss/webhook   (MARKET_TOSS_* 키)
토스 개발자센터에서 가맹점마다 자기 웹훅 주소를 등록하면 됩니다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import config, donations, market, payments
from .db import get_db

log = logging.getLogger("wongaenote.routes_payments")

router = APIRouter()


async def _handle(request: Request, db, service: str, confirm_fn, fail_fn, accept) -> JSONResponse | dict:
    body = await request.body()
    provider = payments.get_provider(service)
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
    if not accept(order_id):
        return JSONResponse({"detail": "이 서비스의 주문번호가 아닙니다."}, status_code=404)

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


@router.post("/api/payments/toss/webhook", include_in_schema=False)
async def toss_webhook(request: Request, db=Depends(get_db)):
    """원가다이어리 후원 결제("wongae-don-…")."""
    return await _handle(request, db, "wongae", donations.confirm_pg_payment, donations.fail_pg_payment,
                         lambda oid: oid.startswith("wongae-don-"))


@router.post("/api/ws/payments/toss/webhook", include_in_schema=False)
async def market_toss_webhook(request: Request, db=Depends(get_db)):
    """도매마켓 떨이 광고 결제("domae-ad-…"). 분리 전에 만든 "wongae-ad-…" 주문도 받아 준다."""
    return await _handle(request, db, "market", market.confirm_pg_payment, market.fail_pg_payment,
                         lambda oid: oid.startswith(("domae-ad-", "wongae-ad-")))
