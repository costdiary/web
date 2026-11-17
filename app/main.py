"""원가노트 서버 진입점. 실행: `python run.py` 또는 `uvicorn app.main:app`."""
from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, market, security, routes_account, routes_channels, routes_data, routes_import, routes_breakeven, routes_recipe, routes_sales, routes_area, routes_labor, routes_market, routes_payments, routes_ws, routes_preps, routes_orders
from .config import ROOT, load_env_file
from .db import connect, init_db, transaction

load_env_file()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC_DIR = ROOT / "static"

# 윈도우는 파일 형식 표를 레지스트리에서 읽습니다. 다른 프로그램이 .js 를 text/plain 으로 바꿔 두었으면
# 브라우저가 자바스크립트 모듈을 거부해 화면이 비어 보이므로, 화면에 쓰는 형식은 직접 지정해 둡니다.
for _ext, _mime in {
    ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
}.items():
    mimetypes.add_type(_mime, _ext)

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'none'"
)

FIELD_LABELS = {
    "email": "이메일", "password": "비밀번호", "name": "이름", "price": "판매가", "pack_size": "규격 수량",
    "pack_unit": "규격 단위", "pack_price": "가격", "qty": "수량", "unit": "단위", "contact": "연락처",
    "yield_pct": "수율", "target_cost_ratio": "목표 원가율", "alert_pct": "알림 기준", "other_cost": "기타 원가",
    "delivery_price": "배달앱 판매가", "fee_pct": "중개이용료율", "pay_pct": "결제수수료율", "delivery_fee": "배달비",
    "coupon_cost": "쿠폰 부담액", "pack_cost": "포장비", "qty_low": "최소 양", "qty_high": "최대 양",
    "supplier": "거래처", "category": "분류",
    "hourly_wage": "시급", "weekly_hours": "주 근무시간", "work_days": "주 근무일",
    "threshold_pct": "알림 기준", "origin": "원산지", "grade": "등급", "region_code": "권역",
    "biz_no": "사업자등록번호", "biz_name": "상호", "ceo_name": "대표자명", "open_date": "개업일자",
    "contact_name": "담당자 이름", "phone": "연락처", "intro": "소개",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    security.purge_audit()
    # shortcut: 시작할 때마다 전체 신호를 다시 계산한다(90일 지난 가격 걸러내기 포함). 사용자가 많아지면 일일 배치로 옮길 것.
    try:
        with closing(connect()) as db, transaction(db):
            market.recompute_all(db)
    except Exception:
        logging.getLogger(__name__).exception("signal recompute failed")
    yield


app = FastAPI(
    title="원가노트",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if config.env_bool("ENABLE_DOCS") else None,
    redoc_url=None,
    openapi_url="/openapi.json" if config.env_bool("ENABLE_DOCS") else None,
)


hosts = [h.strip() for h in config.env_str("ALLOWED_HOSTS").split(",") if h.strip()]
if hosts:  # 운영 주소가 아닌 이름(Host 헤더)으로 들어오는 요청을 거부합니다
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        verdict = security.check_api(request)
        if verdict:
            status, msg, wait = verdict
            res = JSONResponse({"detail": msg}, status_code=status)
            if wait:
                res.headers["Retry-After"] = str(int(wait) + 1)
            res.headers["Cache-Control"] = "no-store"
            return res
    # 다른 사이트에서 몰래 보내는 요청(CSRF)을 막기 위해, 쓰기 요청은 직접 만든 헤더가 있어야 합니다.
    # PG 웹훅은 브라우저가 아니라 PG사 서버가 직접 호출하므로 이 헤더를 보내지 않습니다 — 대신
    # payments.parse_webhook() 의 서명 검증으로 보호합니다.
    if request.method not in ("GET", "HEAD", "OPTIONS") and path.startswith("/api/") and not path.startswith("/api/payments/"):
        if request.headers.get("x-requested-with") != "fetch":
            return JSONResponse({"detail": "잘못된 요청입니다."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    if config.env_bool("COOKIE_SECURE"):  # HTTPS 로 운영할 때만(로컬 http 에서는 켜면 안 됩니다)
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive, noai, noimageai"
    elif path == "/" or path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.exception_handler(RequestValidationError)
async def on_validation_error(request: Request, exc: RequestValidationError):
    msg = "입력값을 확인해 주세요."
    errs = exc.errors()
    if errs:
        loc = [str(x) for x in errs[0].get("loc", []) if x not in ("body", "query", "path")]
        key = loc[-1] if loc else ""
        label = FIELD_LABELS.get(key)
        if label:
            msg = f"입력값을 확인해 주세요. ({label})"
    return JSONResponse({"detail": msg}, status_code=422)


app.include_router(routes_account.router)
app.include_router(routes_data.router)
app.include_router(routes_channels.router)
app.include_router(routes_recipe.router)
app.include_router(routes_import.router)
app.include_router(routes_breakeven.router)
app.include_router(routes_sales.router)
app.include_router(routes_area.router)
app.include_router(routes_labor.router)
app.include_router(routes_market.router)
app.include_router(routes_ws.router)
app.include_router(routes_payments.router)
app.include_router(routes_preps.router)
app.include_router(routes_orders.router)


@app.exception_handler(Exception)
async def on_error(request: Request, exc: Exception):
    # 오류 내용(경로·코드·값)이 화면에 새지 않게 하고, 자세한 내용은 서버 기록에만 남깁니다.
    logging.getLogger("wongaenote").exception("처리하지 못한 오류 %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "서버에 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요."}, status_code=500)


@app.get("/robots.txt", include_in_schema=False)
def robots():
    return PlainTextResponse(security.robots_txt())


@app.get("/healthz")
def healthz():
    return {"ok": True, "version": __version__}


def _is_market_host(request: Request) -> bool:
    """도매마켓 전용 도메인(MARKET_HOSTS, 쉼표 구분)으로 들어온 요청인지. 비어 있으면 항상 False.

    같은 서버 하나가 두 서비스를 내려줍니다: 원가노트(식당 사장님)와 도매마켓(판매자).
    전용 도메인을 연결하면 그 주소의 첫 화면('/')이 곧 도매마켓이 되고, 도메인이 없어도 '/partner' 로 언제나 열립니다.
    (ALLOWED_HOSTS 를 쓰고 있다면 도매마켓 도메인도 거기에 함께 넣어야 합니다.)"""
    hosts = {h.strip().lower() for h in config.env_str("MARKET_HOSTS").split(",") if h.strip()}
    if not hosts:
        return False
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip().lower()
    return host in hosts


@app.get("/", include_in_schema=False)
def index(request: Request):
    if _is_market_host(request):
        return FileResponse(STATIC_DIR / "partner.html", headers={"Cache-Control": "no-cache"})
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/partner", include_in_schema=False)
def partner_index():
    return FileResponse(STATIC_DIR / "partner.html", headers={"Cache-Control": "no-cache"})


@app.get("/market.webmanifest", include_in_schema=False)
def market_manifest(request: Request):
    """도매마켓 전용 PWA 매니페스트. 전용 도메인이면 '/', 아니면 '/partner' 에서 시작합니다."""
    start = "/" if _is_market_host(request) else "/partner"
    return JSONResponse(
        {
            "id": "domae-market",
            "name": "도매마켓 — 식자재 판매자 센터",
            "short_name": "도매마켓",
            "description": "식당의 익명 구매 수요를 보고 블라인드로 단가를 제안하는 식자재 도매업체 전용 서비스",
            "lang": "ko",
            "start_url": start,
            "scope": start,
            "display": "standalone",
            "background_color": "#F4F1E8",
            "theme_color": "#0E5A43",
            "icons": [
                {"src": "/static/icon-market-192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "/static/icon-market-512.png", "sizes": "512x512", "type": "image/png"},
                {"src": "/static/icon-market-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            ],
            "shortcuts": [
                {"name": "수요 보기", "url": f"{start}#/demands"},
                {"name": "연결 요청", "url": f"{start}#/connections"},
            ],
        },
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/sw-market.js", include_in_schema=False)
def market_service_worker():
    # 도매마켓 전용 서비스워커. 원가노트의 /sw.js 와 따로 두고, 화면 쪽에서 범위를 '/partner'(전용 도메인이면 '/')로 등록합니다.
    return FileResponse(STATIC_DIR / "sw-market.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    # 앱 전체(해시 라우팅 포함)를 관리할 수 있도록 루트 경로에서 서비스워커를 내려줍니다.
    # /static/sw.js 로 두면 범위가 /static/ 으로 좁아져 앱 화면을 캐시하지 못합니다.
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
