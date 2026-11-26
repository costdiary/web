"""환경변수 읽기.

값은 호출하는 시점에 읽기 때문에 테스트나 재시작 없이도 바꿔 쓸 수 있습니다.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path: Path | None = None) -> None:
    """`.env` 파일이 있으면 읽어서 환경변수로 등록합니다(이미 설정된 값은 덮어쓰지 않음)."""
    path = path or (ROOT / ".env")
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        os.environ.setdefault(key.strip(), val)


def env_str(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return default if v is None or v.strip() == "" else v.strip()


def env_int(name: str, default: int) -> int:
    try:
        return int(env_str(name, str(default)))
    except ValueError:
        return default


def env_bool(name: str, default: bool = False) -> bool:
    return env_str(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


def public_config() -> dict:
    """로그인 전에도 화면에 보여줘도 되는 설정값. 원가노트는 무료이므로 체험·요금 안내는 없습니다."""
    from . import identity, oauth  # 지연 import: oauth.py가 config를 쓰므로 모듈 맨 위에서 돌면 순환 참조가 됩니다.
    return {
        "signup_code_required": bool(env_str("SIGNUP_CODE")),
        "contact_email": env_str("CONTACT_EMAIL"),
        "business_name": env_str("BUSINESS_NAME"),
        "biz_reg_no": env_str("BIZ_REG_NO"),
        "biz_ceo": env_str("BIZ_CEO"),
        "biz_address": env_str("BIZ_ADDRESS"),
        "ocr_enabled": bool(env_str("ANTHROPIC_API_KEY")),
        # 버전1(기본값 꺼짐)은 도매마켓을 화면에서 숨긴다. 재배포 없이 환경변수만으로 버전2로 되돌릴 수 있다.
        "market_enabled": env_bool("MARKET_ENABLED", False),
        "orders_enabled": env_bool("ORDERS_ENABLED", False),
        # 후원하기는 기본 켜짐 — 끄고 싶을 때만 환경변수로 끈다.
        "donation_enabled": env_bool("DONATION_ENABLED", True),
        # 토스페이먼츠 키가 아직 없으면 화면에 "테스트로 처리됩니다" 안내를 보여준다(payments.get_provider()와 같은 기준).
        "donation_real_pg": bool(env_str("TOSS_SECRET_KEY")),
        # 휴대폰 본인인증(identity.py). real=False면 화면이 "테스트 인증" 입력칸을 보여준다.
        "identity_enabled": identity.enabled(),
        "identity_real": identity.real_configured(),
        # 키를 넣은 제공자만 True — 화면은 True인 것만 버튼으로 보여준다.
        "oauth_providers": oauth.configured_providers(),
        # 구글 애널리틱스(GA4) 측정 ID(G-로 시작). 비어 있으면 화면이 GA를 전혀 불러오지 않는다.
        "ga4_id": env_str("GA4_MEASUREMENT_ID").strip(),
        # 광고를 붙이면 1. 쿠키 동의 창에 "광고" 항목이 생긴다(광고 코드 자체는 아직 없음).
        "ads_enabled": env_bool("ADS_ENABLED", False),
    }
