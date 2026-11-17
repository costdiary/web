"""완성된 요리 사진 -> 들어간 재료와 1인분 양(추정).

사장님 대부분은 메뉴 한 그릇에 몇 g이 들어가는지 정확히 모릅니다. 그래서 사진만 보고 먼저 초안을 만들고,
모든 줄을 '추정'으로 표시한 채 최소~최대 범위와 함께 돌려줍니다. 반영 여부와 양은 사람이 확인합니다.
이미지는 서버에 저장하지 않습니다. ocr.py 와 같은 방식으로 Claude(비전)에 보냅니다.
"""
from __future__ import annotations

import re

from . import ocr, refdata, services, units

SYSTEM_PROMPT = """당신은 한국 식당 주방의 원가 계산을 돕는 조리 전문가입니다.
사진에 보이는 '완성된 요리 1인분'에 들어간 재료와 양을 눈대중으로 추정해, 아래 JSON 형식으로만 답하세요. 설명, 코드블록, 머리말을 붙이지 마세요.

{
  "dish_name": "요리 이름 또는 null",
  "serving_note": "무엇을 1인분으로 보았는지 한 줄 (예: 뚝배기 1개 + 공깃밥 1공기)",
  "ingredients": [
    {
      "name": "재료명",
      "qty": 대표값(숫자),
      "qty_low": 있을 법한 최소(숫자),
      "qty_high": 있을 법한 최대(숫자),
      "unit": "g | ml | 개 중 하나",
      "visible": 사진에서 직접 보이면 true, 보이지 않지만 이 요리에 보통 들어가는 재료(육수·양념·기름 등)면 false,
      "confidence": "high | medium | low",
      "note": "근거나 주의할 점 한 줄 (없으면 빈 문자열)"
    }
  ]
}

규칙:
- 양은 '손질을 마치고 조리에 넣은 생재료' 기준입니다(익히기 전 무게). 고기·채소·가루는 g, 기름·소스·액체는 ml, 달걀·두부(모)처럼 세어서 쓰는 것은 개로 적습니다.
- 밥은 쌀(생쌀) 무게로 환산합니다(공깃밥 1공기 약 210g = 쌀 약 95g). 면은 사 오는 상태(생면 또는 건면) 무게로 적습니다.
- 물, 얼음, 일회용 용기와 수저는 적지 않습니다. 1g(1ml)보다 적은 아주 소량의 양념은 생략합니다.
- 크기를 아는 물건을 기준 삼아 양을 가늠하세요(공깃밥 그릇 지름 약 11cm, 숟가락 길이 약 18cm, 뚝배기 지름 약 16~18cm, 달걀 1개 약 55g).
- 사진으로 알 수 없는 재료는 이 요리의 일반적인 식당 레시피를 따르되 visible을 false로 하고 confidence를 low 또는 medium으로 적습니다.
- 확실하지 않은 만큼 qty_low와 qty_high의 간격을 넓게 잡으세요. 항상 qty_low <= qty <= qty_high 입니다.
- 같은 재료는 한 줄로 합치고 전체 25줄을 넘기지 마세요.
- 음식 사진이 아니거나 알아볼 수 없으면 {"dish_name": null, "serving_note": "", "ingredients": []} 로 답하세요.
- 내 식자재 목록이 주어지면, 같은 재료는 그 목록의 이름과 단위를 그대로 쓰세요. 목록에 없는 재료는 일반적인 이름으로 적습니다.
"""

MAX_LINES = 30
_KIND_LABEL = {"g": "g", "ml": "ml", "ea": "개"}
_CTRL = re.compile(r"[\x00-\x1f\x7f]+")
_WATER = {"물", "얼음", "생수", "정수", "온수", "냉수"}
_CONF = ("high", "medium", "low")


def one_line(s, limit: int) -> str:
    """사용자·모델이 준 글을 프롬프트나 화면에 안전하게 넣도록 한 줄로 정리합니다."""
    return _CTRL.sub(" ", str(s or "")).strip()[:limit]


