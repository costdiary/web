"""tests/fixtures/meat_store.json 가게를 API로 만든다(재료 연결표·메뉴 추천 테스트용)."""
import json
from datetime import date, timedelta
from pathlib import Path

H = {"X-Requested-With": "fetch"}
DATA = json.loads((Path(__file__).parent / "fixtures" / "meat_store.json").read_text(encoding="utf-8"))


def build(c, with_sales=True):
    ids, kinds = {}, {}
    for name, size, unit, price, cat in DATA["ingredients"]:
        r = c.post("/api/ingredients", json={"name": name, "pack_size": size, "pack_unit": unit, "pack_price": price, "category": cat}, headers=H)
        assert r.status_code == 200, r.text
        ids[name] = r.json()["item"]["id"]
        kinds[name] = r.json()["item"]["kind"]
    for name, kind, yq, yu, items in DATA["preps"]:
        r = c.post("/api/preps", json={"name": name, "unit_kind": kind, "yield_qty": yq, "yield_unit": yu,
                                       "items": [{"ingredient_id": ids[n], "qty": q, "unit": {"g": "g", "ml": "ml", "ea": "개"}[kinds[n]]} for n, q in items]}, headers=H)
        assert r.status_code == 200, r.text
    ings = {i["name"]: i["id"] for i in c.get("/api/ingredients", headers=H).json()["items"]}
    menus = {}
    for name, price, cat, items, _sold in DATA["menus"]:
        r = c.post("/api/menus", json={"name": name, "price": price, "category": cat,
                                       "items": [{"ingredient_id": ings[n], "qty": q, "unit": u} for n, q, u in items]}, headers=H)
        assert r.status_code == 200, r.text
        menus[name] = r.json()["item"]["id"]
    if with_sales:
        for name, *_rest, sold in DATA["menus"]:
            for k, part in enumerate((0.4, 0.35, 0.25)):
                day = (date.today() - timedelta(days=3 + k * 7)).isoformat()
                r = c.put("/api/sales/items", json={"day": day, "menu_id": menus[name], "qty": round(sold * part)}, headers=H)
                assert r.status_code == 200, r.text
    return ings, menus
