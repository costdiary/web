"""다른 앱·엑셀에서 쓰던 식자재 단가표와 메뉴·레시피표 읽어 오기.

앱마다 내려받기 양식이 달라서, 제목 줄의 이름으로 칸을 짐작하고(사장님이 화면에서 고칠 수 있음) 읽은 내용을 미리 보여 준 뒤에만 저장합니다.
파일 자체는 서버에 저장하지 않습니다. 읽을 수 있는 형식은 .xlsx 와 CSV 입니다.
"""
from __future__ import annotations

import csv
import io
import math
import re
import unicodedata
import zipfile
from datetime import date, datetime

from . import services, units

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 3000
MAX_COLS = 60
MAX_SHEETS = 12
MAX_MENU_LINES = 60  # 메뉴 하나에 넣을 수 있는 재료 줄 수(schemas.MenuIn 과 같게)
HEADER_SCAN = 15
EXAMPLE_PREFIX = "(예시)"  # 내려받은 양식의 예시 줄. 지우지 않고 올려도 무시합니다.
SKIP_NAMES = {"합계", "소계", "총계", "계", "total", "sum", "subtotal"}
AUTO_LINK_SCORE = 0.95  # 이름이 완전히 같거나 이전에 연결해 둔 이름일 때만 저절로 연결합니다(비슷한 이름은 추천만).

XLS_MESSAGE = "예전 엑셀 형식(.xls)은 읽지 못합니다. 엑셀에서 '다른 이름으로 저장'으로 .xlsx 또는 CSV(UTF-8)로 저장해 올려 주세요."


class ImportFileError(Exception):
    """사용자에게 그대로 보여줘도 되는 파일 읽기 실패 사유."""


# ---------------------------------------------------------------- 파일 읽기

_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]+")


def _cell(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return "예" if v else "아니오"
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, (datetime, date)):
        return v.isoformat()[:10]
    s = _CTRL.sub("", str(v)).strip()
    return s or None


def _trim(rows: list[list]) -> list[list]:
    """뒤쪽의 빈 칸·빈 줄을 잘라 내고 줄마다 칸 수를 맞춥니다."""
    rows = [list(r[:MAX_COLS]) for r in rows]
    while rows and not any(c is not None for c in rows[-1]):
        rows.pop()
    width = max((max((i + 1 for i, c in enumerate(r) if c is not None), default=0) for r in rows), default=0)
    return [r[:width] + [None] * (width - len(r)) for r in rows]


def _decode(data: bytes) -> str:
    encs = ["utf-16"] if data[:2] in (b"\xff\xfe", b"\xfe\xff") else []
    for enc in encs + ["utf-8-sig", "cp949"]:
        try:
            text = data.decode(enc)
        except UnicodeDecodeError:
            continue
        if "\x00" in text:
            break
        return text
    raise ImportFileError("글자를 읽지 못했습니다. 엑셀에서 'CSV UTF-8' 또는 .xlsx 로 저장해 올려 주세요.")


def _read_csv(data: bytes) -> list[dict]:
    text = _decode(data)
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    delim = max([",", "\t", ";", "|"], key=first.count)
    rows = []
    try:
        for i, r in enumerate(csv.reader(io.StringIO(text), delimiter=delim)):
            if i > MAX_ROWS + HEADER_SCAN:
                break
            rows.append([_cell(c) for c in r])
    except csv.Error as e:
        raise ImportFileError("CSV 파일을 읽지 못했습니다. 엑셀에서 'CSV UTF-8' 로 다시 저장해 보세요.") from e
    return [{"name": "CSV", "rows": _trim(rows)}]


