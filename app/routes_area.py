"""주변 상권: 가게 위치를 저장하고, 반경 안의 음식점 분포와 추가 공공데이터를 보여줍니다."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from . import area, services
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .schemas import LocationIn

router = APIRouter(prefix="/api/area")


def _loc(db, uid: int):
    r = db.execute("SELECT lat, lon, radius_m, label FROM shop_location WHERE user_id = ?", (uid,)).fetchone()
    return dict(r) if r else None


@router.get("")
def get_area(refresh: bool = False, user: dict = Depends(current_user), db=Depends(get_db)):
    loc = _loc(db, user["id"])
    st = area.sources_status()
    out = {"location": loc, "sources": st, "stores": None, "stores_at": None, "extra": [], "errors": []}
    if not loc:
        return out
    if st["semas"]:
        key = f"semas:{loc['lat']:.4f}:{loc['lon']:.4f}:{loc['radius_m']}"
        hit = None if refresh else area.cache_get(db, key, area.STORE_TTL)
        if hit:
            out["stores"], out["stores_at"] = hit["data"], hit["at"]
        else:
            try:
                items = area.fetch_stores(loc["lat"], loc["lon"], loc["radius_m"])
                summary = area.summarize_stores(items, loc["lat"], loc["lon"])
                out["stores"], out["stores_at"] = summary, area.cache_put(db, key, summary)
            except area.AreaError as e:
                out["errors"].append(str(e))
    if st["seoul"]:
        for name, args in area.seoul_services():
            key = f"seoul:{name}:{args}"
            hit = None if refresh else area.cache_get(db, key, area.SEOUL_TTL)
            if hit:
                out["extra"].append({**hit["data"], "at": hit["at"]})
                continue
            try:
                data = area.fetch_seoul(name, args)
                out["extra"].append({**data, "at": area.cache_put(db, key, data)})
            except area.AreaError as e:
                out["errors"].append(str(e))
    return out


@router.get("/geocode")
def geocode(q: str, user: dict = Depends(current_user)):
    q = q.strip()
    if not 2 <= len(q) <= 100:
        raise HTTPException(400, "주소를 2~100자로 입력해 주세요.")
    if services.user_rate_hit(f"geo:{user['id']}", 20, 60):
        raise HTTPException(429, "주소 검색이 너무 많습니다. 1분 뒤에 다시 시도해 주세요.")
    try:
        return {"results": area.geocode(q)}
    except area.AreaError as e:
        raise HTTPException(502, str(e))


@router.put("/location")
def put_location(body: LocationIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    with transaction(db):
        db.execute(
            "INSERT INTO shop_location(user_id, lat, lon, radius_m, label, updated_at) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, radius_m=excluded.radius_m, "
            "label=excluded.label, updated_at=excluded.updated_at",
            (user["id"], body.lat, body.lon, body.radius_m, body.label, now_iso()))
    return {"location": _loc(db, user["id"])}


@router.delete("/location")
def delete_location(user: dict = Depends(writable_user), db=Depends(get_db)):
    with transaction(db):
        db.execute("DELETE FROM shop_location WHERE user_id = ?", (user["id"],))
    return {"location": None}
