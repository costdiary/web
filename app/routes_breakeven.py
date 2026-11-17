"""손익분기·목표 매출 계산: 월 고정비와 메뉴 원가·배달 수수료로 '한 달에 얼마를 팔아야 남는지'를 계산합니다."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from . import channels, costing
from .routes_labor import load_summary as labor_summary
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .schemas import BreakevenIn

router = APIRouter(prefix="/api")
# 처음 여는 가게에 보여 줄 기본 항목. 인건비는 '직원 급여' 화면에서 계산한 값이 자동으로 더해지므로 넣지 않습니다.
# 예전에 저장한 항목(예: '인건비' 한 줄)은 그대로 두고, 화면에서 직원 급여와 겹치면 알려 줍니다.
PRESETS = ["월세", "전기세", "수도세", "인터넷비", "기타 잡비"]


def _profile(db, uid: int) -> dict:
    row = db.execute("SELECT * FROM shop_profile WHERE user_id = ?", (uid,)).fetchone()
    fixed = db.execute("SELECT label, amount FROM fixed_costs WHERE user_id = ? ORDER BY position, id", (uid,)).fetchall()
    return {
        "fixed": [{"label": r["label"], "amount": r["amount"]} for r in fixed],
        "delivery_share": row["delivery_share"] if row else 0,
        "open_days": row["open_days"] if row else 26,
        "target_profit": row["target_profit"] if row else 0,
        "payment_fee_pct": row["payment_fee_pct"] if row else 0,
        "saved": row is not None,
    }


def _payload(db, user: dict) -> dict:
    uid = user["id"]
    prof = _profile(db, uid)
    pairs = costing.load_menus(db, user, chans=channels.load_enabled(db, uid))
    stats = costing.contribution([mv for mv, _ in pairs])
    manual_total = sum(f["amount"] for f in prof["fixed"])
    lab = labor_summary(db, uid)
    fixed_total = manual_total + lab["total"]  # 직접 넣은 고정비 + 직원 급여(주휴수당 포함) 한 달 합계
    res = costing.breakeven(fixed_total, prof["target_profit"], prof["delivery_share"], stats["cm_store"], stats["cm_delivery"],
                            stats["avg_price"], prof["open_days"], prof["payment_fee_pct"])
    labor_out = {"total": lab["total"], "base_total": lab["base_total"], "holiday_total": lab["holiday_total"],
                 "night_total": lab["night_total"], "active_count": lab["active_count"], "five_plus": lab["five_plus"]}
    return {"profile": prof, "presets": PRESETS, "stats": stats, "fixed_total": fixed_total, "manual_total": manual_total,
            "labor": labor_out, "result": res}


@router.get("/breakeven")
def get_breakeven(user: dict = Depends(current_user), db=Depends(get_db)):
    return _payload(db, user)


@router.put("/breakeven")
def put_breakeven(body: BreakevenIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        db.execute(
            "INSERT INTO shop_profile(user_id, delivery_share, open_days, target_profit, payment_fee_pct, updated_at) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET delivery_share=excluded.delivery_share, open_days=excluded.open_days, "
            "target_profit=excluded.target_profit, payment_fee_pct=excluded.payment_fee_pct, updated_at=excluded.updated_at",
            (uid, body.delivery_share, body.open_days, body.target_profit, body.payment_fee_pct, now_iso()),
        )
        db.execute("DELETE FROM fixed_costs WHERE user_id = ?", (uid,))
        db.executemany(
            "INSERT INTO fixed_costs(user_id, label, amount, position) VALUES (?,?,?,?)",
            [(uid, f.label.strip(), f.amount, i) for i, f in enumerate(body.fixed) if f.label.strip()],
        )
    return _payload(db, user)
