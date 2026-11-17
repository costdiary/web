"""배달앱(배민·쿠팡이츠 등) 수수료 설정 화면이 쓰는 API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from . import channels
from .db import get_db
from .deps import current_user, writable_user
from .schemas import ChannelIn

router = APIRouter(prefix="/api")


@router.get("/channels")
def list_channels(user: dict = Depends(current_user), db=Depends(get_db)):
    return {"items": channels.list_for_user(db, user["id"]), "as_of": channels.AS_OF}


@router.put("/channels/{key}")
def save_channel(key: str, body: ChannelIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    if key not in channels.BY_KEY:
        raise HTTPException(404, "찾을 수 없습니다.")
    return {"item": channels.save(db, user["id"], key, body.model_dump())}
