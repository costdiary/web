"""다른 앱·엑셀에서 가져오기: 파일 읽기 -> 칸 맞추기 -> 미리보기 -> 저장. 올린 파일은 서버에 저장하지 않습니다.

서버는 올린 파일의 내용을 기억하지 않으므로, 미리보기를 볼 때마다 화면이 같은 파일을 다시 보냅니다(파일은 5MB 이하).
저장할 때는 파일이 아니라 사장님이 미리보기에서 확인한 내용(JSON)을 받아 다시 검증한 뒤 한 번에 저장합니다.
"""
from __future__ import annotations

import json
import logging

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile

from . import importer, services, units
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .routes_data import _resolve_items, _write_items
from .schemas import ImportCommitIn, ImportMenuIn, MenuItemIn

log = logging.getLogger("wongaenote")
router = APIRouter(prefix="/api")

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ------------------------------------------------------------------ 공통

def _load_sheets(file: UploadFile) -> list[dict]:
    data = file.file.read(importer.MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "파일이 비어 있습니다.")
    if len(data) > importer.MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다(5MB 이하). 필요한 시트만 따로 저장해 올려 주세요.")
    try:
        return importer.read_sheets(file.filename or "", data)
    except importer.ImportFileError as e:
        raise HTTPException(400, str(e))


def _pick_sheet(sheets: list[dict], name: str) -> dict:
    if not name:
        return sheets[0]
    for s in sheets:
        if s["name"] == name:
            return s
    raise HTTPException(400, "그 이름의 시트를 찾을 수 없습니다.")


def _parse_mapping(raw: str, kind: str, ncols: int) -> dict[str, int]:
    try:
        m = json.loads(raw or "{}")
    except ValueError:
        raise HTTPException(400, "칸 지정이 올바르지 않습니다.")
    if not isinstance(m, dict):
        raise HTTPException(400, "칸 지정이 올바르지 않습니다.")
    allowed = {f["key"] for f in importer.FIELDS[kind]}
    out: dict[str, int] = {}
    for key, col in m.items():
        if key not in allowed or col is None or col == "":
            continue
        if isinstance(col, bool) or not isinstance(col, int) or not (0 <= col < ncols):
            raise HTTPException(400, "칸 지정이 올바르지 않습니다.")
        out[key] = col
    return out


RECENT_DAYS = 60  # 이 기간 안에 명세서·직접 입력으로 바뀐 단가는 가져오기가 덮어쓰지 않도록 기본값을 '건너뛰기'로 둡니다.


def _existing_ingredients(db, uid: int) -> dict[str, dict]:
    rows = db.execute(
        "SELECT i.*, (SELECT COUNT(*) FROM menu_items mi WHERE mi.ingredient_id = i.id) AS used FROM ingredients i WHERE i.user_id = ?",
        (uid,),
    ).fetchall()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)).strftime("%Y-%m-%d")
    recent = {
        x["iid"]: x["at"]
        for x in db.execute(
            "SELECT ingredient_id AS iid, MAX(created_at) AS at FROM price_history "
            "WHERE user_id = ? AND source != 'import' AND created_at >= ? GROUP BY ingredient_id",
            (uid, cutoff),
        )
    }
    out = {}
    for r in rows:
        kind, up = r["unit_kind"], r["unit_price"]
        out[r["name"]] = {
            "recent_at": recent.get(r["id"]),
            "kind": kind, "unit_price": up, "used": r["used"], "supplier": r["supplier"], "category": r["category"], "yield_pct": r["yield_pct"],
            "display_price": round(units.display_price(kind, up)[0], 2) if up is not None else None,
            "display_unit": units.DISPLAY[kind][0],
        }
    return out


def _unpriced_total(db, uid: int) -> int:
    return db.execute("SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ? AND unit_price IS NULL", (uid,)).fetchone()["c"]


# ------------------------------------------------------------------ 양식·읽기·미리보기

@router.get("/import/template.xlsx")
def template(user: dict = Depends(current_user)):
    return Response(
        content=importer.build_template(),
        media_type=XLSX,
        headers={"Content-Disposition": 'attachment; filename="wongaenote-import-template.xlsx"'},
    )


