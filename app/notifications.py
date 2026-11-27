"""알림 센터: 사장님에게 보여 줄 알림을 한곳에 모아 저장하고, 읽음을 관리합니다.

알림이 생기는 길은 두 가지입니다.

1. 상태를 보고 만드는 알림(collect_*): 단가 상승, 배달 적자, 단가 확인 시기, 어제 매출 미입력, 주간 요약,
   사진 인식 한도처럼 "지금 데이터"만 보면 알 수 있는 것. sync()가 목록을 열 때와
   배지 숫자를 셀 때(사용자당 1분에 한 번) 돌면서 dedupe_key로 한 번만 넣습니다. 이미 넣은 알림은
   읽었든 안 읽었든 다시 만들지 않습니다.
2. 일이 생긴 순간 밀어 넣는 알림(push): 다른 쪽에서 일어난 사건. KINDS에 종류를 더하고 push()를 부릅니다.

도매마켓 소식(더 싼 제안·떨이·연결 요청 답변)은 여기 넣지 않습니다. 도매마켓은 원가다이어리와 다른
서비스라서, 사장님도 도매마켓 화면(/partner)의 '사장님' 메뉴에서 봅니다.

종류마다 분류(cat)가 있고, 사장님은 설정에서 분류별로 알림을 끌 수 있습니다(notification_prefs).
꺼 둔 분류의 알림은 새로 만들지 않고, 이미 있는 것도 목록·배지에서 뺍니다.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import channels, config, costing, services
from .db import now_iso, parse_iso

KST = timezone(timedelta(hours=9))
KEEP_DAYS = 90  # 이보다 오래된 알림은 정리합니다.
SYNC_EVERY = 60.0  # 배지 숫자를 셀 때 상태 알림을 다시 만드는 최소 간격(초)
STALE_DAYS = 45


@dataclass(frozen=True)
class Kind:
    cat: str  # 분류: cost(원가·단가) / sales(매출·배달) / system(서비스 안내)
    icon: str  # static/js/core.js의 아이콘 이름
    tone: str = ""  # 화면 강조색: up(나쁜 소식) / down(좋은 소식) / ""(보통)


CATEGORIES = {
    "cost": ("원가·단가", "식자재 단가가 오르거나 내렸을 때, 단가를 확인할 때가 됐을 때, 주간 요약"),
    "sales": ("매출·배달", "배달로 팔면 적자인 메뉴, 어제 매출을 아직 안 넣었을 때"),
    "system": ("서비스 안내", "사진 인식 한도, 원가다이어리 공지"),
}

KINDS: dict[str, Kind] = {
    # 원가·단가
    "price_up": Kind("cost", "trend", "up"),
    "price_down": Kind("cost", "trend", "down"),
    "stale_prices": Kind("cost", "receipt"),
    "weekly_report": Kind("cost", "list"),
    # 매출·배달
    "delivery_loss": Kind("sales", "receipt", "up"),
    "sales_missing": Kind("sales", "trend"),
    # 서비스 안내
    "ocr_quota": Kind("system", "camera"),
    "notice": Kind("system", "bell"),
}

_last_sync: dict[int, float] = {}


def reset_sync_cache() -> None:
    _last_sync.clear()


def touch(uid: int) -> None:
    """단가·매출이 바뀐 직후 다음 배지 조회에서 바로 알림을 다시 만들게 한다."""
    _last_sync.pop(uid, None)


# ------------------------------------------------------------------ 설정(분류별 켜고 끄기)

def prefs(db, uid: int) -> dict[str, bool]:
    out = {c: True for c in CATEGORIES}
    for r in db.execute("SELECT category, enabled FROM notification_prefs WHERE user_id = ?", (uid,)):
        if r["category"] in out:
            out[r["category"]] = bool(r["enabled"])
    return out


def set_prefs(db, uid: int, values: dict[str, bool]) -> dict[str, bool]:
    for cat, on in values.items():
        if cat not in CATEGORIES:
            continue
        db.execute(
            "INSERT INTO notification_prefs(user_id, category, enabled) VALUES (?,?,?) "
            "ON CONFLICT(user_id, category) DO UPDATE SET enabled = excluded.enabled",
            (uid, cat, 1 if on else 0),
        )
    return prefs(db, uid)


def _off_cats(db, uid: int) -> list[str]:
    return [c for c, on in prefs(db, uid).items() if not on]


# ------------------------------------------------------------------ 넣기·읽기

def push(db, uid: int, kind: str, title: str, body: str = "", link: str = "", dedupe_key: str | None = None,
         data: dict | None = None, created_at: str | None = None) -> int | None:
    """알림 하나를 넣습니다. 같은 dedupe_key가 이미 있거나 그 분류를 꺼 두었으면 넣지 않고 None."""
    k = KINDS.get(kind)
    if k is None:
        raise ValueError(f"unknown notification kind: {kind}")
    if not prefs(db, uid)[k.cat]:
        return None
    cur = db.execute(
        "INSERT OR IGNORE INTO notifications(user_id, kind, category, title, body, link, dedupe_key, data, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (uid, kind, k.cat, title[:120], body[:300], link[:200], dedupe_key,
         json.dumps(data, ensure_ascii=False) if data else None, created_at or now_iso()),
    )
    return cur.lastrowid if cur.rowcount else None


def _where(db, uid: int) -> tuple[str, list]:
    off = _off_cats(db, uid)
    sql = "user_id = ?"
    args: list = [uid]
    if off:
        sql += f" AND category NOT IN ({','.join('?' * len(off))})"
        args += off
    return sql, args


def unread_count(db, uid: int) -> int:
    where, args = _where(db, uid)
    return db.execute(f"SELECT COUNT(*) AS c FROM notifications WHERE {where} AND read_at IS NULL", args).fetchone()["c"]  # nosec B608


def list_for(db, uid: int, category: str | None = None, limit: int = 60) -> list[dict]:
    where, args = _where(db, uid)
    if category in CATEGORIES:
        where += " AND category = ?"
        args.append(category)
    rows = db.execute(
        f"SELECT id, kind, category, title, body, link, data, created_at, read_at FROM notifications "  # nosec B608
        f"WHERE {where} ORDER BY created_at DESC, id DESC LIMIT ?",
        (*args, limit),
    ).fetchall()
    out = []
    for r in rows:
        k = KINDS.get(r["kind"], KINDS["notice"])
        out.append({
            "id": r["id"], "kind": r["kind"], "category": r["category"], "icon": k.icon, "tone": k.tone,
            "title": r["title"], "body": r["body"], "link": r["link"],
            "data": json.loads(r["data"]) if r["data"] else None,
            "created_at": r["created_at"], "read": r["read_at"] is not None,
        })
    return out


def mark_read(db, uid: int, ids: list[int] | None = None) -> None:
    ts = now_iso()
    if ids is None:
        db.execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (ts, uid))
        return
    ids = [int(i) for i in ids][:200]
    if ids:
        db.execute(
            f"UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN ({','.join('?' * len(ids))})",  # nosec B608
            (ts, uid, *ids),
        )


# ------------------------------------------------------------------ 상태를 보고 만드는 알림

def _kst_now() -> datetime:
    return datetime.now(KST)


def collect_prices(db, user: dict, pairs, n: list) -> None:
    uid = user["id"]
    changes = services.price_changes(db, uid)
    # 오른 것: 홈 화면과 같은 기준(설정의 알림 기준 %, 최근 30일)
    for a in costing.build_alerts(user, pairs, changes):
        hit = [i for i in a["impacts"] if i["delta_pp"] >= 0.1]
        if hit:
            top = hit[0]
            body = f"{top['name']} 원가율 {top['ratio_before']:.1f}% → {top['ratio_after']:.1f}%"
            if len(hit) > 1:
                body += f" 외 {len(hit) - 1}개 메뉴"
        elif a["impacts"]:
            body = f"쓰는 메뉴 {len(a['impacts'])}개, 원가율 변화는 크지 않아요"
        else:
            body = "아직 이 식자재를 쓰는 메뉴는 없어요"
        n.append(push(db, uid, "price_up", f"{a['name']} 단가가 {a['change_pct']:.1f}% 올랐어요", body,
                      link=f"#/menus/{hit[0]['menu_id']}" if hit else "#/ingredients",
                      dedupe_key=f"price_up:{a['ingredient_id']}:{a['changed_at']}",
                      data={"ingredient_id": a["ingredient_id"], "prev": a["prev_price"], "price": a["price"], "unit": a["unit"]},
                      created_at=a["changed_at"]))
    # 내린 것: 좋은 소식도 알려 주면 거래처를 바꿀지 판단하기 쉽다.
    threshold = user["alert_pct"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    for iid, ch in changes.items():
        at = parse_iso(ch["at"])
        if ch["pct"] is None or ch["pct"] > -threshold or at is None or at < cutoff:
            continue
        n.append(push(db, uid, "price_down", f"{ch['name']} 단가가 {abs(ch['pct']):.1f}% 내렸어요",
                      "이 식자재를 쓰는 메뉴의 원가율이 내려갔어요", link="#/ingredients",
                      dedupe_key=f"price_down:{iid}:{ch['at']}", created_at=ch["at"]))


def collect_stale(db, user: dict, n: list) -> None:
    uid = user["id"]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    c = db.execute(
        "SELECT COUNT(*) AS c FROM ingredients i WHERE i.user_id = ? AND i.price_checked_at < ? "
        "AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.ingredient_id = i.id)", (uid, cutoff)).fetchone()["c"]
    if c:
        month = _kst_now().strftime("%Y-%m")
        n.append(push(db, uid, "stale_prices", f"단가를 확인한 지 {STALE_DAYS}일 넘은 식자재가 {c}개 있어요",
                      "요즘 받는 가격과 같은지 한 번만 확인해 주세요. 원가율이 정확해집니다.", link="#/ingredients",
                      dedupe_key=f"stale:{month}"))


def collect_delivery(db, user: dict, pairs, n: list) -> None:
    uid = user["id"]
    month = _kst_now().strftime("%Y-%m")
    for mv, _ in pairs:
        for r in (mv.get("delivery") or {"channels": []})["channels"]:
            if r["profit"] is None or r["profit"] >= 0:
                continue
            fix = f" 배달 판매가를 {int(r['recommended_price']):,}원으로 올리면 목표 원가율에 맞아요." if r.get("recommended_price") else ""
            n.append(push(db, uid, "delivery_loss", f"{mv['name']}, {r['short']}에서 팔면 한 건에 {int(-r['profit']):,}원 손해예요",
                          f"수수료·배달비를 빼면 남는 돈이 없어요.{fix}", link=f"#/menus/{mv['id']}",
                          dedupe_key=f"delivery_loss:{mv['id']}:{r['short']}:{month}"))


def collect_sales(db, user: dict, n: list) -> None:
    """최근 2주 동안 매출을 3일 이상 넣어 온 사장님에게만, 어제 매출이 비어 있으면 알려 줍니다."""
    uid = user["id"]
    now = _kst_now()
    if now.hour < 9:  # 밤사이·새벽에는 아직 어제 정리를 안 했을 수 있다
        return
    today = now.date()
    yday = (today - timedelta(days=1)).isoformat()
    since = (today - timedelta(days=14)).isoformat()
    days = db.execute("SELECT COUNT(DISTINCT day) AS c FROM daily_sales WHERE user_id = ? AND day >= ? AND day < ?",
                      (uid, since, today.isoformat())).fetchone()["c"]
    if days < 3:
        return
    has = db.execute("SELECT 1 FROM daily_sales WHERE user_id = ? AND day = ?", (uid, yday)).fetchone()
    if not has:
        n.append(push(db, uid, "sales_missing", "어제 매출을 아직 안 넣으셨어요",
                      "쉬는 날이었다면 넘기셔도 돼요. 넣어 두면 이번 달 손익이 정확해집니다.", link="#/sales",
                      dedupe_key=f"sales_missing:{yday}"))


def collect_weekly(db, user: dict, pairs, n: list) -> None:
    """월요일(한국 시간)에 지난주 원가 요약을 한 번."""
    uid = user["id"]
    now = _kst_now()
    if now.weekday() != 0:
        return
    menus = [mv for mv, _ in pairs if mv["cost_ratio"] is not None]
    if not menus:
        return
    week = now.strftime("%G-W%V")
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rose = db.execute(
        "SELECT COUNT(DISTINCT ingredient_id) AS c FROM price_history WHERE user_id = ? AND created_at >= ? AND source != 'import'",
        (uid, since)).fetchone()["c"]
    avg = sum(m["cost_ratio"] for m in menus) / len(menus)
    over = sum(1 for m in menus if m["cost_ratio"] > user["target_cost_ratio"])
    body = f"메뉴 평균 원가율 {avg:.1f}%, 목표를 넘는 메뉴 {over}개. 지난 7일 동안 단가가 바뀐 식자재 {rose}개."
    n.append(push(db, uid, "weekly_report", "지난주 원가 요약이 나왔어요", body, link="#/", dedupe_key=f"weekly:{week}"))


def collect_ocr(db, user: dict, n: list) -> None:
    from . import auth  # auth가 이 모듈을 직접 쓰지는 않지만, 순환을 피하려고 여기서 가져온다

    if not config.public_config().get("ocr_enabled"):
        return
    uid = user["id"]
    limit = auth.ocr_limit(auth.plan_status(user)["state"])
    if not limit:
        return
    used = services.ocr_used(db, uid)
    month = services.kst_month()
    if used >= limit:
        n.append(push(db, uid, "ocr_quota", "이번 달 사진 자동 인식을 다 쓰셨어요",
                      f"{limit}회를 모두 썼어요. 다음 달 1일에 다시 채워지고, 그동안은 품목을 직접 입력할 수 있어요.",
                      link="#/invoice", dedupe_key=f"ocr_quota:{month}:full"))
    elif used >= limit - 1 and limit > 1:
        n.append(push(db, uid, "ocr_quota", f"이번 달 사진 자동 인식이 {limit - used}회 남았어요",
                      "다음 달 1일에 다시 채워집니다.", link="#/invoice", dedupe_key=f"ocr_quota:{month}:low"))



def sync(db, user: dict, force: bool = False) -> int:
    """상태 알림을 새로 만들고, 새로 만든 개수를 돌려줍니다."""
    uid = user["id"]
    now = time.monotonic()
    if not force and now - _last_sync.get(uid, -1e9) < SYNC_EVERY:
        return 0
    _last_sync[uid] = now
    on = prefs(db, uid)
    n: list = []
    chans = channels.load_enabled(db, uid)
    pairs = costing.load_menus(db, user, chans=chans) if (on["cost"] or on["sales"]) else []
    if on["cost"]:
        collect_prices(db, user, pairs, n)
        collect_stale(db, user, n)
        collect_weekly(db, user, pairs, n)
    if on["sales"]:
        collect_delivery(db, user, pairs, n)
        collect_sales(db, user, n)
    if on["system"]:
        collect_ocr(db, user, n)
    old = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute("DELETE FROM notifications WHERE user_id = ? AND created_at < ?", (uid, old))
    return sum(1 for x in n if x)
