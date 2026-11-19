"""거래명세서 사진 -> 품목·규격·단가. Claude(비전)로 읽고, 결과는 항상 사람이 확인한 뒤 반영합니다.

ANTHROPIC_API_KEY가 없으면 예시(데모) 결과만 돌려줘서 화면 흐름을 먼저 써볼 수 있습니다.
이미지는 파일로 저장하지 않고 API로 보내는 데만 메모리에서 씁니다 — 다만 인식이 이상할 때
운영자가 확인할 수 있도록, 호출한 라우터가 log_attempt()을 불러서 (이미 줄인) 이미지와
결과를 ocr_logs 표에 남깁니다. 이건 원래 "사진을 서버에 전혀 안 남긴다"던 설계에서 바뀐
부분이라, 사장님께 안내하는 개인정보 처리 방침도 같이 손봐야 합니다.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from datetime import date

import httpx
from PIL import Image, ImageOps

from . import config, units
from .db import now_iso

log = logging.getLogger("wongaenote.ocr")

API_URL = "https://api.anthropic.com/v1/messages"
MAX_UPLOAD_BYTES = 12 * 1024 * 1024

SYSTEM_PROMPT = """당신은 한국 식당·카페의 식자재 거래명세서(거래명세표, 납품서, 영수증)를 읽는 판독기입니다.
이미지에서 품목 줄을 읽고 아래 JSON 형식으로만 답하세요. 설명, 코드블록, 머리말을 붙이지 마세요.

{
  "supplier": "거래처(공급자) 상호 또는 null",
  "invoice_date": "YYYY-MM-DD 또는 null",
  "total": 합계금액(숫자) 또는 null,
  "lines": [
    {
      "name": "품목명(규격·단위 제외)",
      "spec_text": "명세서에 적힌 규격/단위 원문 (예: 15kg/망, 30구, 1.8L, 1kg)",
      "pack_size": 포장 1단위의 수량(숫자) 또는 null,
      "pack_unit": "kg | g | L | ml | 개 중 하나, 모르면 null",
      "qty": 납품 수량(숫자) 또는 null,
      "pack_price": 포장 1단위당 단가(원, 숫자),
      "amount": 해당 줄 금액(숫자) 또는 null,
      "origin": "원산지(명세서 표기 그대로, 예: 국산/국내산/미국산/호주산/중국산). 안 보이면 null",
      "grade": "등급(명세서 표기 그대로, 예: 1++, 1+, 1등급, Prime, Choice, 특란). 안 보이면 null",
      "cut": "부위(예: 등심, 안심, 삼겹살, 목살, 앞다리). 정육·수산이 아니거나 안 보이면 null"
    }
  ]
}

규칙:
- 숫자는 쉼표 없이 숫자만 씁니다.
- 보이지 않거나 읽기 어려운 값은 추측하지 말고 null로 둡니다.
- 합계, 부가세, 인수자 서명, 은행 계좌 줄은 lines에 넣지 않습니다.
- pack_price는 '단가' 열의 값입니다. 단가 열이 없고 금액과 수량만 있으면 금액÷수량으로 계산합니다.
- 규격이 '15kg/망'처럼 적혀 있으면 pack_size=15, pack_unit="kg"입니다. '30구'는 pack_size=30, pack_unit="개"입니다.
- origin/grade/cut은 품목명이나 비고란에 적힌 표기를 그대로 옮기세요(코드로 변환하지 마세요. 예: "미국산"이면
  "미국산"이라고 쓰고 "US"로 바꾸지 않습니다). 사장님이 화면에서 직접 고치거나 선택합니다.
"""


class OcrError(Exception):
    """사용자에게 보여줘도 되는 인식 실패 사유."""


def enabled() -> bool:
    return bool(config.env_str("ANTHROPIC_API_KEY"))


def prepare_image(data: bytes) -> bytes:
    """EXIF 회전을 바로잡고 긴 변을 1568px 이하 JPEG로 줄입니다(API 비용·속도 절감)."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except Exception as e:  # 손상된 파일, 지원하지 않는 형식, 너무 큰 이미지
        raise OcrError("이미지를 읽을 수 없습니다. JPG 또는 PNG 사진을 올려 주세요.") from e
    img.thumbnail((1568, 1568))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue()


def extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise OcrError("인식 결과를 해석하지 못했습니다. 사진을 다시 찍어 올려 주세요.")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise OcrError("인식 결과를 해석하지 못했습니다. 사진을 다시 찍어 올려 주세요.") from e
    if not isinstance(data, dict):
        raise OcrError("인식 결과를 해석하지 못했습니다. 사진을 다시 찍어 올려 주세요.")
    return data


