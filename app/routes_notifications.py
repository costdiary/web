"""알림 센터 API: 목록, 안 읽은 개수, 읽음 처리, 분류별 켜고 끄기."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import notifications as notif
from .db import get_db, transaction
from .deps import current_user

router = APIRouter(prefix="/api/notifications")


class ReadIn(BaseModel):
    ids: list[int] | None = Field(default=None, max_length=200)  # 비우면 전부 읽음


class PrefsIn(BaseModel):
    cost: bool | None = None
    sales: bool | None = None
    market: bool | None = None
    system: bool | None = None


@router.get("")
def list_notifications(category: str | None = None, user: dict = Depends(current_user), db=Depends(get_db)):
    with transaction(db):
        notif.sync(db, user, force=True)
    return {
        "items": notif.list_for(db, user["id"], category),
        "unread": notif.unread_count(db, user["id"]),
        "categories": [{"key": k, "label": v[0]} for k, v in notif.CATEGORIES.items()],
    }


@router.get("/count")
def count(user: dict = Depends(current_user), db=Depends(get_db)):
    with transaction(db):
        notif.sync(db, user)
    return {"unread": notif.unread_count(db, user["id"])}


@router.post("/read")
def read(body: ReadIn, user: dict = Depends(current_user), db=Depends(get_db)):
    notif.mark_read(db, user["id"], body.ids)
    return {"unread": notif.unread_count(db, user["id"])}


@router.get("/prefs")
def get_prefs(user: dict = Depends(current_user), db=Depends(get_db)):
    return {"prefs": notif.prefs(db, user["id"]),
            "categories": [{"key": k, "label": v[0], "desc": v[1]} for k, v in notif.CATEGORIES.items()]}


@router.put("/prefs")
def put_prefs(body: PrefsIn, user: dict = Depends(current_user), db=Depends(get_db)):
    with transaction(db):
        p = notif.set_prefs(db, user["id"], body.model_dump(exclude_none=True))
    notif.touch(user["id"])  # 다시 켠 분류의 알림이 바로 만들어지게
    return {"prefs": p}
