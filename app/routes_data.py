"""식자재·메뉴·대시보드·거래명세서·내보내기."""
from __future__ import annotations

import csv
import io
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from . import auth, channels, config, costing, market, ocr, security, seed, services, units
from .db import ISO, get_db, now_iso, transaction
from .deps import current_user, writable_user
from .routes_sales import _summary as _sales_summary
from .schemas import IngredientIn, InvoiceConfirmIn, MenuIn

log = logging.getLogger("wongaenote")
router = APIRouter(prefix="/api")

STALE_DAYS = 45


# ------------------------------------------------------------------ 공통

def _canon(unit: str) -> str:
    c = units.canon_unit(unit)
    if c is None:
        raise HTTPException(400, f"단위를 확인해 주세요: {unit}")
    return c


def _owned(db, table: str, rid: int, uid: int):
    # table 이름은 이 파일 안의 고정 문자열만 넘깁니다.
    row = db.execute(f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (rid, uid)).fetchone()  # nosec B608
    if not row:
        raise HTTPException(404, "찾을 수 없습니다.")
    return row


def ing_view(r, chg: dict | None = None, used: int = 0) -> dict:
    r = dict(r)
    kind = r["unit_kind"]
    up = r["unit_price"]
    disp_unit = units.DISPLAY[kind][0]
    disp_price = units.display_price(kind, up)[0] if up is not None else None
    eff = costing.eff_unit_cost(up, r["yield_pct"]) if up is not None else None
    eff_disp = units.display_price(kind, eff)[0] if eff is not None else None
    d = {
        "id": r["id"],
        "name": r["name"],
        "supplier": r["supplier"],
        "category": r["category"],
        "origin": r["origin"],
        "grade": r["grade"],
        "cut": r["cut"],
        "from_prep_id": r["from_prep_id"],
        "kind": kind,
        "unit_choices": units.UI_UNITS[kind],
        "pack_size": r["pack_size"],
        "pack_unit": r["pack_unit"],
        "pack_price": r["pack_price"],
        "yield_pct": r["yield_pct"],
        "unit_price": up,
        "display_price": round(disp_price, 2) if disp_price is not None else None,
        "display_unit": disp_unit,
        "effective_display_price": round(eff_disp, 2) if eff_disp is not None else None,
        "price_checked_at": r["price_checked_at"],
        "updated_at": r["updated_at"],
        "used_in": used,
        "change_pct": None,
        "prev_display_price": None,
        "changed_at": None,
    }
    if chg:
        d["change_pct"] = round(chg["pct"], 1)
        d["prev_display_price"] = round(units.display_price(kind, chg["prev"])[0], 2)
        d["changed_at"] = chg["at"]
    return d


def _ing_one(db, uid: int, iid: int) -> dict:
    row = _owned(db, "ingredients", iid, uid)
    chg = services.price_changes(db, uid).get(iid)
    used = services.used_counts(db, uid).get(iid, 0)
    return ing_view(row, chg, used)


def _slim(mv: dict) -> dict:
    return {k: v for k, v in mv.items() if k != "lines"}


def _one_menu(db, user: dict, mid: int) -> dict:
    pairs = costing.load_menus(db, user, mid)
    if not pairs:
        raise HTTPException(404, "찾을 수 없습니다.")
    mv = pairs[0][0]
    for ln in mv["lines"]:
        ln["unit_choices"] = units.UI_UNITS[ln["kind"]]
    return mv


# ------------------------------------------------------------------ 식자재

@router.get("/ingredients")
def list_ingredients(user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    chg = services.price_changes(db, uid)
    used = services.used_counts(db, uid)
    rows = db.execute("SELECT * FROM ingredients WHERE user_id = ? ORDER BY name", (uid,)).fetchall()
    return {"items": [ing_view(r, chg.get(r["id"]), used.get(r["id"], 0)) for r in rows]}


@router.post("/ingredients")
def create_ingredient(body: IngredientIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    unit = _canon(body.pack_unit)
    kind, _ = units.to_base(body.pack_size, unit)
    now = now_iso()
    try:
        with transaction(db):
            cur = db.execute(
                "INSERT INTO ingredients(user_id, name, unit_kind, yield_pct, supplier, category, origin, grade, cut, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (uid, body.name, kind, body.yield_pct, body.supplier, body.category, body.origin, body.grade, body.cut, now),
            )
            iid = cur.lastrowid
            ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (iid,)).fetchone()
            services.apply_price(db, uid, ing, body.pack_size, unit, body.pack_price, "manual", ts=now)
            if body.origin:
                # 원산지까지 적어서 등록했으면(등급은 더 이상 필수가 아니다), 도매마켓 품목 매핑
                # 화면을 거치지 않고 이름으로 바로 표준 품목에 연결한다.
                market.try_auto_map(db, uid, iid)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "같은 이름의 식자재가 이미 있습니다.")
    return {"item": _ing_one(db, uid, iid)}


