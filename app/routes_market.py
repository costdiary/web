"""도매 마켓 — 사장님 쪽 API. 전부 `current_user`(만료된 계정도 opt-out·조회 가능, G9)이고,
품목 매핑 저장/해제만 `writable_user`입니다. 계산은 app/market.py, 여기는 얇은 핸들러만 둡니다."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from . import market, market_catalog
from .db import get_db, now_iso, transaction
from .deps import current_user, writable_user
from .schemas import ConnectIn, MarketBulkMapIn, MarketItemRequestIn, MarketMapIn, MarketSettingsIn, OutcomeIn

router = APIRouter(prefix="/api/market")


def _settings_payload(db, uid: int) -> dict:
    st = market.get_buyer_settings(db, uid)
    mapped = db.execute(
        "SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ? AND mk_item_id IS NOT NULL AND origin IS NOT NULL",
        (uid,),
    ).fetchone()["c"]
    exposed = db.execute(
        "SELECT COUNT(*) AS c FROM mk_demand_signals WHERE user_id = ? AND active = 1", (uid,)
    ).fetchone()["c"]
    return {
        "notice_required": not bool(st["notice_ack_at"]),
        "demand_optin": bool(st["demand_optin"]),
        "ad_optin": bool(st["ad_optin"]),
        "threshold_pct": st["threshold_pct"],
        "region_code": st["region_code"],
        "regions": [{"code": c, "label": lbl} for c, lbl in market_catalog.REGIONS.items()],
        "min_buyers": market.K_MIN(),
        "summary": {"mapped_items": mapped, "exposed_items": exposed},
    }


def market_me_summary(db, uid: int) -> dict:
    """GET /api/me의 `market` 섹션(상단 알림 배지·첫 접속 모달 판단용)."""
    st = market.get_buyer_settings(db, uid)
    unread_offers = db.execute(
        "SELECT COUNT(*) AS c FROM mk_matches WHERE user_id = ? AND status = 'new'", (uid,)
    ).fetchone()["c"]
    unread_deals = db.execute(
        "SELECT COUNT(*) AS c FROM ws_ad_deliveries WHERE user_id = ? AND status = 'new'", (uid,)
    ).fetchone()["c"]
    return {
        "notice_required": not bool(st["notice_ack_at"]),
        "unread_offers": unread_offers,
        "unread_deals": unread_deals,
    }


@router.get("/settings")
def get_settings(user: dict = Depends(current_user), db=Depends(get_db)):
    return _settings_payload(db, user["id"])


@router.put("/settings")
def put_settings(body: MarketSettingsIn, user: dict = Depends(current_user), db=Depends(get_db)):
    if body.region_code is not None and body.region_code not in market_catalog.REGIONS:
        raise HTTPException(400, "권역을 다시 선택해 주세요.")
    with transaction(db):
        market.update_buyer_settings(
            db, user["id"],
            demand_optin=body.demand_optin, ad_optin=body.ad_optin, threshold_pct=body.threshold_pct,
            region_code=body.region_code, ack_notice=body.ack_notice,
        )
    return _settings_payload(db, user["id"])


@router.get("/catalog")
def get_catalog(q: str = "", unit_kind: str = "", user: dict = Depends(current_user), db=Depends(get_db)):
    items = market.search_catalog(db, q, unit_kind=unit_kind or None)
    return {
        "items": [
            {"id": i["id"], "name": i["name"], "category": i["category"],
             "category_group": market_catalog.CATEGORY_GROUPS.get(i["category"], i["category"]), "unit_kind": i["unit_kind"]}
            for i in items
        ],
        "origins": [{"code": c, "label": lbl} for c, lbl in market_catalog.ORIGINS.items()],
        "grades": {cat: [{"code": c, "label": lbl} for c, lbl in grades] for cat, grades in market_catalog.GRADES.items()},
        "categories": [{"code": c, "label": c, "group": market_catalog.CATEGORY_GROUPS.get(c, c)} for c in market_catalog.GRADES],
    }


@router.get("/terms")
def get_terms(kind: Literal["category", "grade", "cut"], q: str = Query("", max_length=40), category: str = Query("", max_length=30),
              user: dict = Depends(current_user), db=Depends(get_db)):
    """분류·등급·부위 자동완성(타자 칠 때마다 호출). 시드 + 사장님들이 실제로 쓴 값 — 자유 입력은 그대로 허용."""
    return {"terms": market.search_terms(db, user["id"], kind, q.strip(), category.strip())}


@router.get("/item-requests")
def list_item_requests(user: dict = Depends(current_user), db=Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM mk_item_requests WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)
    ).fetchall()
    return {"requests": [dict(r) for r in rows]}


@router.post("/item-requests")
def create_item_request(body: MarketItemRequestIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    """카탈로그에 없는 품목을 제안한다. 비슷한 품목이 이미 있으면(``confirm`` 없이는) 등록하지 않고
    그 품목을 알려줘서, 사장님이 그걸 고르거나 '그래도 새로 등록' 중 고르게 한다(중복 생성 방지)."""
    db_item = market.find_similar_catalog_item(db, body.name, body.unit_kind)
    if db_item and not body.confirm:
        return {
            "created": False,
            "duplicate_candidate": {"id": db_item["id"], "name": db_item["name"], "category": db_item["category"]},
        }
    db.execute(
        "INSERT INTO mk_item_requests(user_id, name, norm_name, unit_kind, note, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)",
        (user["id"], body.name, market_catalog.norm(body.name), body.unit_kind, body.note, now_iso()),
    )
    return {"created": True}


def _why_hidden(ing: dict, st: dict, sig, item: dict | None) -> str:
    # 표준 품목을 사람이 "고르는" 단계가 없어져서, mk_item_id는 origin만 있으면 항상 채워진다.
    # 그래서 "unmapped"는 사실상 "원산지가 없어서"와 동치가 됐다.
    if not (ing["mk_item_id"] and ing["origin"]):
        return "unmapped"
    if item and item.get("match_mode") == "brand":
        return "brand_sensitive"
    if not st["demand_optin"]:
        return "optout"
    if not st["region_code"] or not st["notice_ack_at"]:
        return "no_region"
    if not sig or not sig["active"]:
        return "stale"
    return ""


@router.get("/ingredients")
def list_ingredients(user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    st = market.get_buyer_settings(db, uid)
    items = {r["id"]: dict(r) for r in db.execute("SELECT * FROM mk_items WHERE active = 1")}
    sigs = {r["ingredient_id"]: r for r in db.execute("SELECT * FROM mk_demand_signals WHERE user_id = ?", (uid,))}
    out = []
    for ing in db.execute("SELECT * FROM ingredients WHERE user_id = ? ORDER BY name", (uid,)).fetchall():
        ing = dict(ing)
        item = items.get(ing["mk_item_id"]) if ing["mk_item_id"] else None
        # 표준 품목을 사람이 고르는 개념이 없어져서(이름이 있으면 항상 자동 매핑) '추천'은 더 이상
        # 의미가 없다. 필드는 하위 호환을 위해 남겨 두고 항상 null을 준다.
        suggest = None
        sig = sigs.get(ing["id"])
        out.append({
            "ingredient_id": ing["id"],
            "name": ing["name"],
            "item": {"id": item["id"], "name": item["name"]} if item else None,
            "origin": ing["origin"],
            "grade": ing["grade"],
            "cut": ing["cut"],
            "category": ing["category"],
            "suggest": suggest,
            "avg_price_display": sig["avg_unit_price"] if sig else None,
            "unit": ing["unit_kind"],
            "invoice_count": sig["invoice_count"] if sig else 0,
            "exposed": bool(sig and sig["active"]),
            "why_hidden": _why_hidden(ing, st, sig, item),
            "mapped": item is not None,
        })
    # 매핑이 필요한 것부터 모아서 보여준다(일괄 처리하기 쉽도록) — 그 안에서는 이름순 유지.
    out.sort(key=lambda r: (r["mapped"], r["name"]))
    unmapped_count = sum(1 for r in out if not r["mapped"])
    return {"items": out, "unmapped_count": unmapped_count}


@router.put("/ingredients/bulk")
def bulk_map_ingredients(body: MarketBulkMapIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    """여러 식자재를 한 번에 "단가제안받기 켜기"로 묶어 처리한다(일괄 처리). 표준 품목을 사람이 고르는
    단계가 없어져서, 각 식자재는 자기 이름·단위로 각자 ``resolve_key``된다(단위가 섞여 있어도 문제없음).
    origin이 비어 있고(바디에도 없고) 그 식자재에도 없으면 그 건만 건너뛰고 ``skipped``로 알려준다 —
    전체를 실패시키지 않는다. 다른 사장님 소유 식자재도 조용히 건너뛴다.
    경로가 ``/ingredients/{ingredient_id}``와 겹치지 않도록(그 라우트가 "bulk"를 id로 해석해 버리므로)
    이 라우트를 먼저 선언한다."""
    uid = user["id"]
    if body.origin is not None and body.origin not in market_catalog.ORIGINS:
        raise HTTPException(400, "원산지를 다시 선택해 주세요.")
    with transaction(db):
        done, skipped = market.bulk_map_ingredients(db, uid, body.ingredient_ids, body.origin)
    return {"mapped": done, "skipped": skipped}


@router.put("/ingredients/{ingredient_id}")
def map_ingredient(ingredient_id: int, body: MarketMapIn, user: dict = Depends(writable_user), db=Depends(get_db)):
    """표준 품목을 사람이 고르는 단계는 없어졌다 — 이 엔드포인트는 "단가제안받기 켜기/끄기" 역할이다.
    enabled=true: origin이 있어야 한다(바디로 보내거나, 식자재에 이미 입력돼 있어야 함). 식자재 이름으로
    ``resolve_key``해 mk_item_id를 구해 저장하고 신호를 다시 계산한다.
    enabled=false: 매핑을 해제한다(기존 DELETE와 동일한 효과)."""
    uid = user["id"]
    with transaction(db):
        ing = db.execute("SELECT * FROM ingredients WHERE id = ? AND user_id = ?", (ingredient_id, uid)).fetchone()
        if not ing:
            raise HTTPException(404, "식자재를 찾지 못했습니다.")
        # 바디에 키가 있으면 그 값(None이면 지움), 없으면 기존 값을 유지한다.
        sent = body.model_fields_set
        grade = body.grade if "grade" in sent else ing["grade"]
        cut = body.cut if "cut" in sent else ing["cut"]
        if body.enabled:
            origin = body.origin or ing["origin"]
            if not origin:
                raise HTTPException(400, "원산지를 입력해 주세요.")
            if origin not in market_catalog.ORIGINS:
                raise HTTPException(400, "원산지를 다시 선택해 주세요.")
            item_id = market.resolve_key(db, ing["name"], ing["category"], ing["unit_kind"])
            db.execute(
                "UPDATE ingredients SET mk_item_id=?, origin=?, grade=?, cut=?, updated_at=? WHERE id=? AND user_id=?",
                (item_id, origin, grade, cut, now_iso(), ingredient_id, uid),
            )
            market.learn_alias(db, ing["name"], item_id)
            market.recompute_signal(db, uid, ingredient_id)
        else:
            # 원산지는 식자재 자체의 정보라서 꺼도 지우지 않는다(mk_item_id만 지워 노출을 끈다). 등급·부위는 보낸 대로 저장.
            db.execute(
                "UPDATE ingredients SET mk_item_id=NULL, grade=?, cut=?, updated_at=? WHERE id=? AND user_id=?",
                (grade, cut, now_iso(), ingredient_id, uid),
            )
            market.recompute_signal(db, uid, ingredient_id)
    row = dict(db.execute("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone())
    return {
        "ingredient_id": row["id"], "item_id": row["mk_item_id"], "origin": row["origin"],
        "grade": row["grade"], "cut": row["cut"], "enabled": row["mk_item_id"] is not None,
    }


@router.delete("/ingredients/{ingredient_id}")
def unmap_ingredient(ingredient_id: int, user: dict = Depends(writable_user), db=Depends(get_db)):
    uid = user["id"]
    with transaction(db):
        cur = db.execute(
            "UPDATE ingredients SET mk_item_id=NULL, updated_at=? WHERE id=? AND user_id=?",
            (now_iso(), ingredient_id, uid),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "식자재를 찾지 못했습니다.")
        market.recompute_signal(db, uid, ingredient_id)
    return {"ok": True}


@router.get("/offers")
def get_offers(status: str = "new", user: dict = Depends(current_user), db=Depends(get_db)):
    offers = market.offers_for_user(db, user["id"], status=status)
    unread = db.execute("SELECT COUNT(*) AS c FROM mk_matches WHERE user_id = ? AND status = 'new'", (user["id"],)).fetchone()["c"]
    out = []
    for r in offers:
        saving = r["saving_pct"]
        out.append({
            "id": r["id"],
            "ingredient": {"id": r["ingredient_id"], "name": r["ing_name"]},
            "item_name": r["item_name"],
            "origin": r["origin"],
            "grade": r["grade"],
            "my_avg_display": r["base_avg_price"],
            "offer_display": r["bid_unit_price"],
            "unit": r["unit_kind"],
            "saving_pct": round(saving, 1),
            "pack": {"size": r["pack_size"], "unit": r["pack_unit"], "price": r["pack_price"]},
            "vat_type": r["vat_type"],
            "min_order_note": r["min_order_note"],
            "seller": {
                "verified": True,
                "region_label": market_catalog.REGIONS.get(r["region_code"] or "", ""),
                "deals_badge": r["score"] > 0.5,
            },
            "status": r["status"],
            "created_at": r["created_at"],
        })
    return {"offers": out, "unread": unread}


def _own_match(db, uid: int, match_id: int) -> dict:
    row = db.execute("SELECT * FROM mk_matches WHERE id = ? AND user_id = ?", (match_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, "제안을 찾지 못했습니다.")
    return dict(row)


@router.post("/offers/{match_id}/seen")
def mark_seen(match_id: int, user: dict = Depends(current_user), db=Depends(get_db)):
    _own_match(db, user["id"], match_id)
    db.execute("UPDATE mk_matches SET status='seen', seen_at=? WHERE id=? AND status='new'", (now_iso(), match_id))
    return {"ok": True}


@router.post("/offers/{match_id}/dismiss")
def dismiss_offer(match_id: int, user: dict = Depends(current_user), db=Depends(get_db)):
    _own_match(db, user["id"], match_id)
    db.execute("UPDATE mk_matches SET status='dismissed' WHERE id=?", (match_id,))
    return {"ok": True}


@router.post("/offers/{match_id}/connect")
def connect_offer(match_id: int, body: ConnectIn, user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    m = _own_match(db, uid, match_id)
    if m["status"] == "connected":
        raise HTTPException(409, "이미 연결 요청을 보냈습니다.")
    bid = db.execute("SELECT * FROM mk_bids WHERE id = ?", (m["bid_id"],)).fetchone()
    if not bid:
        raise HTTPException(404, "제안을 찾지 못했습니다.")
    ts = now_iso()
    with transaction(db):
        try:
            cur = db.execute(
                "INSERT INTO mk_connections(source, match_id, user_id, ws_id, item_id, buyer_name, buyer_contact, "
                "buyer_message, status, requested_at) VALUES ('bid', ?,?,?,?,?,?,?, 'requested', ?)",
                (match_id, uid, bid["ws_id"], bid["item_id"],
                 user["store_name"] if body.share_store_name else "", body.contact, body.message, ts),
            )
        except Exception as e:
            raise HTTPException(409, "이미 연결 요청을 보냈습니다.") from e
        db.execute("UPDATE mk_matches SET status='connected' WHERE id=?", (match_id,))
    return {"connection": _connection_payload(db, cur.lastrowid, "owner")}


@router.get("/deals")
def get_deals(user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    now = now_iso()
    rows = db.execute(
        "SELECT a.*, it.name AS item_name, w.biz_name, d.status AS delivery_status FROM ws_ad_deliveries d "
        "JOIN ws_ads a ON a.id = d.ad_id JOIN mk_items it ON it.id = a.item_id JOIN ws_accounts w ON w.id = a.ws_id "
        "WHERE d.user_id = ? AND a.status = 'active' AND a.ends_at > ? AND d.status != 'dismissed' "
        "ORDER BY a.created_at DESC",
        (uid, now),
    ).fetchall()
    unread = sum(1 for r in rows if r["delivery_status"] == "new")
    out = [{
        "ad_id": r["id"], "title": r["title"], "body": r["body"], "item_name": r["item_name"],
        "origin": r["origin"], "grade": r["grade"], "price_display": r["unit_price"], "unit": r["pack_unit"],
        "pack": {"size": r["pack_size"], "unit": r["pack_unit"], "price": r["pack_price"]},
        "stock_note": r["stock_note"], "ends_at": r["ends_at"],
        "seller": {"biz_name": r["biz_name"], "region_label": ""},
        "status": r["delivery_status"],
    } for r in rows]
    return {"deals": out, "unread": unread}


def _own_delivery(db, uid: int, ad_id: int):
    row = db.execute("SELECT * FROM ws_ad_deliveries WHERE ad_id = ? AND user_id = ?", (ad_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, "광고를 찾지 못했습니다.")
    return row


@router.post("/deals/{ad_id}/dismiss")
def dismiss_deal(ad_id: int, user: dict = Depends(current_user), db=Depends(get_db)):
    _own_delivery(db, user["id"], ad_id)
    db.execute("UPDATE ws_ad_deliveries SET status='dismissed' WHERE ad_id=? AND user_id=?", (ad_id, user["id"]))
    return {"ok": True}


@router.post("/deals/{ad_id}/inquire")
def inquire_deal(ad_id: int, body: ConnectIn, user: dict = Depends(current_user), db=Depends(get_db)):
    uid = user["id"]
    _own_delivery(db, uid, ad_id)
    ad = db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone()
    if not ad or ad["status"] != "active":
        raise HTTPException(404, "광고를 찾지 못했습니다.")
    ts = now_iso()
    with transaction(db):
        try:
            cur = db.execute(
                "INSERT INTO mk_connections(source, ad_id, user_id, ws_id, item_id, buyer_name, buyer_contact, "
                "buyer_message, status, requested_at) VALUES ('ad', ?,?,?,?,?,?,?, 'requested', ?)",
                (ad_id, uid, ad["ws_id"], ad["item_id"],
                 user["store_name"] if body.share_store_name else "", body.contact, body.message, ts),
            )
        except Exception as e:
            raise HTTPException(409, "이미 문의했습니다.") from e
        db.execute("UPDATE ws_ad_deliveries SET status='inquired' WHERE ad_id=? AND user_id=?", (ad_id, uid))
    return {"connection": _connection_payload(db, cur.lastrowid, "owner")}


def _connection_payload(db, conn_id: int, viewer: str) -> dict:
    c = db.execute("SELECT * FROM mk_connections WHERE id = ?", (conn_id,)).fetchone()
    item = db.execute("SELECT name FROM mk_items WHERE id = ?", (c["item_id"],)).fetchone()
    ws = db.execute("SELECT * FROM ws_accounts WHERE id = ?", (c["ws_id"],)).fetchone()
    out = {
        "id": c["id"], "source": c["source"], "item_name": item["name"] if item else "",
        "status": c["status"], "requested_at": c["requested_at"], "responded_at": c["responded_at"],
    }
    if viewer == "owner":
        out["seller"] = {
            "biz_name": ws["biz_name"], "contact_name": ws["contact_name"],
            "phone": ws["phone"] if c["status"] == "accepted" or c["status"] == "closed" else None,
            "intro": ws["intro"],
        }
        out["my_outcome"] = c["buyer_outcome"]
    return out


@router.get("/connections")
def list_connections(user: dict = Depends(current_user), db=Depends(get_db)):
    rows = db.execute("SELECT id FROM mk_connections WHERE user_id = ? ORDER BY requested_at DESC", (user["id"],)).fetchall()
    return {"connections": [_connection_payload(db, r["id"], "owner") for r in rows]}


@router.post("/connections/{conn_id}/outcome")
def set_outcome(conn_id: int, body: OutcomeIn, user: dict = Depends(current_user), db=Depends(get_db)):
    c = db.execute("SELECT * FROM mk_connections WHERE id = ? AND user_id = ?", (conn_id, user["id"])).fetchone()
    if not c:
        raise HTTPException(404, "연결을 찾지 못했습니다.")
    with transaction(db):
        db.execute("UPDATE mk_connections SET buyer_outcome=? WHERE id=?", (body.outcome, conn_id))
        market.recompute_ws_stats(db)
    return _connection_payload(db, conn_id, "owner")
