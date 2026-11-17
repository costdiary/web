"""프렙 레시피(미리 끓여 두는 육수·소스 등) CRUD."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from . import preps as preps_mod, units
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .schemas import PrepIn

router = APIRouter(prefix="/api/preps")


def _canon(unit: str) -> str:
    c = units.canon_unit(unit)
    if c is None:
        raise HTTPException(400, f"단위를 확인해 주세요: {unit}")
    return c


def _view(db, row) -> dict:
    cost = preps_mod.compute_cost(db, row["id"])
    item_rows = db.execute(
        "SELECT pi.ingredient_id, pi.qty, i.name, i.unit_kind FROM prep_items pi "
        "JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.prep_id = ? ORDER BY pi.position, pi.id",
        (row["id"],),
    ).fetchall()
    used = db.execute(
        "SELECT COUNT(*) AS c FROM menu_items mi WHERE mi.ingredient_id = ?", (row["ingredient_id"],)
    ).fetchone()["c"]
    return {
        "id": row["id"], "name": row["name"], "unit_kind": row["unit_kind"], "yield_qty": row["yield_qty"],
        "ingredient_id": row["ingredient_id"], "unit_price": cost["unit_price"], "total_cost": cost["total_cost"],
        "missing": cost["missing"], "used_in_menus": used,
        "items": [{"ingredient_id": r["ingredient_id"], "name": r["name"], "qty": r["qty"], "kind": r["unit_kind"]} for r in item_rows],
    }


def _owned(db, pid: int, uid: int):
    row = db.execute("SELECT * FROM preps WHERE id = ? AND user_id = ?", (pid, uid)).fetchone()
    if not row:
        raise HTTPException(404, "찾을 수 없습니다.")
    return row


def _resolve_items(db, uid: int, items) -> list[tuple[int, float]]:
    out = []
    for it in items:
        ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (it.ingredient_id, uid)).fetchone()
        if not ing:
            raise HTTPException(404, "찾을 수 없습니다.")
        if ing["from_prep_id"] is not None:
            raise HTTPException(400, f"'{ing['name']}'은(는) 다른 프렙의 결과물이라 프렙 재료로 쓸 수 없습니다.")
        unit = _canon(it.unit)
        kind, qty_base = units.to_base(it.qty, unit)
        if kind != ing["unit_kind"]:
            allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
            raise HTTPException(400, f"'{ing['name']}'은(는) {allowed} 단위로 입력해 주세요.")
        out.append((ing["id"], qty_base))
    return out


def _resolve_yield(body: PrepIn) -> float:
    yunit = _canon(body.yield_unit)
    ykind, yqty_base = units.to_base(body.yield_qty, yunit)
    if ykind != body.unit_kind:
        raise HTTPException(400, "완성량 단위를 확인해 주세요.")
    return yqty_base


@router.get("")
def list_preps(user: dict = Depends(current_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM preps WHERE user_id = ? ORDER BY name", (user["id"],)).fetchall()
    return {"items": [_view(db, r) for r in rows]}


@router.get("/{pid}")
def get_prep(pid: int, user: dict = Depends(current_user), db=Depends(get_db)):
    row = _owned(db, pid, user["id"])
    return {"item": _view(db, row)}


@router.post("")
def create_prep(body: PrepIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    if not body.items:
        raise HTTPException(400, "재료를 1개 이상 넣어 주세요.")
    yield_qty = _resolve_yield(body)
    resolved = _resolve_items(db, uid, body.items)
    now = now_iso()
    try:
        with transaction(db):
            cur = db.execute(
                "INSERT INTO ingredients(user_id, name, unit_kind, category, supplier, updated_at) VALUES (?,?,?,?,?,?)",
                (uid, body.name, body.unit_kind, "프렙", "", now),
            )
            iid = cur.lastrowid
            cur2 = db.execute(
                "INSERT INTO preps(user_id, name, unit_kind, yield_qty, ingredient_id, updated_at) VALUES (?,?,?,?,?,?)",
                (uid, body.name, body.unit_kind, yield_qty, iid, now),
            )
            pid = cur2.lastrowid
            db.execute("UPDATE ingredients SET from_prep_id = ? WHERE id = ?", (pid, iid))
            for pos, (ing_id, qty) in enumerate(resolved):
                db.execute(
                    "INSERT INTO prep_items(prep_id, ingredient_id, qty, position) VALUES (?,?,?,?)",
                    (pid, ing_id, qty, pos),
                )
            preps_mod.recompute(db, pid, uid)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "같은 이름의 식자재·프렙이 이미 있습니다.")
    return {"item": _view(db, _owned(db, pid, uid))}


@router.put("/{pid}")
def update_prep(pid: int, body: PrepIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    prep = _owned(db, pid, uid)
    if prep["unit_kind"] != body.unit_kind:
        raise HTTPException(409, "단위 종류(g/ml)는 바꿀 수 없습니다. 새 프렙으로 만들어 주세요.")
    if not body.items:
        raise HTTPException(400, "재료를 1개 이상 넣어 주세요.")
    yield_qty = _resolve_yield(body)
    resolved = _resolve_items(db, uid, body.items)
    now = now_iso()
    try:
        with transaction(db):
            db.execute("UPDATE preps SET name=?, yield_qty=?, updated_at=? WHERE id=?", (body.name, yield_qty, now, pid))
            db.execute("UPDATE ingredients SET name=?, updated_at=? WHERE id=?", (body.name, now, prep["ingredient_id"]))
            db.execute("DELETE FROM prep_items WHERE prep_id = ?", (pid,))
            for pos, (ing_id, qty) in enumerate(resolved):
                db.execute(
                    "INSERT INTO prep_items(prep_id, ingredient_id, qty, position) VALUES (?,?,?,?)",
                    (pid, ing_id, qty, pos),
                )
            preps_mod.recompute(db, pid, uid)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "같은 이름의 식자재·프렙이 이미 있습니다.")
    return {"item": _view(db, _owned(db, pid, uid))}


@router.delete("/{pid}")
def delete_prep(pid: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    prep = _owned(db, pid, uid)
    menus = db.execute(
        "SELECT DISTINCT m.name FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE mi.ingredient_id = ?",
        (prep["ingredient_id"],),
    ).fetchall()
    if menus:
        names = ", ".join(r["name"] for r in menus[:3]) + (" 외" if len(menus) > 3 else "")
        raise HTTPException(409, f"'{names}' 메뉴에서 쓰고 있어 삭제할 수 없습니다. 메뉴에서 먼저 빼 주세요.")
    db.execute("DELETE FROM preps WHERE id = ?", (pid,))  # ingredients.from_prep_id의 ON DELETE CASCADE로 전용 식자재도 함께 삭제됨
    return {"ok": True}
