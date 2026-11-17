"""여러 화면에서 같이 쓰는 로직: 단가 반영, 가격 변동 조회, 이름 매칭, 인식 횟수."""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from . import market_catalog, units
from .db import now_iso


# ---------------------------------------------------------------- 단가 반영

def add_history(db, user_id, ingredient_id, unit_price, pack_size, pack_unit, pack_price, source, invoice_id=None, ts=None):
    db.execute(
        "INSERT INTO price_history(ingredient_id, user_id, unit_price, pack_size, pack_unit, pack_price, source, invoice_id, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (ingredient_id, user_id, unit_price, pack_size, pack_unit, pack_price, source, invoice_id, ts or now_iso()),
    )


def apply_price(db, user_id, ing, pack_size, pack_unit, pack_price, source, invoice_id=None, ts=None) -> dict:
    """식자재 하나의 구매 규격·가격을 반영합니다. 단가가 달라졌을 때만 이력을 남깁니다."""
    ts = ts or now_iso()
    unit = units.canon_unit(pack_unit)
    kind, base_qty = units.to_base(pack_size, unit)
    new_price = pack_price / base_qty
    old_price = ing["unit_price"]
    changed = old_price is None or abs(new_price - old_price) > 1e-9 * max(1.0, abs(old_price))
    db.execute(
        "UPDATE ingredients SET unit_kind=?, unit_price=?, pack_size=?, pack_unit=?, pack_price=?, "
        "price_checked_at=?, updated_at=? WHERE id=? AND user_id=?",
        (kind, new_price, pack_size, unit, pack_price, ts, ts, ing["id"], user_id),
    )
    if changed:
        add_history(db, user_id, ing["id"], new_price, pack_size, unit, pack_price, source, invoice_id, ts)
    if source != "prep":  # 프렙 자체 가격 반영이 스스로를 다시 트리거하는 걸 막는다(순환 방지)
        from . import preps as preps_mod  # 지연 임포트: preps.py가 services.add_history를 쓰므로 순환 임포트 방지

        preps_mod.recompute_preps_using(db, user_id, ing["id"])
    return {"changed": changed, "old": old_price, "new": new_price, "kind": kind}


def recent_avg_price(db, uid: int, ingredient_id: int, n: int = 3) -> float | None:
    """식자재 하나의 '최근 n건 구매 단가 평균'. invoice_lines 기준(가격이 안 바뀐 구매도 포함).
    예시(데모) 명세서는 뺍니다. 도매 매칭에서 지금 거래 중인 가격의 기준으로 씁니다."""
    rows = db.execute(
        "SELECT il.unit_price AS unit_price FROM invoice_lines il "
        "JOIN invoices i ON i.id = il.invoice_id "
        "WHERE il.user_id = ? AND il.ingredient_id = ? AND i.source != 'demo' "
        "ORDER BY il.created_at DESC, il.id DESC LIMIT ?",
        (uid, ingredient_id, n),
    ).fetchall()
    if not rows:
        return None
    return sum(r["unit_price"] for r in rows) / len(rows)


def recent_price_info(db, uid: int, ingredient_id: int, n: int = 3) -> dict | None:
    """recent_avg_price와 같은 기준으로 (평균, 건수, 가장 최근 구매 시각)을 함께 돌려줍니다.
    실제 명세서 구매가 없으면 사장님이 직접 입력(또는 가져오기)한 가장 최근 가격을 씁니다 —
    예시 데이터('seed')와 샘플 명세서는 가짜 수요가 되므로 계속 뺍니다."""
    rows = db.execute(
        "SELECT il.unit_price AS unit_price, il.created_at AS at FROM invoice_lines il "
        "JOIN invoices i ON i.id = il.invoice_id "
        "WHERE il.user_id = ? AND il.ingredient_id = ? AND i.source != 'demo' "
        "ORDER BY il.created_at DESC, il.id DESC LIMIT ?",
        (uid, ingredient_id, n),
    ).fetchall()
    if not rows:
        # shortcut: 이력은 가격이 바뀔 때만 쌓여서, 같은 가격을 다시 저장해도 '최근' 날짜가 갱신되지 않는다.
        rows = db.execute(
            "SELECT unit_price, created_at AS at FROM price_history WHERE user_id = ? AND ingredient_id = ? "
            "AND source IN ('manual', 'import') ORDER BY created_at DESC, id DESC LIMIT 1",
            (uid, ingredient_id),
        ).fetchall()
    if not rows:
        return None
    return {
        "avg": sum(r["unit_price"] for r in rows) / len(rows),
        "n": len(rows),
        "last_at": rows[0]["at"],
    }


def price_changes(db, uid: int) -> dict[int, dict]:
    """식자재별 '가장 최근 단가 vs 그 직전 단가'. 이력이 2건 이상인 것만."""
    rows = db.execute(
        "SELECT ph.ingredient_id AS iid, ph.unit_price AS price, ph.created_at AS at, ph.source AS src, i.name, i.unit_kind AS kind "
        "FROM price_history ph JOIN ingredients i ON i.id = ph.ingredient_id "
        "WHERE ph.user_id = ? ORDER BY ph.ingredient_id, ph.created_at DESC, ph.id DESC",
        (uid,),
    ).fetchall()
    seen: dict[int, list] = {}
    for r in rows:
        lst = seen.setdefault(r["iid"], [])
        if len(lst) < 2:
            lst.append(r)
    out: dict[int, dict] = {}
    for iid, lst in seen.items():
        # 가져오기(import)로 바뀐 단가는 실제 가격 변동이 아니므로 알림을 만들지 않습니다.
        if len(lst) == 2 and lst[1]["price"] > 0 and lst[0]["src"] != "import":
            cur, prev = lst
            out[iid] = {
                "price": cur["price"],
                "prev": prev["price"],
                "at": cur["at"],
                "pct": (cur["price"] / prev["price"] - 1.0) * 100.0,
                "name": cur["name"],
                "kind": cur["kind"],
            }
    return out