def build_user_text(name_hint: str = "", known: list[dict] | None = None, refs: list[dict] | None = None) -> str:
    parts = ["이 요리 1인분의 재료와 양을 추정해 지정한 JSON으로만 답하세요."]
    name = one_line(name_hint, 60)
    if name:
        parts.append(f"메뉴 이름: {name} (사장님이 알려 준 이름입니다. 이 이름을 따르세요.)")
    if known:
        names = ", ".join(f"{one_line(k['name'], 30)} [{_KIND_LABEL.get(k['unit_kind'], 'g')}]" for k in known[:150])
        parts.append(f"내 식자재 목록(이름 [단위]): {names}")
    if refs:
        parts.append(
            "비슷한 요리의 실제 레시피(공공 레시피 DB, 참고용입니다):\n" + refdata.prompt_text(refs)
            + "\n이 양은 레시피 원문 기준이라 1인분이 아닐 수 있습니다. 사진 속 그릇의 크기와 재료 양을 보고 1인분으로 맞춰 쓰되, "
            "사진과 다르면 사진을 따르세요. 참고 레시피를 그대로 베끼지 마세요."
        )
    return "\n".join(parts)


def _ref_images(refs: list[dict]) -> list[tuple[str, bytes]]:
    out = []
    for r in refs:
        img = refdata.image_bytes(r)
        if img:
            out.append((r["name"], img))
    return out


def call_api(jpeg: bytes, name_hint: str = "", known: list[dict] | None = None, refs: list[dict] | None = None) -> dict:
    return ocr.vision_json(SYSTEM_PROMPT, build_user_text(name_hint, known, refs), jpeg, max_tokens=3000, refs=_ref_images(refs or []))


# ---------------------------------------------------------------- 결과 정리

def _unit_and_factor(raw):
    """모델이 적은 단위 -> (g | ml | 개, 곱할 값). 모르면 (None, 1)."""
    c = units.canon_unit(raw)
    if c in ("g", "ml", "개"):
        return c, 1.0
    if c == "kg":
        return "g", 1000.0
    if c == "L":
        return "ml", 1000.0
    s = str(raw or "").strip().lower()
    if s in ("큰술", "큰스푼", "tbsp", "tb"):
        return "ml", 15.0
    if s in ("작은술", "티스푼", "tsp", "ts"):
        return "ml", 5.0
    if s in ("컵", "cup"):
        return "ml", 200.0
    return None, 1.0


def _nice(x: float, unit: str) -> float:
    """눈대중 값에 어울리는 단위로 반올림(123.4g -> 125g)."""
    if unit == "개":
        return max(0.5, round(x * 2) / 2)
    if x >= 100:
        return float(round(x / 5) * 5)
    if x >= 10:
        return float(round(x))
    return max(0.5, round(x * 2) / 2)


def normalize_estimate(raw: dict) -> dict:
    """모델이 돌려준 JSON을 화면에서 쓰는 형태로 정리합니다. 이상한 줄은 버리고, 모르는 값은 기본값으로 채웁니다."""
    merged: dict[str, dict] = {}
    for ing in (raw.get("ingredients") if isinstance(raw, dict) else None) or []:
        if not isinstance(ing, dict):
            continue
        name = one_line(ing.get("name"), 60)
        if not name or name in _WATER:
            continue
        unit, factor = _unit_and_factor(ing.get("unit"))
        if unit is None:
            continue
        qty = ocr._num(ing.get("qty"))
        low = ocr._num(ing.get("qty_low"))
        high = ocr._num(ing.get("qty_high"))
        qty = qty * factor if qty else None
        low = low * factor if low else None
        high = high * factor if high else None
        if not qty or qty <= 0:
            if low and high and low > 0 and high > 0:
                qty = (low + high) / 2.0
            else:
                continue
        if qty > (200 if unit == "개" else 5000):  # 1인분으로는 말이 안 되는 양
            continue
        low = low if low and 0 < low <= qty else qty * 0.75
        high = high if high and high >= qty else qty * 1.25
        conf = str(ing.get("confidence") or "").strip().lower()
        row = {
            "name": name, "unit": unit, "kind": {"g": "g", "ml": "ml", "개": "ea"}[unit],
            "qty": qty, "qty_low": low, "qty_high": high,
            "visible": ing.get("visible") is not False,
            "confidence": conf if conf in _CONF else "medium",
            "note": one_line(ing.get("note"), 80),
        }
        key = services.norm_name(name) or name
        if key in merged and merged[key]["unit"] == unit:  # 같은 재료가 두 줄이면 합칩니다.
            m = merged[key]
            for f in ("qty", "qty_low", "qty_high"):
                m[f] += row[f]
            m["confidence"] = _CONF[max(_CONF.index(m["confidence"]), _CONF.index(row["confidence"]))]
            m["visible"] = m["visible"] or row["visible"]
        elif key not in merged:
            merged[key] = row
    lines = []
    for m in list(merged.values())[:MAX_LINES]:
        q = _nice(m["qty"], m["unit"])
        lo = min(_nice(m["qty_low"], m["unit"]), q)
        hi = max(_nice(m["qty_high"], m["unit"]), q)
        lines.append({**m, "qty": q, "qty_low": lo, "qty_high": hi})
    dish = one_line(raw.get("dish_name") if isinstance(raw, dict) else "", 60)
    note = one_line(raw.get("serving_note") if isinstance(raw, dict) else "", 100)
    return {"dish_name": dish, "serving_note": note, "lines": lines}


