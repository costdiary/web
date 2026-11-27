"""체험용 예시 데이터(가상의 한식당). 단가·메뉴는 실제 시세가 아니라 화면을 써보기 위한 예시입니다."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import units
from .db import ISO, transaction

# 이름, 거래처, 분류, 규격 수량, 규격 단위, 수율(%), 마지막 확인이 며칠 전인지(None이면 마지막 이력 시점), 가격 이력[(며칠 전, 구매가)]
INGREDIENTS = [
    ("돼지 앞다리살", "한우리유통", "육류", 1, "kg", 100, None, [(62, 9800), (34, 9600), (8, 10800)]),
    ("돼지 등심", "한우리유통", "육류", 5, "kg", 100, None, [(60, 42000), (7, 44500)]),
    ("배추김치", "맛촌식품", "반찬", 10, "kg", 100, 3, [(45, 36000)]),
    ("양파", "청과도매", "채소", 15, "kg", 90, None, [(60, 16000), (30, 17000), (6, 18500)]),
    ("대파", "청과도매", "채소", 1, "kg", 85, None, [(40, 3200), (5, 3900)]),
    ("다진 마늘", "청과도매", "양념", 1, "kg", 100, None, [(50, 8500), (9, 9200)]),
    ("고춧가루", "맛촌식품", "양념", 1, "kg", 100, None, [(62, 24000)]),
    ("간장", "맛촌식품", "양념", 1.8, "L", 100, 20, [(70, 6500)]),
    ("두부", "맛촌식품", "가공", 1, "개", 100, None, [(30, 1700), (10, 1800)]),
    ("달걀", "청과도매", "계란", 30, "개", 100, None, [(50, 7200), (14, 7000)]),
    ("식용유", "한우리유통", "유지", 18, "L", 100, None, [(55, 48000), (20, 50500), (5, 53500)]),
    ("쌀", "미곡상", "곡류", 20, "kg", 100, None, [(60, 54000), (12, 56000)]),
    ("빵가루", "맛촌식품", "가공", 1, "kg", 100, 10, [(40, 3600)]),
    ("포장 용기", "포장나라", "포장", 100, "개", 100, 15, [(30, 25000)]),
]

# 메뉴명, 판매가, 분류, 기타 원가(반찬·소스·포장 등), [(식자재, 기본 단위 수량)]
MENUS = [
    ("김치찌개", 10000, "찌개", 300, [("배추김치", 200), ("돼지 앞다리살", 100), ("두부", 0.5), ("대파", 25), ("양파", 40), ("고춧가루", 4), ("다진 마늘", 8), ("쌀", 210)]),
    ("제육볶음", 9500, "볶음", 400, [("돼지 앞다리살", 220), ("양파", 60), ("대파", 20), ("다진 마늘", 10), ("고춧가루", 8), ("간장", 20), ("식용유", 10), ("쌀", 210)]),
    ("돈까스", 10000, "튀김", 400, [("돼지 등심", 150), ("빵가루", 30), ("달걀", 0.5), ("식용유", 80), ("쌀", 210)]),
    ("계란말이", 7000, "사이드", 200, [("달걀", 4), ("대파", 20), ("양파", 30), ("식용유", 15)]),
    ("두부김치", 14000, "안주", 300, [("배추김치", 150), ("돼지 앞다리살", 150), ("두부", 1), ("양파", 30), ("대파", 15), ("식용유", 10)]),
]


def seed_demo(db, user: dict) -> None:
    uid = user["id"]
    has_ing = db.execute("SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ?", (uid,)).fetchone()["c"]
    has_menu = db.execute("SELECT COUNT(*) AS c FROM menus WHERE user_id = ?", (uid,)).fetchone()["c"]
    if has_ing or has_menu:
        raise ValueError("이미 등록된 데이터가 있어 예시 데이터를 넣을 수 없습니다.")

    now = datetime.now(timezone.utc)

    def ts(days: int) -> str:
        return (now - timedelta(days=days)).strftime(ISO)

    ids: dict[str, int] = {}
    with transaction(db):
        for name, supplier, category, size, unit, yld, checked, hist in INGREDIENTS:
            kind, base_qty = units.to_base(size, unit)
            last_days, last_price = hist[-1]
            cur = db.execute(
                "INSERT INTO ingredients(user_id, name, unit_kind, unit_price, yield_pct, supplier, category, "
                "pack_size, pack_unit, pack_price, price_checked_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (uid, name, kind, last_price / base_qty, yld, supplier, category, size, unit, last_price,
                 ts(checked if checked is not None else last_days), ts(last_days)),
            )
            iid = cur.lastrowid
            ids[name] = iid
            for days, pack_price in hist:
                db.execute(
                    "INSERT INTO price_history(ingredient_id, user_id, unit_price, pack_size, pack_unit, pack_price, source, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (iid, uid, pack_price / base_qty, size, unit, pack_price, "seed", ts(days)),
                )
        for name, price, category, other, items in MENUS:
            cur = db.execute(
                "INSERT INTO menus(user_id, name, price, category, other_cost, updated_at) VALUES (?,?,?,?,?,?)",
                (uid, name, price, category, other, ts(0)),
            )
            mid = cur.lastrowid
            for pos, (iname, qty) in enumerate(items):
                db.execute(
                    "INSERT INTO menu_items(menu_id, ingredient_id, qty, position) VALUES (?,?,?,?)",
                    (mid, ids[iname], qty, pos),
                )
        # 예시 데이터는 사장님이 새로 추가한 게 아니라서 NEW 표시를 붙이지 않는다(db.py v22 트리거가 채운 값 비우기).
        db.execute("UPDATE ingredients SET created_at = NULL WHERE user_id = ?", (uid,))