def used_counts(db, uid: int) -> dict[int, int]:
    rows = db.execute(
        "SELECT mi.ingredient_id AS iid, COUNT(DISTINCT mi.menu_id) AS c "
        "FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE m.user_id = ? GROUP BY mi.ingredient_id",
        (uid,),
    ).fetchall()
    return {r["iid"]: r["c"] for r in rows}


# ---------------------------------------------------------------- 이름 매칭


def norm_name(s: str | None) -> str:
    return market_catalog.norm(s)


def load_aliases(db, uid: int) -> dict[str, int]:
    rows = db.execute("SELECT alias, ingredient_id FROM ingredient_aliases WHERE user_id = ?", (uid,)).fetchall()
    return {r["alias"]: r["ingredient_id"] for r in rows}


def save_alias(db, uid: int, alias: str, ingredient_id: int) -> None:
    n = norm_name(alias)
    if not n:
        return
    db.execute(
        "INSERT INTO ingredient_aliases(user_id, alias, ingredient_id) VALUES (?,?,?) "
        "ON CONFLICT(user_id, alias) DO UPDATE SET ingredient_id = excluded.ingredient_id",
        (uid, n, ingredient_id),
    )


def best_match(name: str, ingredients: list, aliases: dict[str, int]):
    """명세서 품목명 -> 내 식자재. 별칭(이전에 연결한 이름) -> 같은 이름 -> 비슷한 이름 순서."""
    n = norm_name(name)
    if not n:
        return None
    if n in aliases:
        return aliases[n], 1.0
    best_id, best = None, 0.0
    for ing in ingredients:
        m = norm_name(ing["name"])
        if not m:
            continue
        if m == n:
            return ing["id"], 1.0
        if len(m) >= 2 and len(n) >= 2 and (m in n or n in m):
            score = 0.85
        else:
            score = SequenceMatcher(None, n, m).ratio()
        if score > best:
            best_id, best = ing["id"], score
    if best_id is not None and best >= 0.7:
        return best_id, round(best, 2)
    return None


# ---------------------------------------------------------------- 자동 인식 횟수

def kst_month() -> str:
    return datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m")


def ocr_used(db, uid: int) -> int:
    row = db.execute("SELECT count FROM ocr_usage WHERE user_id = ? AND ym = ?", (uid, kst_month())).fetchone()
    return row["count"] if row else 0


def ocr_inc(db, uid: int) -> None:
    db.execute(
        "INSERT INTO ocr_usage(user_id, ym, count) VALUES (?,?,1) "
        "ON CONFLICT(user_id, ym) DO UPDATE SET count = count + 1",
        (uid, kst_month()),
    )


def ocr_reserve(db, uid: int, limit: int) -> bool:
    """호출 전에 1회를 먼저 잡습니다(문장 하나라 동시에 여러 요청이 와도 한도를 넘지 않습니다)."""
    if limit <= 0:
        return False
    cur = db.execute(
        "INSERT INTO ocr_usage(user_id, ym, count) VALUES (?,?,1) "
        "ON CONFLICT(user_id, ym) DO UPDATE SET count = count + 1 WHERE count < ?",
        (uid, kst_month(), limit),
    )
    return cur.rowcount == 1


def ocr_release(db, uid: int) -> None:
    """호출이 실패했을 때 먼저 잡아 둔 1회를 돌려줍니다."""
    db.execute("UPDATE ocr_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND ym = ?", (uid, kst_month()))


# 사용자별 요청 횟수 제한(메모리, 서버 한 대 기준)
_user_hits: dict[str, list[float]] = defaultdict(list)


def reset_user_limits() -> None:
    _user_hits.clear()


def user_rate_hit(key: str, limit: int, window: float) -> bool:
    """제한을 넘었으면 True. 넘지 않았으면 이번 요청을 기록하고 False."""
    now = time.time()
    arr = [t for t in _user_hits[key] if now - t < window]
    if len(arr) >= limit:
        _user_hits[key] = arr
        return True
    arr.append(now)
    _user_hits[key] = arr
    return False


# 같은 요청이 두 번 들어와도(저장 버튼 연타·네트워크 재시도) 한 번만 처리하기 위한 기록(메모리, 서버 한 대 기준)
_idem: dict[tuple, tuple[float, object]] = {}
_idem_lock = threading.Lock()
IDEM_TTL = 600


def idem_run(uid: int, key: str | None, fn):
    """key 가 같으면 처음 처리한 결과를 그대로 돌려줍니다. key 가 없으면 그냥 실행합니다."""
    if not key:
        return fn()
    key = key[:64]
    with _idem_lock:  # 같은 키가 동시에 들어와도 한 번만 실행되도록 줄을 세웁니다.
        now = time.time()
        for k in [k for k, (t, _) in _idem.items() if now - t > IDEM_TTL]:
            del _idem[k]
        hit = _idem.get((uid, key))
        if hit:
            return hit[1]
        res = fn()
        _idem[(uid, key)] = (time.time(), res)
        return res


def reset_idem() -> None:
    _idem.clear()
