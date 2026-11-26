"""요청 본문 검증 모델."""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Base(BaseModel):
    """문자열 앞뒤 공백을 자동으로 지웁니다."""

    @model_validator(mode="before")
    @classmethod
    def _strip_strings(cls, data):
        if isinstance(data, dict):
            return {k: (v.strip() if isinstance(v, str) else v) for k, v in data.items()}
        return data


class SignupIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(min_length=1, max_length=200)
    store_name: str = Field("", max_length=60)
    code: str = Field("", max_length=60)
    identity_verification_id: str = Field("", max_length=80)  # 본인인증을 켠 경우에만 필요(identity.py)


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(min_length=1, max_length=200)


class SettingsIn(Base):
    store_name: Optional[str] = Field(None, max_length=60)
    target_cost_ratio: Optional[float] = Field(None, ge=5, le=95)
    alert_pct: Optional[float] = Field(None, ge=0.5, le=100)
    vat_mode: Optional[Literal["incl", "excl"]] = None


class LeadIn(Base):
    name: str = Field("", max_length=60)
    contact: str = Field(min_length=3, max_length=120)
    biz_type: str = Field("", max_length=60)
    message: str = Field("", max_length=1000)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class ForgotPasswordIn(BaseModel):
    email: str = Field(max_length=120)


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class IngredientIn(Base):
    name: str = Field(min_length=1, max_length=60)
    pack_size: float = Field(gt=0, le=1_000_000)
    pack_unit: str = Field(min_length=1, max_length=10)
    pack_price: float = Field(gt=0, le=1_000_000_000)
    yield_pct: float = Field(100, gt=0, le=100)
    supplier: str = Field("", max_length=60)
    category: str = Field("", max_length=30)
    # 등록란에서 직접 입력하거나 거래명세서에서 불러오는 원산지·등급·부위(전부 선택 입력).
    # 도매마켓 매핑(PUT /api/market/ingredients/{id})이 쓰는 origin/grade와 같은 칸을 공유한다.
    origin: Optional[str] = Field(None, max_length=10)
    grade: Optional[str] = Field(None, max_length=10)
    cut: Optional[str] = Field(None, max_length=40)

    @field_validator("origin", "grade", "cut")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class MenuItemIn(Base):
    ingredient_id: int
    qty: float = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=10)
    # 사진으로 추정한 양이면 true. 범위(qty_low~qty_high)는 qty와 같은 단위입니다.
    estimated: bool = False
    qty_low: Optional[float] = Field(None, gt=0, le=1_000_000)
    qty_high: Optional[float] = Field(None, gt=0, le=1_000_000)


class MenuIn(Base):
    name: str = Field(min_length=1, max_length=60)
    price: float = Field(ge=0, le=100_000_000)
    delivery_price: Optional[float] = Field(None, ge=0, le=100_000_000)
    category: str = Field("", max_length=30)
    note: str = Field("", max_length=300)
    other_cost: float = Field(0, ge=0, le=100_000_000)
    items: list[MenuItemIn] = Field(default_factory=list, max_length=60)


class PrepItemIn(Base):
    ingredient_id: int
    qty: float = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=10)


class PrepIn(Base):
    name: str = Field(min_length=1, max_length=60)
    unit_kind: Literal["g", "ml"]
    yield_qty: float = Field(gt=0, le=1_000_000)
    yield_unit: str = Field(min_length=1, max_length=10)
    items: list[PrepItemIn] = Field(default_factory=list, max_length=30)


class ChannelIn(Base):
    enabled: bool
    tier: str = Field("", max_length=10)
    label: str = Field("", max_length=20)
    fee_pct: float = Field(ge=0, le=40)
    pay_pct: float = Field(ge=0, le=15)
    delivery_fee: float = Field(0, ge=0, le=20_000)
    coupon_cost: float = Field(0, ge=0, le=100_000)
    pack_cost: float = Field(0, ge=0, le=100_000)
    vat_extra: bool = True
    checked_on: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")  # 정산내역서와 비교해 요율을 확인한 날


class RecipeLineIn(Base):
    apply: bool = True
    ingredient_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=60)
    alias: str = Field("", max_length=80)
    qty: float = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=10)
    qty_low: Optional[float] = Field(None, gt=0, le=1_000_000)
    qty_high: Optional[float] = Field(None, gt=0, le=1_000_000)
    estimated: bool = True


class RecipeConfirmIn(Base):
    name: str = Field(min_length=1, max_length=60)
    price: float = Field(0, ge=0, le=100_000_000)
    delivery_price: Optional[float] = Field(None, ge=0, le=100_000_000)
    category: str = Field("", max_length=30)
    lines: list[RecipeLineIn] = Field(min_length=1, max_length=60)


