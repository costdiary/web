"""후원(도네이션) — payments.py의 PaymentProvider 추상화를 그대로 재사용한다.

결제사는 아직 정하지 않았다. 지금은 화면·DB 흐름만 완성해 두고, 실제로는
MockProvider(외부로 나가는 요청 없음)로만 동작한다. 나중에 실제 PG 계약이
끝나면 payments.get_provider()만 바꾸면 되고, 이 파일과 routes_donations.py는
그대로 쓸 수 있다(market.py의 떨이 광고 PG 결제와 완전히 같은 구조).
"""
from __future__ import annotations

from . import config
from .db import now_iso, transaction


def create_donation(db, user_id: int | None, nickname: str, amount: int, message: str) -> int:
    ts = now_iso()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO donations(user_id, nickname, message, amount, status, created_at) "
            "VALUES (?,?,?,?, 'requested', ?)",
            (user_id, nickname, message, amount, ts),
        )
        return cur.lastrowid


def set_order_id(db, donation_id: int, order_id: str) -> None:
    db.execute("UPDATE donations SET pg_order_id = ? WHERE id = ?", (order_id, donation_id))


def confirm_pg_payment(db, order_id: str, pg_tx_id: str, amount: int | None) -> dict:
    """PG 승인/웹훅 확인 후 호출. 같은 order_id로 다시 불려도(웹훅 재전송 등) 한 번만
    적용되도록, 이미 paid인 결제는 조용히 그대로 돌려준다(market.confirm_pg_payment와 동일한 원칙)."""
    don = db.execute("SELECT * FROM donations WHERE pg_order_id = ?", (order_id,)).fetchone()
    if not don:
        raise ValueError("후원 신청을 찾지 못했습니다.")
    if don["status"] == "paid":
        return {"donation_id": don["id"], "already": True}
    if amount is not None and amount != don["amount"]:
        raise ValueError(f"결제 금액이 일치하지 않습니다(신청 {don['amount']}원 / 승인 {amount}원).")
    with transaction(db):
        db.execute(
            "UPDATE donations SET status='paid', paid_at=?, pg_tx_id=? WHERE id = ?",
            (now_iso(), pg_tx_id, don["id"]),
        )
    return {"donation_id": don["id"]}


def fail_pg_payment(db, order_id: str, reason: str) -> dict:
    don = db.execute("SELECT * FROM donations WHERE pg_order_id = ?", (order_id,)).fetchone()
    if not don:
        raise ValueError("후원 신청을 찾지 못했습니다.")
    if don["status"] != "requested":
        return {"donation_id": don["id"], "already": True}
    db.execute("UPDATE donations SET status='failed' WHERE id = ?", (don["id"],))
    return {"donation_id": don["id"]}


def amount_public() -> bool:
    """후원 금액 공개 여부 — 사장님이 아니라 운영자가 환경변수로 켜고 끈다(관리자 화면이 따로 없어서).
    기본은 공개(True)."""
    return config.env_bool("DONATION_AMOUNT_PUBLIC", True)


def leaderboard(db, period: str, date_str: str) -> dict:
    """period: 'day' | 'month'. date_str: 일별이면 'YYYY-MM-DD', 월별이면 'YYYY-MM'(또는 'YYYY-MM-DD'도 받아 앞 7자만 씀)."""
    prefix = date_str[:7] if period == "month" else date_str[:10]
    rows = db.execute(
        "SELECT nickname, SUM(amount) AS total, COUNT(*) AS cnt FROM donations "
        "WHERE status = 'paid' AND paid_at LIKE ? GROUP BY nickname ORDER BY total DESC, cnt DESC LIMIT 50",
        (prefix + "%",),
    ).fetchall()
    show_amount = amount_public()
    items = [
        {"nickname": r["nickname"], "count": r["cnt"], **({"amount": r["total"]} if show_amount else {})}
        for r in rows
    ]
    return {"period": period, "date": prefix, "amount_public": show_amount, "items": items}
