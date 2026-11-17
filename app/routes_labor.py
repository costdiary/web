"""직원 급여(인건비): 아르바이트 직원의 시급·주 근무시간을 넣으면 주휴수당까지 더한 한 달 인건비를 계산하고,
그 합계를 손익분기 계산의 고정비에 더합니다. 계산 규칙과 법 출처는 app/labor.py 에 있습니다."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from . import labor
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .schemas import LaborSettingsIn, StaffIn

router = APIRouter(prefix="/api")
KST = timezone(timedelta(hours=9))
MAX_STAFF = 50


def _row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "hourly_wage": r["hourly_wage"], "weekly_hours": r["weekly_hours"],
            "work_days": r["work_days"], "night_hours": r["night_hours"], "active": bool(r["active"])}


def _five_plus(db, uid: int) -> bool:
    row = db.execute("SELECT labor_5plus FROM shop_profile WHERE user_id = ?", (uid,)).fetchone()
    return bool(row["labor_5plus"]) if row else False


def load_summary(db, uid: int) -> dict:
    rows = db.execute("SELECT * FROM staff WHERE user_id = ? ORDER BY active DESC, position, id", (uid,)).fetchall()
    return labor.summarize([_row(r) for r in rows], datetime.now(KST).year, five_plus=_five_plus(db, uid))


def _payload(db, uid: int) -> dict:
    out = load_summary(db, uid)
    out["max_staff"] = MAX_STAFF
    return out


@router.get("/labor")
def get_labor(user: dict = Depends(current_user), db=Depends(get_db)):
    return _payload(db, user["id"])


@router.put("/labor/settings")
def put_labor_settings(body: LaborSettingsIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        db.execute(
            "INSERT INTO shop_profile(user_id, labor_5plus, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET labor_5plus=excluded.labor_5plus, updated_at=excluded.updated_at",
            (uid, int(body.five_plus), now_iso()))
    return _payload(db, uid)


@router.post("/labor/staff")
def add_staff(body: StaffIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        n = db.execute("SELECT COUNT(*) c, COALESCE(MAX(position), -1) p FROM staff WHERE user_id = ?", (uid,)).fetchone()
        if n["c"] >= MAX_STAFF:
            raise HTTPException(400, f"직원은 {MAX_STAFF}명까지 등록할 수 있습니다.")
        db.execute(
            "INSERT INTO staff(user_id, name, hourly_wage, weekly_hours, work_days, night_hours, active, position, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (uid, body.name, body.hourly_wage, body.weekly_hours, body.work_days, body.night_hours, int(body.active), n["p"] + 1, now_iso()))
    return _payload(db, uid)


@router.put("/labor/staff/{staff_id}")
def update_staff(staff_id: int, body: StaffIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        cur = db.execute(
            "UPDATE staff SET name = ?, hourly_wage = ?, weekly_hours = ?, work_days = ?, night_hours = ?, active = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (body.name, body.hourly_wage, body.weekly_hours, body.work_days, body.night_hours, int(body.active), now_iso(), staff_id, uid))
        if cur.rowcount == 0:
            raise HTTPException(404, "직원을 찾지 못했습니다.")
    return _payload(db, uid)


@router.delete("/labor/staff/{staff_id}")
def delete_staff(staff_id: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        cur = db.execute("DELETE FROM staff WHERE id = ? AND user_id = ?", (staff_id, uid))
        if cur.rowcount == 0:
            raise HTTPException(404, "직원을 찾지 못했습니다.")
    return _payload(db, uid)