@router.post("/import/parse")
def parse(
    file: UploadFile = File(...),
    sheet: str = Form(""),
    header_row: int = Form(0),
    user: dict = Depends(writable_user),
):
    """파일 안의 시트마다 제목 줄·칸·미리 짐작한 칸 지정을 돌려줍니다. sheet+header_row 를 주면 그 시트만 제목 줄을 다시 잡습니다."""
    sheets = _load_sheets(file)
    out = []
    for s in sheets:
        hr = header_row - 1 if (sheet and s["name"] == sheet and header_row > 0) else None
        out.append(importer.sheet_overview(s, hr))
    return {"filename": (file.filename or "")[:80], "sheets": out, "fields": importer.FIELDS, "limits": {"rows": importer.MAX_ROWS}}


@router.post("/import/preview")
def preview(
    file: UploadFile = File(...),
    sheet: str = Form(""),
    kind: str = Form(...),
    mapping: str = Form("{}"),
    header_row: int = Form(0),
    user: dict = Depends(writable_user),
    db=Depends(get_db),
):
    if kind not in importer.VOCAB:
        raise HTTPException(400, "가져올 종류(식자재 / 메뉴·레시피)를 골라 주세요.")
    sh = _pick_sheet(_load_sheets(file), sheet)
    rows = sh["rows"]
    hr = (header_row - 1) if header_row > 0 else importer.detect_header_row(rows)
    hr = max(0, min(hr, len(rows) - 1))
    headers = [str(c) if c is not None else "" for c in rows[hr]]
    m = _parse_mapping(mapping, kind, len(headers))
    need = importer.REQUIRED[kind]
    if need not in m:
        label = next(f["label"] for f in importer.FIELDS[kind] if f["key"] == need)
        raise HTTPException(400, f"'{label}' 칸을 골라 주세요.")
    body = rows[hr + 1:]
    first_row_no = hr + 2  # 엑셀에서 보이는 줄 번호
    hints = importer.column_hints(headers, m)
    uid = user["id"]
    if kind == "ingredients":
        recs = importer.ingredient_records(body, m, first_row_no, _existing_ingredients(db, uid), hints)
        stats = importer.ingredient_stats(recs)
    else:
        ings = db.execute("SELECT id, name, unit_kind FROM ingredients WHERE user_id = ?", (uid,)).fetchall()
        menus = {r["name"]: r["id"] for r in db.execute("SELECT MIN(id) AS id, name FROM menus WHERE user_id = ? GROUP BY name", (uid,))}
        recs = importer.menu_records(body, m, first_row_no, ings, services.load_aliases(db, uid), menus, hints)
        stats = importer.menu_stats(recs)
    return {
        "kind": kind, "sheet": sh["name"], "header_row": hr + 1, "records": recs, "stats": stats,
        "truncated": len(body) > importer.MAX_ROWS,
    }


# ------------------------------------------------------------------ 저장

@router.post("/import/commit")
def commit(body: ImportCommitIn, user: dict = Depends(writable_user), db=Depends(get_db),
           idempotency_key: str | None = Header(None)):
    return services.idem_run(user["id"], idempotency_key, lambda: _commit(body, user, db))


def _commit(body: ImportCommitIn, user: dict, db):
    uid = user["id"]
    if body.kind == "ingredients":
        if not body.ingredients:
            raise HTTPException(400, "가져올 식자재가 없습니다.")
        res = _commit_ingredients(db, uid, body)
    else:
        if not body.menus:
            raise HTTPException(400, "가져올 메뉴가 없습니다.")
        res = _commit_menus(db, uid, body)
    log.info("import commit uid=%s kind=%s created=%s updated=%s failed=%s", uid, body.kind, res["created"], res["updated"], len(res["failed"]))
    return res


