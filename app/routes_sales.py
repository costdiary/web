"""내 가게 매출: 파일 올리기·직접 입력, 월별 합계, 손익분기·목표 매출과 비교."""
from __future__ import annotations

import calendar
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from . import costing, importer, notifications, sales
from .db import get_db, transaction
from .deps import current_user, writable_user
from .routes_breakeven import _payload as breakeven_payload
from .schemas import SalesDayIn, SalesItemIn

router = APIRouter(prefix="/api")
KST = timezone(timedelta(hours=9))


def _today():
    return datetime.now(KST).date()


def _month(q: str | None):
    if q and not re.fullmatch(r"\d{4}-\d{2}", q):
        raise HTTPException(400, "month 는 2026-11 처럼 입력하세요.")
    ym = q or _today().strftime("%Y-%m")
    y, m = int(ym[:4]), int(ym[5:])
    if not 1 <= m <= 12 or y < 2000:
        raise HTTPException(400, "month 가 올바르지 않습니다.")
    return ym, y, m


def _summary(db, user: dict, q: str | None) -> dict:
    ym, y, m = _month(q)
    uid = user["id"]
    rows = db.execute(
        "SELECT day, channel, amount, orders FROM daily_sales WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day, channel",
        (uid, f"{ym}-01", f"{ym}-31")).fetchall()
    by_day: dict[str, dict] = {}
    by_ch: dict[str, float] = {}
    total = 0.0
    orders = 0
    for r in rows:
        d = by_day.setdefault(r["day"], {"day": r["day"], "amount": 0.0, "channels": {}, "items": [], "ingredient_cost": None, "net_profit": None})
        d["amount"] += r["amount"]
        d["channels"][r["channel"]] = r["amount"]
        by_ch[r["channel"]] = by_ch.get(r["channel"], 0.0) + r["amount"]
        total += r["amount"]
        orders += r["orders"] or 0

    # 메뉴별 판매 수량(입력했다면) → 그 날의 재료비를 빼서 실제 순이익을 보여 준다.
    cost_by_menu = {mv["id"]: (mv["name"], mv["cost"]) for mv, _ in costing.load_menus(db, user)}
    item_rows = db.execute(
        "SELECT day, menu_id, qty FROM sales_items WHERE user_id = ? AND day >= ? AND day <= ? AND qty > 0 ORDER BY day",
        (uid, f"{ym}-01", f"{ym}-31")).fetchall()
    total_ingredient_cost = 0.0
    any_items = False
    for r in item_rows:
        name_cost = cost_by_menu.get(r["menu_id"])
        if not name_cost:
            continue  # 메뉴가 그 뒤 삭제됐으면 조용히 건너뛴다
        name, cost = name_cost
        d = by_day.setdefault(r["day"], {"day": r["day"], "amount": 0.0, "channels": {}, "items": [], "ingredient_cost": None, "net_profit": None})
        line_cost = (cost or 0) * r["qty"]
        d["items"].append({"menu_id": r["menu_id"], "name": name, "qty": r["qty"], "cost_each": cost, "cost_total": line_cost})
        d["ingredient_cost"] = (d["ingredient_cost"] or 0) + line_cost
        total_ingredient_cost += line_cost
        any_items = True
    for d in by_day.values():
        if d["ingredient_cost"] is not None:
            d["net_profit"] = d["amount"] - d["ingredient_cost"]

    last_day = calendar.monthrange(y, m)[1]
    today = _today()
    if (today.year, today.month) == (y, m):
        elapsed = today.day
    else:
        elapsed = last_day if (y, m) < (today.year, today.month) else 0
    be = breakeven_payload(db, user)
    res = be["result"] or {}
    entered = len(by_day)
    pace = None
    if entered and elapsed and elapsed < last_day:
        pace = total / elapsed * last_day  # 지금까지 평균으로 월말까지 간다고 본 단순 계산
    return {
        "month": ym, "days_in_month": last_day, "elapsed_days": elapsed, "entered_days": entered,
        "total": total, "orders": orders or None,
        "by_channel": [{"key": k, "label": sales.CHANNEL_LABEL.get(k, k), "amount": v} for k, v in sorted(by_ch.items(), key=lambda kv: -kv[1])],
        "days": sorted(by_day.values(), key=lambda d: d["day"]),
        "pace_total": pace,
        "breakeven_sales": res.get("breakeven_sales"), "target_sales": res.get("target_sales"),
        "delivery_total": sum(v for k, v in by_ch.items() if k != "store"),
        "labels": sales.CHANNEL_LABEL,
        "menus": [{"id": mid, "name": name} for mid, (name, _) in cost_by_menu.items()],
        # 메뉴별 판매를 입력한 날짜의 매출만 더해서 비교한다(안 입력한 날짜의 매출까지 섞으면
        # "매출은 전부, 원가는 일부"가 되어 순이익이 실제보다 부풀어 보인다).
        "total_ingredient_cost": total_ingredient_cost if any_items else None,
        "total_net_profit": (sum(d["amount"] for d in by_day.values() if d["ingredient_cost"] is not None) - total_ingredient_cost) if any_items else None,
    }


