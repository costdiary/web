"""도매 마켓 — 도매업체 포털 API(``/api/ws/*``). 가입·인증은 `current_wholesaler`,
수요 조회·제안·연결·광고는 `verified_wholesaler`(사업자 인증 완료)만 쓸 수 있습니다.

1.4절 불변식: 이 라우터의 어떤 응답에도 사장님의 평균단가·임계값·절감률·매칭 여부·상호·거래처명이
나가서는 안 됩니다. 매칭은 전부 백그라운드에서 실행하고, 응답은 매칭 여부와 무관하게 항상 같습니다.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile

from . import auth, config, market, market_catalog, ocr, payments, security, units, wholesale_verify
from .db import connect, get_db, now_iso, transaction
from .deps import current_wholesaler, verified_wholesaler
from .schemas import AdIn, AdPayIn, BidIn, LoginIn, OutcomeIn, PgConfirmIn, RespondIn, WsProfileIn, WsSignupIn, WsVerifyIn

router = APIRouter(prefix="/api/ws")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VERIFY_RETRY_DAILY = 5
VERIFY_RETRY_TOTAL = 15


def _set_ws_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.WS_COOKIE_NAME, token, max_age=auth.SESSION_DAYS * 86400, httponly=True,
        samesite="lax", secure=config.env_bool("COOKIE_SECURE"), path="/",
    )


def _me_payload(db, ws: dict) -> dict:
    regions = [r["region_code"] for r in db.execute("SELECT region_code FROM ws_regions WHERE ws_id = ?", (ws["id"],))]
    attempts_today_row = db.execute(
        "SELECT COUNT(*) AS c FROM ws_verifications WHERE ws_id = ? AND created_at > ?",
        (ws["id"], (now_iso()[:10] + "T00:00:00Z")),
    ).fetchone()
    last = db.execute("SELECT * FROM ws_verifications WHERE ws_id = ? ORDER BY id DESC LIMIT 1", (ws["id"],)).fetchone()
    stats = db.execute("SELECT * FROM ws_stats WHERE ws_id = ?", (ws["id"],)).fetchone()
    return {
        "id": ws["id"], "email": ws["email"], "status": ws["status"],
        "biz_name": ws["biz_name"], "biz_no_masked": _mask_bizno(ws["biz_no"]),
        "contact_name": ws["contact_name"], "phone": ws["phone"], "intro": ws["intro"],
        "regions": regions,
        "verify": {
            "last_step": last["step"] if last else None,
            "reason_code": last["reason_code"] if last else "",
            "attempts_today": attempts_today_row["c"],
        },
        "stats": {"conn_total": stats["conn_total"] if stats else 0, "deals_done": stats["deals_done"] if stats else 0},
        "inbox": {"pending": _pending_connections(db, ws["id"])},
        "ws_verify_mock": not bool(config.env_str("NTS_API_KEY")),
    }


def _pending_connections(db, ws_id: int) -> int:
    return db.execute(
        "SELECT COUNT(*) AS c FROM mk_connections WHERE ws_id = ? AND status = 'requested'", (ws_id,)
    ).fetchone()["c"]


def _mask_bizno(biz_no: str | None) -> str | None:
    if not biz_no or len(biz_no) != 10:
        return None
    return biz_no[:3] + "-**-" + biz_no[7:]


# ---------------------------------------------------------------- 가입·로그인

@router.post("/auth/signup")
def ws_signup(body: WsSignupIn, request: Request, response: Response, db=Depends(get_db)):
    ip = security.client_ip(request)
    wait = security.hit(f"wssignup:{ip}", 10, 3600)
    if wait:
        raise HTTPException(429, "가입 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "이메일 형식을 확인해 주세요.")
    problem = auth.password_problem(body.password, email)
    if problem:
        raise HTTPException(400, problem)
    required = config.env_str("WS_SIGNUP_CODE")
    if required:
        pass  # 가입 코드 검사는 초대제 시범 운영에서만 쓰며, 프론트에 코드 입력란이 생기면 여기에 비교를 추가한다.
    pw_hash = auth.hash_password(body.password)
    ts = now_iso()
    with transaction(db):
        if db.execute("SELECT 1 FROM ws_accounts WHERE email = ?", (email,)).fetchone():
            raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.")
        cur = db.execute(
            "INSERT INTO ws_accounts(email, pw_hash, contact_name, phone, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (email, pw_hash, body.contact_name.strip(), body.phone.strip(), ts, ts),
        )
        token = auth.new_ws_session(db, cur.lastrowid)
    security.audit("ws_signup", ip=ip)
    _set_ws_cookie(response, token)
    return {"me": _me_payload(db, db.execute("SELECT * FROM ws_accounts WHERE id = ?", (cur.lastrowid,)).fetchone())}


@router.post("/auth/login")
def ws_login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    email = body.email.strip().lower()
    ip = security.client_ip(request)
    if security.hit(f"wslogin:{ip}:{email}", 8, 900) or security.hit(f"wsloginmail:{email}", 20, 900):
        raise HTTPException(429, "로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.")
    row = db.execute("SELECT * FROM ws_accounts WHERE email = ?", (email,)).fetchone()
    if not row:
        auth.dummy_verify(body.password)
    if not row or not auth.verify_password(body.password, row["pw_hash"]):
        security.audit("ws_login_fail", ip=ip, detail=email[:80], once=f"wslf:{ip}:{email}")
        raise HTTPException(401, "이메일 또는 비밀번호가 맞지 않습니다.")
    if row["status"] == "suspended":
        raise HTTPException(403, "이용이 정지된 계정입니다.")
    token = auth.new_ws_session(db, row["id"])
    security.audit("ws_login_ok", ip=ip)
    _set_ws_cookie(response, token)
    return {"me": _me_payload(db, row)}


@router.post("/auth/logout")
def ws_logout(request: Request, response: Response, db=Depends(get_db)):
    auth.drop_ws_session(db, request.cookies.get(auth.WS_COOKIE_NAME))
    response.delete_cookie(auth.WS_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def ws_me(ws: dict = Depends(current_wholesaler), db=Depends(get_db)):
    return _me_payload(db, ws)


@router.put("/profile")
def ws_profile(body: WsProfileIn, ws: dict = Depends(current_wholesaler), db=Depends(get_db)):
    fields = {}
    if body.contact_name is not None:
        fields["contact_name"] = body.contact_name
    if body.phone is not None:
        fields["phone"] = body.phone
    if body.intro is not None:
        fields["intro"] = body.intro
    with transaction(db):
        if fields:
            fields["updated_at"] = now_iso()
            sets = ", ".join(f"{k} = ?" for k in fields)
            db.execute(f"UPDATE ws_accounts SET {sets} WHERE id = ?", (*fields.values(), ws["id"]))  # nosec B608
        if body.regions is not None:
            bad = [r for r in body.regions if r not in market_catalog.REGIONS]
            if bad:
                raise HTTPException(400, "권역을 다시 선택해 주세요.")
            db.execute("DELETE FROM ws_regions WHERE ws_id = ?", (ws["id"],))
            for r in body.regions:
                db.execute("INSERT INTO ws_regions(ws_id, region_code) VALUES (?,?)", (ws["id"], r))
    fresh = db.execute("SELECT * FROM ws_accounts WHERE id = ?", (ws["id"],)).fetchone()
    return _me_payload(db, fresh)


# ---------------------------------------------------------------- 사업자 인증

@router.post("/verify/ocr")
def verify_ocr(ws: dict = Depends(current_wholesaler), file: UploadFile = File(...), db=Depends(get_db)):
    data = file.file.read(ocr.MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(400, "파일이 비어 있습니다.")
    if len(data) > ocr.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "사진 용량이 너무 큽니다(12MB 이하).")
    try:
        jpeg = ocr.prepare_image(data)
    except ocr.OcrError as e:
        raise HTTPException(400, str(e)) from e
    try:
        doc = wholesale_verify.extract_business_doc(jpeg)
    except ocr.OcrError as e:
        raise HTTPException(502, str(e)) from e
    ts = now_iso()
    sha = hashlib.sha256(data).hexdigest()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO ws_verifications(ws_id, step, image_sha256, ocr_provider, ocr_json, biz_no, biz_name, "
            "ceo_name, open_date, created_at) VALUES (?, 'ocr_done', ?, ?, '{}', ?, ?, ?, ?, ?)",
            (ws["id"], sha, doc.provider, doc.biz_no, doc.biz_name, doc.ceo_name, doc.open_date, ts),
        )
    return {
        "verification_id": cur.lastrowid, "demo": doc.demo,
        "fields": {"biz_no": doc.biz_no, "biz_name": doc.biz_name, "ceo_name": doc.ceo_name, "open_date": doc.open_date},
        "low_confidence": doc.low_confidence,
    }


@router.post("/verify/submit")
def verify_submit(body: WsVerifyIn, ws: dict = Depends(current_wholesaler), db=Depends(get_db)):
    ver = db.execute("SELECT * FROM ws_verifications WHERE id = ? AND ws_id = ?", (body.verification_id, ws["id"])).fetchone()
    if not ver:
        raise HTTPException(404, "인증 요청을 찾지 못했습니다.")
    today_cut = now_iso()[:10] + "T00:00:00Z"
    today_count = db.execute(
        "SELECT COUNT(*) AS c FROM ws_verifications WHERE ws_id = ? AND decided_at IS NOT NULL AND created_at > ?",
        (ws["id"], today_cut),
    ).fetchone()["c"]
    total_count = db.execute(
        "SELECT COUNT(*) AS c FROM ws_verifications WHERE ws_id = ? AND decided_at IS NOT NULL", (ws["id"],)
    ).fetchone()["c"]
    if total_count >= VERIFY_RETRY_TOTAL:
        with transaction(db):
            db.execute("UPDATE ws_accounts SET status='rejected', updated_at=? WHERE id=?", (now_iso(), ws["id"]))
        return {"status": "rejected", "reason_code": "too_many_attempts", "message": "인증 시도 횟수를 초과했습니다. 운영팀에 문의해 주세요."}
    if today_count >= VERIFY_RETRY_DAILY:
        raise HTTPException(429, "오늘 인증 시도 한도를 넘었습니다. 내일 다시 시도해 주세요.")

    doc = {"biz_no": body.biz_no, "biz_name": body.biz_name, "ceo_name": body.ceo_name, "open_date": body.open_date}
    duplicate = bool(
        db.execute(
            "SELECT 1 FROM ws_accounts WHERE biz_no = ? AND status = 'verified' AND id != ?",
            (body.biz_no, ws["id"]),
        ).fetchone()
    )
    nts = wholesale_verify.check_nts(body.biz_no, body.open_date, body.ceo_name, body.biz_name)
    decision = wholesale_verify.decide(doc, nts, duplicate=duplicate)
    ts = now_iso()
    with transaction(db):
        db.execute(
            "UPDATE ws_verifications SET step=?, biz_no=?, biz_name=?, ceo_name=?, open_date=?, "
            "nts_provider=?, nts_valid=?, nts_status=?, reason_code=?, decided_at=? WHERE id=?",
            (decision.step, body.biz_no, body.biz_name, body.ceo_name, body.open_date,
             nts.provider, nts.valid, nts.status, decision.reason_code, ts, ver["id"]),
        )
        if decision.step == "approved":
            db.execute(
                "UPDATE ws_accounts SET status='verified', biz_no=?, biz_name=?, ceo_name=?, open_date=?, "
                "verified_at=?, updated_at=? WHERE id=?",
                (body.biz_no, body.biz_name, body.ceo_name, body.open_date, ts, ts, ws["id"]),
            )
        elif decision.step == "rejected":
            db.execute("UPDATE ws_accounts SET status='rejected', updated_at=? WHERE id=?", (ts, ws["id"]))
    return {"status": decision.step, "reason_code": decision.reason_code, "message": decision.message}


# ---------------------------------------------------------------- 카탈로그·수요

@router.get("/catalog")
def ws_catalog(q: str = "", ws: dict = Depends(current_wholesaler), db=Depends(get_db)):
    like = f"%{q.strip()}%" if q.strip() else "%"
    items = db.execute(
        "SELECT id, name, category, unit_kind FROM mk_items WHERE active = 1 AND name LIKE ? ORDER BY name LIMIT 200",
        (like,),
    ).fetchall()
    return {
        "items": [dict(r) for r in items],
        "origins": [{"code": c, "label": lbl} for c, lbl in market_catalog.ORIGINS.items()],
        "meat_origins": [{"code": c, "label": lbl} for c, lbl in market_catalog.MEAT_ORIGINS.items()],
        "grades": {cat: [{"code": c, "label": lbl} for c, lbl in grades] for cat, grades in market_catalog.GRADES.items()},
    }


@router.get("/demands")
def ws_demands(region: str = "", category: str = "", q: str = "", ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    market.ensure_fresh_demand(db)  # 자체적으로 필요할 때만 transaction()을 엽니다(중첩 트랜잭션 방지).
    ws_regions = {r["region_code"] for r in db.execute("SELECT region_code FROM ws_regions WHERE ws_id = ?", (ws["id"],))}
    if not ws_regions:
        return {"demands": [], "refreshed_at": now_iso()}
    rows = db.execute(
        "SELECT p.*, it.name AS item_name, it.category AS item_category FROM mk_demand_public p "
        "JOIN mk_items it ON it.id = p.item_id WHERE p.visible = 1 ORDER BY it.name"
    ).fetchall()
    my_bids = {
        (r["item_id"], r["origin"], r["grade"], r["region_code"]): dict(r)
        for r in db.execute("SELECT * FROM mk_bids WHERE ws_id = ? AND status = 'active'", (ws["id"],))
    }
    out = []
    for r in rows:
        if r["region_code"] not in ws_regions:
            continue
        if region and r["region_code"] != region:
            continue
        if category and r["item_category"] != category:
            continue
        if q and q.lower() not in r["item_name"].lower():
            continue
        key = (r["item_id"], r["origin"], r["grade"], r["region_code"])
        mine = my_bids.get(key)
        out.append({
            "demand_id": r["id"],
            "item": {"id": r["item_id"], "name": r["item_name"], "category": r["item_category"]},
            "origin": r["origin"], "grade": r["grade"],
            "region": {"code": r["region_code"], "label": market_catalog.REGIONS.get(r["region_code"], "")},
            "buyer_band": r["buyer_band"],
            "qty_band": {"low": r["qty_low"], "high": r["qty_high"], "unit": ""} if r["qty_low"] is not None else None,
            "my_bid": ({"id": mine["id"], "pack": {"size": mine["pack_size"], "unit": mine["pack_unit"], "price": mine["pack_price"]},
                        "vat_type": mine["vat_type"], "valid_until": mine["valid_until"]} if mine else None),
        })
    return {"demands": out, "refreshed_at": now_iso()}


# ---------------------------------------------------------------- 제안(블라인드 입찰)

def _bid_unit_price(pack_size: float, pack_unit: str, pack_price: float, vat_type: str, expect_kind: str) -> tuple[str, float]:
    unit = units.canon_unit(pack_unit)
    if unit is None:
        raise HTTPException(400, "규격 단위를 확인해 주세요.")
    kind, base = units.to_base(pack_size, unit)
    if kind != expect_kind:
        raise HTTPException(400, "품목의 단위 종류와 다릅니다.")
    price = market.normalize_vat(pack_price, vat_type) / base
    if not (0 < price < market.BID_MAX_UNIT_PRICE):
        raise HTTPException(400, "가격을 확인해 주세요.")
    return unit, price


@router.post("/bids")
def submit_bid(body: BidIn, background: BackgroundTasks, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    if body.demand_id is None:
        raise HTTPException(400, "제안할 수요를 선택해 주세요.")
    d = db.execute("SELECT * FROM mk_demand_public WHERE id = ?", (body.demand_id,)).fetchone()
    my_regions = {r["region_code"] for r in db.execute("SELECT region_code FROM ws_regions WHERE ws_id = ?", (ws["id"],))}
    if not d or d["visible"] != 1 or d["region_code"] not in my_regions:
        raise HTTPException(404, "수요를 찾지 못했습니다.")
    item = db.execute("SELECT * FROM mk_items WHERE id = ?", (d["item_id"],)).fetchone()
    unit, price = _bid_unit_price(body.pack_size, body.pack_unit, body.pack_price, body.vat_type, item["unit_kind"])
    wait = security.hit(f"wsbid:{ws['id']}", market.BID_DAILY_LIMIT, 86400)
    if wait:
        raise HTTPException(429, "하루 제안 등록 한도를 넘었습니다.")
    if market.recent_bid_key_blocked(db, ws["id"], d["item_id"], d["origin"], d["grade"], d["region_code"]):
        raise HTTPException(429, "철회한 제안은 7일 뒤에 다시 등록할 수 있습니다.")
    ts = now_iso()
    valid_until = (datetime.now(timezone.utc) + timedelta(days=body.valid_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with transaction(db):
        try:
            cur = db.execute(
                "INSERT INTO mk_bids(ws_id, item_id, origin, grade, region_code, pack_size, pack_unit, pack_price, "
                "vat_type, unit_price, min_order_note, status, valid_until, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?,?,?)",
                (ws["id"], d["item_id"], d["origin"], d["grade"], d["region_code"], body.pack_size, unit,
                 body.pack_price, body.vat_type, price, body.min_order_note, valid_until, ts, ts),
            )
        except Exception as e:
            raise HTTPException(409, "이미 제안한 품목입니다. 내 제안에서 수정해 주세요.") from e
        bid_id = cur.lastrowid
    background.add_task(_match_bid_background, bid_id)
    row = db.execute("SELECT * FROM mk_bids WHERE id = ?", (bid_id,)).fetchone()
    return {"bid": _bid_payload(row)}


def _match_bid_background(bid_id: int) -> None:
    db = connect()
    try:
        with transaction(db):
            market.match_bid(db, bid_id)
    except Exception:
        logging.getLogger("wongaenote.market").exception("match_bid 실패 (bid=%s)", bid_id)
    finally:
        db.close()


def _bid_payload(r) -> dict:
    return {
        "id": r["id"], "item_id": r["item_id"], "origin": r["origin"], "grade": r["grade"], "region": r["region_code"],
        "pack": {"size": r["pack_size"], "unit": r["pack_unit"], "price": r["pack_price"]},
        "vat_type": r["vat_type"], "status": r["status"], "valid_until": r["valid_until"], "price_changes": r["price_changes"],
    }


@router.get("/bids")
def list_bids(ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    rows = db.execute(
        "SELECT b.*, it.name AS item_name FROM mk_bids b JOIN mk_items it ON it.id = b.item_id "
        "WHERE b.ws_id = ? ORDER BY b.created_at DESC",
        (ws["id"],),
    ).fetchall()
    out = []
    for r in rows:
        p = _bid_payload(r)
        p["item"] = {"id": r["item_id"], "name": r["item_name"]}
        p["region"] = r["region_code"]
        p["region_label"] = market_catalog.REGIONS.get(r["region_code"], r["region_code"])
        p["origin_label"] = market_catalog.ORIGINS.get(r["origin"], r["origin"])
        p["min_order_note"] = r["min_order_note"]
        p["created_at"] = r["created_at"]
        p["price_locked_until"] = _price_locked_until(r)
        out.append(p)
    return {"bids": out}


def _price_locked_until(bid) -> str | None:
    """가격을 한 번 바꾸면 7일 동안 다시 못 바꿉니다. 그 잠금이 풀리는 시각(잠겨 있지 않으면 None)."""
    if not bid["price_changes"] or bid["status"] != "active":
        return None
    try:
        changed = datetime.strptime(bid["updated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    until = changed + timedelta(days=market.BID_PRICE_COOLDOWN_DAYS)
    return until.strftime("%Y-%m-%dT%H:%M:%SZ") if until > datetime.now(timezone.utc) else None


@router.put("/bids/{bid_id}")
def update_bid(bid_id: int, body: BidIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    bid = db.execute("SELECT * FROM mk_bids WHERE id = ? AND ws_id = ?", (bid_id, ws["id"])).fetchone()
    if not bid:
        raise HTTPException(404, "제안을 찾지 못했습니다.")
    if bid["status"] != "active":
        raise HTTPException(409, "진행 중인 제안만 수정할 수 있습니다.")
    item = db.execute("SELECT * FROM mk_items WHERE id = ?", (bid["item_id"],)).fetchone()
    unit, price = _bid_unit_price(body.pack_size, body.pack_unit, body.pack_price, body.vat_type, item["unit_kind"])
    price_changed = abs(price - bid["unit_price"]) > 1e-9
    if price_changed and market.bid_price_cooldown_blocked(db, dict(bid)):
        raise HTTPException(429, "가격 수정은 7일에 한 번만 할 수 있습니다.")
    ts = now_iso()
    # 유효 기간은 수정한 시점부터 다시 셉니다(가격과 무관한 값이라 쿨다운 대상이 아닙니다).
    # updated_at 은 가격 쿨다운의 기준 시각이라, 가격이 바뀔 때만 갱신합니다.
    valid_until = (datetime.now(timezone.utc) + timedelta(days=body.valid_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with transaction(db):
        db.execute(
            "UPDATE mk_bids SET pack_size=?, pack_unit=?, pack_price=?, vat_type=?, unit_price=?, min_order_note=?, "
            "price_changes = price_changes + ?, valid_until=?, updated_at=? WHERE id=?",
            (body.pack_size, unit, body.pack_price, body.vat_type, price, body.min_order_note,
             1 if price_changed else 0, valid_until, ts if price_changed else bid["updated_at"], bid_id),
        )
    row = db.execute("SELECT * FROM mk_bids WHERE id = ?", (bid_id,)).fetchone()
    if price_changed:
        with transaction(db):
            market.match_bid(db, bid_id)
    return {"bid": _bid_payload(row)}


@router.delete("/bids/{bid_id}")
def withdraw_bid(bid_id: int, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    with transaction(db):
        cur = db.execute(
            "UPDATE mk_bids SET status='withdrawn', updated_at=? WHERE id=? AND ws_id=? AND status='active'",
            (now_iso(), bid_id, ws["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "제안을 찾지 못했습니다.")
    return {"ok": True}


# ---------------------------------------------------------------- 연결 요청

def _ws_connection_payload(db, c) -> dict:
    item = db.execute("SELECT name FROM mk_items WHERE id = ?", (c["item_id"],)).fetchone()
    ad = db.execute("SELECT title FROM ws_ads WHERE id = ?", (c["ad_id"],)).fetchone() if c["ad_id"] else None
    return {
        "id": c["id"], "source": c["source"], "item_name": item["name"] if item else "",
        "ad_title": ad["title"] if ad else None,
        "status": c["status"], "requested_at": c["requested_at"], "responded_at": c["responded_at"],
        "respond_by": _plus_hours(c["requested_at"], market.CONN_RESPOND_HOURS) if c["status"] == "requested" else None,
        "buyer": {"name": c["buyer_name"], "contact": c["buyer_contact"], "message": c["buyer_message"]},
        "my_outcome": c["ws_outcome"],
    }


def _plus_hours(iso: str, hours: int) -> str | None:
    try:
        t = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return (t + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/connections")
def ws_connections(ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM mk_connections WHERE ws_id = ? ORDER BY requested_at DESC", (ws["id"],)).fetchall()
    return {"connections": [_ws_connection_payload(db, r) for r in rows]}


@router.post("/connections/{conn_id}/respond")
def ws_respond(conn_id: int, body: RespondIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    c = db.execute("SELECT * FROM mk_connections WHERE id = ? AND ws_id = ?", (conn_id, ws["id"])).fetchone()
    if not c:
        raise HTTPException(404, "연결 요청을 찾지 못했습니다.")
    if c["status"] != "requested":
        raise HTTPException(409, "이미 처리된 요청입니다.")
    status = "accepted" if body.accept else "declined"
    ts = now_iso()
    with transaction(db):
        db.execute("UPDATE mk_connections SET status=?, responded_at=? WHERE id=?", (status, ts, conn_id))
        market.recompute_ws_stats(db)
    fresh = db.execute("SELECT * FROM mk_connections WHERE id = ?", (conn_id,)).fetchone()
    return _ws_connection_payload(db, fresh)


@router.post("/connections/{conn_id}/outcome")
def ws_outcome(conn_id: int, body: OutcomeIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    c = db.execute("SELECT * FROM mk_connections WHERE id = ? AND ws_id = ?", (conn_id, ws["id"])).fetchone()
    if not c:
        raise HTTPException(404, "연결을 찾지 못했습니다.")
    with transaction(db):
        db.execute("UPDATE mk_connections SET ws_outcome=? WHERE id=?", (body.outcome, conn_id))
    fresh = db.execute("SELECT * FROM mk_connections WHERE id = ?", (conn_id,)).fetchone()
    return _ws_connection_payload(db, fresh)


# ---------------------------------------------------------------- 떨이 광고

def _ad_payload(db, ad) -> dict:
    pay = db.execute("SELECT * FROM ws_ad_payments WHERE ad_id = ? ORDER BY id DESC LIMIT 1", (ad["id"],)).fetchone()
    item = db.execute("SELECT name FROM mk_items WHERE id = ?", (ad["item_id"],)).fetchone()
    regions = [r["region_code"] for r in db.execute("SELECT region_code FROM ws_ad_regions WHERE ad_id = ? ORDER BY region_code", (ad["id"],))]
    return {
        "id": ad["id"], "title": ad["title"], "item_id": ad["item_id"], "status": ad["status"],
        "run_days": ad["run_days"], "starts_at": ad["starts_at"], "ends_at": ad["ends_at"],
        "payment": ({"status": pay["status"], "amount": pay["amount"], "method": pay["method"]} if pay else None),
        "item_name": item["name"] if item else "", "origin": ad["origin"], "grade": ad["grade"],
        "body": ad["body"], "pack_size": ad["pack_size"], "pack_unit": ad["pack_unit"], "pack_price": ad["pack_price"],
        "vat_type": ad["vat_type"], "stock_note": ad["stock_note"], "regions": regions,
        "amount": ad["run_days"] * config.env_int("MK_AD_PRICE_PER_DAY", 5000),
        "created_at": ad["created_at"],
    }


@router.get("/ads")
def list_ads(ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM ws_ads WHERE ws_id = ? ORDER BY created_at DESC", (ws["id"],)).fetchall()
    return {
        "ads": [_ad_payload(db, r) for r in rows],
        "pricing": {"per_day": config.env_int("MK_AD_PRICE_PER_DAY", 5000), "bank_note": config.env_str("MK_AD_BANK_NOTE", "입금 안내는 운영팀에 문의해 주세요.")},
    }


def _ad_unit_price(body: AdIn, item) -> tuple[str, float]:
    unit = units.canon_unit(body.pack_unit)
    if unit is None:
        raise HTTPException(400, "규격 단위를 확인해 주세요.")
    kind, base = units.to_base(body.pack_size, unit)
    if kind != item["unit_kind"]:
        raise HTTPException(400, "품목의 단위 종류와 다릅니다.")
    return unit, market.normalize_vat(body.pack_price, body.vat_type) / base


@router.post("/ads")
def create_ad(body: AdIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    item = db.execute("SELECT * FROM mk_items WHERE id = ? AND active = 1", (body.item_id,)).fetchone()
    if not item:
        raise HTTPException(404, "표준 품목을 찾지 못했습니다.")
    if body.origin not in market_catalog.ORIGINS or body.grade not in market_catalog.ALL_GRADE_CODES:
        raise HTTPException(400, "원산지·등급을 확인해 주세요.")
    bad = [r for r in body.regions if r not in market_catalog.REGIONS]
    if bad:
        raise HTTPException(400, "권역을 다시 선택해 주세요.")
    unit, price = _ad_unit_price(body, item)
    ts = now_iso()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO ws_ads(ws_id, item_id, origin, grade, title, body, pack_size, pack_unit, pack_price, "
            "vat_type, unit_price, stock_note, status, run_days, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?,?,?)",
            (ws["id"], body.item_id, body.origin, body.grade, body.title, body.body, body.pack_size, unit,
             body.pack_price, body.vat_type, price, body.stock_note, body.run_days, ts, ts),
        )
        ad_id = cur.lastrowid
        for r in body.regions:
            db.execute("INSERT INTO ws_ad_regions(ad_id, region_code) VALUES (?,?)", (ad_id, r))
    return _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone())


def _own_ad(db, ws_id: int, ad_id: int):
    row = db.execute("SELECT * FROM ws_ads WHERE id = ? AND ws_id = ?", (ad_id, ws_id)).fetchone()
    if not row:
        raise HTTPException(404, "광고를 찾지 못했습니다.")
    return row


@router.put("/ads/{ad_id}")
def update_ad(ad_id: int, body: AdIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    ad = _own_ad(db, ws["id"], ad_id)
    if ad["status"] not in ("draft", "rejected"):
        raise HTTPException(409, "노출 전(초안/반려) 상태에서만 수정할 수 있습니다.")
    item = db.execute("SELECT * FROM mk_items WHERE id = ? AND active = 1", (body.item_id,)).fetchone()
    if not item:
        raise HTTPException(404, "표준 품목을 찾지 못했습니다.")
    unit, price = _ad_unit_price(body, item)
    ts = now_iso()
    with transaction(db):
        db.execute(
            "UPDATE ws_ads SET item_id=?, origin=?, grade=?, title=?, body=?, pack_size=?, pack_unit=?, pack_price=?, "
            "vat_type=?, unit_price=?, stock_note=?, run_days=?, status='draft', updated_at=? WHERE id=?",
            (body.item_id, body.origin, body.grade, body.title, body.body, body.pack_size, unit, body.pack_price,
             body.vat_type, price, body.stock_note, body.run_days, ts, ad_id),
        )
        db.execute("DELETE FROM ws_ad_regions WHERE ad_id = ?", (ad_id,))
        for r in body.regions:
            db.execute("INSERT INTO ws_ad_regions(ad_id, region_code) VALUES (?,?)", (ad_id, r))
    return _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone())


@router.get("/ads/{ad_id}/reach")
def ad_reach(ad_id: int, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    _own_ad(db, ws["id"], ad_id)
    n = db.execute("SELECT COUNT(*) AS c FROM ws_ad_deliveries WHERE ad_id = ?", (ad_id,)).fetchone()["c"]
    if n < 10:
        band = "10곳 미만"
    elif n < 30:
        band = "10~30곳"
    elif n < 100:
        band = "30~100곳"
    else:
        band = "100곳 이상"
    return {"reach_band": band}


@router.post("/ads/{ad_id}/request-payment")
def request_payment(ad_id: int, body: AdPayIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    ad = _own_ad(db, ws["id"], ad_id)
    if ad["status"] not in ("draft", "rejected"):
        raise HTTPException(409, "이미 결제를 신청했습니다.")
    amount = ad["run_days"] * config.env_int("MK_AD_PRICE_PER_DAY", 5000)
    ts = now_iso()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO ws_ad_payments(ad_id, ws_id, amount, method, status, depositor_name, tax_invoice, requested_at) "
            "VALUES (?,?,?, 'invoice', 'requested', ?, ?, ?)",
            (ad_id, ws["id"], amount, body.depositor_name, int(body.tax_invoice), ts),
        )
        db.execute("UPDATE ws_ads SET status='pending_payment', updated_at=? WHERE id=?", (ts, ad_id))
    return {
        "ad": _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone()),
        "payment": {"id": cur.lastrowid, "amount": amount, "status": "requested", "bank_note": config.env_str("MK_AD_BANK_NOTE", "")},
    }


@router.post("/ads/{ad_id}/pay/pg")
def request_payment_pg(ad_id: int, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    """PG(카드결제) 신청 — 결제위젯이 쓸 주문정보를 내려준다. 승인은 프런트가
    /api/ws/ads/pay/pg/confirm 을 부르거나, PG사 웹훅(/api/payments/toss/webhook)으로 이뤄진다."""
    ad = _own_ad(db, ws["id"], ad_id)
    if ad["status"] not in ("draft", "rejected"):
        raise HTTPException(409, "이미 결제를 신청했습니다.")
    amount = ad["run_days"] * config.env_int("MK_AD_PRICE_PER_DAY", 5000)
    provider = payments.get_provider()
    ts = now_iso()
    with transaction(db):
        cur = db.execute(
            "INSERT INTO ws_ad_payments(ad_id, ws_id, amount, method, status, pg_provider, requested_at) "
            "VALUES (?,?,?, 'pg', 'requested', ?, ?)",
            (ad_id, ws["id"], amount, provider.name, ts),
        )
        payment_id = cur.lastrowid
        order_id = payments.make_order_id("ad", payment_id)
        db.execute("UPDATE ws_ad_payments SET pg_order_id = ? WHERE id = ?", (order_id, payment_id))
        db.execute("UPDATE ws_ads SET status='pending_payment', updated_at=? WHERE id=?", (ts, ad_id))
    intent = provider.create_intent(order_id, amount, f"원가노트 떨이 광고({ad['run_days']}일)")
    return {
        "ad": _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone()),
        "payment": {
            "id": payment_id, "amount": amount, "status": "requested", "provider": provider.name,
            "order_id": intent.order_id, "client_key": intent.client_key, "checkout_url": intent.checkout_url,
        },
    }


@router.post("/ads/pay/pg/confirm")
def confirm_payment_pg(body: PgConfirmIn, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    """결제위젯 완료 후 프런트가 돌려받은 paymentKey 로 승인을 마무리할 때 부른다.
    (토스가 직접 보내는 서버-서버 웹훅은 /api/payments/toss/webhook 에서 별도로 처리한다.)"""
    order_id = body.order_id
    payment_key = body.payment_key
    pay = db.execute(
        "SELECT * FROM ws_ad_payments WHERE pg_order_id = ? AND method = 'pg' AND ws_id = ?",
        (order_id, ws["id"]),
    ).fetchone()
    if not pay:
        raise HTTPException(404, "결제 신청을 찾지 못했습니다.")
    if pay["status"] == "paid":
        return {"ad_id": pay["ad_id"], "payment_id": pay["id"], "status": "paid"}
    provider = payments.get_provider()
    conf = provider.confirm(payment_key, order_id, pay["amount"])
    if not conf.paid:
        market.fail_pg_payment(db, order_id, conf.error or "결제 승인 실패")
        raise HTTPException(402, f"결제 승인에 실패했습니다: {conf.error or '알 수 없는 오류'}")
    result = market.confirm_pg_payment(db, order_id, conf.pg_tx_id or payment_key, conf.amount)
    return {**result, "status": "paid"}


@router.post("/ads/{ad_id}/pause")
def pause_ad(ad_id: int, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    ad = _own_ad(db, ws["id"], ad_id)
    if ad["status"] != "active":
        raise HTTPException(409, "운영 중인 광고만 멈출 수 있습니다.")
    with transaction(db):
        db.execute("UPDATE ws_ads SET status='paused', updated_at=? WHERE id=?", (now_iso(), ad_id))
    return _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone())


@router.post("/ads/{ad_id}/resume")
def resume_ad(ad_id: int, ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    ad = _own_ad(db, ws["id"], ad_id)
    if ad["status"] != "paused":
        raise HTTPException(409, "멈춘 광고만 다시 시작할 수 있습니다.")
    with transaction(db):
        db.execute("UPDATE ws_ads SET status='active', updated_at=? WHERE id=?", (now_iso(), ad_id))
    return _ad_payload(db, db.execute("SELECT * FROM ws_ads WHERE id = ?", (ad_id,)).fetchone())


# ---------------------------------------------------------------- 판매자 홈(대시보드)·결제 내역
#
# 1.4절 불변식은 여기서도 그대로입니다: 아래 숫자는 전부 "이 도매업체가 이미 알고 있는 것"(내 제안·내 광고·
# 받은 연결 요청)과 "수요 화면에서 이미 보이는 것"(내 권역의 공개 수요 건수)만 셉니다. 제안이 어느 사장님에게
# 닿았는지(매칭 여부·건수), 사장님의 단가·임계값·상호는 어떤 형태로도 포함하지 않습니다.

BID_EXPIRING_DAYS = 3


def _iso_in(days: float = 0, hours: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/dashboard")
def ws_dashboard(ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    market.ensure_fresh_demand(db)
    wid = ws["id"]
    now = now_iso()
    regions = [r["region_code"] for r in db.execute("SELECT region_code FROM ws_regions WHERE ws_id = ?", (wid,))]

    bids = db.execute("SELECT item_id, origin, grade, region_code, status, valid_until FROM mk_bids WHERE ws_id = ?", (wid,)).fetchall()
    active_bids = [b for b in bids if b["status"] == "active" and b["valid_until"] > now]
    soon = _iso_in(days=BID_EXPIRING_DAYS)
    expiring = [b for b in active_bids if b["valid_until"] <= soon]
    my_keys = {(b["item_id"], b["origin"], b["grade"], b["region_code"]) for b in active_bids}

    demand_total = demand_open = 0
    if regions:
        marks = ",".join("?" * len(regions))
        for d in db.execute(
            f"SELECT item_id, origin, grade, region_code FROM mk_demand_public WHERE visible = 1 AND region_code IN ({marks})",  # nosec B608
            regions,
        ):
            demand_total += 1
            if (d["item_id"], d["origin"], d["grade"], d["region_code"]) not in my_keys:
                demand_open += 1

    conns = [dict(r) for r in db.execute("SELECT * FROM mk_connections WHERE ws_id = ? ORDER BY requested_at DESC", (wid,))]
    pending = [c for c in conns if c["status"] == "requested"]
    need_outcome = [c for c in conns if c["status"] == "accepted" and c["ws_outcome"] is None]
    answered = [c for c in conns if c["responded_at"]]
    resp_hours = []
    for c in answered:
        try:
            a = datetime.strptime(c["requested_at"], "%Y-%m-%dT%H:%M:%SZ")
            b = datetime.strptime(c["responded_at"], "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
        resp_hours.append(max(0.0, (b - a).total_seconds() / 3600))
    decided = [c for c in conns if c["status"] != "requested"]
    done = sum(1 for c in conns if c["ws_outcome"] == "done")
    failed = sum(1 for c in conns if c["ws_outcome"] == "failed")

    # 최근 8주 받은 연결 요청 수(오래된 주 -> 이번 주)
    today = datetime.now(timezone.utc).date()
    week0 = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(7, -1, -1):
        start = week0 - timedelta(weeks=i)
        end = start + timedelta(days=7)
        n = sum(1 for c in conns if start.isoformat() <= c["requested_at"][:10] < end.isoformat())
        weeks.append({"week_start": start.isoformat(), "count": n})

    ads = db.execute("SELECT status FROM ws_ads WHERE ws_id = ?", (wid,)).fetchall()
    ad_count = {k: sum(1 for a in ads if a["status"] == k) for k in ("draft", "pending_payment", "active", "paused", "rejected")}
    month_cut = now[:7] + "-01T00:00:00Z"
    spend = db.execute(
        "SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount ELSE 0 END), 0) AS month "
        "FROM ws_ad_payments WHERE ws_id = ? AND status = 'paid'",
        (month_cut, wid),
    ).fetchone()

    todo = []
    if not regions:
        todo.append({"kind": "regions", "count": 0, "due": None})
    if pending:
        soonest = min(c["requested_at"] for c in pending)
        todo.append({"kind": "respond", "count": len(pending), "due": _plus_hours(soonest, market.CONN_RESPOND_HOURS)})
    if need_outcome:
        todo.append({"kind": "outcome", "count": len(need_outcome), "due": None})
    if expiring:
        todo.append({"kind": "bids_expiring", "count": len(expiring), "due": min(b["valid_until"] for b in expiring)})
    if ad_count["draft"] or ad_count["rejected"]:
        todo.append({"kind": "ads_unpaid", "count": ad_count["draft"] + ad_count["rejected"], "due": None})
    if ad_count["pending_payment"]:
        todo.append({"kind": "ads_pending", "count": ad_count["pending_payment"], "due": None})

    return {
        "todo": todo,
        "demand": {"total": demand_total, "open": demand_open, "regions": len(regions)},
        "bids": {"active": len(active_bids), "expiring": len(expiring), "total": len(bids)},
        "ads": {"active": ad_count["active"], "paused": ad_count["paused"], "total": len(ads)},
        "connections": {
            "total": len(conns), "pending": len(pending), "accepted": sum(1 for c in conns if c["status"] == "accepted"),
            "response_rate": round(len(answered) / len(decided), 3) if decided else None,
            "avg_response_hours": round(sum(resp_hours) / len(resp_hours), 1) if resp_hours else None,
            "deals_done": done, "deals_failed": failed, "weeks": weeks,
        },
        "spend": {"total": spend["total"], "month": spend["month"]},
        "onboarding": {
            "verified": True, "regions": bool(regions), "contact": bool((ws.get("phone") or "").strip()),
            "intro": bool((ws.get("intro") or "").strip()), "first_bid": bool(bids),
        },
    }


@router.get("/billing")
def ws_billing(ws: dict = Depends(verified_wholesaler), db=Depends(get_db)):
    """떨이 광고 결제 내역(무통장·카드). 도매마켓에서 돈이 오가는 곳은 광고비뿐입니다."""
    rows = db.execute(
        "SELECT p.*, a.title AS ad_title, a.run_days AS run_days FROM ws_ad_payments p JOIN ws_ads a ON a.id = p.ad_id "
        "WHERE p.ws_id = ? ORDER BY p.id DESC LIMIT 200",
        (ws["id"],),
    ).fetchall()
    now = now_iso()
    month_cut = now[:7] + "-01T00:00:00Z"
    paid = [r for r in rows if r["status"] == "paid"]
    return {
        "payments": [{
            "id": r["id"], "ad_id": r["ad_id"], "ad_title": r["ad_title"], "run_days": r["run_days"],
            "amount": r["amount"], "method": r["method"], "status": r["status"],
            "tax_invoice": bool(r["tax_invoice"]), "requested_at": r["requested_at"], "paid_at": r["paid_at"],
        } for r in rows],
        "summary": {
            "paid_total": sum(r["amount"] for r in paid),
            "paid_month": sum(r["amount"] for r in paid if (r["paid_at"] or "") >= month_cut),
            "waiting": sum(r["amount"] for r in rows if r["status"] == "requested"),
            "month": now[:7],
        },
        "pricing": {"per_day": config.env_int("MK_AD_PRICE_PER_DAY", 5000), "bank_note": config.env_str("MK_AD_BANK_NOTE", "")},
    }