@router.get("/ingredients/{iid}")
def get_ingredient(iid: int, user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    item = _ing_one(db, uid, iid)
    kind = item["kind"]
    hist = db.execute(
        "SELECT unit_price, pack_size, pack_unit, pack_price, source, created_at FROM price_history "
        "WHERE ingredient_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 40",
        (iid, uid),
    ).fetchall()
    used = db.execute(
        "SELECT m.id, m.name, mi.qty FROM menu_items mi JOIN menus m ON m.id = mi.menu_id "
        "WHERE mi.ingredient_id = ? AND m.user_id = ? ORDER BY m.name",
        (iid, uid),
    ).fetchall()
    return {
        "item": item,
        "history": [
            {
                "date": h["created_at"],
                "display_price": round(units.display_price(kind, h["unit_price"])[0], 2),
                "pack_size": h["pack_size"],
                "pack_unit": h["pack_unit"],
                "pack_price": h["pack_price"],
                "source": h["source"],
            }
            for h in hist
        ],
        "used_in": [
            {"menu_id": u["id"], "name": u["name"], "qty": units.pretty_qty(kind, u["qty"])[0], "unit": units.pretty_qty(kind, u["qty"])[1]}
            for u in used
        ],
    }


@router.put("/ingredients/{iid}")
def update_ingredient(iid: int, body: IngredientIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    ing = _owned(db, "ingredients", iid, uid)
    if ing["from_prep_id"] is not None:
        raise HTTPException(409, "이 식자재는 프렙 레시피에서 자동으로 계산됩니다. 프렙 화면에서 수정해 주세요.")
    unit = _canon(body.pack_unit)
    kind, _ = units.to_base(body.pack_size, unit)
    kind_changed = kind != ing["unit_kind"]
    if kind_changed:
        used = db.execute("SELECT COUNT(*) AS c FROM menu_items WHERE ingredient_id = ?", (iid,)).fetchone()["c"]
        if used:
            raise HTTPException(409, "메뉴에서 쓰고 있는 식자재는 단위 종류(무게/부피/개수)를 바꿀 수 없습니다.")
    try:
        with transaction(db):
            # origin/grade/cut은 보내지 않으면(None) 기존 값을 그대로 둡니다 — 도매마켓 매핑(PUT
            # /api/market/ingredients/{id})이 이미 넣어 둔 값을 일반 수정 화면에서 지워 버리지 않도록.
            db.execute(
                "UPDATE ingredients SET name=?, supplier=?, category=?, yield_pct=?, "
                "origin=COALESCE(?, origin), grade=COALESCE(?, grade), cut=COALESCE(?, cut), updated_at=? "
                "WHERE id=? AND user_id=?",
                (body.name, body.supplier, body.category, body.yield_pct,
                 body.origin, body.grade, body.cut, now_iso(), iid, uid),
            )
            if kind_changed:  # 단위 종류가 달라지면 예전 이력과 비교할 수 없으므로 비웁니다.
                db.execute("DELETE FROM price_history WHERE ingredient_id = ?", (iid,))
                ing = dict(ing, unit_price=None)
            services.apply_price(db, uid, ing, body.pack_size, unit, body.pack_price, "manual")
            # 원산지·등급을 이번에 채웠고 확신 있는 추천이 있으면 바로 표준 품목에 연결하고,
            # 이미 매핑돼 있던 식자재라면(원산지·등급·이름이 바뀌었을 수 있으니) 수요 신호를
            # 다시 계산해 둔다 — 도매마켓 쪽 정보가 식자재 쪽 수정을 그대로 따라가도록.
            refreshed = db.execute("SELECT mk_item_id FROM ingredients WHERE id = ?", (iid,)).fetchone()
            if refreshed["mk_item_id"]:
                market.recompute_signal(db, uid, iid)
            else:
                market.try_auto_map(db, uid, iid)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "같은 이름의 식자재가 이미 있습니다.")
    return {"item": _ing_one(db, uid, iid)}


@router.delete("/ingredients/{iid}")
def delete_ingredient(iid: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    ing = _owned(db, "ingredients", iid, uid)
    if ing["from_prep_id"] is not None:
        raise HTTPException(409, "이 식자재는 프렙 레시피에서 자동으로 만들어집니다. 프렙 화면에서 삭제해 주세요.")
    menus = db.execute(
        "SELECT DISTINCT m.name FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE mi.ingredient_id = ?",
        (iid,),
    ).fetchall()
    if menus:
        names = ", ".join(r["name"] for r in menus[:3]) + (" 외" if len(menus) > 3 else "")
        raise HTTPException(409, f"'{names}' 메뉴에서 쓰고 있어 삭제할 수 없습니다. 메뉴에서 먼저 빼 주세요.")
    db.execute("DELETE FROM ingredients WHERE id = ? AND user_id = ?", (iid, uid))
    return {"ok": True}


# ------------------------------------------------------------------ 메뉴

def _resolve_items(db, uid: int, items) -> list[tuple]:
    """재료 줄을 검증하고 기본 단위로 바꿉니다. 같은 재료가 여러 줄이면 합칩니다.
    돌려주는 값: (식자재 id, 양, 추정 여부 0/1, 최소 양, 최대 양). 추정이 아니면 최소·최대는 None."""
    merged: dict[int, dict] = {}
    order: list[int] = []
    for it in items:
        ing = _owned(db, "ingredients", it.ingredient_id, uid)
        unit = _canon(it.unit)
        kind, qty_base = units.to_base(it.qty, unit)
        if kind != ing["unit_kind"]:
            allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
            raise HTTPException(400, f"'{ing['name']}'은(는) {allowed} 단위로 입력해 주세요.")
        est = bool(it.estimated)
        low = units.to_base(it.qty_low, unit)[1] if (est and it.qty_low) else qty_base
        high = units.to_base(it.qty_high, unit)[1] if (est and it.qty_high) else qty_base
        low, high = min(low, qty_base), max(high, qty_base)
        if ing["id"] not in merged:
            order.append(ing["id"])
            merged[ing["id"]] = {"qty": 0.0, "est": False, "low": 0.0, "high": 0.0}
        m = merged[ing["id"]]
        m["qty"] += qty_base
        m["low"] += low
        m["high"] += high
        m["est"] = m["est"] or est
    out = []
    for i in order:
        m = merged[i]
        out.append((i, m["qty"], 1, m["low"], m["high"]) if m["est"] else (i, m["qty"], 0, None, None))
    return out


def _write_items(db, menu_id: int, resolved: list[tuple]) -> None:
    for pos, (iid, qty, est, low, high) in enumerate(resolved):
        db.execute(
            "INSERT INTO menu_items(menu_id, ingredient_id, qty, position, estimated, qty_low, qty_high) VALUES (?,?,?,?,?,?,?)",
            (menu_id, iid, qty, pos, est, low, high),
        )


@router.get("/menus")
def list_menus(user: dict = Depends(current_user), db=Depends(get_db)):
    menus = [_slim(mv) for mv, _ in costing.load_menus(db, user)]
    rated = [m for m in menus if m["cost_ratio"] is not None]
    target = user["target_cost_ratio"]
    return {
        "items": menus,
        "summary": {
            "count": len(menus),
            "avg_cost_ratio": round(sum(m["cost_ratio"] for m in rated) / len(rated), 1) if rated else None,
            "over_target": sum(1 for m in rated if m["cost_ratio"] > target),
            "target": target,
        },
    }


@router.post("/menus")
def create_menu(body: MenuIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    resolved = _resolve_items(db, uid, body.items)
    with transaction(db):
        cur = db.execute(
            "INSERT INTO menus(user_id, name, price, delivery_price, category, note, other_cost, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, body.name, body.price, body.delivery_price or None, body.category, body.note, body.other_cost, now_iso()),
        )
        mid = cur.lastrowid
        _write_items(db, mid, resolved)
    return {"item": _one_menu(db, user, mid)}


@router.get("/menus/{mid}")
def get_menu(mid: int, user: dict = Depends(current_user), db=Depends(get_db)):
    return {"item": _one_menu(db, user, mid)}


@router.put("/menus/{mid}")
def update_menu(mid: int, body: MenuIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    _owned(db, "menus", mid, uid)
    resolved = _resolve_items(db, uid, body.items)
    with transaction(db):
        db.execute(
            "UPDATE menus SET name=?, price=?, delivery_price=?, category=?, note=?, other_cost=?, updated_at=? WHERE id=? AND user_id=?",
            (body.name, body.price, body.delivery_price or None, body.category, body.note, body.other_cost, now_iso(), mid, uid),
        )
        db.execute("DELETE FROM menu_items WHERE menu_id = ?", (mid,))
        _write_items(db, mid, resolved)
    return {"item": _one_menu(db, user, mid)}


@router.post("/menus/{mid}/duplicate")
def duplicate_menu(mid: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    src = _owned(db, "menus", mid, uid)
    items = db.execute(
        "SELECT ingredient_id, qty, estimated, qty_low, qty_high FROM menu_items WHERE menu_id = ? ORDER BY position, id", (mid,)
    ).fetchall()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO menus(user_id, name, price, delivery_price, category, note, other_cost, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, f"{src['name']} (복사)"[:60], src["price"], src["delivery_price"], src["category"], src["note"], src["other_cost"], now_iso()),
        )
        new_id = cur.lastrowid
        _write_items(db, new_id, [(r["ingredient_id"], r["qty"], r["estimated"], r["qty_low"], r["qty_high"]) for r in items])
    return {"item": _one_menu(db, user, new_id)}


@router.delete("/menus/{mid}")
def delete_menu(mid: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    _owned(db, "menus", mid, uid)
    db.execute("DELETE FROM menus WHERE id = ? AND user_id = ?", (mid, uid))
    return {"ok": True}


# ------------------------------------------------------------------ 대시보드

@router.get("/dashboard")
def dashboard(user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    target = user["target_cost_ratio"]
    chans = channels.load_enabled(db, uid)
    pairs = costing.load_menus(db, user, chans=chans)
    menus = [mv for mv, _ in pairs]
    changes = services.price_changes(db, uid)
    alerts = costing.build_alerts(user, pairs, changes)
    rated = [m for m in menus if m["cost_ratio"] is not None]
    avg = round(sum(m["cost_ratio"] for m in rated) / len(rated), 1) if rated else None
    cutoff = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).strftime(ISO)
    stale = db.execute(
        "SELECT i.id, i.name, i.price_checked_at FROM ingredients i "
        "WHERE i.user_id = ? AND i.price_checked_at < ? "
        "AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.ingredient_id = i.id) "
        "ORDER BY i.price_checked_at LIMIT 20",
        (uid, cutoff),
    ).fetchall()
    invoices = db.execute(
        "SELECT id, supplier, invoice_date, total, line_count, created_at FROM invoices "
        "WHERE user_id = ? ORDER BY id DESC LIMIT 3",
        (uid,),
    ).fetchall()
    worst = sorted(rated, key=lambda m: -m["cost_ratio"])[:5]
    loss = []  # 배달앱에서 팔수록 적자인 메뉴
    for mv in menus:
        for r in (mv["delivery"] or {"channels": []})["channels"]:
            if r["profit"] is not None and r["profit"] < 0:
                loss.append({"menu_id": mv["id"], "name": mv["name"], "channel": r["short"], "profit": r["profit"],
                             "net_ratio": r["net_ratio"], "sale_price": r["sale_price"], "recommended_price": r["recommended_price"]})
    loss.sort(key=lambda x: x["profit"])
    unpriced = db.execute("SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ? AND unit_price IS NULL", (uid,)).fetchone()["c"]
    sales = _sales_summary(db, user, None)  # 이번 달 매출·재료비 — 홈 화면은 원가율보다 이 금액을 메인으로 보여 준다
    return {
        "summary": {
            "menu_count": len(menus),
            "ingredient_count": db.execute("SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ?", (uid,)).fetchone()["c"],
            "avg_cost_ratio": avg,
            "over_target": sum(1 for m in rated if m["cost_ratio"] > target),
            "rising_count": len(alerts),
            "stale_count": len(stale),
            "target": target,
            "sales_total": sales["total"],
            "sales_ingredient_cost": sales["total_ingredient_cost"],
            "sales_net_profit": sales["total_net_profit"],
            "sales_entered_days": sales["entered_days"],
        },
        "alerts": alerts[:8],
        "worst_menus": [_slim(m) for m in worst],
        "delivery": {
            "configured": bool(chans),
            "channels": [{"key": c["key"], "short": c["short"]} for c in chans],
            "loss_count": len(loss),
            "loss": loss[:5],
        },
        "unpriced_count": unpriced,
        "estimated_menu_count": sum(1 for m in menus if m["estimated_count"]),
        "stale": [{"id": s["id"], "name": s["name"], "checked_at": s["price_checked_at"]} for s in stale[:5]],
        "recent_invoices": [dict(i) for i in invoices],
    }


# ------------------------------------------------------------------ 거래명세서

@router.get("/invoices")
def list_invoices(user: dict = Depends(current_user), db=Depends(get_db)):
    rows = db.execute(
        "SELECT id, supplier, invoice_date, total, line_count, created_at FROM invoices "
        "WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        (user["id"],),
    ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/invoices/parse")
def parse_invoice(file: UploadFile = File(...), user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    data = file.file.read(ocr.MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(400, "파일이 비어 있습니다.")
    if len(data) > ocr.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "사진 용량이 너무 큽니다(12MB 이하).")
    try:
        jpeg = ocr.prepare_image(data)
    except ocr.OcrError as e:
        raise HTTPException(400, str(e))

    ps = auth.plan_status(user)
    limit = auth.ocr_limit(ps["state"])
    demo = not ocr.enabled()
    if demo:
        parsed = ocr.demo_invoice()
    else:
        if services.user_rate_hit(f"ai:{uid}", 6, 60):
            raise HTTPException(429, "자동 인식 요청이 너무 많습니다. 1분 뒤에 다시 시도해 주세요.")
        if not services.ocr_reserve(db, uid, limit):
            raise HTTPException(429, f"이번 달 자동 인식 {limit}회를 모두 썼습니다. 직접 입력으로는 계속 반영할 수 있습니다.")
        try:
            parsed = ocr.parse_invoice(jpeg)
        except BaseException as e:
            services.ocr_release(db, uid)
            if isinstance(e, ocr.OcrError):
                raise HTTPException(502, str(e))
            raise

    ings = db.execute("SELECT id, name, unit_kind FROM ingredients WHERE user_id = ?", (uid,)).fetchall()
    by_id = {r["id"]: r for r in ings}
    aliases = services.load_aliases(db, uid)
    for ln in parsed["lines"]:
        m = services.best_match(ln["name"], ings, aliases)
        ln["match"] = {"id": m[0], "name": by_id[m[0]]["name"], "score": m[1]} if m and m[0] in by_id else None
    return {
        "demo": demo,
        **parsed,
        "usage": {"ocr_used": services.ocr_used(db, uid), "ocr_limit": limit},
    }


@router.post("/invoices/confirm")
def confirm_invoice(body: InvoiceConfirmIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    applied = [ln for ln in body.lines if ln.apply]
    if not applied:
        raise HTTPException(400, "반영할 품목을 하나 이상 선택해 주세요.")

    prepared = []  # 저장 전에 전부 검증합니다(하나라도 틀리면 아무것도 저장하지 않음).
    for idx, ln in enumerate(applied, start=1):
        unit = units.canon_unit(ln.pack_unit)
        if unit is None:
            raise HTTPException(400, f"{idx}번째 품목('{ln.name}')의 단위를 확인해 주세요.")
        kind, _ = units.to_base(ln.pack_size, unit)
        ing = None
        if ln.ingredient_id:
            ing = _owned(db, "ingredients", ln.ingredient_id, uid)
            if ing["unit_kind"] != kind:
                allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
                raise HTTPException(400, f"'{ln.name}': 연결한 식자재 '{ing['name']}'은(는) {allowed} 단위로 입력해야 합니다.")
        prepared.append((ln, unit, kind, ing))

    # 자동 인식이 꺼진 서버에서는 'ocr'이라고 주장해도 예시(demo)로 강등합니다(위조해도 얻는 건
    # "자기 예시 데이터가 자기 평균에 섞이는 것"뿐이라 위험은 낮지만, 신호 계산은 깨끗하게 유지합니다).
    source = body.source
    if source == "ocr" and not ocr.enabled():
        source = "demo"

    results = []
    changed_ids: list[int] = []
    affected_ingredient_ids: list[int] = []
    with transaction(db):
        inv = db.execute(
            "INSERT INTO invoices(user_id, supplier, invoice_date, total, line_count, created_at, source) VALUES (?,?,?,?,?,?,?)",
            (uid, body.supplier, body.invoice_date, body.total, len(prepared), now_iso(), source),
        )
        invoice_id = inv.lastrowid
        for ln, unit, kind, ing in prepared:
            created = False
            if ing is None:
                ing = db.execute("SELECT * FROM ingredients WHERE user_id = ? AND name = ?", (uid, ln.name)).fetchone()
                if ing is not None and ing["unit_kind"] != kind:
                    allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
                    raise HTTPException(400, f"'{ln.name}': 이미 있는 식자재는 {allowed} 단위로 입력해야 합니다.")
            if ing is None:
                cur = db.execute(
                    "INSERT INTO ingredients(user_id, name, unit_kind, yield_pct, supplier, category, origin, grade, cut, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (uid, ln.name, kind, 100, body.supplier, "", ln.origin, ln.grade, ln.cut, now_iso()),
                )
                ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (cur.lastrowid,)).fetchone()
                created = True
            elif ln.origin or ln.grade or ln.cut:
                # 이미 있는 식자재는 자동 인식(또는 사장님이 명세서 화면에서 채운 값)이 비어 있는 칸만
                # 채웁니다 — 도매마켓 매핑 등 다른 경로로 이미 들어가 있는 값은 덮지 않습니다.
                db.execute(
                    "UPDATE ingredients SET origin=COALESCE(origin,?), grade=COALESCE(grade,?), cut=COALESCE(cut,?) WHERE id=?",
                    (ln.origin, ln.grade, ln.cut, ing["id"]),
                )
                ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (ing["id"],)).fetchone()
            res = services.apply_price(db, uid, ing, ln.pack_size, unit, ln.pack_price, "invoice", invoice_id)
            db.execute(
                "INSERT INTO invoice_lines(user_id, invoice_id, ingredient_id, pack_size, pack_unit, pack_price, unit_price, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (uid, invoice_id, ing["id"], ln.pack_size, unit, ln.pack_price, res["new"], now_iso()),
            )
            services.save_alias(db, uid, ln.alias or ln.name, ing["id"])
            affected_ingredient_ids.append(ing["id"])
            prev_disp = units.display_price(kind, res["old"])[0] if res["old"] is not None else None
            new_disp, disp_unit = units.display_price(kind, res["new"])
            pct = ((res["new"] / res["old"] - 1.0) * 100.0) if (res["old"] and res["changed"]) else None
            if res["changed"] and not created:
                changed_ids.append(ing["id"])
            results.append(
                {
                    "ingredient_id": ing["id"],
                    "name": ing["name"],
                    "created": created,
                    "changed": res["changed"],
                    "prev_display_price": round(prev_disp, 2) if prev_disp is not None else None,
                    "display_price": round(new_disp, 2),
                    "unit": disp_unit,
                    "change_pct": round(pct, 1) if pct is not None else None,
                }
            )

    affected = 0
    if changed_ids:
        marks = ",".join("?" * len(changed_ids))
        affected = db.execute(
            "SELECT COUNT(DISTINCT mi.menu_id) AS c FROM menu_items mi JOIN menus m ON m.id = mi.menu_id "
            f"WHERE m.user_id = ? AND mi.ingredient_id IN ({marks})",
            (uid, *changed_ids),
        ).fetchone()["c"]
    # 명세서 확정(커밋 완료) 뒤 수요 신호·매칭을 갱신합니다. 실패해도 명세서 저장에는 영향이 없습니다.
    new_offers = market.on_invoice_confirmed(db, uid, invoice_id, affected_ingredient_ids)
    try:
        market.deliver_active_ads_for_invoice(db, uid, invoice_id)
    except Exception:
        log.exception("deliver_active_ads_for_invoice 실패")
    return {"invoice_id": invoice_id, "updated": results, "affected_menus": affected, "market": {"new_offers": new_offers}}


# ------------------------------------------------------------------ 예시 데이터·내보내기

@router.post("/demo/seed")
def demo_seed(user: dict = Depends(writable_user), db=Depends(get_db)):
    try:
        seed.seed_demo(db, user)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


def _safe_cell(c):
    # 엑셀에서 열 때 수식으로 실행되는 것을 막습니다.
    if isinstance(c, str) and c[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + c
    return c


def _export_guard(user: dict) -> None:
    """내려받기는 한 번에 많은 자료가 나가므로 횟수를 제한하고 기록을 남깁니다."""
    if security.hit(f"export:{user['id']}", config.env_int("EXPORT_PER_HOUR", 12), 3600):
        raise HTTPException(429, "내려받기를 너무 자주 했습니다. 잠시 뒤에 다시 시도해 주세요.")
    security.audit("export", user_id=user["id"], once=f"ex:{user['id']}")


def _csv(filename: str, header: list[str], rows: list[list]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_safe_cell(c) for c in r])
    body = ("﻿" + buf.getvalue()).encode("utf-8")  # BOM: 엑셀에서 한글이 깨지지 않게
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/ingredients.csv")
def export_ingredients(user: dict = Depends(current_user), db=Depends(get_db)):
    _export_guard(user)
    chg = services.price_changes(db, user["id"])
    rows = db.execute("SELECT * FROM ingredients WHERE user_id = ? ORDER BY name", (user["id"],)).fetchall()
    out = []
    for r in rows:
        v = ing_view(r, chg.get(r["id"]))
        out.append([v["name"], v["supplier"], v["category"], v["pack_size"], v["pack_unit"], v["pack_price"],
                    v["display_price"], v["display_unit"], v["yield_pct"], v["change_pct"], v["price_checked_at"]])
    return _csv("ingredients.csv",
                ["식자재", "거래처", "분류", "규격 수량", "규격 단위", "구매가(원)", "단가", "단가 단위", "수율(%)", "최근 변동(%)", "마지막 확인"],
                out)


@router.get("/export/menus.csv")
def export_menus(user: dict = Depends(current_user), db=Depends(get_db)):
    _export_guard(user)
    chans = channels.load_enabled(db, user["id"])
    out = []
    for mv, _ in costing.load_menus(db, user, chans=chans):
        row = [mv["name"], mv["category"], mv["price"], mv["cost"], mv["cost_ratio"], mv["margin"], mv["recommended_price"], mv["status"], mv["delivery_price"]]
        by_key = {r["key"]: r for r in (mv["delivery"] or {"channels": []})["channels"]}
        row += [by_key[c["key"]]["profit"] if c["key"] in by_key else None for c in chans]
        out.append(row)
    header = ["메뉴", "분류", "판매가(원)", "원가(원)", "원가율(%)", "마진(원)", "권장 판매가(원)", "상태", "배달앱 판매가(원)"]
    header += [f"{c['short']} 건당 남는 돈(원)" for c in chans]
    return _csv("menus.csv", header, out)


@router.get("/export/recipes.csv")
def export_recipes(user: dict = Depends(current_user), db=Depends(get_db)):
    _export_guard(user)
    """메뉴마다 재료와 양을 한 줄씩 적은 표. '가져오기'에서 그대로 다시 읽을 수 있습니다."""
    out = []
    for mv, _ in costing.load_menus(db, user, chans=[]):
        head = [mv["name"], mv["category"], mv["price"], mv["delivery_price"], mv["other_cost"]]
        if not mv["lines"]:
            out.append(head + [None, None, None, None])
        for ln in mv["lines"]:
            out.append(head + [ln["name"], ln["qty"], ln["unit"], "추정" if ln["estimated"] else ""])
    return _csv("recipes.csv", ["메뉴", "분류", "판매가(원)", "배달앱 판매가(원)", "기타 원가(원)", "재료", "사용량", "단위", "추정 여부"], out)