@router.get("/sales")
def get_sales(month: str | None = None, user: dict = Depends(current_user), db=Depends(get_db)):
    return _summary(db, user, month)


def _upsert(db, uid: int, recs: list[dict], source: str) -> None:
    db.executemany(
        "INSERT INTO daily_sales(user_id, day, channel, amount, orders, source) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(user_id, day, channel) DO UPDATE SET amount=excluded.amount, orders=excluded.orders, source=excluded.source",
        [(uid, r["day"], r["channel"], r["amount"], r["orders"], source) for r in recs])


@router.post("/sales/import")
def import_sales(file: UploadFile = File(...), user: dict = Depends(writable_user), db=Depends(get_db)):
    data = file.file.read(importer.MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "파일이 비어 있습니다.")
    if len(data) > importer.MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다(5MB 이하).")
    try:
        res = sales.parse_file(file.filename or "", data)
    except importer.ImportFileError as e:
        raise HTTPException(400, str(e))
    if res["error"]:
        raise HTTPException(400, res["error"])
    recs = res["records"]
    if len(recs) > sales.MAX_ROWS:
        raise HTTPException(400, f"한 번에 {sales.MAX_ROWS}건까지 올릴 수 있습니다. 기간을 나눠 올려 주세요.")
    with transaction(db):
        _upsert(db, user["id"], recs, "upload")
    days = sorted({r["day"] for r in recs})
    return {"saved": len(recs), "skipped": res["skipped"], "from": days[0], "to": days[-1], "month": days[-1][:7]}


@router.put("/sales/day")
def put_day(body: SalesDayIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    notifications.touch(user["id"])  # 단가·매출이 바뀌면 종 숫자를 바로 다시 센다
    day = sales.parse_day(body.day)
    if day is None:
        raise HTTPException(400, "날짜가 올바르지 않습니다.")
    ch = sales.parse_channel(body.channel) if body.channel not in sales.CHANNEL_LABEL else body.channel
    with transaction(db):
        _upsert(db, user["id"], [{"day": day, "channel": ch, "amount": body.amount, "orders": body.orders}], "manual")
    return _summary(db, user, day[:7])


@router.delete("/sales/day")
def delete_day(day: str, channel: str = "store", user: dict = Depends(writable_user), db=Depends(get_db)):
    d = sales.parse_day(day)
    if d is None:
        raise HTTPException(400, "날짜가 올바르지 않습니다.")
    with transaction(db):
        db.execute("DELETE FROM daily_sales WHERE user_id = ? AND day = ? AND channel = ?", (user["id"], d, channel))
    return _summary(db, user, d[:7])


@router.put("/sales/items")
def put_sales_item(body: SalesItemIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    day = sales.parse_day(body.day)
    if day is None:
        raise HTTPException(400, "날짜가 올바르지 않습니다.")
    uid = user["id"]
    menu = db.execute("SELECT id FROM menus WHERE id = ? AND user_id = ?", (body.menu_id, uid)).fetchone()
    if not menu:
        raise HTTPException(404, "메뉴를 찾지 못했습니다.")
    with transaction(db):
        if body.qty <= 0:
            db.execute("DELETE FROM sales_items WHERE user_id = ? AND day = ? AND menu_id = ?", (uid, day, body.menu_id))
        else:
            db.execute(
                "INSERT INTO sales_items(user_id, day, menu_id, qty) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id, day, menu_id) DO UPDATE SET qty=excluded.qty",
                (uid, day, body.menu_id, body.qty),
            )
    return _summary(db, user, day[:7])
