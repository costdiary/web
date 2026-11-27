"""완성된 요리 사진으로 레시피 초안 만들기: 사진 -> 재료·양 추정 -> 확인 -> 메뉴로 저장."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from . import auth, ocr, recipe_ai, refdata, services, units
from .db import get_db, now_iso, transaction
from .deps import writable_user
from .routes_data import _one_menu, _owned, _resolve_items, _write_items
from .schemas import MenuItemIn, RecipeConfirmIn

log = logging.getLogger("wongaenote")
router = APIRouter(prefix="/api")


@router.post("/recipe/estimate")
def estimate(
    file: UploadFile = File(...),
    name: str = Form(""),
    user: dict = Depends(writable_user),
    db=Depends(get_db),
):
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

    ings = db.execute(
        "SELECT i.id, i.name, i.unit_kind, i.unit_price FROM ingredients i WHERE i.user_id = ? "
        "ORDER BY (SELECT COUNT(*) FROM menu_items mi WHERE mi.ingredient_id = i.id) DESC, i.name",
        (uid,),
    ).fetchall()
    by_id = {r["id"]: r for r in ings}
    hint = recipe_ai.one_line(name, 60)

    limit = auth.ocr_limit(auth.plan_status(user)["state"])
    demo = not ocr.enabled()
    if demo:
        est = recipe_ai.demo_estimate(hint)
        ocr.log_attempt(db, uid, "recipe", "demo", jpeg, result=est)
    else:
        if services.user_rate_hit(f"ai:{uid}", 6, 60):
            raise HTTPException(429, "사진 인식 요청이 너무 많습니다. 1분 뒤에 다시 시도해 주세요.")
        if not services.ocr_reserve(db, uid, limit):
            raise HTTPException(429, f"이번 달 사진 인식 {limit}회를 모두 썼습니다. 메뉴는 직접 입력해서 만들 수 있습니다.")
        try:
            est = recipe_ai.estimate_live(jpeg, hint, [dict(r) for r in ings])
        except BaseException as e:
            services.ocr_release(db, uid)
            ocr.log_attempt(db, uid, "recipe", "error", jpeg, error=str(e))
            if isinstance(e, ocr.OcrError):
                raise HTTPException(502, str(e))
            raise
        ocr.log_attempt(db, uid, "recipe", "ok" if est["lines"] else "error", jpeg, result=est,
                         error=None if est["lines"] else "재료를 알아보지 못함(요리 사진이 아닐 수 있음)")

    if not est["lines"]:
        raise HTTPException(422, "요리 사진으로 보이지 않거나 재료를 알아보지 못했습니다. 요리가 잘 보이게 위에서 다시 찍어 주세요.")

    aliases = services.load_aliases(db, uid)
    for ln in est["lines"]:
        m = services.best_match(ln["name"], ings, aliases)
        ing = by_id.get(m[0]) if m else None
        # 무게로 적힌 재료를 개수로 쓰는 식자재에 억지로 붙이지 않습니다(단위 종류가 다르면 연결 안 함).
        if ing is not None and ing["unit_kind"] == ln["kind"]:
            ln["match"] = {"id": ing["id"], "name": ing["name"], "score": m[1], "priced": ing["unit_price"] is not None}
        else:
            ln["match"] = None
    return {
        "demo": demo,
        "dish_name": est["dish_name"] or hint,
        "serving_note": est["serving_note"],
        "lines": est["lines"],
        "reference": est.get("reference") or {"used": False, "names": []},
        "usage": {"ocr_used": services.ocr_used(db, uid), "ocr_limit": limit},
    }


@router.post("/recipe/confirm")
def confirm(body: RecipeConfirmIn, user: dict = Depends(writable_user), db=Depends(get_db),
            idempotency_key: str | None = Header(None)):
    return services.idem_run(user["id"], idempotency_key, lambda: _confirm(body, user, db))


def _confirm(body: RecipeConfirmIn, user: dict, db):
    uid = user["id"]
    applied = [ln for ln in body.lines if ln.apply]
    if not applied:
        raise HTTPException(400, "메뉴에 넣을 재료를 하나 이상 선택해 주세요.")

    prepared = []  # 저장 전에 전부 검증합니다(하나라도 틀리면 아무것도 저장하지 않음).
    for idx, ln in enumerate(applied, start=1):
        unit = units.canon_unit(ln.unit)
        if unit is None:
            raise HTTPException(400, f"{idx}번째 재료('{ln.name}')의 단위를 확인해 주세요.")
        kind, _ = units.to_base(ln.qty, unit)
        ing = None
        if ln.ingredient_id:
            ing = _owned(db, "ingredients", ln.ingredient_id, uid)
            if ing["unit_kind"] != kind:
                allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
                raise HTTPException(400, f"'{ln.name}': 연결한 식자재 '{ing['name']}'은(는) {allowed} 단위로 입력해야 합니다.")
        prepared.append((ln, unit, kind, ing))

    created = 0
    with transaction(db):
        items = []
        for ln, unit, kind, ing in prepared:
            if ing is None:
                ing = db.execute("SELECT * FROM ingredients WHERE user_id = ? AND name = ?", (uid, ln.name)).fetchone()
                if ing is not None and ing["unit_kind"] != kind:
                    allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
                    raise HTTPException(400, f"'{ln.name}': 이미 있는 식자재는 {allowed} 단위로 입력해야 합니다.")
            if ing is None:  # 가격은 나중에 명세서로 채웁니다. 가격이 없는 동안은 원가에서 빠지고 '단가 없음'으로 표시됩니다.
                cur = db.execute(
                    "INSERT INTO ingredients(user_id, name, unit_kind, yield_pct, supplier, category, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
                    (uid, ln.name, kind, 100, "", "", now_iso(), now_iso()),
                )
                ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (cur.lastrowid,)).fetchone()
                created += 1
            services.save_alias(db, uid, ln.alias or ln.name, ing["id"])
            items.append(MenuItemIn(ingredient_id=ing["id"], qty=ln.qty, unit=unit, estimated=ln.estimated,
                                    qty_low=ln.qty_low, qty_high=ln.qty_high))
        resolved = _resolve_items(db, uid, items)
        cur = db.execute(
            "INSERT INTO menus(user_id, name, price, delivery_price, category, note, other_cost, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, body.name, body.price, body.delivery_price or None, body.category, "", 0, now_iso()),
        )
        mid = cur.lastrowid
        _write_items(db, mid, resolved)
    menu = _one_menu(db, user, mid)
    _contribute(body.name, prepared)
    return {"item": menu, "created_ingredients": created, "unpriced": len(menu["missing"])}


def _contribute(name: str, prepared) -> None:
    """양을 직접 확인(추정 표시를 지운)한 줄이 대부분일 때만 참고 레시피 DB 에 쌓습니다. 실패해도 메뉴 저장에는 영향이 없습니다."""
    try:
        rows = [(ln, unit, kind) for ln, unit, kind, _ in prepared]
        if len(rows) < 3 or sum(1 for ln, _, _ in rows if not ln.estimated) < 0.7 * len(rows):
            return  # 모델의 추정 그대로인 값은 되먹임이 되므로 쌓지 않습니다.
        lines = []
        for ln, unit, kind in rows:
            base = units.to_base(ln.qty, unit)[1]
            lines.append((ln.name, base, {"g": "g", "ml": "ml", "ea": "개"}.get(kind, "g")))
        refdata.contribute(name, lines)
    except Exception:  # noqa: BLE001
        log.warning("reference contribute failed", exc_info=True)
