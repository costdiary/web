"""방문자 수 세기(운영자용). 외부 분석 도구·쿠키 없이 서버가 직접 셉니다.

- 첫 화면('/')을 브라우저가 불러올 때마다 "조회 1"을 더합니다.
- 같은 날 같은 사람(IP + 브라우저 정보)은 "방문자 1명"으로 한 번만 셉니다. 그 판단에 쓰는 값은
  IP를 그대로 두지 않고, 그날만 쓰는 무작위 소금(salt)과 섞어 되돌릴 수 없는 해시로만 남깁니다.
  소금과 해시는 이틀 뒤 지우므로, 지난 날의 방문 기록으로 누가 왔는지 거꾸로 알아낼 수 없습니다.
- 남는 것은 날짜별 숫자(조회·방문자·로그인한 사장님 수)와 "어디서 왔는지"(검색·SNS 주소의 도메인,
  utm_source)뿐입니다.
- 검색엔진·AI 크롤러·수집 도구는 사람이 아니므로 세지 않습니다.

날짜는 한국 시간(KST) 기준입니다. 세다가 문제가 생겨도 화면은 그대로 열려야 하므로, 오류는 기록만 하고 넘깁니다.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from contextlib import closing
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import Request

from . import security
from .db import connect, transaction

log = logging.getLogger("wongaenote.visits")
KST = timezone(timedelta(hours=9))

# security.blocked_agent 가 막는 AI 크롤러·수집 도구에 더해, 검색엔진 봇처럼 화면은 열어도 사람이 아닌 것들
BOT_TOKENS = ("bot", "spider", "crawl", "slurp", "facebookexternalhit", "embedly", "preview", "lighthouse",
              "pingdom", "uptime", "monitor", "headless", "kakaotalk-scrap", "yeti", "daum")


def today_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def is_bot(ua: str) -> bool:
    u = (ua or "").strip().lower()
    if not u:
        return True
    if security.blocked_agent(ua):
        return True
    return any(t in u for t in BOT_TOKENS)


def _source(request: Request) -> str:
    """어디서 왔는지: utm_source 가 있으면 그것, 없으면 다른 사이트에서 넘어온 경우 그 도메인. 직접 들어오면 ''."""
    utm = (request.query_params.get("utm_source") or "").strip().lower()[:40]
    if utm:
        return utm
    ref = request.headers.get("referer") or ""
    if not ref:
        return ""
    try:
        host = (urlsplit(ref).hostname or "").lower()
    except ValueError:
        return ""
    own = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
    if not host or host == own:
        return ""
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]
    return host[:60]


def _salt(db, day: str) -> str:
    row = db.execute("SELECT salt FROM visit_salts WHERE day = ?", (day,)).fetchone()
    if row:
        return row["salt"]
    salt = secrets.token_hex(16)
    db.execute("INSERT OR IGNORE INTO visit_salts(day, salt) VALUES (?, ?)", (day, salt))
    # 다른 요청이 먼저 넣었을 수 있으니 저장된 값을 다시 읽는다
    return db.execute("SELECT salt FROM visit_salts WHERE day = ?", (day,)).fetchone()["salt"]


def record(request: Request) -> None:
    """첫 화면을 한 번 열었다고 기록한다. 실패해도 예외를 밖으로 내보내지 않는다."""
    try:
        ua = request.headers.get("user-agent") or ""
        if is_bot(ua):
            return
        # 브라우저가 미리 불러오기(prefetch)만 한 경우는 세지 않는다
        purpose = (request.headers.get("sec-purpose") or request.headers.get("purpose") or "").lower()
        if "prefetch" in purpose:
            return
        day = today_kst()
        member = 1 if request.cookies.get("sid") else 0
        src = _source(request)
        with closing(connect()) as db, transaction(db):
            salt = _salt(db, day)
            vhash = hashlib.sha256(f"{salt}|{security.client_ip(request)}|{ua}".encode()).hexdigest()[:32]
            db.execute("INSERT OR IGNORE INTO visit_daily(day) VALUES (?)", (day,))
            db.execute("UPDATE visit_daily SET views = views + 1 WHERE day = ?", (day,))
            seen = db.execute("SELECT member FROM visit_seen WHERE day = ? AND vhash = ?", (day, vhash)).fetchone()
            if not seen:
                db.execute("INSERT INTO visit_seen(day, vhash, member) VALUES (?, ?, ?)", (day, vhash, member))
                db.execute("UPDATE visit_daily SET visitors = visitors + 1, member_visitors = member_visitors + ? WHERE day = ?",
                           (member, day))
                db.execute("INSERT OR IGNORE INTO visit_sources(day, source) VALUES (?, ?)", (day, src))
                db.execute("UPDATE visit_sources SET visitors = visitors + 1 WHERE day = ? AND source = ?", (day, src))
            elif member and not seen["member"]:
                # 같은 날 처음엔 둘러보다가 나중에 로그인한 사람: 로그인한 사장님으로도 한 번 센다
                db.execute("UPDATE visit_seen SET member = 1 WHERE day = ? AND vhash = ?", (day, vhash))
                db.execute("UPDATE visit_daily SET member_visitors = member_visitors + 1 WHERE day = ?", (day,))
            # 이틀 지난 소금·해시는 지운다(숫자만 남김)
            cutoff = (datetime.now(KST) - timedelta(days=2)).strftime("%Y-%m-%d")
            db.execute("DELETE FROM visit_seen WHERE day < ?", (cutoff,))
            db.execute("DELETE FROM visit_salts WHERE day < ?", (cutoff,))
    except Exception:
        log.exception("방문 기록 실패")


# ---------------------------------------------------------------- 운영자 화면용 집계

def _days(n: int) -> list[str]:
    now = datetime.now(KST)
    return [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n - 1, -1, -1)]


def _kst_day(utc_iso: str) -> str:
    try:
        return datetime.strptime(utc_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(KST).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return (utc_iso or "")[:10]


def summary(db, days: int = 30) -> dict:
    days = max(7, min(days, 365))
    span = _days(days)
    start, today = span[0], span[-1]
    week_start = span[-7]

    # 가입자(사장님 계정). created_at 은 UTC 라 한국 날짜로 바꿔서 센다.
    users = db.execute("SELECT id, created_at FROM users").fetchall()
    social = {r["user_id"]: r["provider"] for r in db.execute("SELECT user_id, MIN(provider) AS provider FROM oauth_accounts GROUP BY user_id")}
    signup_by_day: dict[str, int] = {}
    method: dict[str, int] = {}
    for u in users:
        d = _kst_day(u["created_at"])
        signup_by_day[d] = signup_by_day.get(d, 0) + 1
        if d >= start:
            m = social.get(u["id"], "email")
            method[m] = method.get(m, 0) + 1

    def signups_between(a: str, b: str) -> int:
        return sum(v for d, v in signup_by_day.items() if a <= d <= b)

    visit_rows = {r["day"]: dict(r) for r in db.execute(
        "SELECT day, views, visitors, member_visitors FROM visit_daily WHERE day >= ?", (start,))}

    def visits_between(a: str, b: str, key: str) -> int:
        return sum(r[key] for d, r in visit_rows.items() if a <= d <= b)

    first = db.execute("SELECT MIN(day) FROM visit_daily").fetchone()[0]
    sources = [dict(r) for r in db.execute(
        "SELECT source, SUM(visitors) AS visitors FROM visit_sources WHERE day >= ? GROUP BY source ORDER BY visitors DESC LIMIT 12",
        (start,))]

    series = []
    for d in span:
        v = visit_rows.get(d, {})
        series.append({"day": d, "signups": signup_by_day.get(d, 0), "visitors": v.get("visitors", 0),
                       "views": v.get("views", 0), "member_visitors": v.get("member_visitors", 0)})

    return {
        "days": days,
        "today": today,
        "signups": {
            "total": len(users),
            "today": signup_by_day.get(today, 0),
            "week": signups_between(week_start, today),
            "period": signups_between(start, today),
            "by_method": method,
        },
        "visits": {
            "tracking_since": first,
            "today": visit_rows.get(today, {}).get("visitors", 0),
            "today_views": visit_rows.get(today, {}).get("views", 0),
            "week": visits_between(week_start, today, "visitors"),
            "period": visits_between(start, today, "visitors"),
            "period_views": visits_between(start, today, "views"),
            "period_members": visits_between(start, today, "member_visitors"),
        },
        "sources": sources,
        "series": series,
    }
