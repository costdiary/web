"""여러 가게가 등록한 메뉴에서 모은 '함께 쓰는 레시피'(메뉴 추천 후보).

사장님들이 메뉴를 등록할수록 추천 후보가 늘어나게 하려고, 모든 가게의 메뉴를 메뉴 이름으로 묶고
여러 가게에서 공통으로 나타나는 재료 조합만 레시피로 만듭니다(app/menu_map.py의 suggest()가 씀).

다른 가게의 레시피가 그대로 보이지 않게 하는 규칙:
- 서로 다른 가게 MIN_STORES곳 이상이 파는 메뉴 이름만 씁니다. 추천을 보는 가게 자신의 메뉴는 셈에서 뺍니다.
- 재료도 MIN_STORES곳 이상, 그리고 그 메뉴를 파는 가게의 절반 이상이 쓰는 것만 넣습니다.
  재료 이름은 재료 가족 이름(예: '국내산 삼겹살 1kg' → '삼겹살')이나 괄호·규격·원산지를 뺀 이름으로 바꿉니다.
- 양은 가게들 값의 가운데 값(중앙값)을 보기 좋게 반올림한 어림값입니다. 어느 한 가게의 양이 아닙니다.
- 가게 이름·거래처·단가·판매가는 쓰지 않습니다.
- 체험용 예시 데이터(app/seed.py)를 그대로 둔 메뉴는 세지 않습니다(예시를 넣은 가게가 많아도 늘지 않게).
- 프렙(육수·양념장)은 '육수'처럼 재료 가족이 있으면 그 이름으로, 없으면 프렙에 들어간 원재료로 펼쳐 셉니다.

가게 수가 늘수록 추천에서 이 레시피의 점수를 더 올려(store_bonus) 기본 레시피보다 앞에 나오게 합니다.
계산은 CACHE_SECONDS 동안 기억해 두고 다시 씁니다.
"""
from __future__ import annotations

import math
import re
import threading
import time
from collections import Counter, defaultdict
from statistics import median

from . import seed
from .menu_map import _JUNK, _PAREN, _SPEC, _WORDS, family_of, key

MIN_STORES = 3        # 서로 다른 가게 몇 곳 이상이 팔아야 추천 후보로 쓰는지
INGREDIENT_SHARE = 0.5  # 그 메뉴를 파는 가게 중 몇 할 이상이 쓰는 재료만 넣는지
CACHE_SECONDS = 3600

_SERVING = re.compile(r"\d+\s*인(?:분)?|점심|저녁|특선|정식세트|세트")
_UNIT = {"g": "g", "ml": "ml", "ea": "개"}

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "data": None}


def clear() -> None:
    with _lock:
        _cache["at"], _cache["data"] = 0.0, None


def menu_key(name: str | None) -> str:
    """메뉴 이름 묶기용: '김치찌개(2인)', '점심 김치찌개' → '김치찌개'."""
    return key(_SERVING.sub("", _PAREN.sub("", name or "")))


def _display(name: str) -> str:
    s = _WORDS.sub("", _PAREN.sub("", name or ""))
    s = _SPEC.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" -_/.,·ㆍ") or name


def _seed_signatures() -> set[tuple]:
    out = set()
    for name, _price, _cat, _other, items in seed.MENUS:
        out.add((menu_key(name), tuple(sorted((key(n), round(float(q), 3)) for n, q in items))))
    return out


def _nice(q: float, unit: str) -> float:
    if unit == "개":
        return max(0.25, round(q * 4) / 4)
    if q < 20:
        return max(1, round(q))
    step = 5 if q < 100 else 10
    return float(round(q / step) * step)


