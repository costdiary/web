"""내 가게 매출 읽기.

지금은 '파일 올리기'(CSV·엑셀)만 실제로 동작합니다. 배달앱·POS 같은 곳의 API 로 가져오려면
`SalesSource` 규칙에 맞는 어댑터를 만들어 `SOURCES` 에 등록하면 됩니다(`rows()` 가 날짜별 매출을 돌려주면 끝).
각 업체의 API 가 공개되어 있는지·어떤 형식인지는 확인하지 않았으므로 어댑터는 아직 하나도 만들지 않았습니다.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Protocol

from . import importer

CHANNEL_WORDS = {
    "store": ("매장", "홀", "포스", "pos", "카드", "현장", "store"),
    "baemin": ("배민", "배달의민족", "baemin"),
    "coupang": ("쿠팡", "coupang"),
    "yogiyo": ("요기요", "yogiyo"),
    "other": ("기타", "other"),
}
CHANNEL_LABEL = {"store": "매장", "baemin": "배민", "coupang": "쿠팡이츠", "yogiyo": "요기요", "other": "기타"}
MAX_ROWS = 20000

HEAD_DAY = ("날짜", "일자", "매출일", "영업일", "date", "일시")
HEAD_AMOUNT = ("매출", "매출액", "금액", "판매금액", "합계", "결제금액", "amount", "sales")
HEAD_ORDERS = ("건수", "주문수", "주문건수", "orders", "결제건수")
HEAD_CHANNEL = ("채널", "구분", "경로", "주문경로", "channel")


class SalesSource(Protocol):
    """매출을 가져오는 곳(파일·배달앱 API·POS)이 지켜야 할 모양."""
    key: str

    def rows(self, start: date, end: date) -> list[dict]:  # [{day, channel, amount, orders}]
        ...


SOURCES: dict[str, SalesSource] = {}


def _norm(s) -> str:
    return re.sub(r"[\s_()/]", "", str(s or "")).lower()


def parse_day(v) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v or "").strip()
    m = re.match(r"^(\d{4})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})", s)
    if not m:
        m = re.match(r"^(\d{4})(\d{2})(\d{2})$", s)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def parse_channel(v) -> str:
    t = _norm(v)
    if not t:
        return "store"
    for key, words in CHANNEL_WORDS.items():
        if any(_norm(w) in t for w in words):
            return key
    return "other"


def _num(v) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = re.sub(r"[,원\s]", "", str(v or ""))
    try:
        return float(s)
    except ValueError:
        return None


def _col(headers: list[str], words: tuple[str, ...]) -> int | None:
    ws = [_norm(w) for w in words]
    for w in ws:  # 정확히 같은 이름을 먼저
        for i, h in enumerate(headers):
            if h == w:
                return i
    for w in ws:
        for i, h in enumerate(headers):
            if w and w in h:
                return i
    return None


def parse_sheet(rows: list[list]) -> dict:
    """표 한 장 -> {records, skipped, error}. 머리글 행은 날짜·금액 칸이 함께 보이는 첫 행으로 찾습니다."""
    for hi, row in enumerate(rows[:30]):
        heads = [_norm(c) for c in row]
        di, ai = _col(heads, HEAD_DAY), _col(heads, HEAD_AMOUNT)
        if di is not None and ai is not None and di != ai:
            oi, ci = _col(heads, HEAD_ORDERS), _col(heads, HEAD_CHANNEL)
            break
    else:
        return {"records": [], "skipped": 0, "error": "'날짜'와 '매출(금액)' 칸이 있는 표를 찾지 못했습니다. 첫 줄에 날짜, 매출 같은 제목을 넣어 주세요."}
    out: dict[tuple, dict] = {}
    skipped = 0
    for row in rows[hi + 1:]:
        if not any(c not in (None, "") for c in row):
            continue
        get = lambda i: row[i] if i is not None and i < len(row) else None  # noqa: E731
        day, amt = parse_day(get(di)), _num(get(ai))
        if day is None or amt is None or amt < 0 or amt > 10_000_000_000:
            skipped += 1
            continue
        orders = _num(get(oi))
        ch = parse_channel(get(ci))
        key = (day, ch)
        prev = out.get(key)
        if prev:  # 같은 날·같은 채널이 여러 줄이면 합칩니다(영수증 단위 파일 등).
            prev["amount"] += amt
            if orders is not None:
                prev["orders"] = (prev["orders"] or 0) + int(orders)
        else:
            out[key] = {"day": day, "channel": ch, "amount": amt, "orders": int(orders) if orders is not None else None}
    return {"records": list(out.values()), "skipped": skipped, "error": None}


def parse_file(filename: str, data: bytes) -> dict:
    sheets = importer.read_sheets(filename, data)
    last = None
    for sh in sheets:
        res = parse_sheet(sh["rows"])
        if res["records"]:
            return res
        last = res
    return last or {"records": [], "skipped": 0, "error": "읽을 표가 없습니다."}
