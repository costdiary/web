"""배달앱 주문건 연동(배민·쿠팡이츠) — 건별 손익, 월간 요약, 광고 유입 주문 마진, 메뉴별 마진 순위.

지금은 파트너 API 키가 없어 '연결하기'를 누르면 예시 주문으로 틀을 보여 준다(orders.source='mock').
실제 키가 들어오면 order_integrations.fetch_orders만 바꾸면 되고, 이 화면·계산 코드는 그대로 쓸 수 있다.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException

from . import order_integrations as oi
from .db import get_db
from .deps import current_user, writable_user

router = APIRouter(prefix="/api/orders")


@router.get("/platforms")
def list_platforms(user: dict = Depends(current_user), db=Depends(get_db)):
    rows = {r["platform"]: r for r in db.execute("SELECT * FROM order_platforms WHERE user_id = ?", (user["id"],)).fetchall()}
    return {"items": [
        {
            "platform": key, "label": label,
            "connected": bool(rows[key]["connected"]) if key in rows else False,
            "connected_at": rows[key]["connected_at"] if key in rows else None,
        }
        for key, label in oi.PLATFORMS.items()
    ]}


@router.post("/platforms/{platform}/sync")
def sync(platform: str, user: dict = Depends(writable_user), db=Depends(get_db)):
    if platform not in oi.PLATFORMS:
        raise HTTPException(404, "찾을 수 없습니다.")
    added = oi.sync_platform(db, user["id"], platform)
    return {"added": added}


@router.get("")
def list_orders(user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    rows = db.execute("SELECT * FROM orders WHERE user_id = ? ORDER BY ordered_at DESC LIMIT 200", (uid,)).fetchall()
    items = [dict(r) for r in rows]

    priced = [o for o in items if o["net_profit"] is not None]
    summary: dict = {"count": len(items), "unmatched": sum(1 for o in items if o["menu_id"] is None)}
    if priced:
        summary["avg_margin_pct"] = round(sum(o["margin_pct"] for o in priced) / len(priced), 1)
        summary["total_sales"] = round(sum(o["order_amount"] for o in priced))
        summary["total_profit"] = round(sum(o["net_profit"] for o in priced))
        ad = [o for o in priced if o["ad_fee"] > 0]
        plain = [o for o in priced if o["ad_fee"] == 0]
        if ad and plain:
            summary["ad_avg_margin_pct"] = round(sum(o["margin_pct"] for o in ad) / len(ad), 1)
            summary["plain_avg_margin_pct"] = round(sum(o["margin_pct"] for o in plain) / len(plain), 1)
    else:
        summary["avg_margin_pct"] = None

    by_menu: dict[str, list[float]] = defaultdict(list)
    for o in priced:
        by_menu[o["menu_name"]].append(o["margin_pct"])
    worst = sorted(
        ({"name": k, "avg_margin_pct": round(sum(v) / len(v), 1), "count": len(v)} for k, v in by_menu.items()),
        key=lambda x: x["avg_margin_pct"],
    )[:5]

    return {"items": items, "summary": summary, "worst_menus": worst}
