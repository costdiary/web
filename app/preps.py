"""프렙 레시피(미리 끓여 두는 육수·소스 등)의 g/ml당 원가 계산.

프렙은 '식자재'처럼 메뉴에 바로 쓸 수 있게, 전용 식자재 한 줄(ingredients.from_prep_id)을
자동으로 두고 그 단가를 프렙 레시피로부터 계산해 채운다. 메뉴 원가 계산(costing.py)은 식자재
단가만 보므로 따로 손댈 필요가 없다. 프렙 재료는 다른 프렙 결과물이 아닌 원재료만 허용해서
(routes_preps._resolve_items에서 검증) 순환 계산을 막는다.
"""
from __future__ import annotations

from . import services
from .costing import eff_unit_cost
from .db import now_iso


def compute_cost(db, prep_id: int) -> dict:
    """프렙 1개(g/ml)당 원가. 재료 단가가 없으면 그만큼 빼고 missing에 이름을 담는다."""
    prep = db.execute("SELECT * FROM preps WHERE id = ?", (prep_id,)).fetchone()
    items = db.execute(
        "SELECT pi.qty, i.unit_price, i.yield_pct, i.name FROM prep_items pi "
        "JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.prep_id = ? ORDER BY pi.position, pi.id",
        (prep_id,),
    ).fetchall()
    total = 0.0
    missing: list[str] = []
    for it in items:
        if it["unit_price"] is None:
            missing.append(it["name"])
            continue
        total += it["qty"] * eff_unit_cost(it["unit_price"], it["yield_pct"])
    yield_qty = prep["yield_qty"] if prep else 0
    unit_price = (total / yield_qty) if yield_qty and yield_qty > 0 else None
    return {"total_cost": round(total, 2), "unit_price": unit_price, "missing": missing}


def recompute(db, prep_id: int, uid: int | None = None) -> None:
    """프렙 원가를 다시 계산해 전용 식자재 단가에 반영하고, 바뀌었으면 이력을 남긴다."""
    prep = db.execute("SELECT * FROM preps WHERE id = ?", (prep_id,)).fetchone()
    if not prep:
        return
    uid = uid or prep["user_id"]
    result = compute_cost(db, prep_id)
    if result["unit_price"] is None:
        return  # 재료 단가가 아직 없으면 0원으로 덮어쓰지 않고 그대로 둔다
    ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (prep["ingredient_id"],)).fetchone()
    if not ing:
        return
    ts = now_iso()
    old_price = ing["unit_price"]
    changed = old_price is None or abs(result["unit_price"] - old_price) > 1e-9 * max(1.0, abs(old_price or 0))
    db.execute(
        "UPDATE ingredients SET unit_price=?, price_checked_at=?, updated_at=? WHERE id=?",
        (result["unit_price"], ts, ts, ing["id"]),
    )
    if changed:
        services.add_history(db, uid, ing["id"], result["unit_price"], None, prep["unit_kind"], None, "prep", ts=ts)


def recompute_preps_using(db, uid: int, ingredient_id: int) -> None:
    """이 식자재(원재료)를 재료로 쓰는 프렙을 모두 다시 계산한다. 가격 반영(services.apply_price)마다 불린다."""
    rows = db.execute(
        "SELECT DISTINCT p.id FROM preps p JOIN prep_items pi ON pi.prep_id = p.id "
        "WHERE p.user_id = ? AND pi.ingredient_id = ?",
        (uid, ingredient_id),
    ).fetchall()
    for r in rows:
        recompute(db, r["id"], uid)
