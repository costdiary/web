"""보안 장치: 요청 횟수 제한(로그인한 계정의 대량 수집 포함), 자동 차단, 접속 기록, 크롤러 거르기.

모두 서버 한 대·메모리 기준입니다. 서버를 여러 대로 늘리면 Redis 같은 공용 저장소로 옮겨야 합니다.
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict, deque
from contextlib import closing

from fastapi import Request

from . import config
from .db import connect, now_iso

log = logging.getLogger("wongaenote.security")

# ---------------------------------------------------------------- 크롤러·자동 수집 도구
AI_CRAWLERS = (
    "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "anthropic-ai", "CCBot", "PerplexityBot",
    "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bytespider", "Amazonbot", "meta-externalagent",
    "FacebookBot", "cohere-ai", "Diffbot", "ImagesiftBot", "Omgilibot", "YouBot", "PetalBot", "AhrefsBot", "SemrushBot",
    "MJ12bot", "DotBot", "DataForSeoBot",
)
# 브라우저가 아닌 일반 수집 도구(브라우저는 이런 이름을 쓰지 않습니다)
SCRAPER_TOKENS = ("python-requests", "python-urllib", "aiohttp", "scrapy", "go-http-client", "curl/", "wget/",
                   "libwww-perl", "java/", "apache-httpclient", "node-fetch", "axios/", "headlesschrome", "phantomjs")


def blocked_agent(ua: str) -> bool:
    if config.env_str("API_BLOCK_UA", "1") == "0":
        return False
    u = (ua or "").strip().lower()
    if not u:
        return True
    return any(t.lower() in u for t in AI_CRAWLERS) or any(t in u for t in SCRAPER_TOKENS)


def robots_txt() -> str:
    lines = []
    for bot in AI_CRAWLERS:
        lines += [f"User-agent: {bot}", "Disallow: /", ""]
    lines += ["User-agent: *", "Disallow: /api/", "Disallow: /static/js/", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- 요청 횟수 제한
_win: dict[str, deque] = defaultdict(deque)
_blocked: dict[str, float] = {}
_violations: dict[str, deque] = defaultdict(deque)
_audit_seen: dict[str, float] = {}
MAX_KEYS = 50_000


def reset() -> None:
    _win.clear()
    _blocked.clear()
    _violations.clear()
    _audit_seen.clear()


def _prune() -> None:
    if len(_win) <= MAX_KEYS:
        return
    cut = time.time() - 3600
    for k in [k for k, q in _win.items() if not q or q[-1] < cut]:
        _win.pop(k, None)
    if len(_win) > MAX_KEYS:  # 그래도 많으면 가장 오래된 절반을 버립니다
        for k in list(_win)[: len(_win) // 2]:
            _win.pop(k, None)


def hit(key: str, limit: int, window: float) -> float:
    """한도 안이면 기록하고 0, 넘었으면 다시 시도할 수 있을 때까지 남은 초를 돌려줍니다."""
    now = time.time()
    q = _win[key]
    while q and now - q[0] >= window:
        q.popleft()
    if len(q) >= limit:
        return max(1.0, window - (now - q[0]))
    q.append(now)
    _prune()
    return 0.0


def client_ip(request: Request) -> str:
    if config.env_bool("TRUST_PROXY"):
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def identity(request: Request) -> tuple[str, bool]:
    """(제한 기준 이름, 로그인 여부). 로그인한 요청(사장님 sid, 도매업체 wsid)은 토큰 기준으로 셉니다."""
    sid = request.cookies.get("sid")
    if sid:
        return "s:" + hashlib.sha256(sid.encode()).hexdigest()[:20], True
    wsid = request.cookies.get("wsid")
    if wsid:
        return "w:" + hashlib.sha256(wsid.encode()).hexdigest()[:20], True
    return "ip:" + client_ip(request), False


def check_api(request: Request) -> tuple[int, str, float] | None:
    """/api/ 요청 검사. 막아야 하면 (상태코드, 메시지, 기다릴 초), 통과면 None."""
    ua = request.headers.get("user-agent", "")
    ip = client_ip(request)
    if blocked_agent(ua):
        audit("blocked_agent", ip=ip, detail=ua[:120], once=f"ua:{ip}")
        return 403, "허용되지 않는 접속 방식입니다.", 0
    ident, authed = identity(request)
    now = time.time()
    for k in (ident, "ip:" + ip):
        until = _blocked.get(k, 0)
        if until > now:
            return 429, "요청이 너무 많아 잠시 멈췄습니다. 잠시 뒤에 다시 시도해 주세요.", until - now
    per_min = config.env_int("API_RATE_PER_MIN", 120) if authed else config.env_int("API_RATE_PER_MIN_ANON", 40)
    wait = hit(f"min:{ident}", per_min, 60)
    if not wait and authed:
        wait = hit(f"day:{ident}", config.env_int("API_RATE_PER_DAY", 15000), 86400)
    if not wait:
        return None
    # 한도를 자꾸 넘으면 잠시 막습니다(대량 수집 프로그램을 돌리는 계정·주소 대응)
    v = _violations[ident]
    while v and now - v[0] > 3600:
        v.popleft()
    v.append(now)
    audit("rate_limited", ip=ip, detail=ident, once=f"rl:{ident}")
    if len(v) >= config.env_int("AUTO_BLOCK_AFTER", 5):
        mins = config.env_int("AUTO_BLOCK_MINUTES", 15)
        _blocked[ident] = now + mins * 60
        v.clear()
        audit("auto_block", ip=ip, detail=f"{ident} {mins}분")
        return 429, f"요청이 너무 많아 {mins}분 동안 막았습니다.", mins * 60
    return 429, "요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.", wait


# ---------------------------------------------------------------- 접속 기록
def audit(event: str, *, user_id: int | None = None, ip: str = "", detail: str = "", once: str | None = None) -> None:
    """보안 사건 기록. once 를 주면 같은 키는 1분에 한 번만 남깁니다(기록이 넘치는 것을 막기 위해)."""
    if once:
        now = time.time()
        if now - _audit_seen.get(once, 0) < 60:
            return
        _audit_seen[once] = now
        if len(_audit_seen) > MAX_KEYS:
            _audit_seen.clear()
    try:
        with closing(connect()) as db:
            db.execute("INSERT INTO audit_log(at, user_id, ip, event, detail) VALUES (?,?,?,?,?)",
                       (now_iso(), user_id, ip[:64], event, detail[:300]))
    except Exception:  # 기록 실패가 서비스를 멈추면 안 됩니다
        log.exception("audit write failed")


def purge_audit(days: int | None = None) -> None:
    days = days or config.env_int("AUDIT_KEEP_DAYS", 180)
    try:
        with closing(connect()) as db:
            db.execute("DELETE FROM audit_log WHERE at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)", (f"-{int(days)} days",))
    except Exception:
        log.exception("audit purge failed")
