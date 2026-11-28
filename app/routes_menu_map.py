"""재료·메뉴 연결표(GET /api/menu-map)와 메뉴 추천(GET /api/menu-ideas). 읽기 전용."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from . import menu_map
from .db import get_db
from .deps import current_user

router = APIRouter(prefix="/api")


@router.get("/menu-map")
def get_map(user: dict = Depends(current_user), db=Depends(get_db)):
    return menu_map.build_map(db, user)


@router.get("/menu-ideas")
def get_ideas(user: dict = Depends(current_user), db=Depends(get_db)):
    return menu_map.suggest(db, user)