def _collect(db) -> dict[str, list[dict]]:
    """메뉴 이름 → 가게마다 하나씩 {user_id, name, category, lines: {재료이름키: (보이는 이름, 양, 단위)}}."""
    ings = {r["id"]: dict(r) for r in db.execute(
        "SELECT id, user_id, name, unit_kind, from_prep_id FROM ingredients").fetchall()}
    preps = {r["id"]: dict(r) for r in db.execute("SELECT id, user_id, ingredient_id, yield_qty FROM preps").fetchall()}
    prep_of_ing = {p["ingredient_id"]: p for p in preps.values() if p.get("ingredient_id")}
    prep_items: dict[int, list] = defaultdict(list)
    for r in db.execute("SELECT prep_id, ingredient_id, qty FROM prep_items").fetchall():
        prep_items[r["prep_id"]].append((r["ingredient_id"], r["qty"]))
    menus = {r["id"]: dict(r) for r in db.execute("SELECT id, user_id, name, category FROM menus").fetchall()}
    items: dict[int, list] = defaultdict(list)
    for r in db.execute("SELECT menu_id, ingredient_id, qty FROM menu_items ORDER BY menu_id, position, id").fetchall():
        items[r["menu_id"]].append((r["ingredient_id"], r["qty"]))
    seeds = _seed_signatures()

    def put(lines: dict, ing: dict, qty: float):
        fam = family_of(ing["name"])
        k = fam or key(ing["name"])
        if not k:
            return
        unit = _UNIT[ing["unit_kind"]]
        shown = fam or _display(ing["name"])
        if k in lines:
            old = lines[k]
            if old[2] == unit:
                lines[k] = (old[0], old[1] + qty, unit)
            return
        lines[k] = (shown, qty, unit)

    by_name: dict[str, dict[int, dict]] = defaultdict(dict)
    for mid, m in menus.items():
        mk = menu_key(m["name"])
        its = items.get(mid, [])
        if len(mk) < 2 or len(its) < 2 or m["user_id"] in by_name[mk]:
            continue
        sig = (mk, tuple(sorted((key(ings[i]["name"]), round(float(q), 3)) for i, q in its if i in ings)))
        if sig in seeds:
            continue  # 예시 데이터를 그대로 둔 메뉴
        lines: dict = {}
        for iid, qty in its:
            ing = ings.get(iid)
            if not ing or ing["user_id"] != m["user_id"]:
                continue
            prep = prep_of_ing.get(iid) if ing.get("from_prep_id") else None
            if prep and not family_of(ing["name"]) and (prep.get("yield_qty") or 0) > 0:
                for pid, pq in prep_items.get(prep["id"], []):
                    sub = ings.get(pid)
                    if sub and sub["user_id"] == m["user_id"]:
                        put(lines, sub, qty * pq / prep["yield_qty"])
            else:
                put(lines, ing, qty)
        if len(lines) >= 2:
            by_name[mk][m["user_id"]] = {"name": m["name"], "category": m["category"] or "", "lines": lines}
    return {mk: list(({"user_id": u, **v} for u, v in stores.items())) for mk, stores in by_name.items()
            if len(stores) >= MIN_STORES}


def _data(db) -> dict[str, list[dict]]:
    now = time.time()
    with _lock:
        if _cache["data"] is not None and now - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
    data = _collect(db)
    with _lock:
        _cache["at"], _cache["data"] = now, data
    return data


def recipes(db, exclude_user_id: int | None = None) -> list[dict]:
    """[{name, category, aliases, lines: [(재료, 양, 'g'|'ml'|'개')], stores}] 가게 수가 많은 순."""
    out = []
    for _mk, stores in _data(db).items():
        rows = [s for s in stores if s["user_id"] != exclude_user_id]
        n = len(rows)
        if n < MIN_STORES:
            continue
        need = max(MIN_STORES, math.ceil(n * INGREDIENT_SHARE))
        cnt: Counter = Counter()
        for s in rows:
            cnt.update(s["lines"].keys())
        lines = []
        for k, c in cnt.most_common():
            if c < need:
                break
            vals = [s["lines"][k] for s in rows if k in s["lines"]]
            unit = Counter(v[2] for v in vals).most_common(1)[0][0]
            qs = [v[1] for v in vals if v[2] == unit]
            if len(qs) < MIN_STORES:
                continue
            shown = Counter(v[0] for v in vals).most_common(1)[0][0]
            lines.append((shown, _nice(median(qs), unit), unit))
        if len(lines) < 2:
            continue
        names = Counter(s["name"].strip() for s in rows)
        # 보이는 이름: 가장 많이 쓰는 표기. 그 표기를 쓰는 가게가 MIN_STORES곳 미만이면 괄호·인분을 뺀 이름.
        top, top_n = names.most_common(1)[0]
        name = top if top_n >= MIN_STORES else (_SERVING.sub("", _PAREN.sub("", top)).strip() or top)
        cat = Counter(s["category"] for s in rows if s["category"]).most_common(1)
        out.append({"name": name, "category": cat[0][0] if cat else "", "aliases": tuple(names),
                    "lines": lines, "stores": n})
    out.sort(key=lambda r: (-r["stores"], r["name"]))
    return out


def store_bonus(stores: int) -> float:
    """가게 수가 많을수록 추천 점수를 더 올린다(3곳 6점 → 10곳 이상 20점)."""
    return float(min(20, 6 + 2 * max(0, stores - MIN_STORES)))
