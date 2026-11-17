"""메뉴 원가·마진 계산과 단가 상승 영향 분석.

모든 수량은 기본 단위(g / ml / 개)로 저장하고, 단가도 기본 단위당 원(₩)입니다.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

from . import channels as channels_mod
from . import units
from .db import parse_iso


def eff_unit_cost(unit_price: float, yield_pct: float | None) -> float:
    """수율(다듬고 남는 비율)을 반영한 실제 단가. 수율 90%면 단가를 0.9로 나눕니다."""
    y = (yield_pct or 100.0) / 100.0
    return unit_price / y if y > 0 else unit_price


def basis_price(price: float, vat_mode: str) -> float:
    """원가율 계산에 쓰는 판매가. 'excl'이면 부가세(10%)를 뺀 공급가."""
    return price / 1.1 if vat_mode == "excl" else price


def round_up(x: float, step: int = 100) -> int:
    return int(math.ceil(x / step - 1e-9) * step)


def status_for(ratio: float | None, target: float) -> str:
    """양호 / 주의(목표+5%p 이내) / 위험."""
    if ratio is None:
        return "unknown"
    if ratio <= target + 1e-9:
        return "good"
    if ratio <= target + 5.0:
        return "warn"
    return "bad"


def channel_result(cost: float, sale: float, ch: dict, target: float, vat_mode: str) -> dict:
    """배달앱 한 곳에서 팔 때의 한 건 손익.

    cost  = 재료비 + 기타 원가(배달 포장비는 채널 설정에서 따로 더합니다)
    sale  = 그 앱에서 받는 판매가(고객이 내는 금액)
    수수료·배달비는 앱이 '부가세 별도'로 안내하므로 vat_extra 이면 10%를 더해 비용으로 잡습니다.
    실수령액 = (부가세 반영한) 매출 - 중개이용료 - 결제수수료 - 배달비 - 사장님 부담 쿠폰
    배달 원가율 = (재료비 + 포장비) / 실수령액. 목표 원가율과 같은 잣대로 도장을 찍습니다.
    """
    k = 1.0 / 1.1 if vat_mode == "excl" else 1.0
    # 공급가 기준(excl)이면 수수료·배달비에 붙는 부가세는 매입세액으로 돌려받는 돈이라 비용에서 뺍니다.
    # (매출도 부가세를 뺀 값으로 보기 때문에 양쪽이 같은 기준이 됩니다.) 쿠폰은 소비자가에서 깎이므로 /1.1.
    vatf = 1.1 if (ch.get("vat_extra", True) and vat_mode != "excl") else 1.0
    fee_pct, pay_pct = float(ch["fee_pct"]), float(ch["pay_pct"])
    fee_amt = sale * fee_pct / 100.0 * vatf
    pay_amt = sale * pay_pct / 100.0 * vatf
    deliv_amt = float(ch["delivery_fee"]) * vatf
    coupon = float(ch["coupon_cost"]) * k
    charges = fee_amt + pay_amt + deliv_amt + coupon
    total_cost = cost + float(ch["pack_cost"])

    revenue = sale * k if sale > 0 else None
    net = revenue - charges if revenue is not None else None
    profit = net - total_cost if net is not None else None
    ratio = total_cost / net * 100.0 if (net is not None and net > 0) else None
    if sale <= 0:
        status = "unknown"
    elif ratio is None:
        status = "bad"  # 받는 돈이 0 이하
    else:
        status = status_for(ratio, target)

    a = (fee_pct + pay_pct) / 100.0 * vatf
    recommended = None
    if total_cost > 0 and target > 0 and (k - a) > 1e-9:
        recommended = round_up((total_cost / (target / 100.0) + deliv_amt + coupon) / (k - a))

    items = []
    if fee_amt:
        items.append({"label": f"중개이용료 {channels_mod.fmt_pct(fee_pct)}%", "amount": round(fee_amt)})
    if pay_amt:
        items.append({"label": f"결제수수료 {channels_mod.fmt_pct(pay_pct)}%", "amount": round(pay_amt)})
    if deliv_amt:
        items.append({"label": "사장님 부담 배달비", "amount": round(deliv_amt)})
    if coupon:
        items.append({"label": "쿠폰·할인 부담", "amount": round(coupon)})
    return {
        "key": ch["key"],
        "short": ch["short"],
        "label": ch["label"],
        "kind": ch["kind"],
        "sale_price": sale,
        "charges": round(charges),
        "fee_items": items,
        "vat_extra": bool(ch.get("vat_extra", True)),
        "net": round(net) if net is not None else None,
        "cost": round(total_cost),
        "profit": round(profit) if profit is not None else None,
        "net_ratio": round(ratio, 1) if ratio is not None else None,
        "status": status,
        "recommended_price": recommended,
        "price_gap": (recommended - sale) if (recommended is not None and sale > 0) else None,
    }


def compute_menu(menu: dict, items: list[dict], target: float, vat_mode: str, chans: list[dict] | None = None) -> dict:
    lines = []
    parts = 0.0
    parts_low = 0.0
    parts_high = 0.0
    est_n = 0
    missing: list[str] = []
    for it in items:
        up = it["unit_price"]
        est = bool(it.get("estimated"))
        lo_b = it.get("qty_low") if est else None
        hi_b = it.get("qty_high") if est else None
        if up is None:
            missing.append(it["name"])
            unit_cost, cost = None, 0.0
            low_c = high_c = 0.0
        else:
            unit_cost = eff_unit_cost(up, it["yield_pct"])
            cost = it["qty"] * unit_cost
            low_c = (lo_b if lo_b is not None else it["qty"]) * unit_cost
            high_c = (hi_b if hi_b is not None else it["qty"]) * unit_cost
        parts += cost
        parts_low += low_c
        parts_high += high_c
        est_n += 1 if est else 0
        qv, qu = units.pretty_qty(it["unit_kind"], it["qty"])
        factor = units.BASE_OF[qu][1]
        lines.append(
            {
                "ingredient_id": it["ingredient_id"],
                "name": it["name"],
                "kind": it["unit_kind"],
                "qty_base": it["qty"],
                "qty": qv,
                "unit": qu,
                "unit_cost": unit_cost,
                "cost": round(cost, 2),
                "estimated": est,
                "qty_low_base": lo_b,
                "qty_high_base": hi_b,
                "qty_low": round(lo_b / factor, 3) if lo_b is not None else None,
                "qty_high": round(hi_b / factor, 3) if hi_b is not None else None,
            }
        )
    other = float(menu.get("other_cost") or 0.0)
    cost_total = parts + other
    for ln in lines:
        ln["share_pct"] = round(ln["cost"] / cost_total * 100.0, 1) if cost_total > 0 else 0.0

    price = float(menu.get("price") or 0.0)
    basis = basis_price(price, vat_mode)
    ratio = (cost_total / basis * 100.0) if basis > 0 else None
    margin = (basis - cost_total) if basis > 0 else None
    recommended = None
    if cost_total > 0 and target > 0:
        need = cost_total / (target / 100.0)
        recommended = round_up(need * (1.1 if vat_mode == "excl" else 1.0))

    # 사진으로 추정한 양이 들어 있으면 원가가 얼마에서 얼마 사이일지 범위도 함께 돌려줍니다.
    cost_low = cost_high = ratio_low = ratio_high = None
    if est_n:
        cost_low, cost_high = parts_low + other, parts_high + other
        if basis > 0:
            ratio_low, ratio_high = round(cost_low / basis * 100.0, 1), round(cost_high / basis * 100.0, 1)
        cost_low, cost_high = round(cost_low, 2), round(cost_high, 2)

    explicit = float(menu.get("delivery_price") or 0.0)
    sale = explicit if explicit > 0 else price
    delivery = None
    if chans:
        delivery = {
            "sale_price": sale,
            "explicit": explicit > 0,
            "channels": [],
        }
        for ch in chans:
            r = channel_result(cost_total, sale, ch, target, vat_mode)
            if est_n and cost_low is not None:  # 추정한 양이 있으면 남는 돈도 범위로 알려 줍니다.
                best = channel_result(cost_low, sale, ch, target, vat_mode)["profit"]
                worst = channel_result(cost_high, sale, ch, target, vat_mode)["profit"]
                if best is not None and worst is not None:
                    r["profit_low"], r["profit_high"] = worst, best
            if missing:  # 단가 없는 재료가 있으면 원가가 빠져 있으니 '양호' 도장을 찍지 않습니다.
                r["incomplete"] = True
                r["status"] = "unknown"
            delivery["channels"].append(r)
    return {
        "id": menu["id"],
        "name": menu["name"],
        "category": menu.get("category", ""),
        "note": menu.get("note", ""),
        "price": price,
        "delivery_price": explicit if explicit > 0 else None,
        "other_cost": other,
        "cost": round(cost_total, 2),
        "cost_ratio": round(ratio, 1) if ratio is not None else None,
        "margin": round(margin) if margin is not None else None,
        "margin_pct": round(100.0 - ratio, 1) if ratio is not None else None,
        "status": status_for(ratio, target),
        "recommended_price": recommended,
        "price_gap": (recommended - price) if (recommended is not None and price > 0) else None,
        "incomplete": bool(missing),
        "missing": missing,
        "item_count": len(items),
        "estimated_count": est_n,
        "cost_low": cost_low,
        "cost_high": cost_high,
        "ratio_low": ratio_low,
        "ratio_high": ratio_high,
        "delivery": delivery,
        "lines": lines,
    }


def load_menus(db, user: dict, menu_id: int | None = None, chans: list[dict] | None = None) -> list[tuple[dict, list[dict]]]:
    """(계산된 메뉴, 원본 재료 줄) 목록. menu_id를 주면 그 메뉴 하나만. chans를 안 주면 켜 둔 배달앱을 읽어 옵니다."""
    uid = user["id"]
    if chans is None:
        chans = channels_mod.load_enabled(db, uid)
    if menu_id is None:
        rows = db.execute("SELECT * FROM menus WHERE user_id = ? ORDER BY name", (uid,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM menus WHERE user_id = ? AND id = ?", (uid, menu_id)).fetchall()
    menus = [dict(r) for r in rows]
    if not menus:
        return []
    ids = [m["id"] for m in menus]
    marks = ",".join("?" * len(ids))
    item_rows = db.execute(
        "SELECT mi.id AS row_id, mi.menu_id, mi.ingredient_id, mi.qty, mi.position, mi.estimated, mi.qty_low, mi.qty_high, "
        "i.name, i.unit_kind, i.unit_price, i.yield_pct "
        "FROM menu_items mi JOIN ingredients i ON i.id = mi.ingredient_id "
        f"WHERE mi.menu_id IN ({marks}) ORDER BY mi.menu_id, mi.position, mi.id",
        ids,
    ).fetchall()
    by_menu: dict[int, list[dict]] = defaultdict(list)
    for r in item_rows:
        by_menu[r["menu_id"]].append(dict(r))
    target, vat = user["target_cost_ratio"], user["vat_mode"]
    return [(compute_menu(m, by_menu[m["id"]], target, vat, chans), by_menu[m["id"]]) for m in menus]


def build_alerts(user: dict, pairs: list[tuple[dict, list[dict]]], changes: dict[int, dict], window_days: int = 30) -> list[dict]:
    """최근 단가가 기준 이상 오른 식자재와, 그 때문에 원가율이 얼마나 오른 메뉴가 있는지."""
    vat = user["vat_mode"]
    threshold = user["alert_pct"]
    now = datetime.now(timezone.utc)
    uses: dict[int, list[tuple[dict, dict]]] = defaultdict(list)
    for mv, items in pairs:
        for it in items:
            uses[it["ingredient_id"]].append((mv, it))

    alerts = []
    for iid, ch in changes.items():
        if ch["pct"] is None or ch["pct"] < threshold:
            continue
        at = parse_iso(ch["at"])
        if at is None or (now - at).days > window_days:
            continue
        impacts = []
        for mv, it in uses.get(iid, []):
            basis = basis_price(mv["price"], vat)
            if basis <= 0:
                continue
            delta = it["qty"] * (
                eff_unit_cost(ch["price"], it["yield_pct"]) - eff_unit_cost(ch["prev"], it["yield_pct"])
            )
            after = mv["cost"] / basis * 100.0
            before = (mv["cost"] - delta) / basis * 100.0
            impacts.append(
                {
                    "menu_id": mv["id"],
                    "name": mv["name"],
                    "ratio_before": round(before, 1),
                    "ratio_after": round(after, 1),
                    "delta_pp": round(after - before, 2),
                    "cost_delta": round(delta, 1),
                    "status": mv["status"],
                }
            )
        impacts.sort(key=lambda x: -x["delta_pp"])
        price_disp, unit_disp = units.display_price(ch["kind"], ch["price"])
        prev_disp, _ = units.display_price(ch["kind"], ch["prev"])
        alerts.append(
            {
                "ingredient_id": iid,
                "name": ch["name"],
                "unit": unit_disp,
                "price": round(price_disp, 1),
                "prev_price": round(prev_disp, 1),
                "change_pct": round(ch["pct"], 1),
                "changed_at": ch["at"],
                "impacts": impacts,
            }
        )
    alerts.sort(key=lambda a: (-(a["impacts"][0]["delta_pp"] if a["impacts"] else 0.0), -a["change_pct"]))
    return alerts


# ------------------------------------------------------------------ 손익분기

def contribution(menu_views: list[dict]) -> dict:
    """메뉴들의 '판매가 1원당 남는 돈'(공헌이익률)을 매장·배달로 나눠 구합니다.
    메뉴 판매 비중을 모르므로 모든 메뉴를 같은 비중으로 봅니다. 단가가 빠진 메뉴는 원가가 모자라 계산에서 뺍니다."""
    m_sum = p_sum = 0.0
    used = skipped = 0
    d_profit = d_sale = 0.0
    for mv in menu_views:
        price = mv.get("price") or 0
        if price <= 0 or mv.get("margin") is None:
            continue
        if mv.get("incomplete"):
            skipped += 1
            continue
        used += 1
        m_sum += mv["margin"]
        p_sum += price
        dl = mv.get("delivery")
        if dl and dl["channels"]:
            chs = [c for c in dl["channels"] if c["profit"] is not None]
            if chs:
                d_profit += sum(c["profit"] for c in chs) / len(chs)
                d_sale += dl["sale_price"]
    return {
        "cm_store": (m_sum / p_sum) if p_sum > 0 else None,
        "cm_delivery": (d_profit / d_sale) if d_sale > 0 else None,
        "avg_price": (p_sum / used) if used else None,
        "menu_used": used, "menu_skipped": skipped,
    }


def breakeven(fixed: float, target_profit: float, delivery_share: float, cm_store, cm_delivery, avg_price, open_days: int, pay_fee_pct: float = 0.0) -> dict:
    """손익분기 매출 = 고정비 ÷ 공헌이익률. 목표 이익을 더하면 목표 매출.
    공헌이익률 = (1-배달비중) x (매장 공헌이익률 - 결제수수료율) + 배달비중 x 배달 공헌이익률. 배달 데이터가 없으면 매장 값을 씁니다."""
    d = min(max(delivery_share, 0.0), 100.0) / 100.0
    if cm_store is None:
        return {"cm": None, "breakeven_sales": None, "target_sales": None, "daily_breakeven": None, "daily_target": None, "orders_breakeven": None, "orders_target": None}
    store = cm_store - pay_fee_pct / 100.0
    deliv = cm_delivery if cm_delivery is not None else store
    cm = (1 - d) * store + d * deliv
    out = {"cm": cm, "breakeven_sales": None, "target_sales": None, "daily_breakeven": None, "daily_target": None, "orders_breakeven": None, "orders_target": None}
    if cm <= 1e-9:
        return out
    be = fixed / cm
    tg = (fixed + target_profit) / cm
    days = max(1, int(open_days))
    out.update(
        breakeven_sales=round(be), target_sales=round(tg), daily_breakeven=round(be / days), daily_target=round(tg / days),
        orders_breakeven=math.ceil(be / avg_price - 1e-9) if avg_price else None,
        orders_target=math.ceil(tg / avg_price - 1e-9) if avg_price else None,
    )
    return out
