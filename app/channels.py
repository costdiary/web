"""배달앱(배달의민족·쿠팡이츠 등)별 수수료 설정.

요율은 앱이 정하고 자주 바뀝니다. 그래서 여기 있는 값은 '기준일 시점의 기본값'일 뿐이고,
가게마다 화면에서 고칠 수 있게 하며, 공식 페이지에서 확인한 것과 못 한 것을 구분해 보여 줍니다.
계산식은 costing.channel_result 에 있습니다.
"""
from __future__ import annotations

from .db import now_iso

AS_OF = "2026-11-08"

BAEMIN_GUIDE = {"label": "배민 사장님 가이드 · 배민배달 요금", "url": "https://ceo.baemin.com/guide/12699"}
BAEMIN_SELF_GUIDE = {"label": "배민 사장님 가이드 · 가게배달 요금", "url": "https://ceo.baemin.com/guide/3882"}
FTC_NOTICE = {"label": "공정거래위원회 보도자료(2025.10.13)", "url": "https://www.korea.kr/news/policyNewsView.do?newsId=156722071"}
COUPANG_PICKUP_NEWS = {"label": "디지털데일리 보도(2026.02.26)", "url": "https://www.ddaily.co.kr/page/view/2026022614361332229"}
UNOFFICIAL_BAEMIN = {"label": "비공식 요금 정리(글래스월렛)", "url": "https://glasswallet.com/calculate/delivery-app-fee/baemin-fee-rates"}
PAY_NEWS = {"label": "결제수수료율 보도(바이라인네트워크, 2023.03.31)", "url": "https://byline.network/2023/03/31-139/"}
COUPANG_UNCONFIRMED = {"label": "쿠팡이츠 공식 사이트 확인 못 함 · 2025.02 발표 보도 기준", "url": None}

# 배달 중개이용료·사장님 부담 배달비 구간(모두 부가세 별도). 배달비는 구간 안에서 지역마다 달라지며,
# 기본값은 범위의 위쪽(서울 기준 예시)으로 두어 비용을 작게 잡지 않게 했습니다.
_DELIVERY_TIERS = [
    {"key": "t1", "label": "상위 35% 이내 · 신규", "fee_pct": 7.8, "delivery_fee": 3400, "delivery_range": [2400, 3400]},
    {"key": "t2", "label": "35% 초과 ~ 50% 이하", "fee_pct": 6.8, "delivery_fee": 3100, "delivery_range": [2100, 3100]},
    {"key": "t3", "label": "50% 초과 ~ 80% 이하", "fee_pct": 6.8, "delivery_fee": 2900, "delivery_range": [1900, 2900]},
    {"key": "t4", "label": "80% 초과 ~ 100%", "fee_pct": 2.0, "delivery_fee": 2900, "delivery_range": [1900, 2900]},
]

_PAY_NOTE = (
    "결제수수료율 3%는 공식 안내 페이지에서 확인하지 못한 임시값입니다(2023년 보도의 일반 가맹점 카드 요율). "
    "영세·중소 가맹점은 더 낮을 수 있으니 정산내역서의 '결제정산수수료'를 보고 고치세요."
)