class ImportIngredientIn(Base):
    """가져오기 미리보기에서 사장님이 확인한 식자재 한 줄. 가격은 없을 수 있습니다(단가 없음으로 등록)."""
    name: str = Field(min_length=1, max_length=60)
    supplier: str = Field("", max_length=60)
    category: str = Field("", max_length=30)
    pack_unit: str = Field(min_length=1, max_length=10)
    pack_size: Optional[float] = Field(None, gt=0, le=1_000_000)
    pack_price: Optional[float] = Field(None, gt=0, le=1_000_000_000)
    yield_pct: Optional[float] = Field(None, gt=0, le=100)


class ImportLineIn(Base):
    name: str = Field(min_length=1, max_length=60)
    ingredient_id: Optional[int] = None  # 비어 있으면 같은 이름의 식자재를 쓰고, 없으면 '단가 없음'으로 새로 만듭니다.
    qty: float = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=10)


class ImportMenuIn(Base):
    name: str = Field(min_length=1, max_length=60)
    price: Optional[float] = Field(None, ge=0, le=100_000_000)
    delivery_price: Optional[float] = Field(None, ge=0, le=100_000_000)
    category: str = Field("", max_length=30)
    other_cost: Optional[float] = Field(None, ge=0, le=100_000_000)
    lines: list[ImportLineIn] = Field(default_factory=list, max_length=60)


class ImportCommitIn(Base):
    kind: Literal["ingredients", "menus"]
    on_conflict: Literal["update", "skip"] = "update"
    ingredients: list[ImportIngredientIn] = Field(default_factory=list, max_length=3000)
    menus: list[ImportMenuIn] = Field(default_factory=list, max_length=3000)


class InvoiceLineIn(Base):
    apply: bool = True
    ingredient_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=60)
    alias: str = Field("", max_length=80)
    pack_size: float = Field(gt=0, le=1_000_000)
    pack_unit: str = Field(min_length=1, max_length=10)
    pack_price: float = Field(gt=0, le=1_000_000_000)
    # 거래명세서 자동 인식(또는 사장님 수정)이 뽑아낸 원산지·등급·부위. 새 식자재를 만들 때 반영되고,
    # 이미 있는 식자재는 해당 칸이 비어 있을 때만 채운다(다른 경로로 이미 입력/매핑된 값은 덮지 않음).
    origin: Optional[str] = Field(None, max_length=10)
    grade: Optional[str] = Field(None, max_length=10)
    cut: Optional[str] = Field(None, max_length=40)

    @field_validator("origin", "grade", "cut")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class InvoiceConfirmIn(Base):
    supplier: str = Field("", max_length=60)
    invoice_date: Optional[str] = Field(None, max_length=10)
    total: Optional[float] = Field(None, ge=0)
    source: Literal["ocr", "manual", "demo"] = "manual"
    lines: list[InvoiceLineIn] = Field(min_length=1, max_length=200)

    @field_validator("invoice_date")
    @classmethod
    def _date_ok(cls, v):
        return v if v and re.match(r"^\d{4}-\d{2}-\d{2}$", v) else None


class FixedCostIn(Base):
    label: str = Field(min_length=1, max_length=30)
    amount: float = Field(ge=0, le=10_000_000_000)


class StaffIn(Base):
    """직원 한 명. 시급·근무시간은 서버에서도 범위를 확인합니다(최저임금 미달은 막지 않고 화면에서 경고)."""
    name: str = Field(min_length=1, max_length=30)
    hourly_wage: float = Field(gt=0, le=200_000)
    weekly_hours: float = Field(gt=0, le=80)
    work_days: int = Field(5, ge=1, le=7)
    night_hours: float = Field(0, ge=0, le=80)
    active: bool = True

    @field_validator("night_hours")
    @classmethod
    def _night_within_week(cls, v, info):
        wh = info.data.get("weekly_hours")
        if wh is not None and v > wh:
            raise ValueError("야간근무 시간은 주 근무시간을 넘을 수 없습니다.")
        return v


class LaborSettingsIn(Base):
    """사업장 전체 설정: 상시 근로자 5명 이상이면 연장·야간·휴일 가산수당(근로기준법 제56조)이 적용됩니다."""
    five_plus: bool = False


class SalesDayIn(Base):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    channel: str = Field("store", max_length=20)
    amount: float = Field(ge=0, le=10_000_000_000)
    orders: Optional[int] = Field(None, ge=0, le=1_000_000)


class SalesItemIn(Base):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    menu_id: int
    qty: float = Field(ge=0, le=100_000)


class LocationIn(Base):
    lat: float = Field(ge=33.0, le=38.7)
    lon: float = Field(ge=124.5, le=132.0)
    radius_m: int = Field(500, ge=100, le=2000)
    label: str = Field("", max_length=100)


class BreakevenIn(Base):
    fixed: list[FixedCostIn] = Field(default_factory=list, max_length=30)
    delivery_share: float = Field(0, ge=0, le=100)
    open_days: int = Field(26, ge=1, le=31)
    target_profit: float = Field(0, ge=0, le=10_000_000_000)
    payment_fee_pct: float = Field(0, ge=0, le=10)


# ====================================================================== 도매 마켓(사장님 쪽)