def estimate_live(jpeg: bytes, name_hint: str = "", known: list[dict] | None = None) -> dict:
    """참고 레시피 DB 가 있으면 이름이 비슷한 레시피를 함께 보여 줘서 양을 보정합니다.
    이름을 알려 줬으면 처음부터 한 번에, 이름이 없으면 먼저 요리 이름을 알아낸 뒤 참고 자료가 있을 때만 한 번 더 다듬습니다."""
    refs = refdata.find_similar(name_hint) if name_hint else []
    raw = call_api(jpeg, name_hint, known, refs) if refs else call_api(jpeg, name_hint, known)
    refined = bool(refs)
    if not refs and isinstance(raw, dict) and raw.get("dish_name"):
        refs = refdata.find_similar(str(raw["dish_name"]))
        if refs:
            raw = call_api(jpeg, str(raw["dish_name"]), known, refs)
            refined = True
    est = normalize_estimate(raw)
    est["reference"] = {"used": refined, "names": [r["name"] for r in refs]} if refs else {"used": False, "names": []}
    return est


def demo_estimate(name_hint: str = "") -> dict:
    """API 키가 없을 때 보여주는 예시(올린 사진과 관계없는 제육볶음 1인분). 예시 데이터의 식자재 이름과 맞춰 두었습니다."""
    name = one_line(name_hint, 60)
    return normalize_estimate({
        "dish_name": name or "제육볶음(예시)",
        "serving_note": "예시입니다 — 철판 접시 1개 + 공깃밥 1공기",
        "ingredients": [
            {"name": "돼지 앞다리살", "qty": 200, "qty_low": 160, "qty_high": 250, "unit": "g", "visible": True, "confidence": "medium", "note": "고기 두께와 접시 크기로 가늠"},
            {"name": "양파", "qty": 60, "qty_low": 40, "qty_high": 90, "unit": "g", "visible": True, "confidence": "medium", "note": ""},
            {"name": "대파", "qty": 20, "qty_low": 10, "qty_high": 30, "unit": "g", "visible": True, "confidence": "medium", "note": ""},
            {"name": "쌀", "qty": 95, "qty_low": 85, "qty_high": 105, "unit": "g", "visible": True, "confidence": "high", "note": "공깃밥 약 210g"},
            {"name": "고춧가루", "qty": 8, "qty_low": 4, "qty_high": 12, "unit": "g", "visible": False, "confidence": "low", "note": "양념에 보통 들어가는 양"},
            {"name": "간장", "qty": 20, "qty_low": 10, "qty_high": 30, "unit": "ml", "visible": False, "confidence": "low", "note": ""},
            {"name": "식용유", "qty": 10, "qty_low": 5, "qty_high": 15, "unit": "ml", "visible": False, "confidence": "low", "note": ""},
            {"name": "설탕", "qty": 8, "qty_low": 4, "qty_high": 12, "unit": "g", "visible": False, "confidence": "low", "note": "예시 데이터에 없는 재료 — 새로 등록됩니다"},
        ],
    })
