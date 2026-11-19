"""운영자(ADMIN_EMAILS) 전용 화면 — 지금은 OCR 인식 로그만. 사장님이 올린 거래명세서/요리
사진이 Claude(비전)에 어떻게 읽혔는지(또는 왜 실패했는지) 확인하는 용도.

메뉴·사이드바에는 노출하지 않는다(일반 사용자에게 보일 이유가 없음) — 운영자가 주소를
직접 쳐서 들어간다. 접근 자체는 deps.current_admin이 막는다(이메일 화이트리스트 밖이면 404).
"""
from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Depends, HTTPException

from .db import get_db
from .deps import current_admin

router = APIRouter(prefix="/api/admin")


@router.get("/ocr-logs")
def list_ocr_logs(kind: str = "", status: str = "", limit: int = 50,
                   admin: dict = Depends(current_admin), db=Depends(get_db)):
    limit = max(1, min(limit, 200))
    where, params = [], []
    if kind:
        where.append("l.kind = ?")
        params.append(kind)
    if status:
        where.append("l.status = ?")
        params.append(status)
    sql = (
        "SELECT l.id, l.kind, l.status, l.summary, l.error_text, l.created_at, "
        "(l.image IS NOT NULL) AS has_image, u.store_name, u.email "
        "FROM ocr_logs l LEFT JOIN users u ON u.id = l.user_id"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY l.id DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(sql, params).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/ocr-logs/{log_id}")
def get_ocr_log(log_id: int, admin: dict = Depends(current_admin), db=Depends(get_db)):
    row = db.execute(
        "SELECT l.*, u.store_name, u.email FROM ocr_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?",
        (log_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "로그를 찾지 못했습니다.")
    d = dict(row)
    image = d.pop("image")
    d["image_data_url"] = f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}" if image else None
    try:
        d["result"] = json.loads(d["result_json"]) if d["result_json"] else None
    except json.JSONDecodeError:
        d["result"] = None
    return d