def _commit_ingredients(db, uid: int, body: ImportCommitIn) -> dict:
    created = updated = unchanged = skipped = 0
    failed: list[dict] = []
    repriced: list[int] = []
    seen: set[str] = set()
    now = now_iso()
    with transaction(db):
        last = {rec.name: i for i, rec in enumerate(body.ingredients)}
        for i, rec in enumerate(body.ingredients):
            if last[rec.name] != i:  # 같은 이름이 여러 번 오면 미리보기와 같이 마지막 줄만 씁니다.
                skipped += 1
                continue
            seen.add(rec.name)
            unit = units.canon_unit(rec.pack_unit)
            if unit is None:
                failed.append({"name": rec.name, "reason": "단위를 확인해 주세요."})
                continue
            priced = rec.pack_price is not None
            if priced and rec.pack_size is None:
                failed.append({"name": rec.name, "reason": "규격 수량이 필요합니다."})
                continue
            kind = units.to_base(1, unit)[0]
            ing = db.execute("SELECT * FROM ingredients WHERE user_id = ? AND name = ?", (uid, rec.name)).fetchone()
            if ing is None:
                cur = db.execute(
                    "INSERT INTO ingredients(user_id, name, unit_kind, yield_pct, supplier, category, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
                    (uid, rec.name, kind, rec.yield_pct or 100, rec.supplier, rec.category, now, now),
                )
                if priced:  # 가격이 없으면 '단가 없음'으로 두고 나중에 명세서로 채웁니다.
                    ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (cur.lastrowid,)).fetchone()
                    services.apply_price(db, uid, ing, rec.pack_size, unit, rec.pack_price, "import", ts=now)
                created += 1
                continue
            if body.on_conflict == "skip":
                skipped += 1
                continue
            if priced and kind != ing["unit_kind"]:
                used = db.execute("SELECT COUNT(*) AS c FROM menu_items WHERE ingredient_id = ?", (ing["id"],)).fetchone()["c"]
                if used:
                    failed.append({"name": rec.name, "reason": "메뉴에서 쓰고 있어 단위 종류(무게·부피·개수)를 바꿀 수 없습니다."})
                    continue
                db.execute("DELETE FROM price_history WHERE ingredient_id = ?", (ing["id"],))  # 단위 종류가 달라지면 예전 이력과 비교할 수 없습니다.
                ing = dict(ing, unit_price=None)
            supplier = rec.supplier or ing["supplier"]
            category = rec.category or ing["category"]
            yld = rec.yield_pct if rec.yield_pct is not None else ing["yield_pct"]
            meta = (supplier, category, yld) != (ing["supplier"], ing["category"], ing["yield_pct"])
            if meta:
                db.execute("UPDATE ingredients SET supplier=?, category=?, yield_pct=?, updated_at=? WHERE id=? AND user_id=?",
                           (supplier, category, yld, now, ing["id"], uid))
            res = services.apply_price(db, uid, ing, rec.pack_size, unit, rec.pack_price, "import", ts=now) if priced else None
            if res and res["changed"]:
                updated += 1
                if res["old"] is not None:
                    repriced.append(ing["id"])
            elif meta:
                updated += 1
            else:
                unchanged += 1

    menu_ids: set[int] = set()  # 단가가 바뀐 식자재를 쓰는 메뉴 수(원가가 달라진 메뉴)
    for i in range(0, len(repriced), 500):
        chunk = repriced[i:i + 500]
        rows = db.execute(
            "SELECT DISTINCT mi.menu_id AS id FROM menu_items mi JOIN menus m ON m.id = mi.menu_id "
            f"WHERE m.user_id = ? AND mi.ingredient_id IN ({','.join('?' * len(chunk))})",
            (uid, *chunk),
        ).fetchall()
        menu_ids.update(r["id"] for r in rows)
    return {
        "kind": "ingredients", "created": created, "updated": updated, "unchanged": unchanged, "skipped": skipped, "failed": failed,
        "affected_menus": len(menu_ids), "unpriced_total": _unpriced_total(db, uid),
    }


class _Conflict(Exception):
    pass


def _plan_lines(db, uid: int, rec: ImportMenuIn) -> list[tuple]:
    """재료 줄을 저장 전에 모두 점검합니다(쓰기 없음). 틀린 줄이 하나라도 있으면 그 메뉴는 통째로 건너뜁니다."""
    plan = []
    new_kinds: dict[str, str] = {}
    for ln in rec.lines:
        unit = units.canon_unit(ln.unit)
        if unit is None:
            raise _Conflict(f"'{ln.name}'의 단위를 확인해 주세요.")
        kind = units.to_base(ln.qty, unit)[0]
        if ln.ingredient_id:
            ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (ln.ingredient_id, uid)).fetchone()
            if ing is None:
                raise _Conflict(f"'{ln.name}'에 연결한 식자재를 찾을 수 없습니다.")
        else:
            ing = db.execute("SELECT * FROM ingredients WHERE user_id = ? AND name = ?", (uid, ln.name)).fetchone()
        if ing is not None:
            if ing["unit_kind"] != kind:
                allowed = "/".join(units.UI_UNITS[ing["unit_kind"]])
                raise _Conflict(f"'{ln.name}'은(는) 식자재 '{ing['name']}'에 맞춰 {allowed} 단위로 적어야 합니다.")
        elif new_kinds.setdefault(ln.name, kind) != kind:
            raise _Conflict(f"'{ln.name}'이(가) 서로 다른 단위 종류(무게/부피/개수)로 적혀 있습니다.")
        plan.append((ln, unit, kind, ing))
    return plan