class MarketSettingsIn(Base):
    demand_optin: Optional[bool] = None
    ad_optin: Optional[bool] = None
    threshold_pct: Optional[float] = Field(None, ge=1, le=30)
    region_code: Optional[str] = Field(None, max_length=20)
    ack_notice: Optional[bool] = None


class MarketMapIn(Base):
    """PUT /api/market/ingredients/{id}: 표준 품목을 사람이 고르는 단계는 없어졌고, 이 엔드포인트는
    "단가제안받기 켜기/끄기" 역할이다. enabled=true면 서버가 식자재 이름으로 품목을 자동 resolve한다."""
    enabled: bool = True
    # 비우면(None) 식자재에 이미 입력된 값을 쓴다. enabled=true인데 origin이 둘 다 없으면 400.
    origin: Optional[str] = Field(None, max_length=10)
    grade: Optional[str] = Field(None, max_length=40)
    cut: Optional[str] = Field(None, max_length=40)

    @field_validator("cut", "grade", "origin")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class MarketBulkMapIn(Base):
    ingredient_ids: list[int] = Field(min_length=1, max_length=100)
    # 비우면 각 식자재에 이미 입력된 origin을 그대로 쓴다.
    origin: Optional[str] = Field(None, max_length=10)

    @field_validator("origin")
    @classmethod
    def _blank_to_none(cls, v):
        return v or None


class MarketItemRequestIn(Base):
    name: str = Field(min_length=1, max_length=60)
    unit_kind: Literal["g", "ml", "ea"]
    note: str = Field("", max_length=300)
    confirm: bool = False


class ConnectIn(Base):
    contact: str = Field(min_length=3, max_length=60)
    message: str = Field("", max_length=300)
    share_store_name: bool = False


class OutcomeIn(Base):
    outcome: Literal["done", "failed"]
    reason: str = Field("", max_length=200)


# ====================================================================== 도매업체 쪽

class WsSignupIn(Base):
    email: str = Field(max_length=120)
    password: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=40)
    phone: str = Field("", max_length=30)
    agree_terms: bool

    @field_validator("agree_terms")
    @classmethod
    def _must_agree(cls, v):
        if not v:
            raise ValueError("약관에 동의해야 가입할 수 있습니다.")
        return v


class WsProfileIn(Base):
    contact_name: Optional[str] = Field(None, max_length=40)
    phone: Optional[str] = Field(None, max_length=30)
    intro: Optional[str] = Field(None, max_length=200)
    regions: Optional[list[str]] = Field(None, min_length=1, max_length=8)


class WsVerifyIn(Base):
    verification_id: int
    biz_no: str = Field(pattern=r"^\d{10}$")
    biz_name: str = Field(min_length=1, max_length=60)
    ceo_name: str = Field(min_length=1, max_length=40)
    open_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class BidIn(Base):
    demand_id: Optional[int] = None
    pack_size: float = Field(gt=0, le=1_000_000)
    pack_unit: str = Field(min_length=1, max_length=10)
    pack_price: float = Field(gt=0, le=1_000_000_000)
    vat_type: Literal["incl", "excl", "exempt"] = "incl"
    min_order_note: str = Field("", max_length=200)
    valid_days: int = Field(14, ge=1, le=30)


class AdIn(Base):
    item_id: int
    origin: str = Field(min_length=1, max_length=10)
    grade: str = Field(min_length=1, max_length=10)
    title: str = Field(min_length=1, max_length=40)
    body: str = Field("", max_length=500)
    pack_size: float = Field(gt=0, le=1_000_000)
    pack_unit: str = Field(min_length=1, max_length=10)
    pack_price: float = Field(gt=0, le=1_000_000_000)
    vat_type: Literal["incl", "excl", "exempt"] = "incl"
    stock_note: str = Field("", max_length=100)
    run_days: int = Field(3, ge=1, le=14)
    regions: list[str] = Field(min_length=1, max_length=11)


class AdPayIn(Base):
    depositor_name: str = Field(min_length=1, max_length=40)
    tax_invoice: bool = False


class PgConfirmIn(Base):
    order_id: str = Field(min_length=1, max_length=80)
    payment_key: str = Field(min_length=1, max_length=200)


class DonationIn(Base):
    nickname: str = Field(min_length=1, max_length=30)
    amount: int = Field(ge=1000, le=1000000)
    message: str = Field("", max_length=200)
    amount_public: bool = False  # 공개는 후원자가 직접 켜는 선택(opt-in). 화면도 기본 꺼짐으로 보냄.


class RespondIn(Base):
    accept: bool


class IdentityStartIn(Base):
    purpose: str = Field("signup", pattern="^(signup|account)$")


class IdentityMockIn(Base):
    name: str = Field("", max_length=30)
    phone: str = Field("", max_length=20)
    birth_date: str = Field("", max_length=10)


class IdentityCompleteIn(Base):
    verification_id: str = Field(min_length=1, max_length=80)
    mock: IdentityMockIn | None = None  # 키가 없는 테스트 모드에서만 쓰인다(MockIdentityProvider)
