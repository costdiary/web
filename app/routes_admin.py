"""운영자(ADMIN_EMAILS) 전용 화면 — 가입자·방문자 수(운영 현황)와 OCR 인식 로그. 사장님이 올린 거래명세서/요리
사진이 Claude(비전)에 어떻게 읽혔는지(또는 왜 실패했는지) 확인하는 용도.

메뉴·사이드바에는 노출하지 않는다(일반 사용자에게 보일 이유가 없음) — 운영자가 주소를
직접 쳐서 들어간다. 접근 자체는 deps.current_admin이 막는다(이메일 화이트리스트 밖이면 404).
"""
from __future__ import annotations

import base64
import json
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request

from .db import get_db, now_iso, transaction
from . import auth, security, visits
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


@router.get("/stats")
def site_stats(days: int = 30, admin: dict = Depends(current_admin), db=Depends(get_db)):
    """가입자 수와 방문자 수(한국 날짜 기준). 방문자는 visits.py 가 첫 화면 요청을 센 값."""
    return visits.summary(db, days)


# ---------------------------------------------------------------- 사장님 계정 찾기·관리

@router.get("/users")
def list_users(q: str = "", limit: int = 50, offset: int = 0,
               admin: dict = Depends(current_admin), db=Depends(get_db)):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    where, params = "", []
    if q.strip():
        where = "WHERE u.email LIKE ? OR u.store_name LIKE ?"
        like = f"%{q.strip()}%"
        params = [like, like]
    total = db.execute(f"SELECT COUNT(*) FROM users u {where}", params).fetchone()[0]
    rows = db.execute(
        "SELECT u.id, u.email, u.store_name, u.created_at, u.identity_verified_at, "
        "(SELECT MIN(provider) FROM oauth_accounts o WHERE o.user_id = u.id) AS provider, "
        "(SELECT COUNT(*) FROM ingredients WHERE user_id = u.id) AS ingredients, "
        "(SELECT COUNT(*) FROM menus WHERE user_id = u.id) AS menus, "
        "(SELECT COUNT(*) FROM invoices WHERE user_id = u.id) AS invoices, "
        "(SELECT MAX(created_at) FROM sessions WHERE user_id = u.id) AS last_login "
        f"FROM users u {where} ORDER BY u.id DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    return {"total": total, "items": [dict(r) for r in rows]}


def _user_or_404(db, uid: int) -> dict:
    row = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not row:
        raise HTTPException(404, "사장님 계정을 찾지 못했습니다.")
    return dict(row)


@router.get("/users/{uid}")
def get_user(uid: int, admin: dict = Depends(current_admin), db=Depends(get_db)):
    u = _user_or_404(db, uid)
    count = lambda t: db.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (uid,)).fetchone()[0]  # noqa: E731
    return {
        "id": u["id"], "email": u["email"], "store_name": u["store_name"], "created_at": u["created_at"],
        "identity_verified_at": u.get("identity_verified_at"),
        "providers": [r["provider"] for r in db.execute("SELECT provider FROM oauth_accounts WHERE user_id = ?", (uid,))],
        "counts": {t: count(t) for t in ("ingredients", "menus", "invoices", "preps", "daily_sales", "staff", "ocr_logs", "donations")},
        "last_login": db.execute("SELECT MAX(created_at) FROM sessions WHERE user_id = ?", (uid,)).fetchone()[0],
        "active_sessions": db.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?",
                                      (uid, now_iso())).fetchone()[0],
        "recent_events": [dict(r) for r in db.execute(
            "SELECT at, event, detail FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 15", (uid,))],
    }


@router.post("/users/{uid}/temp-password")
def temp_password(uid: int, request: Request, admin: dict = Depends(current_admin), db=Depends(get_db)):
    """비밀번호를 잊은 사장님께 줄 임시 비밀번호. 기존 로그인은 모두 풀린다(manage.py set-password 와 같음)."""
    u = _user_or_404(db, uid)
    temp = secrets.token_urlsafe(9)
    with transaction(db):
        db.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (auth.hash_password(temp), uid))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    security.audit("admin_temp_password", user_id=uid, ip=security.client_ip(request), detail=f"by {admin['email']}")
    return {"email": u["email"], "temp_password": temp}


@router.post("/users/{uid}/logout-all")
def force_logout(uid: int, request: Request, admin: dict = Depends(current_admin), db=Depends(get_db)):
    _user_or_404(db, uid)
    n = db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,)).rowcount
    security.audit("admin_logout_all", user_id=uid, ip=security.client_ip(request), detail=f"by {admin['email']}")
    return {"ended": n}


# ---------------------------------------------------------------- DB 둘러보기(읽기 전용)
# 표 이름은 sqlite_master 에 있는 것만 받는다. 비밀번호·토큰·해시 같은 칸은 가리고, 사진(BLOB)은 크기만 보여 준다.
# 고치기는 일부러 넣지 않았다: 잘못 지우면 되돌릴 수 없어서, 바꿀 일은 위의 계정 관리 버튼이나 manage.py 로 한다.

SECRET_COL = re.compile(r"(hash|token|salt|secret|password|pw_)", re.I)


def _tables(db) -> list[str]:
    return [r["name"] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


@router.get("/tables")
def list_tables(admin: dict = Depends(current_admin), db=Depends(get_db)):
    return {"items": [{"name": t, "rows": db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]} for t in _tables(db)]}


@router.get("/tables/{name}")
def browse_table(name: str, q: str = "", limit: int = 50, offset: int = 0,
                 admin: dict = Depends(current_admin), db=Depends(get_db)):
    if name not in _tables(db):
        raise HTTPException(404, "그런 표가 없습니다.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    cols = [r["name"] for r in db.execute(f'PRAGMA table_info("{name}")')]
    text_cols = [c for c in cols if not SECRET_COL.search(c)]
    where, params = "", []
    if q.strip() and text_cols:
        where = "WHERE " + " OR ".join(f'CAST("{c}" AS TEXT) LIKE ?' for c in text_cols)
        params = [f"%{q.strip()}%"] * len(text_cols)
    total = db.execute(f'SELECT COUNT(*) FROM "{name}" {where}', params).fetchone()[0]
    order = "ORDER BY rowid DESC" if db.execute(
        "SELECT 1 FROM sqlite_master WHERE name = ? AND sql LIKE '%WITHOUT ROWID%'", (name,)).fetchone() is None else ""
    rows = db.execute(f'SELECT * FROM "{name}" {where} {order} LIMIT ? OFFSET ?', [*params, limit, offset]).fetchall()

    def cell(col, v):
        if v is None:
            return None
        if SECRET_COL.search(col):
            return "••••"
        if isinstance(v, (bytes, bytearray)):
            return f"(파일 {len(v):,}바이트)"
        if isinstance(v, str) and len(v) > 300:
            return v[:300] + "…"
        return v

    return {"name": name, "columns": cols, "total": total,
            "rows": [[cell(c, r[c]) for c in cols] for r in rows]}