def _read_xlsx(data: bytes) -> list[dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if len(infos) > 500 or sum(i.file_size for i in infos) > 30 * 1024 * 1024:
                raise ImportFileError("파일이 너무 커서 읽을 수 없습니다. 필요한 시트만 따로 저장해 올려 주세요.")
    except zipfile.BadZipFile as e:
        raise ImportFileError("엑셀 파일(.xlsx)이 아니거나 손상되었습니다. 엑셀에서 다시 저장해 보세요.") from e
    import openpyxl  # 가져오기를 쓸 때만 불러옵니다.

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:
        raise ImportFileError("엑셀 파일을 열지 못했습니다. 암호가 걸려 있거나 손상된 파일일 수 있습니다.") from e
    sheets = []
    try:
        for ws in wb.worksheets[:MAX_SHEETS]:
            if getattr(ws, "sheet_state", "visible") != "visible":
                continue
            try:
                ws.reset_dimensions()  # 일부 프로그램이 잘못 적어 둔 표 크기를 무시하고 실제 내용을 읽습니다.
            except Exception:
                pass
            rows = [
                [_cell(c) for c in r]
                for r in ws.iter_rows(min_row=1, max_row=MAX_ROWS + HEADER_SCAN + 1, max_col=MAX_COLS, values_only=True)
            ]
            sheets.append({"name": str(ws.title), "rows": _trim(rows)})
    except ImportFileError:
        raise
    except Exception as e:
        raise ImportFileError("엑셀 내용을 읽는 중 문제가 생겼습니다. 엑셀에서 다시 저장해 올려 보세요.") from e
    finally:
        wb.close()
    return sheets


def read_sheets(filename: str, data: bytes) -> list[dict]:
    """파일 -> [{name, rows}]. 셀 값은 글자·숫자·None 입니다."""
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if data[:4] == b"\xd0\xcf\x11\xe0":  # 예전 .xls (OLE2)
        raise ImportFileError(XLS_MESSAGE)
    if data[:4] == b"PK\x03\x04":
        sheets = _read_xlsx(data)
    elif ext in ("xlsx", "xlsm"):
        raise ImportFileError("엑셀 파일(.xlsx)이 아니거나 손상되었습니다. 엑셀에서 다시 저장해 보세요.")
    elif ext in ("csv", "tsv", "txt", "xls"):
        # 이름만 .xls 인 탭 구분 글자 파일도 있어 글자로 읽어 봅니다. 표(HTML)로 저장한 .xls 는 읽지 못합니다.
        if ext == "xls" and re.search(rb"<\s*(table|html)", data[:4096], re.IGNORECASE):
            raise ImportFileError(XLS_MESSAGE)
        sheets = _read_csv(data)
    else:
        raise ImportFileError("엑셀(.xlsx) 또는 CSV 파일만 올릴 수 있습니다.")
    sheets = [s for s in sheets if len(s["rows"]) >= 2]
    if not sheets:
        raise ImportFileError("읽을 내용이 없습니다. 제목 줄 아래에 데이터가 한 줄 이상 있어야 합니다.")
    return sheets


# ---------------------------------------------------------------- 칸 이름 짐작

# 칸 종류 -> 제목 줄에 흔히 쓰는 이름. 비교할 때는 공백·괄호 안 글자·기호를 지우고 소문자로 맞춥니다.
VOCAB = {
    "ingredients": {
        "name": ["식자재", "식자재명", "식자재이름", "식재료", "식재료명", "재료", "재료명", "재료이름", "품목", "품목명", "품명", "상품", "상품명",
                 "제품", "제품명", "자재", "자재명", "원재료", "원재료명", "이름", "name", "item", "ingredient"],
        "supplier": ["거래처", "거래처명", "공급처", "공급업체", "공급사", "업체", "업체명", "납품처", "구매처", "구입처", "매입처", "supplier", "vendor"],
        "category": ["분류", "카테고리", "구분", "종류", "대분류", "category"],
        "pack_size": ["규격수량", "구매수량", "포장수량", "용량", "중량", "입수", "함량", "packsize", "size"],
        "pack_unit": ["규격단위", "구매단위", "포장단위", "단위", "unit"],
        "spec": ["규격", "스펙", "사양", "spec"],
        "pack_price": ["구매가", "구매가격", "구입가", "매입가", "포장가격", "포장가", "박스가격", "가격", "price"],
        "price_any": ["단가", "매입단가", "구매단가", "unitprice"],
        "unit_price": ["환산단가", "단위당단가", "단위당가격", "kg당", "kg당단가", "개당", "l당", "원/kg", "원/l"],
        "unit_price_unit": ["단가단위", "환산단위", "기준단위"],
        "yield_pct": ["수율", "yield"],
    },
    "menus": {
        "menu_name": ["메뉴", "메뉴명", "메뉴이름", "요리", "요리명", "레시피", "레시피명", "제품명", "menu", "dish", "recipe"],
        "price": ["판매가", "판매가격", "메뉴가격", "판매단가", "메뉴가", "가격", "price"],
        "delivery_price": ["배달가", "배달가격", "배달앱판매가", "배달앱가", "배달앱가격", "배달판매가", "배민가", "배달단가"],
        "category": ["분류", "카테고리", "구분", "category"],
        "other_cost": ["기타원가", "기타비용", "부재료비", "기타", "포장비"],
        "ing_name": ["재료", "재료명", "식자재", "식자재명", "식재료", "식재료명", "원재료", "사용재료", "품목", "ingredient"],
        "qty": ["사용량", "수량", "투입량", "레시피량", "중량", "양", "1인분", "amount", "qty"],
        "unit": ["단위", "사용단위", "unit"],
    },
}

# 화면에 보여 줄 칸 설명(순서대로 표시). required 인 칸은 꼭 골라야 합니다.
FIELDS = {
    "ingredients": [
        {"key": "name", "label": "식자재 이름", "required": True, "hint": ""},
        {"key": "pack_size", "label": "규격 수량", "required": False, "hint": "예: 15kg 양파면 15"},
        {"key": "pack_unit", "label": "규격 단위", "required": False, "hint": "kg, g, L, ml, 개"},
        {"key": "spec", "label": "규격(글자)", "required": False, "hint": "'15kg/망', '30구'처럼 수량과 단위가 한 칸에 있을 때"},
        {"key": "pack_price", "label": "구매 가격(한 포장의 값)", "required": False, "hint": "15kg 한 망이 18,000원이면 18,000"},
        {"key": "price_any", "label": "단가(어느 쪽인지 애매할 때)", "required": False, "hint": "구매 가격 칸이 따로 없을 때만 고르세요"},
        {"key": "unit_price", "label": "kg·L·개당 단가", "required": False, "hint": "이미 1kg(1L, 1개)당 값이 적혀 있을 때"},
        {"key": "unit_price_unit", "label": "단가 단위", "required": False, "hint": "kg당 단가면 kg"},
        {"key": "supplier", "label": "거래처", "required": False, "hint": ""},
        {"key": "category", "label": "분류", "required": False, "hint": ""},
        {"key": "yield_pct", "label": "수율(%)", "required": False, "hint": "다듬고 남는 비율. 없으면 건드리지 않습니다"},
    ],
    "menus": [
        {"key": "menu_name", "label": "메뉴 이름", "required": True, "hint": ""},
        {"key": "price", "label": "판매가", "required": False, "hint": ""},
        {"key": "ing_name", "label": "재료 이름", "required": False, "hint": "재료가 한 줄에 하나씩 적혀 있을 때"},
        {"key": "qty", "label": "사용량", "required": False, "hint": "1인분 기준"},
        {"key": "unit", "label": "사용 단위", "required": False, "hint": "g, kg, ml, L, 개"},
        {"key": "delivery_price", "label": "배달앱 판매가", "required": False, "hint": ""},
        {"key": "category", "label": "분류", "required": False, "hint": ""},
        {"key": "other_cost", "label": "기타 원가", "required": False, "hint": "소스·포장처럼 재료 목록에 없는 비용"},
    ],
}
REQUIRED = {"ingredients": "name", "menus": "menu_name"}

_PAREN = re.compile(r"[\(\[（].*?[\)\]）]")
_SEP = re.compile(r"[\s_\-·ㆍ.,:;'\"]+")


def norm_header(s) -> str:
    t = unicodedata.normalize("NFKC", str(s or ""))
    return _SEP.sub("", _PAREN.sub("", t)).lower()


def _vocab_index(kind: str) -> dict[str, str]:
    idx: dict[str, str] = {}
    for field, words in VOCAB[kind].items():
        for w in words:
            idx.setdefault(norm_header(w), field)
    return idx


_VOCAB_IDX = {k: _vocab_index(k) for k in VOCAB}

# 정확히 같은 이름이 없을 때, 제목에 이 글자가 들어 있으면 그 칸으로 짐작합니다(앞에 있는 것이 우선).
_CONTAINS = {
    "ingredients": [("수율", "yield_pct"), ("거래처", "supplier"), ("공급", "supplier"), ("규격", "spec"), ("단가", "price_any"),
                    ("가격", "price_any"), ("품목", "name"), ("품명", "name"), ("재료", "name"), ("식자재", "name")],
    "menus": [("배달", "delivery_price"), ("판매", "price"), ("메뉴", "menu_name"), ("재료", "ing_name"), ("사용량", "qty")],
}


def guess_mapping(headers: list[str], kind: str) -> dict[str, int]:
    """제목 줄 -> {칸 종류: 열 번호}. 같은 종류가 여러 열에 있으면 앞의 것을 씁니다."""
    idx = _VOCAB_IDX[kind]
    mapping: dict[str, int] = {}
    for i, h in enumerate(headers):
        field = idx.get(norm_header(h))
        if field and field not in mapping:
            mapping[field] = i
    used = set(mapping.values())
    for i, h in enumerate(headers):
        if i in used or not h:
            continue
        n = norm_header(h)
        for needle, field in _CONTAINS[kind]:
            if needle in n and field not in mapping:
                mapping[field] = i
                used.add(i)
                break
    return mapping


# 제목에 단위가 적혀 있는 경우: '단가(원/kg)', 'kg당 단가', '100g당 가격', '사용량(g)'
_UNIT_RE = r"kg|g|ml|l|리터|개|ea"
_HINT = re.compile(
    rf"(?:(?P<n1>\d+(?:\.\d+)?)\s*)?(?<![a-z])(?P<u1>{_UNIT_RE})\s*당"
    rf"|/\s*(?:(?P<n2>\d+(?:\.\d+)?)\s*)?(?<![a-z])(?P<u2>{_UNIT_RE})(?![a-z])"
    rf"|\(\s*(?:(?P<n3>\d+(?:\.\d+)?)\s*)?(?<![a-z])(?P<u3>{_UNIT_RE})\s*\)",
    re.IGNORECASE,
)


def header_unit_hint(title) -> tuple[float, str] | None:
    """제목에서 (수량, 단위)를 찾습니다. '단가(원/kg)' -> (1, 'kg'), '100g당 가격' -> (100, 'g')."""
    m = _HINT.search(unicodedata.normalize("NFKC", str(title or "")))
    if not m:
        return None
    for i in "123":
        u = m.group(f"u{i}")
        if u:
            unit = units.canon_unit(u)
            if unit is None:
                return None
            n = m.group(f"n{i}")
            return (float(n) if n else 1.0), unit
    return None


def column_hints(headers: list[str], mapping: dict[str, int]) -> dict[str, tuple[float, str]]:
    out = {}
    for field in ("pack_size", "price_any", "unit_price", "qty"):
        i = mapping.get(field)
        if i is not None and i < len(headers):
            h = header_unit_hint(headers[i])
            if h:
                out[field] = h
    return out


def _header_score(row: list) -> tuple[int, int]:
    """(재료표 점수, 메뉴표 점수): 제목 줄처럼 보이는 정도."""
    scores = []
    for kind in ("ingredients", "menus"):
        fields = {_VOCAB_IDX[kind].get(norm_header(c)) for c in row if isinstance(c, str)}
        fields.discard(None)
        scores.append(len(fields))
    return scores[0], scores[1]


def detect_header_row(rows: list[list]) -> int:
    best, best_score = 0, 0
    for i, r in enumerate(rows[:HEADER_SCAN]):
        if sum(1 for c in r if c is not None) < 2:
            continue
        s = max(_header_score(r))
        if s > best_score:
            best, best_score = i, s
    return best


def detect_kind(headers: list[str]) -> str:
    ing, men = _header_score(headers)
    has_menu_name = any(_VOCAB_IDX["menus"].get(norm_header(h)) == "menu_name" for h in headers if isinstance(h, str))
    return "menus" if (has_menu_name and men >= ing) or men > ing else "ingredients"


def sheet_overview(sheet: dict, header_row: int | None = None) -> dict:
    """시트 하나를 화면에 보여 줄 요약. header_row 는 0부터 세는 줄 번호(None 이면 자동으로 찾음)."""
    rows = sheet["rows"]
    hr = detect_header_row(rows) if header_row is None else max(0, min(header_row, len(rows) - 1))
    headers = [str(c) if c is not None else "" for c in rows[hr]]
    body = rows[hr + 1:]
    cols = []
    for i, title in enumerate(headers):
        samples = []
        for r in body:
            if i < len(r) and r[i] is not None:
                v = r[i]
                samples.append(f"{v:g}" if isinstance(v, float) else str(v)[:24])
                if len(samples) == 3:
                    break
        cols.append({"index": i, "title": title or f"(제목 없음 {i + 1})", "samples": samples})
    return {
        "name": sheet["name"],
        "row_count": len(body),
        "header_row": hr + 1,  # 사람이 세는 번호(1부터)
        "columns": cols,
        "kind": detect_kind(headers),
        "mappings": {k: guess_mapping(headers, k) for k in VOCAB},
        "truncated": len(body) > MAX_ROWS,
    }


# ---------------------------------------------------------------- 값 읽기

def _num(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    s = unicodedata.normalize("NFKC", str(v)).replace(",", "").replace("원", "").replace("₩", "").replace("%", "").strip()
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def _unit_of(v) -> str | None:
    """'kg', 'KG', 'g(그램)', '(L)' -> 표준 단위. 모르면 None."""
    if not isinstance(v, str):
        return None
    s = unicodedata.normalize("NFKC", v).strip()
    c = units.canon_unit(s)
    if c:
        return c
    outer = _PAREN.sub("", s).strip()
    c = units.canon_unit(outer) if outer else None
    if c:
        return c
    m = re.search(r"[\(\[]\s*([^\)\]]+?)\s*[\)\]]", s)
    return units.canon_unit(m.group(1)) if m else None


def _spec_pair(v):
    """'15kg/망', '30구' -> (15.0, 'kg'). 'kg' 처럼 단위만 있으면 (None, 'kg')."""
    if v is None:
        return None, None
    s = unicodedata.normalize("NFKC", str(v)).strip()
    size, unit = units.guess_spec(s)
    if size is not None:
        return size, unit
    return None, _unit_of(s)


def _qty_cell(v):
    """칸 하나 -> (수량, 단위). '15', 15, '15kg', '30구' 모두 읽습니다."""
    n = _num(v)
    if n is not None:
        return n, None
    return _spec_pair(v)


def _text(v, limit: int) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()[:limit]


def _get(row: list, mapping: dict, field: str):
    i = mapping.get(field)
    if i is None or i >= len(row):
        return None
    return row[i]


def _yield(v):
    n = _num(v)
    if n is None:
        return None, ""
    if 0 < n <= 1:
        n *= 100.0  # 0.9 -> 90%
    if 0 < n <= 100:
        return n, ""
    return None, f"수율 '{v}'은(는) 1에서 100 사이가 아니라 무시했습니다."


def _skippable(name: str) -> bool:
    return name.lower() in SKIP_NAMES or name.startswith(EXAMPLE_PREFIX)


# ---------------------------------------------------------------- 식자재 표

PRICE_UNKNOWN_MSG = "가격이 몇 kg(또는 L·개) 기준인지 알 수 없습니다. '규격 수량·단위' 칸을 지정해 주세요."


def ingredient_record(row: list, mapping: dict, row_no: int, hints: dict | None = None) -> dict:
    hints = hints or {}
    name = _text(_get(row, mapping, "name"), 60)
    rec = {
        "row": row_no, "name": name, "supplier": _text(_get(row, mapping, "supplier"), 60), "category": _text(_get(row, mapping, "category"), 30),
        "pack_size": None, "pack_unit": None, "pack_price": None, "yield_pct": None, "kind": None,
        "unit_price": None, "display_price": None, "display_unit": None, "ok": True, "error": "", "warn": [],
    }
    if not name:
        return {**rec, "ok": False, "error": "식자재 이름이 비어 있습니다."}

    # 구매 규격(수량·단위): 수량 칸 -> 단위 칸 -> 규격 글자 -> 제목에 적힌 단위 순서로 채웁니다.
    size, unit = _qty_cell(_get(row, mapping, "pack_size"))
    unit = _unit_of(_get(row, mapping, "pack_unit")) or unit
    spec = _get(row, mapping, "spec")
    if spec is not None and (size is None or unit is None):
        s2, u2 = _spec_pair(spec)
        size = s2 if size is None else size
        unit = u2 if unit is None else unit
    if unit is None and hints.get("pack_size"):
        unit = hints["pack_size"][1]

    pack_price = _num(_get(row, mapping, "pack_price"))
    price_any = _num(_get(row, mapping, "price_any"))
    unit_price = _num(_get(row, mapping, "unit_price"))
    up_unit = _unit_of(_get(row, mapping, "unit_price_unit"))

    price = None
    if pack_price and pack_price > 0:  # 한 포장의 값
        price = pack_price
        if unit and not size:
            size = 1.0
    elif price_any and price_any > 0:  # 그냥 '단가': 단가 단위 칸 > 제목의 단위 > 규격 > 단위만 있으면 1단위 값
        if up_unit:
            size, unit, price = 1.0, up_unit, price_any
        elif hints.get("price_any"):
            size, unit = hints["price_any"]
            price = price_any
        else:
            price = price_any
            if unit and not size:
                size = 1.0
    elif unit_price and unit_price > 0:  # 이미 kg·L·개당으로 환산된 값
        if up_unit:
            size, unit, price = 1.0, up_unit, unit_price
        elif hints.get("unit_price"):
            size, unit = hints["unit_price"]
            price = unit_price
        elif unit:
            size, price = 1.0, unit_price
    if price is not None and not (size and size > 0 and unit):
        return {**rec, "ok": False, "error": PRICE_UNKNOWN_MSG}
    if price is None and unit is None:
        unit = up_unit or (hints.get("price_any") or hints.get("unit_price") or (None, None))[1]
        if unit is None:
            return {**rec, "ok": False, "error": "단위와 가격을 모두 알 수 없습니다."}
    if price is not None and (price > 1_000_000_000 or size > 1_000_000):
        return {**rec, "ok": False, "error": "숫자가 너무 큽니다. 칸을 잘못 고르지 않았는지 확인하세요."}

    y, ywarn = _yield(_get(row, mapping, "yield_pct"))
    if ywarn:
        rec["warn"].append(ywarn)
    rec["yield_pct"] = y
    rec["pack_unit"] = unit
    if price is not None:
        kind, base_qty = units.to_base(size, unit)
        disp, du = units.display_price(kind, price / base_qty)
        rec.update(pack_size=size, pack_price=price, kind=kind, unit_price=price / base_qty, display_price=round(disp, 2), display_unit=du)
    else:
        kind = units.to_base(1, unit)[0]
        rec.update(kind=kind, display_unit=units.DISPLAY[kind][0])
        rec["warn"].append("가격이 없어 '단가 없음'으로 등록합니다. 나중에 명세서로 채울 수 있습니다.")
    return rec


def _same_price(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= 1e-9 * max(1.0, abs(a))


def ingredient_records(body: list[list], mapping: dict, first_row_no: int, existing: dict[str, dict], hints: dict | None = None) -> list[dict]:
    out: list[dict] = []
    for i, row in enumerate(body[:MAX_ROWS]):
        if not any(c is not None for c in row):
            continue
        name = _text(_get(row, mapping, "name"), 60)
        if _skippable(name):
            continue
        out.append(ingredient_record(row, mapping, first_row_no + i, hints))
    last: dict[str, int] = {}
    for idx, r in enumerate(out):
        if r["name"]:
            last[r["name"]] = idx
    for idx, r in enumerate(out):
        if r["name"] and last[r["name"]] != idx and r["ok"]:
            r.update(ok=False, dup=True, error="같은 이름이 아래에 또 있어 마지막 줄만 가져옵니다.")
    for r in out:
        ex = existing.get(r["name"])
        r["existing"] = {k: ex[k] for k in ("display_price", "display_unit", "kind", "used")} if ex else None
        if not r["ok"]:
            r["action"] = "skip"
        elif ex is None:
            r["action"] = "create"
        else:
            priced = r["unit_price"] is not None
            if priced and ex["kind"] != r["kind"] and ex["used"]:
                r.update(ok=False, error="메뉴에서 쓰고 있어 단위 종류(무게·부피·개수)를 바꿀 수 없습니다.", action="skip")
                continue
            price_changed = priced and (ex["kind"] != r["kind"] or not _same_price(ex["unit_price"], r["unit_price"]))
            meta_changed = bool(
                (r["supplier"] and r["supplier"] != ex["supplier"])
                or (r["category"] and r["category"] != ex["category"])
                or (r["yield_pct"] is not None and abs(r["yield_pct"] - ex["yield_pct"]) > 1e-9)
            )
            r["action"] = "update" if (price_changed or meta_changed) else "same"
            if price_changed and ex.get("recent_at"):
                r["recent_conflict"] = True
                r["warn"].append(f"최근({str(ex['recent_at'])[:10]}) 명세서·직접 입력으로 바뀐 단가가 있습니다. 파일의 옛 단가로 덮어쓰지 않도록 체크를 꺼 두었습니다.")
    return out


def ingredient_stats(recs: list[dict]) -> dict:
    s = {"total": len(recs), "create": 0, "update": 0, "same": 0, "skip": 0, "error": 0, "unpriced": 0}
    for r in recs:
        if not r["ok"]:
            s["skip" if r.get("dup") else "error"] += 1
            continue
        s[r["action"]] += 1
        if r["unit_price"] is None:
            s["unpriced"] += 1
    return s


# ---------------------------------------------------------------- 메뉴·레시피 표

def menu_records(body: list[list], mapping: dict, first_row_no: int, ings: list, aliases: dict[str, int],
                 existing_menus: dict[str, int], hints: dict | None = None) -> list[dict]:
    hints = hints or {}
    by_id = {r["id"]: r for r in ings}
    groups: dict[str, dict] = {}
    order: list[str] = []
    current: str | None = None
    skipping = False  # 예시 메뉴 아래 줄(메뉴 이름이 비어 있는 줄)도 같이 건너뜁니다.
    cache: dict[str, tuple | None] = {}
    for i, row in enumerate(body[:MAX_ROWS]):
        if not any(c is not None for c in row):
            continue
        row_no = first_row_no + i
        name = _text(_get(row, mapping, "menu_name"), 60)
        if name:
            skipping = _skippable(name)
            if skipping:
                continue
            current = name
        elif skipping or current is None:
            continue
        g = groups.get(current)
        if g is None:
            g = groups[current] = {"row": row_no, "name": current, "price": None, "delivery_price": None, "category": "", "other_cost": None,
                                   "lines": [], "warn": [], "error": ""}
            order.append(current)
        for field in ("price", "delivery_price", "other_cost"):
            n = _num(_get(row, mapping, field))
            if n is not None and n >= 0 and g[field] is None:
                g[field] = n
        if not g["category"]:
            g["category"] = _text(_get(row, mapping, "category"), 30)
        ing_name = _text(_get(row, mapping, "ing_name"), 60)
        if not ing_name or _skippable(ing_name):
            continue
        qty, qunit = _qty_cell(_get(row, mapping, "qty"))
        unit = _unit_of(_get(row, mapping, "unit")) or qunit or (hints.get("qty") or (None, None))[1]
        line = {"row": row_no, "name": ing_name, "qty": qty, "unit": unit, "kind": None, "ingredient_id": None, "match": None, "suggest": None,
                "new": True, "error": ""}
        if not qty or qty <= 0:
            line["error"] = "사용량을 알 수 없습니다."
        elif qty > 1_000_000:
            line["error"] = "사용량이 너무 큽니다."
        elif unit is None:
            line["error"] = "사용 단위를 알 수 없습니다."
        else:
            line["kind"] = units.to_base(qty, unit)[0]
            key = services.norm_name(ing_name) or ing_name
            if key not in cache:
                cache[key] = services.best_match(ing_name, ings, aliases)
            m = cache[key]
            ing = by_id.get(m[0]) if m else None
            if ing is not None and ing["unit_kind"] == line["kind"]:
                cand = {"id": ing["id"], "name": ing["name"], "score": m[1]}
                if m[1] >= AUTO_LINK_SCORE:
                    line.update(ingredient_id=ing["id"], match=cand, new=False)
                else:
                    line["suggest"] = cand
        g["lines"].append(line)
    out = []
    for name in order:
        g = groups[name]
        bad = [ln for ln in g["lines"] if ln["error"]]
        ok = True
        if bad:
            ok, g["error"] = False, f"재료 {len(bad)}줄을 읽지 못했습니다: {bad[0]['name']} — {bad[0]['error']}"
        elif len(g["lines"]) > MAX_MENU_LINES:
            ok, g["error"] = False, f"재료가 {MAX_MENU_LINES}줄을 넘습니다."
        if g["price"] is None:
            g["warn"].append("판매가가 없어 가져온 뒤 직접 입력해야 합니다.")
        if not g["lines"]:
            g["warn"].append("재료가 없습니다. 메뉴 이름과 가격만 가져옵니다.")
        g["existing_id"] = existing_menus.get(name)
        g["ok"] = ok
        g["action"] = "skip" if not ok else ("update" if g["existing_id"] else "create")
        out.append(g)
    return out


def menu_stats(recs: list[dict]) -> dict:
    s = {"total": len(recs), "create": 0, "update": 0, "skip": 0, "error": 0, "lines": 0, "linked": 0, "suggest": 0, "new": 0}
    for r in recs:
        if not r["ok"]:
            s["error"] += 1
            continue
        s[r["action"]] += 1
        for ln in r["lines"]:
            s["lines"] += 1
            if ln["ingredient_id"]:
                s["linked"] += 1
            else:
                s["new"] += 1
                if ln["suggest"]:
                    s["suggest"] += 1
    return s


# ---------------------------------------------------------------- 양식 내려받기

def build_template() -> bytes:
    """빈 양식(.xlsx). 식자재 / 메뉴·레시피 / 안내 세 시트. (예시) 줄은 가져올 때 무시됩니다."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    head_font = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="E9E2D0")
    example_font = Font(italic=True, color="808080")

    def sheet(ws, header, examples, widths, unit_col=None, money_cols=()):
        ws.append(header)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(vertical="center")
        for r in examples:
            ws.append(r)
        for r in ws.iter_rows(min_row=2, max_row=1 + len(examples)):
            for c in r:
                c.font = example_font
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w
        for col in money_cols:
            for r in range(2, 502):
                ws.cell(row=r, column=col).number_format = "#,##0"
        if unit_col:
            dv = DataValidation(type="list", formula1='"g,kg,ml,L,개"', allow_blank=True)
            dv.error, dv.errorTitle = "g, kg, ml, L, 개 중에서 골라 주세요.", "단위"
            ws.add_data_validation(dv)
            col = ws.cell(row=1, column=unit_col).column_letter
            dv.add(f"{col}2:{col}501")
        ws.freeze_panes = "A2"

    wb = Workbook()
    ws = wb.active
    ws.title = "식자재"
    sheet(ws, ["식자재", "거래처", "분류", "규격 수량", "규격 단위", "구매가(원)", "수율(%)"],
          [[f"{EXAMPLE_PREFIX} 양파", "한우리유통", "채소", 15, "kg", 18000, 85],
           [f"{EXAMPLE_PREFIX} 식용유", "", "기름", 18, "L", 52000, 100],
           [f"{EXAMPLE_PREFIX} 달걀", "", "", 30, "개", 7500, 100]],
          [22, 16, 12, 12, 12, 14, 10], unit_col=5, money_cols=(6,))

    ws2 = wb.create_sheet("메뉴·레시피")
    sheet(ws2, ["메뉴", "분류", "판매가(원)", "배달앱 판매가(원)", "재료", "사용량", "단위"],
          [[f"{EXAMPLE_PREFIX} 제육볶음", "식사", 9000, 10000, "돼지 앞다리살", 200, "g"],
           [None, None, None, None, "양파", 60, "g"],
           [None, None, None, None, "식용유", 10, "ml"]],
          [24, 12, 14, 18, 20, 10, 10], unit_col=7, money_cols=(3, 4))

    ws3 = wb.create_sheet("안내")
    notes = [
        "원가노트 가져오기 양식",
        "",
        f"· '{EXAMPLE_PREFIX}'가 붙은 줄은 가져올 때 무시됩니다. 지우고 쓰셔도, 그냥 두셔도 됩니다.",
        "· 식자재 시트: 한 줄에 식자재 하나. 규격 수량·단위는 사 오는 포장 기준(15kg 한 망이면 15, kg), 구매가는 그 포장 한 개의 가격입니다.",
        "· 수율: 껍질·뼈를 다듬고 남는 비율(%)입니다. 모르면 비워 두세요(100%로 계산합니다).",
        "· 메뉴·레시피 시트: 재료 한 줄에 하나씩 적고, 같은 메뉴는 첫 줄에만 메뉴 이름을 적어도 됩니다. 사용량은 1인분 기준입니다.",
        "· 재료 이름이 식자재 시트와 같으면 저절로 연결되고, 없는 재료는 '단가 없음'으로 새로 만들어집니다(나중에 명세서로 채울 수 있습니다).",
        "· 다른 앱에서 내려받은 엑셀·CSV도 그대로 올릴 수 있습니다. 칸 이름은 올린 뒤 화면에서 맞출 수 있습니다.",
        "· 예전 엑셀 형식(.xls)은 읽지 못합니다. .xlsx 또는 CSV(UTF-8)로 저장해 올려 주세요.",
    ]
    for line in notes:
        ws3.append([line])
    ws3["A1"].font = Font(bold=True, size=13)
    ws3.column_dimensions["A"].width = 110
    for r in ws3.iter_rows(min_row=3):
        r[0].alignment = Alignment(wrap_text=True, vertical="top")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
