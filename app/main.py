"""원가노트 서버 진입점. 실행: `python run.py` 또는 `uvicorn app.main:app`."""
from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, config, market, security, routes_account, routes_channels, routes_data, routes_import, routes_breakeven, routes_recipe, routes_sales, routes_area, routes_labor, routes_market, routes_payments, routes_ws, routes_preps, routes_orders, routes_donations, routes_identity, routes_admin, routes_notifications, visits
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

# 토스 결제위젯(donate.js, TOSS_SECRET_KEY가 있을 때만 로딩됨)이 쓰는 도메인을 열어 둔다.
# 직접 켜 보고 확인한 사실: 이게 없으면 js.tosspayments.com 스크립트 자체가 CSP에 막혀
# 조용히 로딩 실패한다(화면엔 에러가 안 뜨고, onerror 콜백만 조용히 호출됨).
# 와일드카드(*.tosspayments.com)로 넉넉히 열어 둔 것이라 — 토스 쪽에서 쓰는 정확한 서브도메인
# 목록을 공식 문서로 확인하지는 못했다. 실제 키로 결제창을 띄워 보고, 브라우저 콘솔에 또 다른
# CSP 차단 메시지가 남으면 거기 나오는 도메인만 더 좁혀서 추가해도 된다.
TOSS_CSP = "https://*.tosspayments.com"
# 포트원 본인인증 SDK(cdn.portone.io)와 그 SDK가 띄우는 인증 창(포트원·다날 등 본인인증사). 토스와 같은
# 이유로 넉넉히 열어 둔 것이라, 실제 키로 인증 창을 띄웠을 때 콘솔에 CSP 차단이 남으면 그 도메인을 더한다.
PORTONE_CSP = "https://*.portone.io https://*.iamport.co https://*.danalpay.com https://*.danal.co.kr"
PAY_CSP = f"{TOSS_CSP} {PORTONE_CSP}"
# 구글 애널리틱스(GA4). 사장님이 쿠키 동의 창에서 "통계"를 허용했을 때만 화면이 이 스크립트를 불러온다(analytics.js).
GA_SCRIPT_CSP = "https://www.googletagmanager.com"
GA_CONNECT_CSP = "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com"
CSP = (
    f"default-src 'self'; img-src 'self' data: blob: {PAY_CSP} {GA_CONNECT_CSP}; style-src 'self' 'unsafe-inline' {PAY_CSP}; "
    f"script-src 'self' {PAY_CSP} {GA_SCRIPT_CSP}; font-src 'self' {PAY_CSP}; connect-src 'self' {PAY_CSP} {GA_CONNECT_CSP}; "
    f"frame-src {PAY_CSP}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
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
    # 도커 헬스체크는 Host: 127.0.0.1 로 호출하므로, ALLOWED_HOSTS 가 설정되어 있어도
    # 루프백 주소는 항상 통과시킵니다(TrustedHostMiddleware 의 400 방지).
    hc_hosts = ["127.0.0.1", "localhost", "::1"]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts + [h for h in hc_hosts if h not in hosts])


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
app.include_router(routes_donations.router)
app.include_router(routes_identity.router)
app.include_router(routes_admin.router)
app.include_router(routes_notifications.router)


@app.exception_handler(Exception)
async def on_error(request: Request, exc: Exception):
    # 오류 내용(경로·코드·값)이 화면에 새지 않게 하고, 자세한 내용은 서버 기록에만 남깁니다.
    logging.getLogger("wongaenote").exception("처리하지 못한 오류 %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "서버에 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요."}, status_code=500)


@app.get("/robots.txt", include_in_schema=False)
def robots():
    return PlainTextResponse(security.robots_txt())


# ---------------------------------------------------------------- 검색엔진·AI 검색용 공개 문서
GUIDE_DIR = STATIC_DIR / "guide"
GUIDES = ("menu-cost-rate",)  # static/guide/<이름>.html. 새 안내 글을 넣으면 여기에도 더한다(사이트맵에 실림).


@app.get("/llms.txt", include_in_schema=False)
def llms_txt():
    # AI가 원가다이어리를 한눈에 이해하도록 정리한 소개 글(llmstxt.org 형식)
    return FileResponse(STATIC_DIR / "llms.txt", media_type="text/plain; charset=utf-8", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap():
    base = security.site_url()
    urls = [f"{base}/"] + [f"{base}/guide/{g}" for g in GUIDES]
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>'
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/guide/{slug}", include_in_schema=False)
def guide(slug: str, request: Request):
    if slug not in GUIDES:
        return PlainTextResponse("찾는 글이 없습니다.", status_code=404)
    visits.record(request)
    return FileResponse(GUIDE_DIR / f"{slug}.html", headers={"Cache-Control": "public, max-age=600"})


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
    visits.record(request)  # 운영자용 방문자 수(쿠키 없음, 실패해도 화면은 그대로)
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


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
