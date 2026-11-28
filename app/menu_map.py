"""재료·메뉴 연결표와 메뉴 추천.

build_map(): 어떤 식자재가 어떤 메뉴(프렙 레시피를 거쳐 들어가는 것까지)에 쓰이는지 전부 모으고,
  많이 쓰이고 재료비 비중이 큰 '핵심 식자재'를 가려냅니다.
  - 프렙(육수·양념장)을 메뉴에 쓰면, 그 프렙에 들어간 원재료도 그 메뉴에 쓰인 것으로 셉니다
    (메뉴 1인분에 쓴 프렙 양 × 프렙 재료 양 ÷ 프렙 완성량).
  - 최근 30일 메뉴별 판매 수량(sales_items)이 있으면 '한 달에 실제로 쓴 양·돈'도 계산하고,
    재료비 비중을 판매량 기준으로 잡습니다. 없으면 메뉴 1인분씩을 같은 무게로 봅니다.

suggest(): 가게가 이미 사 오는 식자재와 기본 레시피(menu_ideas_data.IDEAS), 공공 레시피(refdata,
  있을 때만), 자주 파는 메뉴의 기본 레시피(menu_presets, 있을 때만)를 맞춰 보고,
  새로 살 재료가 없거나 1~2개뿐인 메뉴를 추천합니다. 이미 파는 메뉴와 이름이 겹치면 뺍니다.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .costing import basis_price, eff_unit_cost
from .menu_ideas_data import BASIC, FAMILY, IDEAS

_PAREN = re.compile(r"[\(\[（].*?[\)\]）]")
_SPEC = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l|리터|개|구|입|ea|봉|망|박스|box|팩|단|포기|모)?", re.IGNORECASE)
_WORDS = re.compile(r"국내산|국산|수입산|수입|미국산|호주산|캐나다산|칠레산|스페인산|중국산|냉동|냉장|손질|생물|특품|상품|업소용|대용량")
_JUNK = re.compile(r"[\s\-_/.,·ㆍ]+")

CORE_MAX = 6


def key(name: str | None) -> str:
    """이름 맞추기용: 괄호·규격·원산지 같은 말과 띄어쓰기를 뺀 소문자."""
    s = _PAREN.sub("", name or "")
    s = _WORDS.sub("", s)
    s = _SPEC.sub("", s)
    return _JUNK.sub("", s).lower()


def _fam_ok(fam: str, k: str) -> bool:
    contains, exact, exclude, _price, _ea = FAMILY[fam]
    if not k:
        return False
    if any(x in k for x in exclude):
        return False
    return k in exact or any(x in k for x in contains)


def family_of(name: str) -> str | None:
    """레시피 재료 이름(예: '돼지 앞다리살', '멸치육수')이 어느 재료 가족인지. 위에 적은 가족부터 봅니다."""
    if name in FAMILY:
        return name
    k = key(name)
    for fam in FAMILY:
        if _fam_ok(fam, k):
            return fam
    return None


# ------------------------------------------------------------------ 읽기

def _load(db, uid: int):
    ings = {r["id"]: dict(r) for r in db.execute("SELECT * FROM ingredients WHERE user_id = ?", (uid,)).fetchall()}
    preps = {r["id"]: dict(r) for r in db.execute("SELECT * FROM preps WHERE user_id = ? ORDER BY name", (uid,)).fetchall()}
    prep_items: dict[int, list[dict]] = defaultdict(list)
    if preps:
        marks = ",".join("?" * len(preps))
        for r in db.execute(f"SELECT prep_id, ingredient_id, qty FROM prep_items WHERE prep_id IN ({marks}) ORDER BY position, id", list(preps)).fetchall():  # nosec B608
            prep_items[r["prep_id"]].append(dict(r))
    menus = {r["id"]: dict(r) for r in db.execute("SELECT * FROM menus WHERE user_id = ? ORDER BY name", (uid,)).fetchall()}
    menu_items: dict[int, list[dict]] = defaultdict(list)
    if menus:
        marks = ",".join("?" * len(menus))
        for r in db.execute(f"SELECT menu_id, ingredient_id, qty FROM menu_items WHERE menu_id IN ({marks}) ORDER BY position, id", list(menus)).fetchall():  # nosec B608
            menu_items[r["menu_id"]].append(dict(r))
    return ings, preps, prep_items, menus, menu_items


def _sold_30d(db, uid: int) -> dict[int, float]:
    since = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    rows = db.execute(
        "SELECT menu_id, SUM(qty) AS q FROM sales_items WHERE user_id = ? AND day >= ? AND qty > 0 GROUP BY menu_id",
        (uid, since),
    ).fetchall()
    return {r["menu_id"]: float(r["q"] or 0) for r in rows if (r["q"] or 0) > 0}


def _unit_cost(ing: dict) -> float | None:
    up = ing.get("unit_price")
    return eff_unit_cost(up, ing.get("yield_pct")) if up is not None else None


# ------------------------------------------------------------------ 연결표

def build_map(db, user: dict) -> dict:
    uid = user["id"]
    ings, preps, prep_items, menus, menu_items = _load(db, uid)
    prep_of_ing = {p["ingredient_id"]: p for p in preps.values() if p.get("ingredient_id")}
    sold = _sold_30d(db, uid)
    vat, target = user["vat_mode"], user["target_cost_ratio"]

    # 원재료 → 메뉴 연결(프렙을 거치는 것은 펼쳐서). key = (재료 id, 메뉴 id)
    use: dict[tuple[int, int], dict] = {}
    prep_menus: dict[int, set[int]] = defaultdict(set)
    menu_cost: dict[int, float] = {}
    menu_missing: dict[int, int] = {}

    def add(iid: int, mid: int, qty: float, via: dict | None):
        ing = ings.get(iid)
        if not ing:
            return
        uc = _unit_cost(ing)
        e = use.setdefault((iid, mid), {"qty": 0.0, "cost": 0.0, "priced": uc is not None, "via": [], "direct": False})
        if not via:
            e["direct"] = True
        e["qty"] += qty
        if uc is not None:
            e["cost"] += qty * uc
        if via and via["name"] not in e["via"]:
            e["via"].append(via["name"])

    for mid, items in menu_items.items():
        total, missing = 0.0, 0
        for it in items:
            ing = ings.get(it["ingredient_id"])
            if not ing:
                continue
            uc = _unit_cost(ing)
            if uc is None:
                missing += 1
            else:
                total += it["qty"] * uc
            prep = prep_of_ing.get(ing["id"]) if ing.get("from_prep_id") else None
            if prep:
                prep_menus[prep["id"]].add(mid)
                y = prep.get("yield_qty") or 0
                if y > 0:
                    for pi in prep_items.get(prep["id"], []):
                        add(pi["ingredient_id"], mid, it["qty"] * pi["qty"] / y, prep)
            else:
                add(ing["id"], mid, it["qty"], None)
        menu_cost[mid] = total
        menu_missing[mid] = missing

    used_menus = [m for m in menus.values() if menu_items.get(m["id"])]
    by_sales = bool(sold) and any(sold.get(m["id"]) for m in used_menus)
    weight = {m["id"]: (sold.get(m["id"], 0.0) if by_sales else 1.0) for m in used_menus}

    # 원재료마다
    per_ing: dict[int, dict] = {}
    for (iid, mid), e in use.items():
        d = per_ing.setdefault(iid, {"menus": [], "weighted": 0.0, "monthly_qty": 0.0, "monthly_cost": 0.0})
        mc = menu_cost.get(mid) or 0
        d["menus"].append({
            "id": mid, "name": menus[mid]["name"], "qty": round(e["qty"], 3), "cost": round(e["cost"], 1) if e["priced"] else None,
            "share": round(e["cost"] / mc * 100, 1) if e["priced"] and mc > 0 else None, "via": e["via"], "direct": e["direct"],
        })
        d["weighted"] += e["cost"] * weight.get(mid, 0)
        if by_sales:
            d["monthly_qty"] += e["qty"] * sold.get(mid, 0)
            d["monthly_cost"] += e["cost"] * sold.get(mid, 0)
    total_weighted = sum(d["weighted"] for d in per_ing.values()) or 0

    raw = [i for i in ings.values() if not i.get("from_prep_id")]
    max_count = max((len(d["menus"]) for d in per_ing.values()), default=0)
    max_share = 0.0
    for d in per_ing.values():
        d["share"] = (d["weighted"] / total_weighted * 100) if total_weighted > 0 else 0.0
        max_share = max(max_share, d["share"])

    n_menus = len(used_menus)
    thr = max(2, math.ceil(n_menus * 0.3))
    out_ings = []
    for i in raw:
        d = per_ing.get(i["id"])
        count = len(d["menus"]) if d else 0
        share = d["share"] if d else 0.0
        score = 0.0
        if d and max_count:
            score = 0.5 * count / max_count + (0.5 * share / max_share if max_share > 0 else 0)
        menus_sorted = sorted(d["menus"], key=lambda x: -(x["cost"] or 0)) if d else []
        # 값이 10% 오르면: 메뉴 1인분 원가 합계 증가, 판매가가 있는 메뉴의 원가율 평균 증가(%p)
        bump = sum((x["cost"] or 0) * 0.1 for x in menus_sorted)
        pts = []
        for x in menus_sorted:
            m = menus[x["id"]]
            b = basis_price(m["price"] or 0, vat)
            if b > 0 and x["cost"]:
                pts.append(x["cost"] * 0.1 / b * 100)
        preps_using = sorted({p["name"] for p in preps.values() for pi in prep_items.get(p["id"], []) if pi["ingredient_id"] == i["id"]})
        out_ings.append({
            "id": i["id"], "name": i["name"], "kind": i["unit_kind"], "category": i["category"],
            "priced": i["unit_price"] is not None,
            "menu_count": count, "share": round(share, 1), "score": round(score, 4),
            "menus": menus_sorted, "preps": preps_using,
            "monthly_qty": round(d["monthly_qty"], 1) if d and by_sales else None,
            "monthly_cost": round(d["monthly_cost"]) if d and by_sales else None,
            "bump10": round(bump, 1), "bump10_pts": round(sum(pts) / len(pts), 2) if pts else None,
            "tier": "unused" if count == 0 else ("some" if count == 1 else "often"),
        })
    # 핵심: 메뉴 여러 개에 들어가면서 재료비 비중도 있는 것, 또는 혼자서 재료비 비중이 아주 큰 것
    cands = [x for x in out_ings if x["menu_count"] and ((x["menu_count"] >= thr and x["share"] >= 5) or x["share"] >= 15)]
    cands.sort(key=lambda x: -x["score"])
    for x in cands[:CORE_MAX]:
        x["tier"] = "core"
    out_ings.sort(key=lambda x: (-x["menu_count"], -x["share"], x["name"]))

    out_menus = []
    for m in menus.values():
        ids = [iid for (iid, mid) in use if mid == m["id"]]
        b = basis_price(m["price"] or 0, vat)
        c = menu_cost.get(m["id"], 0.0)
        out_menus.append({
            "id": m["id"], "name": m["name"], "category": m["category"], "price": m["price"],
            "cost": round(c), "ratio": round(c / b * 100, 1) if b > 0 and c > 0 else None,
            "ingredients": ids, "missing_price": menu_missing.get(m["id"], 0),
            "sold_30d": sold.get(m["id"]) if by_sales else None,
            "preps": sorted({preps[p]["name"] for p, ms in prep_menus.items() if m["id"] in ms}),
        })
    out_menus.sort(key=lambda m: (-len(m["ingredients"]), m["name"]))

    out_preps = [{
        "id": p["id"], "name": p["name"],
        "ingredients": [pi["ingredient_id"] for pi in prep_items.get(p["id"], []) if pi["ingredient_id"] in ings],
        "menus": sorted(prep_menus.get(p["id"], set())),
    } for p in preps.values()]

    return {
        "ingredients": out_ings, "menus": out_menus, "preps": out_preps,
        "summary": {
            "ingredient_count": len(raw), "menu_count": len(menus), "linked_menus": n_menus,
            "core_count": sum(1 for x in out_ings if x["tier"] == "core"),
            "unused_count": sum(1 for x in out_ings if x["tier"] == "unused"),
            "core_rule_menus": thr, "by_sales": by_sales, "target": target,
        },
    }


# ------------------------------------------------------------------ 메뉴 추천

def _recipes() -> list[dict]:
    """추천 후보 레시피(이름이 같으면 먼저 넣은 것만). 기본 레시피 → 자주 파는 메뉴 → 공공 레시피 순."""
    out: list[dict] = []
    seen: set[str] = set()

    def put(name, category, aliases, lines, pitch, src):
        k = key(name)
        if not k or k in seen or len(lines) < 2:
            return
        seen.add(k)
        out.append({"name": name, "category": category, "aliases": tuple(aliases), "lines": lines, "pitch": pitch, "src": src})

    for name, cat, aliases, lines, pitch in IDEAS:
        put(name, cat, aliases, [(n, q, u) for n, q, u in lines], pitch, "basic")
    try:  # 메뉴 만들기(그릇 채우기) 화면의 기본 레시피가 들어와 있으면 같이 씁니다.
        from .menu_presets import PRESETS  # type: ignore
        for name, cat, aliases, lines, _basis in PRESETS:
            put(name, cat, aliases, [(n, q, u) for n, q, u in lines], "", "preset")
    except Exception:  # noqa: BLE001 - 없거나 모양이 달라도 추천은 기본 레시피로 계속
        pass
    try:  # 공공 레시피(식약처)가 내려받아져 있으면 같이 씁니다.
        from . import refdata
        conn = refdata.connect()
        if conn is not None:
            try:
                rows = conn.execute("SELECT id, name, category FROM ref_recipes ORDER BY id LIMIT 3000").fetchall()
                lines_by: dict[int, list] = defaultdict(list)
                for ln in conn.execute("SELECT recipe_id, name, qty, unit FROM ref_lines ORDER BY recipe_id, pos").fetchall():
                    u = {"g": "g", "ml": "ml", "mL": "ml", "개": "개"}.get(ln["unit"] or "", None)
                    lines_by[ln["recipe_id"]].append((ln["name"], ln["qty"] if u else None, u or "g"))
                for r in rows:
                    put(r["name"], r["category"] or "", (), lines_by.get(r["id"], []), "", "public")
            finally:
                conn.close()
    except Exception:  # noqa: BLE001
        pass
    return out


def _to_kind(qty: float | None, unit: str, kind: str, ea_g: float | None) -> float | None:
    """레시피 양(g|ml|개)을 가게 식자재 기본 단위(g|ml|ea)로."""
    if qty is None:
        return None
    if unit == "개":
        if kind == "ea":
            return qty
        return qty * ea_g if ea_g else None
    if kind == "ea":
        return qty / ea_g if ea_g else None
    return qty  # g ↔ ml 은 1:1로 어림


def _ref_cost(fam: str | None, qty: float | None, unit: str) -> float | None:
    if not fam or qty is None:
        return None
    price, ea_g = FAMILY[fam][3], FAMILY[fam][4]
    if price is None:
        return None
    # 가격표는 개로 세는 재료(달걀·두부·라면·만두·김)는 원/개, 나머지는 원/g(ml)
    per_ea = fam in ("달걀", "두부", "라면 사리", "만두", "김")
    if unit == "개":
        if per_ea:
            return qty * price
        return qty * ea_g * price if ea_g else None
    if per_ea:
        return qty / ea_g * price if ea_g else None
    return qty * price


def _round_price(x: float) -> int:
    return int(math.ceil(x / 500.0 - 1e-9) * 500)


def suggest(db, user: dict, limit: int = 12) -> dict:
    uid = user["id"]
    mp = build_map(db, user)
    ings, _preps, _pi, menus, _mi = _load(db, uid)
    tier = {x["id"]: x["tier"] for x in mp["ingredients"]}
    count = {x["id"]: x["menu_count"] for x in mp["ingredients"]}
    top_menu = {x["id"]: (x["menus"][0] if x["menus"] else None) for x in mp["ingredients"]}
    raw = [i for i in ings.values() if not i.get("from_prep_id")]
    # 맞춰 볼 식자재: 원재료 전부 + 프렙 결과물(멸치육수처럼 미리 만들어 두는 것은 레시피의 '육수'로 쓴다)
    raw_keys = [(i, key(i["name"])) for i in ings.values()]
    menu_sets = {m["id"]: set(m["ingredients"]) for m in mp["menus"]}

    fam_cache: dict[str, list[dict]] = {}

    def owned(rname: str) -> tuple[dict | None, str | None]:
        fam = family_of(rname)
        ck = fam or ("=" + key(rname))
        if ck not in fam_cache:
            if fam:
                hits = [i for i, k in raw_keys if _fam_ok(fam, k)]
            else:
                rk = key(rname)
                hits = [i for i, k in raw_keys if rk and (rk == k or (len(rk) >= 2 and rk in k))]
            # 메뉴에 많이 쓰는 것, 단가가 있는 것, 이름이 짧은(더 일반적인) 것 순
            hits.sort(key=lambda i: (-count.get(i["id"], 0), i["unit_price"] is None, len(i["name"])))
            fam_cache[ck] = hits
        hits = fam_cache[ck]
        return (hits[0] if hits else None), fam

    menu_keys = [key(m["name"]) for m in menus.values()]

    def already_sold(rec) -> bool:
        for nm in (rec["name"], *rec["aliases"]):
            k = key(nm)
            if not k:
                continue
            for mk in menu_keys:
                if mk and (k == mk or (len(k) >= 3 and k in mk) or (len(mk) >= 3 and mk in k)):
                    return True
        return False

    target = user["target_cost_ratio"]
    vat = user["vat_mode"]
    ideas = []
    recipes = _recipes()
    n_recipes = len(recipes)
    for rec in recipes:
        if already_sold(rec):
            continue
        lines = []
        mains = have = 0
        missing: list[str] = []
        for rname, qty, unit in rec["lines"]:
            ing, fam = owned(rname)
            basic = (fam or rname) in BASIC
            if not basic:
                mains += 1
                if ing:
                    have += 1
                else:
                    missing.append(fam or rname)
            cost, approx, base_qty = None, False, None
            if ing:
                base_qty = _to_kind(qty, unit, ing["unit_kind"], FAMILY[fam][4] if fam else None)
                uc = _unit_cost(ing)
                if base_qty is not None and uc is not None:
                    cost = base_qty * uc
            if cost is None:
                cost = _ref_cost(fam, qty, unit)
                approx = cost is not None
            src = top_menu.get(ing["id"]) if ing else None
            lines.append({
                "name": fam or rname, "qty": qty, "unit": unit, "basic": basic,
                "have": bool(ing), "ingredient_id": ing["id"] if ing else None, "ingredient": ing["name"] if ing else None,
                "kind": ing["unit_kind"] if ing else None, "base_qty": round(base_qty, 3) if base_qty is not None else None,
                "core": bool(ing) and tier.get(ing["id"]) == "core",
                "from_menu": {"id": src["id"], "name": src["name"]} if src else None,
                "cost": round(cost, 1) if cost is not None else None, "approx": approx,
            })
        if mains < 2 or have < 2 or len(missing) > 2 or have / mains < 0.6:
            continue
        core_used = [ln["ingredient"] for ln in lines if ln["core"]]
        # 어떤 메뉴들을 섞으면 되는지: 겹치는 재료가 가장 많은 내 메뉴를 바탕으로 두고,
        # 나머지 재료는 그 재료를 쓰는 다른 메뉴에서 가져온다(예: 제육볶음 + 콩나물국의 콩나물).
        hset = {ln["ingredient_id"] for ln in lines if ln["have"] and not ln["basic"]}
        best_id, best = None, 0
        for mid, ms in menu_sets.items():
            ov = len(hset & ms)
            if ov > best:
                best_id, best = mid, ov
        base = None
        if best_id is not None and best >= 2:
            base = {"id": best_id, "name": menus[best_id]["name"], "ingredients": []}
        adds: dict[int, dict] = {}
        for ln in lines:
            if not ln["have"] or ln["basic"]:
                continue
            if base and ln["ingredient_id"] in menu_sets[base["id"]]:
                ln["from_menu"] = {"id": base["id"], "name": base["name"]}
                base["ingredients"].append(ln["ingredient"])
            elif ln["from_menu"]:
                a = adds.setdefault(ln["from_menu"]["id"], {"id": ln["from_menu"]["id"], "name": ln["from_menu"]["name"], "ingredients": []})
                a["ingredients"].append(ln["ingredient"])
            else:
                a = adds.setdefault(0, {"id": None, "name": None, "ingredients": []})  # 식자재에는 있지만 아직 메뉴에 안 쓰는 것
                a["ingredients"].append(ln["ingredient"])
        add_list = sorted(adds.values(), key=lambda a: (a["id"] is None, -len(a["ingredients"])))
        side_cat = rec["category"] in ("반찬", "사이드")
        # 사이드(값싼 국·반찬)에 쓰던 재료로 메인 메뉴를 만드는 조합이면 더 앞에(예: 콩나물국의 콩나물 → 콩나물불고기)
        from_side = not side_cat and any(
            a["id"] and ("사이드" in (menus[a["id"]]["category"] or "") or 0 < (menus[a["id"]]["price"] or 0) <= 3000) for a in add_list)
        real_adds = [a for a in add_list if a["id"]]
        score = (100 * have / mains - 18 * len(missing) + 7 * min(len(real_adds), 3) + 4 * min(len(core_used), 3)
                 - (8 if not add_list and not missing else 0) + (16 if from_side else 0) - (12 if side_cat else 0))
        sources = ([base] if base else []) + real_adds
        cost = sum(ln["cost"] or 0 for ln in lines)
        unknown = [ln["name"] for ln in lines if ln["cost"] is None and not ln["basic"]]
        price = None
        if cost > 0 and target > 0:
            basis = cost / (target / 100.0)
            price = _round_price(basis * 1.1 if vat == "excl" else basis)
        b = basis_price(price, vat) if price else 0
        if price and price < 5000 and not side_cat:
            score -= 8  # 한 끼 메인으로는 너무 싼 것(콩나물밥 3천 원 같은)은 조금 뒤로
        ideas.append({
            "name": rec["name"], "category": rec["category"], "pitch": rec["pitch"], "src": rec["src"],
            "lines": lines, "missing": missing, "have": have, "mains": mains,
            "sources": sources, "base": base, "adds": add_list,
            "core_used": core_used, "score": round(score, 1), "from_side": from_side,
            "cost": round(cost), "cost_approx": any(ln["approx"] for ln in lines), "cost_unknown": unknown,
            "price": price, "ratio": round(cost / b * 100, 1) if b > 0 else None,
        })
    ideas.sort(key=lambda x: (len(x["missing"]), -x["score"], x["name"]))

    def pick(group: list[dict], n: int) -> list[dict]:
        # 한 분류(찌개·볶음…)로 몰리지 않게 같은 분류는 3개까지
        out, per_cat = [], defaultdict(int)
        for x in group:
            if per_cat[x["category"]] >= 3:
                continue
            per_cat[x["category"]] += 1
            out.append(x)
            if len(out) >= n:
                break
        return out

    ready = pick([x for x in ideas if not x["missing"]], 8)
    almost = pick([x for x in ideas if x["missing"]], max(0, limit - len(ready)) or 4)
    return {
        "items": ready + almost,
        "summary": {
            "ingredient_count": len(raw), "menu_count": len(menus), "target": target,
            "ready": len(ready), "almost": len(almost), "candidates": len(ideas), "checked": n_recipes,
        },
    }