def vision_json(system: str, text: str, jpeg: bytes, max_tokens: int = 4096, refs: list[tuple[str, bytes]] | None = None) -> dict:
    """사진 한 장과 지시문을 Claude에 보내고, 답에서 JSON 한 덩어리를 꺼내 돌려줍니다(명세서·요리 사진 공용)."""
    key = config.env_str("ANTHROPIC_API_KEY")
    if not key:
        raise OcrError("자동 인식이 설정되지 않았습니다.")
    content = []
    for label, img in (refs or [])[:2]:  # 참고 레시피 사진(최대 2장)을 이름표와 함께 먼저 보여 줍니다.
        content.append({"type": "text", "text": f"[참고 사진] {label}"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(img).decode("ascii")}})
    if refs:
        content.append({"type": "text", "text": "[분석할 사진] 아래 사진이 지금 추정할 요리입니다."})
    payload = {
        "model": config.env_str("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        "max_tokens": max_tokens,
        "system": system,
        "messages": [
            {
                "role": "user",
                "content": content + [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": base64.b64encode(jpeg).decode("ascii"),
                        },
                    },
                    {"type": "text", "text": text},
                ],
            }
        ],
    }
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    try:
        resp = httpx.post(API_URL, headers=headers, json=payload, timeout=90.0)
    except httpx.HTTPError as e:
        log.warning("anthropic request failed: %s", type(e).__name__)
        raise OcrError("인식 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.") from e
    if resp.status_code != 200:
        log.warning("anthropic http %s: %s", resp.status_code, resp.text[:300])
        raise OcrError(f"인식 서버에서 오류가 났습니다({resp.status_code}). 잠시 후 다시 시도해 주세요.")
    blocks = resp.json().get("content", [])
    out = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    return extract_json(out)


def call_api(jpeg: bytes) -> dict:
    return vision_json(SYSTEM_PROMPT, "이 거래명세서를 읽어서 지정한 JSON으로만 답하세요.", jpeg)


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").replace("원", "").strip())
    except ValueError:
        return None


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# 원산지 키워드 -> market_catalog.ORIGINS 코드. 긴 표기부터 먼저 검사합니다(예: "국내산"이 "국산"보다 먼저).
_ORIGIN_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("국내산", "KR"), ("국산", "KR"), ("한우", "KR"),
    ("미국산", "US"), ("미국", "US"),
    ("호주산", "AU"), ("호주", "AU"), ("뉴질랜드", "AU"),
    ("중국산", "CN"), ("중국", "CN"),
)

# 등급 표기 -> mk_grade_terms.code. 순서가 중요합니다("1++"을 "1+"보다 먼저 검사).
_GRADE_PATTERNS: tuple[tuple["re.Pattern[str]", str], ...] = (
    (re.compile(r"1\+\+"), "1++"),
    (re.compile(r"1\+(?!\+)"), "1+"),
    (re.compile(r"(?<!\d)1\s*등급"), "1"),
    (re.compile(r"2\s*등급"), "2"),
    (re.compile(r"3\s*등급"), "3"),
    (re.compile(r"prime", re.IGNORECASE), "PRIME"),
    (re.compile(r"choice", re.IGNORECASE), "CHOICE"),
    (re.compile(r"select", re.IGNORECASE), "SELECT"),
    (re.compile(r"msa\s*9", re.IGNORECASE), "MSA9"),
    (re.compile(r"msa\s*7", re.IGNORECASE), "MSA7"),
    (re.compile(r"msa\s*4", re.IGNORECASE), "MSA4"),
    (re.compile(r"wagyu", re.IGNORECASE), "WAGYU"),
    (re.compile(r"특란"), "특란"),
    (re.compile(r"대란"), "대란"),
    (re.compile(r"중란"), "중란"),
    (re.compile(r"소란"), "소란"),
)

# 부위 사전(흔히 쓰는 20여 개만 — 품목마다 다양해서 엄격한 enum을 두지 않고 매칭 보조로만 씁니다).
_CUT_KEYWORDS: tuple[str, ...] = (
    "등심", "안심", "채끝", "갈비", "사태", "양지", "업진", "앞다리", "뒷다리", "목살", "삼겹살",
    "갈매기살", "가슴살", "다리살", "날개", "부채살", "토시살", "제비추리", "우둔", "설도",
)


def guess_origin_grade_cut(text: str) -> tuple[str | None, str | None, str | None]:
    """품목명·규격·(있다면) 모델이 뽑아낸 원산지/등급/부위 원문을 합친 문자열에서 origin 코드
    (market_catalog.ORIGINS)·grade 코드(mk_grade_terms)·cut(자유 텍스트)을 추정합니다.
    mock(API 키 없음) 경로와 실제 인식 경로가 같은 규칙으로 정규화되도록 공용으로 씁니다."""
    origin = next((code for kw, code in _ORIGIN_KEYWORDS if kw in text), None)
    grade = next((code for pat, code in _GRADE_PATTERNS if pat.search(text)), None)
    cut = next((kw for kw in _CUT_KEYWORDS if kw in text), None)
    return origin, grade, cut


