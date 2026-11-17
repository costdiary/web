"""도매업체 사업자등록증 인증: OCR(사진 -> 4개 값) + 국세청 진위확인·상태조회.

``ocr.py``와 같은 원칙을 따릅니다: 이미지는 서버 디스크에 저장하지 않고, 외부 API 키가 없으면
결정적인 예시(mock) 결과를 돌려줘서 화면 흐름을 먼저 써볼 수 있게 합니다.

국세청 API 참고(작성자 기억 기준, 2026-11-12 기준 확인 — 실제 연동 전 공공데이터포털
Swagger 문서로 다시 대조할 것):
  공공데이터포털 "국세청_사업자등록정보 진위확인 및 상태조회 서비스"
  https://www.data.go.kr/data/15081808/openapi.do
  POST https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=...
  본문  {"businesses":[{"b_no":"숫자10자리","start_dt":"YYYYMMDD","p_nm":"대표자명","b_nm":"상호(선택)"}]}
  응답  data[0].valid: "01" 일치 / "02" 불일치. 일치 시 data[0].status.b_stt_cd: "01" 계속/"02" 휴업/"03" 폐업.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from . import config, ocr

log = logging.getLogger("wongaenote.wholesale_verify")

NTS_API_URL = "https://api.odcloud.kr/api/nts-businessman/v1/validate"

VERIFY_SYSTEM_PROMPT = """당신은 한국 사업자등록증 사진을 읽는 판독기입니다.
이미지에서 아래 값을 읽어 JSON으로만 답하세요. 설명, 코드블록, 머리말을 붙이지 마세요.