CATALOG: list[dict] = [
    {
        "key": "baemin", "short": "배민", "label": "배달의민족 · 배민배달", "kind": "delivery",
        "tiers": _DELIVERY_TIERS, "default_tier": "t1",
        "defaults": {"fee_pct": 7.8, "pay_pct": 3.0, "delivery_fee": 3400, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": True, "fee_verified": True, "pay_verified": False,
        "sources": [BAEMIN_GUIDE, PAY_NEWS],
        "notes": [
            "중개이용료와 배달비는 부가세 별도 금액입니다. 매출 구간은 배민이 산정해 알려 주니, 우리 가게 구간을 골라 주세요.",
            "배달비는 구간별 범위 안에서 지역에 따라 달라집니다. 기본값은 범위의 위쪽입니다.",
            _PAY_NOTE,
        ],
    },
    {
        "key": "baemin_self", "short": "배민 가게배달", "label": "배달의민족 · 가게배달", "kind": "delivery",
        "tiers": [], "default_tier": "",
        "defaults": {"fee_pct": 6.8, "pay_pct": 3.0, "delivery_fee": 0, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": True, "fee_verified": True, "pay_verified": False,
        "sources": [BAEMIN_SELF_GUIDE, PAY_NEWS],
        "notes": [
            "중개이용료는 주문 건당 6.8%(부가세 별도)입니다.",
            "직접 배달하거나 대행사에 내는 배달비는 가게마다 달라 '사장님 부담 배달비'에 직접 넣어야 합니다.",
            _PAY_NOTE,
        ],
    },
    {
        "key": "baemin_pickup", "short": "배민 포장", "label": "배달의민족 · 포장주문", "kind": "pickup",
        "tiers": [], "default_tier": "",
        "defaults": {"fee_pct": 6.8, "pay_pct": 3.0, "delivery_fee": 0, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": False, "fee_verified": False, "pay_verified": False,
        "sources": [UNOFFICIAL_BAEMIN, PAY_NEWS],
        "notes": [
            "포장주문 중개이용료 6.8%(부가세 별도, 2025년 4월 14일부터)는 비공식 정리를 따른 값입니다. 배민 공식 페이지에서는 확인하지 못했습니다.",
            _PAY_NOTE,
        ],
    },
    {
        "key": "coupang", "short": "쿠팡이츠", "label": "쿠팡이츠 · 배달", "kind": "delivery",
        "tiers": _DELIVERY_TIERS, "default_tier": "t1",
        "defaults": {"fee_pct": 7.8, "pay_pct": 3.0, "delivery_fee": 3400, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": True, "fee_verified": False, "pay_verified": False,
        "sources": [COUPANG_UNCONFIRMED, FTC_NOTICE, PAY_NEWS],
        "notes": [
            "쿠팡이츠 공식 사이트를 이 환경에서 열 수 없어, 2025년 2월 발표 보도에 나온 구간별 요율(배민과 같은 구조)을 기본값으로 썼습니다. 반드시 정산내역서로 확인하세요.",
            "쿠팡이츠는 수수료를 할인 전 가격 기준으로 매겨 왔고, 공정거래위원회가 2025년 10월 실제 결제 금액 기준으로 고치라고 시정권고했습니다. 이 계산은 할인 전 가격 기준(보수적)입니다.",
            _PAY_NOTE,
        ],
    },
    {
        "key": "coupang_pickup", "short": "쿠팡이츠 포장", "label": "쿠팡이츠 · 포장", "kind": "pickup",
        "tiers": [], "default_tier": "",
        "defaults": {"fee_pct": 6.8, "pay_pct": 3.0, "delivery_fee": 0, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": False, "fee_verified": False, "pay_verified": False,
        "sources": [COUPANG_PICKUP_NEWS, PAY_NEWS],
        "notes": [
            "포장 중개이용료 6.8%는 2026년 4월부터 적용된다는 보도 기준입니다. 전통시장 매장과 매출 하위 20% 영세매장은 2027년 3월까지 지원(환급)을 받을 수 있다고 알려졌으니, 해당되면 0%로 바꾸세요.",
            _PAY_NOTE,
        ],
    },
    {
        "key": "custom", "short": "기타 배달앱", "label": "기타 배달앱(직접 입력)", "kind": "custom",
        "tiers": [], "default_tier": "",
        "defaults": {"fee_pct": 0, "pay_pct": 0, "delivery_fee": 0, "coupon_cost": 0, "pack_cost": 0, "vat_extra": True},
        "has_delivery_fee": True, "fee_verified": False, "pay_verified": False,
        "sources": [],
        "notes": ["요기요·땡겨요처럼 위에 없는 앱은 정산내역서의 수수료율을 보고 직접 넣으세요."],
    },
]

BY_KEY = {c["key"]: c for c in CATALOG}


def fmt_pct(x: float) -> str:
    return f"{x:g}"


def tier_of(entry: dict, tier_key: str) -> dict | None:
    return next((t for t in entry["tiers"] if t["key"] == tier_key), None)


def default_state(entry: dict) -> dict:
    d = dict(entry["defaults"])
    t = tier_of(entry, entry["default_tier"])
    if t:
        d["fee_pct"] = t["fee_pct"]
        d["delivery_fee"] = t["delivery_fee"]
    return {"enabled": False, "tier": entry["default_tier"], "label": "", **d}


STALE_DAYS = 90


def days_since(day: str) -> int:
    """'YYYY-MM-DD' 로부터 오늘(한국시간)까지 지난 날수."""
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone(timedelta(hours=9))).date()
    try:
        return (today - datetime.strptime(day, "%Y-%m-%d").date()).days
    except ValueError:
        return 0


def _row_state(row) -> dict:
    return {
        "enabled": bool(row["enabled"]), "tier": row["tier"], "label": row["label"],
        "fee_pct": row["fee_pct"], "pay_pct": row["pay_pct"], "delivery_fee": row["delivery_fee"],
        "coupon_cost": row["coupon_cost"], "pack_cost": row["pack_cost"], "vat_extra": bool(row["vat_extra"]),
        "checked_on": row["checked_on"],
    }


def display_name(entry: dict, state: dict) -> tuple[str, str]:
    """(짧은 이름, 긴 이름). 기타 배달앱은 사장님이 붙인 이름을 씁니다."""
    if entry["key"] == "custom" and state.get("label"):
        return state["label"], state["label"]
    return entry["short"], entry["label"]


def list_for_user(db, uid: int) -> list[dict]:
    rows = {r["key"]: r for r in db.execute("SELECT * FROM channels WHERE user_id = ?", (uid,)).fetchall()}
    out = []
    for e in CATALOG:
        row = rows.get(e["key"])
        state = _row_state(row) if row else default_state(e)
        short, label = display_name(e, state)
        basis = max(AS_OF, state.get("checked_on") or "")  # 가장 최근에 확인한 날
        out.append({**e, "short": short, "label": label, "state": state, "configured": row is not None, "as_of": AS_OF,
                    "stale": days_since(basis) > STALE_DAYS, "age_days": days_since(basis)})
    return out


def load_enabled(db, uid: int) -> list[dict]:
    """계산에 쓸 '켜 둔' 채널만. 계산 함수가 바로 쓰는 평평한 딕셔너리로 돌려줍니다."""
    rows = {r["key"]: r for r in db.execute("SELECT * FROM channels WHERE user_id = ? AND enabled = 1", (uid,)).fetchall()}
    out = []
    for e in CATALOG:
        row = rows.get(e["key"])
        if row is None:
            continue
        st = _row_state(row)
        short, label = display_name(e, st)
        out.append({
            "key": e["key"], "short": short, "label": label, "kind": e["kind"],
            "fee_pct": st["fee_pct"], "pay_pct": st["pay_pct"], "delivery_fee": st["delivery_fee"],
            "coupon_cost": st["coupon_cost"], "pack_cost": st["pack_cost"], "vat_extra": st["vat_extra"],
        })
    return out


def save(db, uid: int, key: str, data: dict) -> dict:
    """채널 설정을 저장합니다(없으면 만들고 있으면 덮어씀). 포장 채널은 배달비를 0으로 고정합니다."""
    entry = BY_KEY[key]
    tier = data.get("tier") or ""
    if tier and tier != "custom" and tier_of(entry, tier) is None:
        tier = entry["default_tier"]
    delivery_fee = data["delivery_fee"] if entry["has_delivery_fee"] else 0.0
    label = data.get("label", "") if key == "custom" else ""
    db.execute(
        "INSERT INTO channels(user_id, key, label, enabled, tier, fee_pct, pay_pct, delivery_fee, coupon_cost, pack_cost, vat_extra, checked_on, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(user_id, key) DO UPDATE SET label=excluded.label, enabled=excluded.enabled, tier=excluded.tier, "
        "fee_pct=excluded.fee_pct, pay_pct=excluded.pay_pct, delivery_fee=excluded.delivery_fee, "
        "coupon_cost=excluded.coupon_cost, pack_cost=excluded.pack_cost, vat_extra=excluded.vat_extra, checked_on=excluded.checked_on, updated_at=excluded.updated_at",
        (uid, key, label, 1 if data["enabled"] else 0, tier, data["fee_pct"], data["pay_pct"], delivery_fee,
         data["coupon_cost"], data["pack_cost"], 1 if data["vat_extra"] else 0, data.get("checked_on") or None, now_iso()),
    )
    return next(c for c in list_for_user(db, uid) if c["key"] == key)