def _commit_menus(db, uid: int, body: ImportCommitIn) -> dict:
    created = updated = skipped = new_ings = missing_price = 0
    failed: list[dict] = []
    seen: set[str] = set()
    now = now_iso()
    with transaction(db):
        last = {rec.name: i for i, rec in enumerate(body.menus)}
        for i, rec in enumerate(body.menus):
            if last[rec.name] != i:  # 같은 이름이 여러 번 오면 마지막 것만 씁니다(식자재와 같은 규칙).
                skipped += 1
                continue
            seen.add(rec.name)
            ex = db.execute("SELECT * FROM menus WHERE user_id = ? AND name = ? ORDER BY id LIMIT 1", (uid, rec.name)).fetchone()
            if ex is not None and body.on_conflict == "skip":
                skipped += 1
                continue
            try:
                plan = _plan_lines(db, uid, rec)
            except _Conflict as e:
                failed.append({"name": rec.name, "reason": str(e)})
                continue
            items = []
            for ln, unit, kind, ing in plan:
                if ing is None:  # 앞선 줄·메뉴에서 방금 만든 같은 이름이 있으면 그것을 씁니다.
                    ing = db.execute("SELECT * FROM ingredients WHERE user_id = ? AND name = ?", (uid, ln.name)).fetchone()
                if ing is None:
                    cur = db.execute(
                        "INSERT INTO ingredients(user_id, name, unit_kind, yield_pct, supplier, category, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (uid, ln.name, kind, 100, "", "", now, now),
                    )
                    ing = db.execute("SELECT * FROM ingredients WHERE id = ?", (cur.lastrowid,)).fetchone()
                    new_ings += 1
                elif ln.ingredient_id and services.norm_name(ln.name) != services.norm_name(ing["name"]):
                    services.save_alias(db, uid, ln.name, ing["id"])  # 사장님이 이름이 다른 식자재로 이어 준 것은 기억해 둡니다.
                items.append(MenuItemIn(ingredient_id=ing["id"], qty=ln.qty, unit=unit))
            resolved = _resolve_items(db, uid, items)  # 같은 재료가 여러 줄이면 합칩니다.
            if ex is None:
                cur = db.execute(
                    "INSERT INTO menus(user_id, name, price, delivery_price, category, note, other_cost, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (uid, rec.name, rec.price or 0, rec.delivery_price or None, rec.category, "", rec.other_cost or 0, now),
                )
                _write_items(db, cur.lastrowid, resolved)
                created += 1
                if rec.price is None:
                    missing_price += 1
            else:  # 파일에 적힌 값만 바꾸고, 재료 줄이 없는 파일이면 기존 레시피는 그대로 둡니다.
                db.execute(
                    "UPDATE menus SET price=?, delivery_price=?, category=?, other_cost=?, updated_at=? WHERE id=? AND user_id=?",
                    (
                        rec.price if rec.price is not None else ex["price"],
                        rec.delivery_price or ex["delivery_price"],
                        rec.category or ex["category"],
                        rec.other_cost if rec.other_cost is not None else ex["other_cost"],
                        now, ex["id"], uid,
                    ),
                )
                if resolved:
                    db.execute("DELETE FROM menu_items WHERE menu_id = ?", (ex["id"],))
                    _write_items(db, ex["id"], resolved)
                updated += 1
    return {
        "kind": "menus", "created": created, "updated": updated, "skipped": skipped, "failed": failed,
        "created_ingredients": new_ings, "missing_price": missing_price, "unpriced_total": _unpriced_total(db, uid),
    }