{
  "biz_no": "사업자등록번호 10자리(숫자만, 하이픈 제거) 또는 null",
  "biz_name": "상호 또는 null",
  "ceo_name": "대표자 성명 또는 null",
  "open_date": "개업일자 YYYY-MM-DD 또는 null",
  "low_confidence": ["읽기 어려웠던 필드 이름 목록"]
}
"""


@dataclass
class BizDoc:
    biz_no: str | None
    biz_name: str | None
    ceo_name: str | None
    open_date: str | None
    low_confidence: list[str] = field(default_factory=list)
    provider: str = "mock"
    demo: bool = True


@dataclass
class NtsResult:
    valid: bool | None  # True 일치 / False 불일치 / None 조회 실패
    status: str = "unknown"  # active | suspended | closed | unknown
    provider: str = "mock"
    error: str = ""


@dataclass
class Decision:
    step: str  # approved | rejected | retry
    reason_code: str
    message: str


# ---------------------------------------------------------------- 사업자번호 체크섬

def checksum_ok(biz_no: str) -> bool:
    """사업자등록번호 10자리 체크섬(국세청 공개 공식)."""
    d = (biz_no or "").strip()
    if len(d) != 10 or not d.isdigit():
        return False
    weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    total = sum(int(d[i]) * weights[i] for i in range(9))
    total += (int(d[8]) * 5) // 10
    check = (10 - (total % 10)) % 10
    return check == int(d[9])


def _demo_biz_no() -> str:
    """체크섬이 맞는 고정 예시 사업자번호(테스트용)."""
    for suffix in range(100):
        cand = f"123456{suffix:04d}"
        if checksum_ok(cand):
            return cand
    return "1234567890"  # 사실상 도달하지 않음


# ---------------------------------------------------------------- OCR

def ocr_provider() -> str:
    return config.env_str("WS_OCR_PROVIDER", "mock")


def extract_business_doc(jpeg: bytes) -> BizDoc:
    provider = ocr_provider()
    if provider == "claude" and ocr.enabled():
        try:
            raw = ocr.vision_json(VERIFY_SYSTEM_PROMPT, "이 사업자등록증을 읽어서 지정한 JSON으로만 답하세요.", jpeg, max_tokens=512)
        except ocr.OcrError:
            raise
        return BizDoc(
            biz_no=str(raw.get("biz_no") or "").replace("-", "").strip() or None,
            biz_name=(str(raw.get("biz_name") or "").strip() or None),
            ceo_name=(str(raw.get("ceo_name") or "").strip() or None),
            open_date=(str(raw.get("open_date") or "").strip() or None),
            low_confidence=[str(x) for x in (raw.get("low_confidence") or [])],
            provider="claude",
            demo=False,
        )
    # mock(기본) — 등록증 사진의 실제 내용과 무관하게 결정적인 예시를 돌려준다.
    return BizDoc(
        biz_no=_demo_biz_no(),
        biz_name="성실도매유통(예시)",
        ceo_name="김성실",
        open_date="2015-03-02",
        low_confidence=[],
        provider="mock",
        demo=True,
    )


# ---------------------------------------------------------------- 국세청

def check_nts(biz_no: str, open_date: str, ceo_name: str, biz_name: str = "") -> NtsResult:
    api_key = config.env_str("NTS_API_KEY")
    if not api_key:
        return _mock_nts(biz_no, ceo_name)
    try:
        resp = httpx.post(
            NTS_API_URL,
            params={"serviceKey": api_key},
            json={"businesses": [{"b_no": biz_no, "start_dt": (open_date or "").replace("-", ""), "p_nm": ceo_name, "b_nm": biz_name}]},
            timeout=10.0,
        )
        if resp.status_code != 200:
            log.warning("nts http %s: %s", resp.status_code, resp.text[:300])
            return NtsResult(valid=None, status="unknown", provider="odcloud", error=f"http {resp.status_code}")
        data = (resp.json().get("data") or [{}])[0]
        valid_code = str(data.get("valid") or "")
        if valid_code not in ("01", "02"):
            return NtsResult(valid=None, status="unknown", provider="odcloud", error=f"valid={valid_code!r}")
        valid = valid_code == "01"
        stt = str((data.get("status") or {}).get("b_stt_cd") or "")
        status = {"01": "active", "02": "suspended", "03": "closed"}.get(stt, "unknown")
        return NtsResult(valid=valid, status=status, provider="odcloud")
    except httpx.HTTPError as e:
        log.warning("nts request failed: %s", type(e).__name__)
        return NtsResult(valid=None, status="unknown", provider="odcloud", error=str(type(e).__name__))


def _mock_nts(biz_no: str, ceo_name: str) -> NtsResult:
    """목 국세청 규칙(모든 분기를 결정적으로 밟을 수 있게). 5.2절."""
    d = (biz_no or "").strip()
    if not checksum_ok(d):
        return NtsResult(valid=False, status="unknown", provider="mock")
    if d.endswith("0"):
        return NtsResult(valid=True, status="closed", provider="mock")
    if d.endswith("9"):
        return NtsResult(valid=None, status="unknown", provider="mock", error="mock api error")
    if (ceo_name or "").startswith("불일치"):
        return NtsResult(valid=False, status="unknown", provider="mock")
    return NtsResult(valid=True, status="active", provider="mock")


# ---------------------------------------------------------------- 판정(순수 함수)

def decide(doc: dict, nts: NtsResult, *, duplicate: bool = False) -> Decision:
    """doc: {'biz_no','biz_name','ceo_name','open_date'} 사용자가 확인·제출한 값."""
    if duplicate:
        return Decision("rejected", "duplicate", "이미 이 사업자등록번호로 인증된 계정이 있습니다.")
    biz_no = str(doc.get("biz_no") or "")
    if not checksum_ok(biz_no):
        return Decision("retry", "mismatch", "사업자등록번호를 다시 확인해 주세요.")
    if nts.valid is None:
        return Decision("retry", "api_error", "잠시 뒤에 다시 시도해 주세요.")
    if nts.valid is False:
        open_date = str(doc.get("open_date") or "")
        if _is_recent(open_date):
            return Decision("retry", "too_new", "신규 개업은 국세청 반영에 1~2일이 걸립니다. 며칠 뒤 다시 시도해 주세요.")
        return Decision("retry", "mismatch", "등록증의 번호·대표자명·개업일자를 다시 확인해 주세요.")
    if nts.status in ("suspended", "closed"):
        return Decision("rejected", "closed", "휴업 또는 폐업 상태의 사업자는 인증할 수 없습니다.")
    return Decision("approved", "", "사업자 인증이 완료되었습니다.")


def _is_recent(open_date: str, days: int = 3) -> bool:
    from datetime import datetime, timezone
    try:
        d = datetime.strptime(open_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - d).days <= days


def verify_business(doc: dict, *, duplicate: bool = False) -> Decision:
    nts = check_nts(str(doc.get("biz_no") or ""), str(doc.get("open_date") or ""), str(doc.get("ceo_name") or ""), str(doc.get("biz_name") or ""))
    return decide(doc, nts, duplicate=duplicate)
