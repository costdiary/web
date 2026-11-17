"""도매 역경매 마켓의 핵심 로직: 평균단가·수요신호 갱신, 익명화 집계, 블라인드 제안 매칭, 신뢰 점수.

라우트는 얇게 유지하고(``routes_market.py``/``routes_ws.py``), 계산은 전부 여기에 둡니다.
DB 연결을 인자로 받는 순수 함수들이며, 이 모듈 스스로는 라우트를 갖지 않습니다.

법적 근거(개인정보 보호법 제17·22·58조의2, 작성자 기억 기준 — law.go.kr 조문 대조는 출시 전
전문가 검토 권장. 설계 문서 10.1절 참고): 익명·집계(k≥3, 권역·구간화) 상태로만 도매업체에
노출하고, 사장님이 명시적으로 안내를 확인하기 전에는 노출하지 않습니다.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from . import config, market_catalog, services
from .db import now_iso, transaction

log = logging.getLogger("wongaenote.market")

def K_MIN() -> int:
    return config.env_int("MK_MIN_BUYERS", 3)

SIGNAL_STALE_DAYS = 90
CONN_RESPOND_HOURS = 72
CONN_AUTO_FAIL_DAYS = 30
BID_PRICE_COOLDOWN_DAYS = 7
BID_MAX_UNIT_PRICE = 100_000  # 기준 단위(g/ml/ea)당 원. 가격 기반 검사는 아니고, 입력 오류를 거르는 정적 상한.
BID_DAILY_LIMIT = 50
DEAL_VERIFY_WINDOW_DAYS = 60
SIMILAR_NAME_RATIO = 0.85


# ======================================================================== 사장님 설정

def get_buyer_settings(db, uid: int) -> dict:
    row = db.execute("SELECT * FROM mk_buyer_settings WHERE user_id = ?", (uid,)).fetchone()
    if row:
        return dict(row)
    ts = now_iso()
    db.execute(
        "INSERT INTO mk_buyer_settings(user_id, updated_at) VALUES (?,?)",
        (uid, ts),
    )
    return dict(db.execute("SELECT * FROM mk_buyer_settings WHERE user_id = ?", (uid,)).fetchone())


def update_buyer_settings(db, uid: int, *, demand_optin=None, ad_optin=None, threshold_pct=None,
                           region_code=None, ack_notice=None) -> dict:
    cur = get_buyer_settings(db, uid)
    ts = now_iso()
    fields = {"updated_at": ts}
    was_optin = bool(cur["demand_optin"])
    if demand_optin is not None:
        fields["demand_optin"] = int(demand_optin)
        if was_optin and not demand_optin:
            fields["optout_at"] = ts
    if ad_optin is not None:
        fields["ad_optin"] = int(ad_optin)
    if threshold_pct is not None:
        fields["threshold_pct"] = threshold_pct
    if region_code is not None:
        fields["region_code"] = region_code
    if ack_notice:
        fields["notice_ack_at"] = ts
    sets = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE mk_buyer_settings SET {sets} WHERE user_id = ?", (*fields.values(), uid))  # nosec B608
    new = get_buyer_settings(db, uid)
    # opt-out/권역 변경/임계값 변경은 켜 둔 모든 식자재에 다시 반영해야 한다(권역을 나중에 정한
    # 경우에는 아직 신호가 없으므로, 기존 신호가 아니라 켜 둔 식자재 기준으로 돈다).
    recompute_all(db, uid)
    return new


def recompute_all(db, uid: int | None = None) -> None:
    """단가 제안받기를 켜 둔 식자재의 신호를 전부 다시 계산한다(uid를 주면 그 사장님 것만)."""
    for r in db.execute(
        "SELECT user_id, id FROM ingredients WHERE mk_item_id IS NOT NULL AND (? IS NULL OR user_id = ?)", (uid, uid)
    ).fetchall():
        recompute_signal(db, r["user_id"], r["id"])


# ======================================================================== 품목 매핑(자유 입력 -> 표준 품목)

def learn_alias(db, name: str, item_id: int) -> None:
    """매핑을 저장할 때마다 '이 이름 -> 이 표준 품목'을 기억해 둔다(개인정보 없음, 이름만).
    다른 사장님이 비슷한 이름으로 식자재를 등록했을 때 자동 추천(``suggest_for_name``)에 쓴다."""
    n = market_catalog.norm(name)
    if not n:
        return
    db.execute(
        "INSERT INTO mk_item_aliases(norm_alias, item_id) VALUES (?,?) "
        "ON CONFLICT(norm_alias) DO UPDATE SET item_id = excluded.item_id",
        (n, item_id),
    )


def catalog_items(db, unit_kind: str | None = None) -> list[dict]:
    if unit_kind:
        rows = db.execute("SELECT * FROM mk_items WHERE active = 1 AND unit_kind = ?", (unit_kind,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM mk_items WHERE active = 1").fetchall()
    return [dict(r) for r in rows]


def suggest_for_name(db, name: str, unit_kind: str, aliases: dict[str, int] | None = None) -> tuple[int, float] | None:
    """식자재 이름 -> 표준 품목 추천. 별칭(과거에 누군가 매핑해 둔 같은 이름) -> 이름 포함/유사도 순서.
    ``services.best_match``와 같은 규칙(부분 일치 0.85, 그 외 SequenceMatcher)이되 대상이 표준 품목인 버전."""
    n = market_catalog.norm(name)
    if not n:
        return None
    if aliases is None:
        aliases = {r["norm_alias"]: r["item_id"] for r in db.execute("SELECT * FROM mk_item_aliases")}
    if n in aliases:
        item = db.execute("SELECT * FROM mk_items WHERE id = ? AND active = 1", (aliases[n],)).fetchone()
        if item and item["unit_kind"] == unit_kind:
            return item["id"], 1.0
    best_id, best = None, 0.0
    for item in catalog_items(db, unit_kind):
        m = item["norm_name"]
        if not m:
            continue
        if m == n:
            return item["id"], 1.0
        if len(m) >= 2 and len(n) >= 2 and (m in n or n in m):
            score = 0.85
        else:
            score = SequenceMatcher(None, n, m).ratio()
        if score > best:
            best_id, best = item["id"], score
    if best_id is not None and best >= 0.6:
        return best_id, round(best, 2)
    return None


def search_catalog(db, q: str, unit_kind: str | None = None, limit: int = 200) -> list[dict]:
    """품목 검색: 원래 표기 LIKE뿐 아니라, 정규화한 이름/검색어로도 맞춰 본다(띄어쓰기·기호 차이, 사소한 오타 흡수).
    오타가 있어도 걸리도록, 정확히 안 맞으면 유사도로 한 번 더 추려서 섞어 보여준다."""
    items = catalog_items(db, unit_kind)
    nq = market_catalog.norm(q)
    if not nq:
        items.sort(key=lambda i: i["name"])
        return items[:limit]
    scored = []
    for item in items:
        nm = item["norm_name"]
        if nm == nq:
            score = 1.2  # 정확 일치를 맨 위로
        elif nm.startswith(nq) or nq in nm:
            score = 1.0
        elif nm in nq:
            score = 0.9
        else:
            score = SequenceMatcher(None, nq, nm).ratio()
        if score >= 0.45:
            scored.append((score, item))
    scored.sort(key=lambda t: (-t[0], t[1]["name"]))
    return [item for _, item in scored[:limit]]


def search_terms(db, uid: int, kind: str, q: str = "", category: str = "") -> list[str]:
    """GET /api/market/terms. 분류·등급·부위 자동완성 후보: 시드(``mk_terms``) + 사장님들이 실제로
    ``ingredients.<kind>``에 입력한 값. 개인정보 보호를 위해 다른 사장님의 자유 입력은 서로 다른
    2명 이상이 쓴 값만 넣는다(내 값은 항상). category는 정렬 가산점일 뿐 필터가 아니다."""
    if kind not in ("category", "grade", "cut"):
        return []
    esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = db.execute(
        f"""WITH ok AS (
              SELECT {kind} AS term FROM ingredients WHERE {kind} IS NOT NULL AND {kind} != ''
              GROUP BY {kind} HAVING COUNT(DISTINCT user_id) >= 2 OR SUM(user_id = :uid) > 0),
            used AS (
              SELECT {kind} AS term, category AS cat, COUNT(*) AS cnt FROM ingredients
              WHERE {kind} IN (SELECT term FROM ok) GROUP BY {kind}, category),
            cand AS (SELECT term, category AS cat FROM mk_terms WHERE kind = :kind
                     UNION SELECT term, cat FROM used)
            SELECT cand.term FROM cand LEFT JOIN used ON used.term = cand.term AND used.cat = cand.cat
            WHERE cand.term LIKE :like ESCAPE '\\'
            GROUP BY cand.term
            ORDER BY MAX(cand.cat = :category AND :category != '') DESC, SUM(COALESCE(used.cnt, 0)) DESC,
                     cand.term LIKE :prefix ESCAPE '\\' DESC,
                     COALESCE((SELECT MIN(rowid) FROM mk_terms t WHERE t.kind = :kind AND t.term = cand.term), 1000000), cand.term
            LIMIT 10""",  # nosec B608 — kind는 위에서 화이트리스트로 거른 열 이름
        {"uid": uid, "kind": kind, "like": f"%{esc}%", "prefix": f"{esc}%", "category": category},
    ).fetchall()
    return [r["term"] for r in rows]


def find_similar_catalog_item(db, name: str, unit_kind: str) -> dict | None:
    """신규 품목 요청 전에, 이미 카탈로그에 비슷한 게 있는지 확인(중복 등록 방지 안내용)."""
    got = suggest_for_name(db, name, unit_kind)
    if not got:
        return None
    item_id, score = got
    if score < 0.8:
        return None
    item = db.execute("SELECT * FROM mk_items WHERE id = ?", (item_id,)).fetchone()
    return dict(item) if item else None


def _is_brand_sensitive(name: str, category: str | None) -> bool:
    brand_norms = {market_catalog.norm(b) for b in market_catalog.BRAND_SENSITIVE_NAMES}
    if market_catalog.norm(name) in brand_norms:
        return True
    if category and market_catalog.norm(category) in brand_norms:
        return True
    return False


def resolve_key(db, name: str, category: str | None, unit_kind: str) -> int:
    """식자재 이름 -> 집계 키(``mk_items.id``). 표준 품목을 사람이 고르는 단계를 없애고, 사장님이
    식자재에 입력한 이름을 그대로 쓴다.

    순서: ① 정규화한 이름 + unit_kind 정확 일치 -> 그 품목. ② 기존 별칭(``mk_item_aliases``, 과거에
    누군가 이 이름을 매핑해 둔 적이 있으면) -> 그 품목. ③ 둘 다 없으면 승인 없이 즉시 새 품목을
    만들어 그 id를 돌려준다(source='auto'). "다진마늘"이 "마늘"로 잘못 묶이는 걸 막기 위해, 부분
    일치/유사도 기반 추측은 여기서 쓰지 않는다(정확 일치와 별칭만)."""
    n = market_catalog.norm(name)
    row = db.execute(
        "SELECT * FROM mk_items WHERE norm_name = ? AND unit_kind = ? AND active = 1", (n, unit_kind)
    ).fetchone()
    if row:
        return row["id"]
    alias = db.execute("SELECT item_id FROM mk_item_aliases WHERE norm_alias = ?", (n,)).fetchone()
    if alias:
        item = db.execute(
            "SELECT * FROM mk_items WHERE id = ? AND unit_kind = ? AND active = 1", (alias["item_id"], unit_kind)
        ).fetchone()
        if item:
            return item["id"]
    match_mode = "brand" if _is_brand_sensitive(name, category) else "commodity"
    cat = category or "가공"
    try:
        cur = db.execute(
            "INSERT INTO mk_items(name, norm_name, category, unit_kind, active, match_mode, source) "
            "VALUES (?,?,?,?,1,?, 'auto')",
            (name, n, cat, unit_kind, match_mode),
        )
        return cur.lastrowid
    except sqlite3.IntegrityError:
        # norm_name은 테이블 전체에서 유일해야 한다(다른 unit_kind로 이미 존재). 품목을 둘로
        # 쪼개는 대신(오매핑 위험) 기존 품목을 그대로 재사용한다.
        existing = db.execute("SELECT * FROM mk_items WHERE norm_name = ?", (n,)).fetchone()
        if existing:
            return existing["id"]
        raise


def try_auto_map(db, uid: int, ingredient_id: int) -> bool:
    """식자재 등록·수정·명세서 확정 직후 호출. 원산지가 있고 아직 표준 품목에 안 묶여 있으면
    (등급은 더 이상 필수가 아니다) ``resolve_key``로 즉시 매핑한다 — 애매해서 매핑이 안 되는
    상태는 더 이상 없다: 이름이 있으면 항상 매핑된다(새로 생성하든 기존에 붙든).
    이미 매핑돼 있는 식자재는 손대지 않는다 — 원산지·등급·품목을 바꾸는 건 여전히 '단가제안받기'
    매핑 화면(PUT /api/market/ingredients/{id})이나 일반 식자재 수정(PUT /api/ingredients/{id})이
    책임지며, 그 경로들이 바뀐 값을 이 함수가 쓰는 ingredients 테이블에 그대로 반영하므로
    식자재·도매마켓 정보는 항상 같은 값을 본다."""
    ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (ingredient_id, uid)).fetchone()
    if not ing or ing["mk_item_id"] or not ing["origin"]:
        return False
    item_id = resolve_key(db, ing["name"], ing["category"], ing["unit_kind"])
    db.execute(
        "UPDATE ingredients SET mk_item_id=?, updated_at=? WHERE id=? AND user_id=?",
        (item_id, now_iso(), ingredient_id, uid),
    )
    learn_alias(db, ing["name"], item_id)
    recompute_signal(db, uid, ingredient_id)
    return True


def bulk_map_ingredients(db, uid: int, ingredient_ids: list[int], origin: str | None) -> tuple[list[int], list[int]]:
    """여러 식자재를 한 번에 "단가제안받기 켜기"로 묶어 처리한다. 더는 표준 품목·등급을 공통으로
    지정하지 않는다 — 각 식자재는 자기 이름·단위로 각자 ``resolve_key``되므로 단위가 섞여 있어도
    문제없다. ``origin``을 주면 모든 식자재에 공통으로 적용하고, 비우면 각 식자재에 이미 적혀 있는
    origin을 그대로 쓴다(그마저 없으면 건너뛴다). (매핑된 ingredient_id 목록, 건너뛴 목록)을 돌려준다."""
    done, skipped = [], []
    ts = now_iso()
    for ing_id in ingredient_ids:
        ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (ing_id, uid)).fetchone()
        if not ing:
            skipped.append(ing_id)
            continue
        o = origin or ing["origin"]
        if not o:
            skipped.append(ing_id)
            continue
        item_id = resolve_key(db, ing["name"], ing["category"], ing["unit_kind"])
        db.execute(
            "UPDATE ingredients SET mk_item_id=?, origin=?, updated_at=? WHERE id=? AND user_id=?",
            (item_id, o, ts, ing_id, uid),
        )
        learn_alias(db, ing["name"], item_id)
        recompute_signal(db, uid, ing_id)
        done.append(ing_id)
    return done, skipped


# ======================================================================== 평균단가·신호

def normalize_vat(price: float, vat_type: str) -> float:
    if vat_type == "excl":
        return price * 1.1
    return price  # incl / exempt


def _owner_avg_incl_vat(db, uid: int, ing_id: int) -> dict | None:
    info = services.recent_price_info(db, uid, ing_id)
    if info is None:
        return None
    user = db.execute("SELECT vat_mode FROM users WHERE id = ?", (uid,)).fetchone()
    vat_mode = user["vat_mode"] if user else "incl"
    avg = info["avg"] * 1.1 if vat_mode == "excl" else info["avg"]
    return {"avg": avg, "n": info["n"], "last_at": info["last_at"]}


def recompute_signal(db, uid: int, ingredient_id: int):
    """명세서 확정·품목 매핑·설정 변경 뒤 호출. 신호가 더는 유효하지 않으면 비활성화하고 None을 돌려준다."""
    ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (ingredient_id, uid)).fetchone()
    st = get_buyer_settings(db, uid)
    cp = _owner_avg_incl_vat(db, uid, ingredient_id) if ing else None
    item = db.execute("SELECT * FROM mk_items WHERE id = ?", (ing["mk_item_id"],)).fetchone() if ing and ing["mk_item_id"] else None
    stale_cut = (datetime.now(timezone.utc) - timedelta(days=SIGNAL_STALE_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    eligible = bool(
        ing and ing["mk_item_id"] and ing["origin"]
        and item and item["match_mode"] != "brand"
        and st["demand_optin"] == 1 and st["notice_ack_at"] and st["region_code"]
        and cp is not None and cp["last_at"] >= stale_cut
    )
    if not eligible:
        existing = db.execute(
            "SELECT * FROM mk_demand_signals WHERE user_id = ? AND ingredient_id = ?", (uid, ingredient_id)
        ).fetchone()
        db.execute(
            "UPDATE mk_demand_signals SET active = 0, updated_at = ? WHERE user_id = ? AND ingredient_id = ?",
            (now_iso(), uid, ingredient_id),
        )
        db.execute(
            "UPDATE mk_matches SET status = 'stale' WHERE user_id = ? AND ingredient_id = ? AND status IN ('new','seen')",
            (uid, ingredient_id),
        )
        if existing:
            refresh_public_key(db, (existing["item_id"], existing["origin"], existing["grade"], existing["region_code"]), decrease_only=True)
        return None
    db.execute(
        "INSERT INTO mk_demand_signals(user_id, ingredient_id, item_id, origin, grade, region_code, "
        "avg_unit_price, invoice_count, monthly_base_qty, last_bought_at, active, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,1,?) "
        "ON CONFLICT(user_id, ingredient_id) DO UPDATE SET "
        "item_id=excluded.item_id, origin=excluded.origin, grade=excluded.grade, region_code=excluded.region_code, "
        "avg_unit_price=excluded.avg_unit_price, invoice_count=excluded.invoice_count, "
        "monthly_base_qty=excluded.monthly_base_qty, last_bought_at=excluded.last_bought_at, "
        "active=1, updated_at=excluded.updated_at",
        (uid, ingredient_id, ing["mk_item_id"], ing["origin"], ing["grade"] or "", st["region_code"],
         cp["avg"], cp["n"], None, cp["last_at"], now_iso()),
    )
    sig = db.execute(
        "SELECT * FROM mk_demand_signals WHERE user_id = ? AND ingredient_id = ?", (uid, ingredient_id)
    ).fetchone()
    refresh_public_key(db, (sig["item_id"], sig["origin"], sig["grade"], sig["region_code"]))
    match_signal(db, sig)
    return sig


def on_invoice_confirmed(db, uid: int, invoice_id: int, ingredient_ids: list[int]) -> int:
    """confirm_invoice 트랜잭션이 커밋된 뒤 호출. 실패해도 명세서 저장 자체는 이미 끝난 뒤라 영향 없다."""
    new_offers = 0
    try:
        for ing_id in set(ingredient_ids):
            try_auto_map(db, uid, ing_id)
            recompute_signal(db, uid, ing_id)
        new_offers = _count_new_offers_from_invoice(db, uid, invoice_id)
        verify_deals_by_invoice(db, uid, invoice_id)
    except Exception:
        log.exception("on_invoice_confirmed 실패 (uid=%s invoice=%s)", uid, invoice_id)
    return new_offers


def _count_new_offers_from_invoice(db, uid: int, invoice_id: int) -> int:
    rows = db.execute(
        "SELECT DISTINCT ingredient_id FROM invoice_lines WHERE invoice_id = ? AND user_id = ?",
        (invoice_id, uid),
    ).fetchall()
    if not rows:
        return 0
    ids = [r["ingredient_id"] for r in rows]
    marks = ",".join("?" * len(ids))
    return db.execute(
        f"SELECT COUNT(*) AS c FROM mk_matches WHERE user_id = ? AND status = 'new' AND ingredient_id IN ({marks})",  # nosec B608
        (uid, *ids),
    ).fetchone()["c"]


# ======================================================================== 익명화 집계

def refresh_public_key(db, key: tuple, decrease_only: bool = False) -> None:
    item_id, origin, grade, region_code = key
    rows = db.execute(
        "SELECT DISTINCT user_id, monthly_base_qty FROM mk_demand_signals "
        "WHERE item_id = ? AND origin = ? AND grade = ? AND region_code = ? AND active = 1",
        (item_id, origin, grade, region_code),
    ).fetchall()
    n = len({r["user_id"] for r in rows})
    ts = now_iso()
    if n < K_MIN():
        db.execute(
            "INSERT INTO mk_demand_public(item_id, origin, grade, region_code, visible, buyer_band, qty_low, qty_high, refreshed_at) "
            "VALUES (?,?,?,?,0,'',NULL,NULL,?) "
            "ON CONFLICT(item_id, origin, grade, region_code) DO UPDATE SET "
            "visible=0, buyer_band='', qty_low=NULL, qty_high=NULL, refreshed_at=excluded.refreshed_at",
            (item_id, origin, grade, region_code, ts),
        )
        return
    existing = db.execute(
        "SELECT * FROM mk_demand_public WHERE item_id=? AND origin=? AND grade=? AND region_code=?",
        (item_id, origin, grade, region_code),
    ).fetchone()
    if decrease_only and existing and existing["visible"] == 1:
        # 늘어나는 방향은 일괄 갱신(refresh_public_all)만 반영한다. 여기서는 숨김 전환만 즉시 적용되므로
        # (n >= K_MIN을 이미 통과했음) 그대로 둔다 — 실제 '줄어드는 방향 즉시 반영'은 opt-out으로 n이
        # K_MIN 밑으로 떨어질 때 위 분기에서 처리된다.
        return
    qtys = [r["monthly_base_qty"] for r in rows if r["monthly_base_qty"] is not None]
    total = sum(qtys) if len(qtys) >= K_MIN() else None
    lo, hi = market_catalog.qty_band(total)
    db.execute(
        "INSERT INTO mk_demand_public(item_id, origin, grade, region_code, visible, buyer_band, qty_low, qty_high, refreshed_at) "
        "VALUES (?,?,?,?,1,?,?,?,?) "
        "ON CONFLICT(item_id, origin, grade, region_code) DO UPDATE SET "
        "visible=1, buyer_band=excluded.buyer_band, qty_low=excluded.qty_low, qty_high=excluded.qty_high, refreshed_at=excluded.refreshed_at",
        (item_id, origin, grade, region_code, market_catalog.buyer_band(n), lo, hi, ts),
    )


def refresh_public_all(db) -> None:
    keys = set()
    for r in db.execute("SELECT DISTINCT item_id, origin, grade, region_code FROM mk_demand_signals WHERE active = 1"):
        keys.add((r["item_id"], r["origin"], r["grade"], r["region_code"]))
    for r in db.execute("SELECT DISTINCT item_id, origin, grade, region_code FROM mk_demand_public"):
        keys.add((r["item_id"], r["origin"], r["grade"], r["region_code"]))
    for key in keys:
        refresh_public_key(db, key)
    now = now_iso()
    db.execute("UPDATE mk_bids SET status = 'expired' WHERE status = 'active' AND valid_until < ?", (now,))
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=CONN_RESPOND_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute("UPDATE mk_connections SET status = 'expired' WHERE status = 'requested' AND requested_at < ?", (cutoff,))
    recompute_ws_stats(db)


def demand_stale(db) -> bool:
    row = db.execute("SELECT MAX(refreshed_at) AS at FROM mk_demand_public").fetchone()
    if not row or not row["at"]:
        return True
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return row["at"] < cutoff


def ensure_fresh_demand(db) -> None:
    """GET /api/ws/demands가 호출: 24시간 넘게 갱신 안 됐으면 지연 실행으로 한 번 돌린다."""
    if demand_stale(db):
        with transaction(db):
            refresh_public_all(db)


# ======================================================================== 제안 접수·매칭

def try_match(db, bid: dict, sig: dict) -> int:
    st = db.execute("SELECT * FROM mk_buyer_settings WHERE user_id = ?", (sig["user_id"],)).fetchone()
    threshold_pct = st["threshold_pct"] if st else 5.0
    trigger = sig["avg_unit_price"] * (1 - threshold_pct / 100.0)
    if not (bid["unit_price"] < trigger):
        db.execute(
            "UPDATE mk_matches SET status = 'stale' WHERE bid_id = ? AND user_id = ? AND ingredient_id = ? AND status IN ('new','seen')",
            (bid["id"], sig["user_id"], sig["ingredient_id"]),
        )
        return 0
    ws = db.execute("SELECT * FROM ws_accounts WHERE id = ?", (bid["ws_id"],)).fetchone()
    if not ws or ws["status"] != "verified":
        return 0
    if is_shadowed(db, bid["ws_id"]):
        return 0
    saving = (1 - bid["unit_price"] / sig["avg_unit_price"]) * 100.0
    existing = db.execute(
        "SELECT * FROM mk_matches WHERE bid_id = ? AND user_id = ? AND ingredient_id = ?",
        (bid["id"], sig["user_id"], sig["ingredient_id"]),
    ).fetchone()
    ts = now_iso()
    if existing:
        if existing["status"] in ("new", "seen", "stale"):
            new_status = "new" if existing["status"] == "stale" else existing["status"]
            db.execute(
                "UPDATE mk_matches SET base_avg_price=?, threshold_pct=?, bid_unit_price=?, saving_pct=?, status=? WHERE id = ?",
                (sig["avg_unit_price"], threshold_pct, bid["unit_price"], saving, new_status, existing["id"]),
            )
            return 1 if existing["status"] == "stale" else 0
        return 0  # dismissed/connected는 건드리지 않는다
    db.execute(
        "INSERT INTO mk_matches(bid_id, user_id, ingredient_id, base_avg_price, threshold_pct, bid_unit_price, saving_pct, status, created_at) "
        "VALUES (?,?,?,?,?,?,?, 'new', ?)",
        (bid["id"], sig["user_id"], sig["ingredient_id"], sig["avg_unit_price"], threshold_pct, bid["unit_price"], saving, ts),
    )
    return 1


def match_signal(db, sig: dict) -> int:
    n = 0
    now = now_iso()
    bids = db.execute(
        "SELECT * FROM mk_bids WHERE item_id = ? AND origin = ? AND grade = ? AND region_code = ? "
        "AND status = 'active' AND valid_until > ?",
        (sig["item_id"], sig["origin"], sig["grade"], sig["region_code"], now),
    ).fetchall()
    for bid in bids:
        n += try_match(db, dict(bid), sig)
    return n


def match_bid(db, bid_id: int) -> int:
    bid = db.execute("SELECT * FROM mk_bids WHERE id = ?", (bid_id,)).fetchone()
    if not bid or bid["status"] != "active":
        return 0
    bid = dict(bid)
    n = 0
    sigs = db.execute(
        "SELECT * FROM mk_demand_signals WHERE item_id = ? AND origin = ? AND grade = ? AND region_code = ? AND active = 1",
        (bid["item_id"], bid["origin"], bid["grade"], bid["region_code"]),
    ).fetchall()
    for sig in sigs:
        n += try_match(db, bid, dict(sig))
    return n


def recent_bid_key_blocked(db, ws_id: int, item_id: int, origin: str, grade: str, region_code: str) -> bool:
    """철회 후 같은 키 재등록 7일 대기(4.6절 — 블라인드를 깨는 가격 탐색 방지)."""
    row = db.execute(
        "SELECT updated_at FROM mk_bids WHERE ws_id=? AND item_id=? AND origin=? AND grade=? AND region_code=? AND status='withdrawn' "
        "ORDER BY updated_at DESC LIMIT 1",
        (ws_id, item_id, origin, grade, region_code),
    ).fetchone()
    if not row:
        return False
    cutoff = (datetime.now(timezone.utc) - timedelta(days=BID_PRICE_COOLDOWN_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return row["updated_at"] > cutoff


def bid_price_cooldown_blocked(db, bid: dict) -> bool:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=BID_PRICE_COOLDOWN_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return bid["price_changes"] > 0 and bid["updated_at"] > cutoff


def offers_for_user(db, uid: int, status: str = "new") -> list[dict]:
    """GET /api/market/offers. 식자재당 상위 3건, rank = saving_pct * (0.5 + ws_stats.score)."""
    where = "m.user_id = ? AND m.status IN ('new','seen')" if status == "new" else "m.user_id = ?"
    rows = db.execute(
        f"SELECT m.*, b.ws_id, b.pack_size, b.pack_unit, b.pack_price, b.vat_type, b.min_order_note, "  # nosec B608
        f"i.name AS ing_name, it.name AS item_name, b.origin, b.grade, i.unit_kind, s.region_code, "
        f"COALESCE(st.score, 0.5) AS score "
        f"FROM mk_matches m JOIN mk_bids b ON b.id = m.bid_id "
        f"JOIN ingredients i ON i.id = m.ingredient_id "
        f"JOIN mk_items it ON it.id = b.item_id "
        f"LEFT JOIN mk_demand_signals s ON s.user_id = m.user_id AND s.ingredient_id = m.ingredient_id "
        f"LEFT JOIN ws_stats st ON st.ws_id = b.ws_id "
        f"WHERE {where} ORDER BY m.ingredient_id, (m.saving_pct * (0.5 + COALESCE(st.score,0.5))) DESC",
        (uid,),
    ).fetchall()
    out, per_ing = [], {}
    for r in rows:
        iid = r["ingredient_id"]
        per_ing.setdefault(iid, 0)
        if per_ing[iid] >= 3:
            continue
        per_ing[iid] += 1
        out.append(dict(r))
    return out


# ======================================================================== 신뢰 점수·연결

def _biz_name_matches(a: str, b: str) -> bool:
    return SequenceMatcher(None, services.norm_name(a), services.norm_name(b)).ratio() >= SIMILAR_NAME_RATIO


def verify_deals_by_invoice(db, uid: int, invoice_id: int) -> None:
    inv = db.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if not inv:
        return
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DEAL_VERIFY_WINDOW_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conns = db.execute(
        "SELECT * FROM mk_connections WHERE user_id = ? AND status IN ('accepted','closed') AND requested_at > ?",
        (uid, cutoff),
    ).fetchall()
    if not conns:
        return
    line_items = {
        r["ingredient_id"]
        for r in db.execute("SELECT ingredient_id FROM invoice_lines WHERE invoice_id = ? AND user_id = ?", (invoice_id, uid))
    }
    if not line_items:
        return
    mapped_items = {
        r["id"]: r["mk_item_id"]
        for r in db.execute(
            f"SELECT id, mk_item_id FROM ingredients WHERE id IN ({','.join('?' * len(line_items))})",  # nosec B608
            tuple(line_items),
        )
    }
    for c in conns:
        ws = db.execute("SELECT biz_name FROM ws_accounts WHERE id = ?", (c["ws_id"],)).fetchone()
        if not ws or not _biz_name_matches(inv["supplier"], ws["biz_name"]):
            continue
        if c["item_id"] not in mapped_items.values():
            continue
        db.execute(
            "UPDATE mk_connections SET invoice_verified = 1, status = 'closed', closed_at = ? WHERE id = ?",
            (now_iso(), c["id"]),
        )


def deal_result(c: dict) -> str | None:
    if c["invoice_verified"]:
        return "done"
    if c["status"] == "expired":
        return "failed"
    if c["buyer_outcome"]:
        return c["buyer_outcome"]
    if c["status"] == "accepted":
        cutoff = (datetime.now(timezone.utc) - timedelta(days=CONN_AUTO_FAIL_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
        if c["requested_at"] < cutoff:
            return "failed"
    return None


def recompute_ws_stats(db) -> None:
    rows = db.execute("SELECT * FROM mk_connections").fetchall()
    by_ws: dict[int, list] = {}
    for r in rows:
        by_ws.setdefault(r["ws_id"], []).append(dict(r))
    ts = now_iso()
    for ws_id, conns in by_ws.items():
        done = sum(1 for c in conns if deal_result(c) == "done")
        failed = sum(1 for c in conns if deal_result(c) == "failed")
        answered = sum(1 for c in conns if c["status"] != "requested" or c.get("responded_at"))
        score = (done + 2) / (done + failed + 4)
        db.execute(
            "INSERT INTO ws_stats(ws_id, conn_total, conn_answered, deals_done, deals_failed, score, updated_at) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(ws_id) DO UPDATE SET "
            "conn_total=excluded.conn_total, conn_answered=excluded.conn_answered, deals_done=excluded.deals_done, "
            "deals_failed=excluded.deals_failed, score=excluded.score, updated_at=excluded.updated_at",
            (ws_id, len(conns), answered, done, failed, score, ts),
        )


def is_shadowed(db, ws_id: int) -> bool:
    s = db.execute("SELECT * FROM ws_stats WHERE ws_id = ?", (ws_id,)).fetchone()
    if not s:
        return False
    return (s["deals_done"] + s["deals_failed"]) >= 5 and s["score"] < 0.2


# ======================================================================== 떨이 광고

def approve_ad_payment(db, payment_id: int, by: str) -> dict:
    """입금(계좌이체) 확인 후 수동 승인 — CLI(``manage.py ad-approve``) 전용."""
    pay = db.execute("SELECT * FROM ws_ad_payments WHERE id = ?", (payment_id,)).fetchone()
    if not pay:
        raise ValueError("결제 신청을 찾지 못했습니다.")
    if pay["status"] == "paid":
        return {"ad_id": pay["ad_id"], "payment_id": payment_id, "already": True}
    with transaction(db):
        db.execute(
            "UPDATE ws_ad_payments SET status='paid', paid_at=?, confirmed_by=? WHERE id = ?",
            (now_iso(), by, payment_id),
        )
        _activate_ad_for_payment(db, pay["ad_id"])
    return {"ad_id": pay["ad_id"], "payment_id": payment_id}


def confirm_pg_payment(db, order_id: str, pg_tx_id: str, amount: int | None, by: str = "pg") -> dict:
    """PG(토스페이먼츠 등) 결제 승인/웹훅 확인 후 호출. 같은 order_id로 다시 불려도(웹훅 재전송 등)
    한 번만 적용되도록 이미 paid 인 결제는 조용히 그대로 돌려준다."""
    pay = db.execute("SELECT * FROM ws_ad_payments WHERE pg_order_id = ? AND method = 'pg'", (order_id,)).fetchone()
    if not pay:
        raise ValueError("결제 신청을 찾지 못했습니다.")
    if pay["status"] == "paid":
        return {"ad_id": pay["ad_id"], "payment_id": pay["id"], "already": True}
    if amount is not None and amount != pay["amount"]:
        raise ValueError(f"결제 금액이 일치하지 않습니다(신청 {pay['amount']}원 / 승인 {amount}원).")
    with transaction(db):
        db.execute(
            "UPDATE ws_ad_payments SET status='paid', paid_at=?, confirmed_by=?, pg_tx_id=? WHERE id = ?",
            (now_iso(), by, pg_tx_id, pay["id"]),
        )
        _activate_ad_for_payment(db, pay["ad_id"])
    return {"ad_id": pay["ad_id"], "payment_id": pay["id"]}


def fail_pg_payment(db, order_id: str, reason: str) -> dict:
    pay = db.execute("SELECT * FROM ws_ad_payments WHERE pg_order_id = ? AND method = 'pg'", (order_id,)).fetchone()
    if not pay:
        raise ValueError("결제 신청을 찾지 못했습니다.")
    if pay["status"] != "requested":
        return {"ad_id": pay["ad_id"], "payment_id": pay["id"], "already": True}
    db.execute("UPDATE ws_ad_payments SET status='failed', memo=? WHERE id = ?", (reason[:200], pay["id"]))
    return {"ad_id": pay["ad_id"], "payment_id": pay["id"]}


def _activate_ad_for_payment(db, ad_id: int) -> None:
    ad = db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone()
    ts = now_iso()
    starts = datetime.now(timezone.utc)
    ends = (starts + timedelta(days=ad["run_days"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute(
        "UPDATE ws_ads SET status='active', starts_at=?, ends_at=?, updated_at=? WHERE id = ?",
        (ts, ends, ts, ad["id"]),
    )
    _deliver_ad(db, ad["id"])


def _deliver_ad(db, ad_id: int) -> int:
    ad = db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone()
    regions = [r["region_code"] for r in db.execute("SELECT region_code FROM ws_ad_regions WHERE ad_id = ?", (ad_id,))]
    if not regions:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=180)).strftime("%Y-%m-%dT%H:%M:%SZ")
    marks = ",".join("?" * len(regions))
    targets = db.execute(
        f"SELECT DISTINCT il.user_id AS uid, MAX(il.created_at) AS last_at FROM invoice_lines il "  # nosec B608
        f"JOIN ingredients g ON g.id = il.ingredient_id "
        f"JOIN mk_buyer_settings s ON s.user_id = il.user_id "
        f"WHERE g.mk_item_id = ? AND s.ad_optin = 1 AND s.notice_ack_at IS NOT NULL AND s.region_code IN ({marks}) "
        f"GROUP BY il.user_id HAVING MAX(il.created_at) >= ?",
        (ad["item_id"], *regions, cutoff),
    )
    n = 0
    ts = now_iso()
    for r in targets:
        db.execute(
            "INSERT OR IGNORE INTO ws_ad_deliveries(ad_id, user_id, status, created_at) VALUES (?,?, 'new', ?)",
            (ad_id, r["uid"], ts),
        )
        n += 1
    return n


def deliver_active_ads_for_invoice(db, uid: int, invoice_id: int) -> None:
    """노출 중인 광고에, 이번 명세서로 새로 조건을 만족하게 된 사장님을 추가 배포한다."""
    st = db.execute("SELECT * FROM mk_buyer_settings WHERE user_id = ?", (uid,)).fetchone()
    if not st or not st["ad_optin"] or not st["notice_ack_at"] or not st["region_code"]:
        return
    ing_ids = [r["ingredient_id"] for r in db.execute(
        "SELECT ingredient_id FROM invoice_lines WHERE invoice_id = ? AND user_id = ?", (invoice_id, uid)
    )]
    if not ing_ids:
        return
    item_ids = {
        r["mk_item_id"] for r in db.execute(
            f"SELECT mk_item_id FROM ingredients WHERE id IN ({','.join('?' * len(ing_ids))}) AND mk_item_id IS NOT NULL",  # nosec B608
            tuple(ing_ids),
        )
    }
    if not item_ids:
        return
    now = now_iso()
    for item_id in item_ids:
        ads = db.execute(
            "SELECT a.id FROM ws_ads a JOIN ws_ad_regions r ON r.ad_id = a.id "
            "WHERE a.item_id = ? AND a.status = 'active' AND a.ends_at > ? AND r.region_code = ?",
            (item_id, now, st["region_code"]),
        ).fetchall()
        for ad in ads:
            db.execute(
                "INSERT OR IGNORE INTO ws_ad_deliveries(ad_id, user_id, status, created_at) VALUES (?,?, 'new', ?)",
                (ad["id"], uid, now),
            )