def normalize_parsed(raw: dict) -> dict:
    """모델이 돌려준 JSON을 화면에서 쓰기 좋은 형태로 정리합니다(누락된 규격은 원문에서 추정)."""
    lines = []
    for ln in raw.get("lines") or []:
        if not isinstance(ln, dict):
            continue
        name = str(ln.get("name") or "").strip()
        if not name:
            continue
        spec = str(ln.get("spec_text") or "").strip()
        size = _num(ln.get("pack_size"))
        unit = units.canon_unit(ln.get("pack_unit"))
        if not size or not unit:
            g_size, g_unit = units.guess_spec(spec)
            if g_size is None:
                g_size, g_unit = units.guess_spec(name)
            if g_size is not None:
                size, unit = g_size, g_unit
        qty = _num(ln.get("qty"))
        amount = _num(ln.get("amount"))
        price = _num(ln.get("pack_price"))
        if price is None and amount and qty:
            price = amount / qty
        # 원산지·등급·부위: 모델(또는 예시 데이터)이 적어 준 원문 표기와 품목명·규격을 함께 보고
        # market_catalog/mk_grade_terms가 쓰는 코드로 정규화합니다. 실제 인식이 비활성화된 mock
        # 경로에서도 같은 규칙으로 품목명에서 뽑아내므로(예: "양파(국산)" -> origin=KR) 동작이 같습니다.
        hint = " ".join(
            str(ln.get(k) or "") for k in ("origin", "grade", "cut")
        ) + f" {name} {spec}"
        origin, grade, cut = guess_origin_grade_cut(hint)
        lines.append(
            {
                "name": name,
                "spec_text": spec,
                "pack_size": size if size and size > 0 else None,
                "pack_unit": unit,
                "qty": qty,
                "pack_price": price if price and price > 0 else None,
                "amount": amount,
                "origin": origin,
                "grade": grade,
                "cut": cut,
            }
        )
    date_s = str(raw.get("invoice_date") or "").strip()
    return {
        "supplier": str(raw.get("supplier") or "").strip(),
        "invoice_date": date_s if _DATE_RE.match(date_s) else None,
        "total": _num(raw.get("total")),
        "lines": lines,
    }


def parse_invoice(jpeg: bytes) -> dict:
    return normalize_parsed(call_api(jpeg))


def _summarize(kind: str, result: dict | None) -> str:
    if not result:
        return ""
    if kind == "invoice":
        supplier = result.get("supplier") or "거래처 미확인"
        n = len(result.get("lines") or [])
        total = result.get("total")
        return f"{supplier} · {n}개 품목" + (f" · {int(total):,}원" if total else "")
    dish = result.get("dish_name") or "요리명 미확인"
    n = len(result.get("lines") or [])
    return f"{dish} · 재료 {n}개"


def log_attempt(db, user_id: int | None, kind: str, status: str, jpeg: bytes | None,
                 result: dict | None = None, error: str | None = None) -> None:
    """인식 시도마다(성공/데모/실패 모두) 운영자 확인용으로 남긴다. 로그 자체가 실패해도
    OCR 흐름을 막으면 안 되므로 예외는 삼키고 경고만 남긴다."""
    try:
        db.execute(
            "INSERT INTO ocr_logs(user_id, kind, status, summary, result_json, error_text, image, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                user_id, kind, status, _summarize(kind, result),
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                error, jpeg, now_iso(),
            ),
        )
    except Exception:  # noqa: BLE001
        log.warning("ocr log_attempt failed", exc_info=True)


def demo_invoice() -> dict:
    """API 키가 없을 때 보여주는 예시. 일부러 이름이 조금 다르게 적혀 있습니다."""
    return normalize_parsed(
        {
            "supplier": "한우리유통(예시)",
            "invoice_date": date.today().isoformat(),
            "total": 240800,
            "lines": [
                {"name": "돼지 앞다리살", "spec_text": "1kg", "pack_size": 1, "pack_unit": "kg", "qty": 10, "pack_price": 11200, "amount": 112000},
                {"name": "양파(국산)", "spec_text": "15kg/망", "pack_size": 15, "pack_unit": "kg", "qty": 2, "pack_price": 19000, "amount": 38000},
                {"name": "대파 단", "spec_text": "1kg", "pack_size": 1, "pack_unit": "kg", "qty": 3, "pack_price": 4200, "amount": 12600},
                {"name": "계란 특란", "spec_text": "30구", "pack_size": 30, "pack_unit": "개", "qty": 2, "pack_price": 7400, "amount": 14800},
                {"name": "식용유", "spec_text": "18L", "pack_size": 18, "pack_unit": "L", "qty": 1, "pack_price": 54500, "amount": 54500},
                {"name": "깨소금", "spec_text": "500g", "pack_size": 500, "pack_unit": "g", "qty": 1, "pack_price": 8900, "amount": 8900},
            ],
        }
    )
