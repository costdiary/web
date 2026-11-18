"""배달앱(배민·쿠팡이츠) 주문건 연동.

실제 파트너 API 키가 없는 지금은 예시 주문을 만들어 화면과 계산 틀을 확인할 수 있게 한다.
나중에 BAEMIN_API_KEY/COUPANGEATS_API_KEY가 생기면 fetch_orders의 모의 분기를 실제 호출로
바꾸기만 하면 되고, 저장·연결·화면 쪽 코드는 그대로 쓸 수 있다.
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone

from . import costing
from .db import now_iso

PLATFORMS = {"baemin": "배달의민족", "coupangeats": "쿠팡이츠"}

_MOCK_FEE = {"commission_pct": 7.8, "payment_pct": 3.0, "delivery_fee": 3400}
_MOCK_AMOUNTS = [8900, 9500, 11000, 12500, 15000, 18000]


def _mock_orders(uid: int, platform: str, menu_names: list[str], n: int = 20) -> list[dict]:
    """예시 주문 n건. 사장님·플랫폼마다 시드를 고정해, 다시 가져와도 같은 틀이 나오게 한다."""
    seed = int(hashlib.sha1(f"{uid}:{platform}".encode()).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)
    names = menu_names or ["예시 메뉴"]
    now = datetime.now(timezone.utc)
    out = []
    for i in range(n):
        name = rng.choice(names)
        amount = rng.choice(_MOCK_AMOUNTS)
        at = now - timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 23))
        ad = round(amount * 0.02) if rng.random() < 0.3 else 0  # 30%는 광고로 들어온 주문으로 가정
        out.append({
            "external_order_id": f"mock-{platform}-{i}",
            "menu_name": name,
            "order_amount": amount,
            "commission_fee": round(amount * _MOCK_FEE["commission_pct"] / 100),
            "payment_fee": round(amount * _MOCK_FEE["payment_pct"] / 100),
            "delivery_fee": _MOCK_FEE["delivery_fee"],
            "ad_fee": ad,
            "ordered_at": at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    return out


def fetch_orders(db, uid: int, platform: str) -> list[dict]:
    """지금은 항상 예시 주문. 실제 연동 키가 생기면 여기만 그 플랫폼의 파트너 API 호출로 바꾼다."""
    menu_names = [r["name"] for r in db.execute("SELECT name FROM menus WHERE user_id = ?", (uid,)).fetchall()]
    return _mock_orders(uid, platform, menu_names)


def sync_platform(db, uid: int, platform: str) -> int:
    """주문을 가져와 저장하고(이미 있는 건 건너뜀) 메뉴 연결·손익을 다시 계산한다. 새로 들어온 건수를 돌려준다."""
    rows = fetch_orders(db, uid, platform)
    added = 0
    for r in rows:
        exists = db.execute(
            "SELECT id FROM orders WHERE user_id=? AND platform=? AND external_order_id=?",
            (uid, platform, r["external_order_id"]),
        ).fetchone()
        if exists:
            continue
        db.execute(
            "INSERT INTO orders(user_id, platform, external_order_id, menu_name, order_amount, "
            "commission_fee, payment_fee, delivery_fee, ad_fee, ordered_at, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,'mock')",
            (uid, platform, r["external_order_id"], r["menu_name"], r["order_amount"],
             r["commission_fee"], r["payment_fee"], r["delivery_fee"], r["ad_fee"], r["ordered_at"]),
        )
        added += 1
    db.execute(
        "INSERT INTO order_platforms(user_id, platform, connected, connected_at) VALUES (?,?,1,?) "
        "ON CONFLICT(user_id, platform) DO UPDATE SET connected=1, connected_at=excluded.connected_at",
        (uid, platform, now_iso()),
    )
    recompute_costs(db, uid)
    return added


def recompute_costs(db, uid: int) -> None:
    """저장된 주문을 메뉴 이름으로 연결하고(같은 이름의 메뉴가 있으면), 재료비·순이익·마진율을 다시 계산한다.
    메뉴 이름은 유니크 제약이 없어 같은 이름을 가진 메뉴가 둘 이상일 수 있다. 그런 이름은 어느 메뉴를
    가리키는지 알 수 없으므로 자동 연결하지 않는다(엉뚱한 메뉴의 원가로 잘못 집계되는 것보다,
    '미인식'으로 남겨 두는 쪽이 안전하다)."""
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not user:
        return
    name_counts: dict[str, int] = {}
    menus_by_name: dict[str, int] = {}
    for m in db.execute("SELECT id, name FROM menus WHERE user_id = ?", (uid,)).fetchall():
        name_counts[m["name"]] = name_counts.get(m["name"], 0) + 1
        menus_by_name[m["name"]] = m["id"]
    for name, count in name_counts.items():
        if count > 1:
            menus_by_name.pop(name, None)
    cost_by_menu = {mv["id"]: mv["cost"] for mv, _ in costing.load_menus(db, user)}
    for o in db.execute("SELECT * FROM orders WHERE user_id = ?", (uid,)).fetchall():
        mid = menus_by_name.get(o["menu_name"])
        cost = cost_by_menu.get(mid) if mid else None
        net = margin = None
        if cost is not None:
            charges = o["commission_fee"] + o["payment_fee"] + o["delivery_fee"] + o["ad_fee"]
            net = o["order_amount"] - charges - cost
            margin = round(net / o["order_amount"] * 100, 1) if o["order_amount"] else None
        db.execute(
            "UPDATE orders SET menu_id=?, ingredient_cost=?, net_profit=?, margin_pct=? WHERE id=?",
            (mid, cost, net, margin, o["id"]),
        )
