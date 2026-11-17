"""단위 변환. 모든 단가는 g / ml / 개 기준(기본 단위)으로 저장합니다."""
from __future__ import annotations

import re

# 화면에서 고를 수 있는 단위 -> (기본 단위 종류, 기본 단위로 환산하는 배수)
BASE_OF = {
    "g": ("g", 1.0),
    "kg": ("g", 1000.0),
    "ml": ("ml", 1.0),
    "L": ("ml", 1000.0),
    "개": ("ea", 1.0),
}

# 종류별로 화면에 보여줄 단위 목록
UI_UNITS = {"g": ["g", "kg"], "ml": ["ml", "L"], "ea": ["개"]}

# 단가를 보여줄 때 쓰는 단위(원/kg, 원/L, 원/개)
DISPLAY = {"g": ("kg", 1000.0), "ml": ("L", 1000.0), "ea": ("개", 1.0)}

_ALIAS = {
    "g": "g", "gram": "g", "그램": "g", "그람": "g",
    "kg": "kg", "㎏": "kg", "킬로": "kg", "킬로그램": "kg",
    "ml": "ml", "㎖": "ml", "cc": "ml",
    "l": "L", "ℓ": "L", "리터": "L",
    "개": "개", "ea": "개", "구": "개", "입": "개", "장": "개", "마리": "개",
    "포기": "개", "단": "개", "봉": "개", "팩": "개", "병": "개", "캔": "개",
    "알": "개", "모": "개", "pc": "개", "pcs": "개",
}


def canon_unit(u) -> str | None:
    """'KG', '킬로', 'l', '구' 같은 표기를 g/kg/ml/L/개 중 하나로 맞춥니다. 모르면 None."""
    if u is None:
        return None
    s = str(u).strip()
    if not s:
        return None
    if s in BASE_OF:
        return s
    return _ALIAS.get(s) or _ALIAS.get(s.lower())


def to_base(size: float, unit: str) -> tuple[str, float]:
    """(수량, 단위) -> (기본 단위 종류, 기본 단위 수량). 예: (15, 'kg') -> ('g', 15000)"""
    c = canon_unit(unit)
    if c is None:
        raise ValueError(f"알 수 없는 단위: {unit}")
    kind, factor = BASE_OF[c]
    return kind, float(size) * factor


def display_price(kind: str, unit_price: float) -> tuple[float, str]:
    """기본 단위당 단가 -> 화면용 단가. 예: ('g', 1.2) -> (1200.0, 'kg')"""
    unit, factor = DISPLAY[kind]
    return unit_price * factor, unit


def pretty_qty(kind: str, base_qty: float) -> tuple[float, str]:
    """기본 단위 수량 -> 읽기 쉬운 수량. 예: ('g', 1500) -> (1.5, 'kg')"""
    if kind == "g" and base_qty >= 1000:
        return round(base_qty / 1000, 3), "kg"
    if kind == "ml" and base_qty >= 1000:
        return round(base_qty / 1000, 3), "L"
    return round(base_qty, 3), {"g": "g", "ml": "ml", "ea": "개"}[kind]


_SPEC_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(kg|㎏|g|㎖|ml|ℓ|l|리터|cc|개|구|입|ea|pcs|pc|마리|포기|장)",
    re.IGNORECASE,
)


def guess_spec(text: str | None) -> tuple[float | None, str | None]:
    """'15kg/망', '30구', '1.8L' 같은 규격 문자열에서 (수량, 단위)를 찾습니다."""
    if not text:
        return None, None
    m = _SPEC_RE.search(str(text).replace(",", ""))
    if not m:
        return None, None
    unit = canon_unit(m.group(2))
    if unit is None:
        return None, None
    return float(m.group(1)), unit
