"""주변 상권 공공데이터.

- 소상공인시장진흥공단 상가(상권)정보 '반경내 상가업소 조회' (공공데이터포털, 키 필요: DATA_GO_KR_KEY)
  주소·파라미터는 공공데이터포털의 안내 페이지(data.go.kr/data/15012005)에서 확인한 값입니다.
- 서울 열린데이터광장 데이터(생활인구·상권 추정매출 등): SEOUL_API_KEY 와 SEOUL_SERVICES 를 직접 지정합니다.
  서비스 이름과 요청 인자는 데이터셋 페이지마다 달라서 코드에 고정하지 않았습니다.

실제 서버 응답은 이 개발 환경에서 확인하지 못했습니다(키 없음, 외부 접속 제한). 응답 모양이 다르면 오류로 알려 줍니다.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import httpx

from . import config

NAVER_GEOCODE_URL = "https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode"
SEMAS_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius"
SEOUL_URL = "http://openapi.seoul.go.kr:8088"
STORE_TTL = timedelta(days=7)   # 상가 자료는 분기마다 갱신됩니다.
SEOUL_TTL = timedelta(days=1)
MAX_PAGES = 5


class AreaError(Exception):
    pass


def semas_key() -> str:
    return unquote(config.env_str("DATA_GO_KR_KEY"))


def seoul_services() -> list[tuple[str, str]]:
    """SEOUL_SERVICES='서비스명, 서비스명:인자1/인자2' -> [(서비스명, '인자1/인자2')]"""
    out = []
    for part in config.env_str("SEOUL_SERVICES").split(","):
        part = part.strip()
        if part:
            name, _, args = part.partition(":")
            out.append((name.strip(), args.strip()))
    return out


def naver_keys() -> tuple[str, str]:
    return config.env_str("NAVER_MAP_KEY_ID"), config.env_str("NAVER_MAP_KEY")


def geocode(query: str, client: httpx.Client | None = None) -> list[dict]:
    """주소 -> 위도·경도 후보 (네이버 클라우드 Maps Geocoding). 응답의 x 는 경도, y 는 위도입니다."""
    kid, key = naver_keys()
    if not (kid and key):
        raise AreaError("NAVER_MAP_KEY_ID, NAVER_MAP_KEY 가 설정되어 있지 않습니다.")
    own = client is None
    client = client or httpx.Client(timeout=10)
    try:
        try:
            r = client.get(config.env_str("NAVER_GEOCODE_URL", NAVER_GEOCODE_URL), params={"query": query, "count": 5},
                           headers={"Accept": "application/json", "x-ncp-apigw-api-key-id": kid, "x-ncp-apigw-api-key": key})
        except httpx.HTTPError:
            raise AreaError("네이버 지도 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from None
        if r.status_code in (401, 403):
            raise AreaError("네이버 지도 인증에 실패했습니다. 키와 Geocoding 사용 설정을 확인해 주세요.")
        if r.status_code != 200:
            raise AreaError(f"네이버 지도 서버가 오류({r.status_code})를 돌려줬습니다.")
        try:
            data = r.json()
        except ValueError:
            raise AreaError("네이버 지도 응답을 읽지 못했습니다.") from None
    finally:
        if own:
            client.close()
    if not isinstance(data, dict) or data.get("status") not in ("OK", None):
        raise AreaError("네이버 지도 응답이 예상과 다릅니다.")
    out = []
    for a in data.get("addresses") or []:
        try:
            lat, lon = float(a["y"]), float(a["x"])
        except (KeyError, TypeError, ValueError):
            continue
        out.append({"road": str(a.get("roadAddress") or ""), "jibun": str(a.get("jibunAddress") or ""), "lat": lat, "lon": lon})
    return out


def sources_status() -> dict:
    return {
        "geocode": all(naver_keys()),
        "semas": bool(semas_key()),
        "seoul": bool(config.env_str("SEOUL_API_KEY")) and bool(seoul_services()),
        "seoul_services": [n for n, _ in seoul_services()] if config.env_str("SEOUL_API_KEY") else [],
    }


def distance_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _items(payload: dict) -> list[dict]:
    body = payload.get("body") if isinstance(payload, dict) else None
    if not isinstance(body, dict):
        raise AreaError("상가정보 응답 형식이 예상과 다릅니다.")
    items = body.get("items")
    if isinstance(items, dict):
        items = items.get("item")
    if items in (None, ""):
        return []
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise AreaError("상가정보 응답 형식이 예상과 다릅니다.")
    return items


def fetch_stores(lat: float, lon: float, radius_m: int, client: httpx.Client | None = None) -> list[dict]:
    key = semas_key()
    if not key:
        raise AreaError("DATA_GO_KR_KEY 가 설정되어 있지 않습니다.")
    own = client is None
    client = client or httpx.Client(timeout=15)
    out: list[dict] = []
    try:
        for page in range(1, MAX_PAGES + 1):
            try:
                r = client.get(SEMAS_URL, params={"serviceKey": key, "pageNo": page, "numOfRows": 1000, "radius": radius_m,
                                                  "cx": lon, "cy": lat, "type": "json"})
            except httpx.HTTPError:
                raise AreaError("상가정보 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from None
            if r.status_code != 200:
                raise AreaError(f"상가정보 서버가 오류({r.status_code})를 돌려줬습니다. 인증키와 활용신청 상태를 확인해 주세요.")
            try:
                data = r.json()
            except ValueError:
                raise AreaError("상가정보 응답을 읽지 못했습니다. 인증키가 올바른지 확인해 주세요.") from None
            header = data.get("header") if isinstance(data, dict) else None
            if isinstance(header, dict) and str(header.get("resultCode", "00")) not in ("00", "0", "INFO-000"):
                raise AreaError(f"상가정보 오류: {header.get('resultMsg', '알 수 없음')}")
            items = _items(data)
            out.extend(items)
            total = int((data.get("body") or {}).get("totalCount") or 0)
            if len(out) >= total or not items:
                break
    finally:
        if own:
            client.close()
    return out


def summarize_stores(items: list[dict], lat: float, lon: float) -> dict:
    """업소 목록 -> 업종별 개수와 가까운 음식점."""
    by_l: dict[str, int] = {}
    food_by_m: dict[str, int] = {}
    food: list[dict] = []
    for it in items:
        try:
            la, lo = float(it.get("lat")), float(it.get("lon"))
        except (TypeError, ValueError):
            continue
        lcls = str(it.get("indsLclsNm") or "기타")
        by_l[lcls] = by_l.get(lcls, 0) + 1
        if "음식" in lcls:
            mcls = str(it.get("indsMclsNm") or "기타")
            food_by_m[mcls] = food_by_m.get(mcls, 0) + 1
            name = str(it.get("bizesNm") or "")
            br = str(it.get("brchNm") or "")
            food.append({"name": f"{name} {br}".strip(), "mcls": mcls, "scls": str(it.get("indsSclsNm") or ""),
                         "addr": str(it.get("rdnmAdr") or it.get("lnoAdr") or ""), "dist": round(distance_m(lat, lon, la, lo))})
    food.sort(key=lambda f: f["dist"])
    rank = lambda d: [{"name": k, "count": v} for k, v in sorted(d.items(), key=lambda kv: -kv[1])]  # noqa: E731
    return {"total": sum(by_l.values()), "by_large": rank(by_l), "food_total": len(food), "food_by_mid": rank(food_by_m), "food_nearest": food[:30]}


def fetch_seoul(service: str, args: str, rows: int = 20, client: httpx.Client | None = None) -> dict:
    key = config.env_str("SEOUL_API_KEY")
    if not key:
        raise AreaError("SEOUL_API_KEY 가 설정되어 있지 않습니다.")
    path = f"{SEOUL_URL}/{key}/json/{service}/1/{rows}/" + (args.strip("/") + "/" if args else "")
    own = client is None
    client = client or httpx.Client(timeout=15)
    try:
        try:
            r = client.get(path)
        except httpx.HTTPError:
            raise AreaError(f"서울 열린데이터광장({service})에 연결하지 못했습니다.") from None
        try:
            data = r.json()
        except ValueError:
            raise AreaError(f"서울 열린데이터광장({service}) 응답을 읽지 못했습니다.") from None
    finally:
        if own:
            client.close()
    block = data.get(service) if isinstance(data, dict) else None
    if not isinstance(block, dict):
        msg = (data.get("RESULT") or {}).get("MESSAGE") if isinstance(data, dict) else None
        raise AreaError(f"서울 열린데이터광장({service}) 오류: {msg or '서비스 이름·인자를 확인해 주세요.'}")
    res = block.get("RESULT") or {}
    if res.get("CODE") not in (None, "INFO-000"):
        raise AreaError(f"서울 열린데이터광장({service}) 오류: {res.get('MESSAGE', res.get('CODE'))}")
    items = block.get("row") or []
    cols = list(items[0].keys()) if items else []
    return {"service": service, "total": block.get("list_total_count"), "columns": cols, "rows": items[:rows]}


# ----------------------------------------------------------------- 저장해 둔 결과(캐시)
def cache_get(db, key: str, ttl: timedelta):
    row = db.execute("SELECT fetched_at, payload FROM area_cache WHERE cache_key = ?", (key,)).fetchone()
    if not row:
        return None
    try:
        at = datetime.fromisoformat(row["fetched_at"])
        if datetime.now(timezone.utc) - at > ttl:
            return None
        return {"at": row["fetched_at"], "data": json.loads(row["payload"])}
    except ValueError:
        return None


def cache_put(db, key: str, data) -> str:
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.execute("INSERT INTO area_cache(cache_key, fetched_at, payload) VALUES (?,?,?) "
               "ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload",
               (key, at, json.dumps(data, ensure_ascii=False)))
    return at
