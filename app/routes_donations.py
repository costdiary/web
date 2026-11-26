"""후원(도네이션) — 왼쪽 사이드바에 들어가는 "후원하기" 화면과 일별/월별 순위.

지금은 결제사가 정해지지 않아 payments.get_provider()가 MockProvider를 돌려준다(화면/DB
흐름만 먼저 완성). 실제 PG 계약이 끝나면 get_provider()만 바꾸면 되고, 이 라우터는 그대로 쓸 수 있다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from . import donations, identity, payments
from .db import get_db, now_iso
from .deps import current_user
from .schemas import DonationIn, PgConfirmIn

router = APIRouter(prefix="/api/donations")


@router.post("")
def start_donation(body: DonationIn, user: dict = Depends(current_user), db=Depends(get_db)):
    # 후원과 본인인증을 한 계정으로 묶는다: 인증을 켠 운영에서는 실명 확인된 계정만 후원할 수 있다.
    if identity.enabled() and not identity.is_verified(user):
        raise HTTPException(403, "후원하려면 휴대폰 본인인증을 먼저 해 주세요.")
    donation_id = donations.create_donation(db, user["id"], body.nickname, body.amount, body.message, body.amount_public)
    provider = payments.get_provider()
    order_id = payments.make_order_id("don", donation_id)
    donations.set_order_id(db, donation_id, order_id)
    intent = provider.create_intent(order_id, body.amount, "원가다이어리 후원")
    return {
        "donation_id": donation_id, "amount": body.amount, "status": "requested", "provider": provider.name,
        "order_id": intent.order_id, "client_key": intent.client_key, "checkout_url": intent.checkout_url,
    }


@router.post("/confirm")
def confirm_donation(body: PgConfirmIn, user: dict = Depends(current_user), db=Depends(get_db)):
    """결제위젯 완료 후 프런트가 돌려받은 paymentKey로 승인을 마무리할 때 부른다.
    (PG사가 직접 보내는 서버-서버 웹훅은 /api/payments/toss/webhook에서 별도로 처리한다.)"""
    order_id = body.order_id
    don = db.execute("SELECT * FROM donations WHERE pg_order_id = ?", (order_id,)).fetchone()
    if not don:
        raise HTTPException(404, "후원 신청을 찾지 못했습니다.")
    if don["status"] == "paid":
        return {"donation_id": don["id"], "status": "paid"}
    provider = payments.get_provider()
    conf = provider.confirm(body.payment_key, order_id, don["amount"])
    if not conf.paid:
        donations.fail_pg_payment(db, order_id, conf.error or "결제 승인 실패")
        raise HTTPException(402, f"결제 승인에 실패했습니다: {conf.error or '알 수 없는 오류'}")
    try:
        result = donations.confirm_pg_payment(db, order_id, conf.pg_tx_id or body.payment_key, conf.amount)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {**result, "status": "paid"}


@router.get("/leaderboard")
def get_leaderboard(period: str = "day", date: str = "", user: dict = Depends(current_user), db=Depends(get_db)):
    if period not in ("day", "month"):
        raise HTTPException(400, "period는 day 또는 month여야 합니다.")
    return donations.leaderboard(db, period, date or now_iso()[:10])
