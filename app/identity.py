"""휴대폰 본인인증 — payments.py와 같은 원칙의 provider 추상화.

포트원(PortOne) V2 키(``PORTONE_STORE_ID``·``PORTONE_IDENTITY_CHANNEL_KEY``·``PORTONE_API_SECRET``)가
없으면 외부로 나가는 요청 없이 모의(mock) 인증으로 동작한다. 실제 본인인증은 포트원 관리자 화면에서
본인인증 채널(다날 등 휴대폰 본인인증 계약)을 연결해 받은 채널 키가 있어야 한다.

후원 결제(payments.py, 토스페이먼츠)와 "동기화"하는 방법: 인증 결과(이름·휴대폰·CI)는 그 사장님
계정(users)에 붙고, 후원은 본인인증을 마친 계정만 할 수 있다. 그래서 후원 내역(donations.user_id)을
따라가면 언제나 실명 확인된 사람으로 이어진다. 같은 사람(같은 CI)은 계정을 하나만 만들 수 있다.

흐름(포트원 V2, https://developers.portone.io/api/rest-v2/identityVerification):
  1) 서버: start() — 추측할 수 없는 인증 번호(identityVerificationId)를 만들어 기록하고 내려준다.
  2) 프런트: 포트원 브라우저 SDK ``PortOne.requestIdentityVerification({storeId, identityVerificationId,
     channelKey})`` 로 휴대폰 인증 창을 띄운다(모바일은 redirectUrl 로 돌아온다).
  3) 서버: complete() — 브라우저가 "끝났다"고 알려 오면, 브라우저 말을 믿지 않고 포트원 서버에
     ``GET /identity-verifications/{id}`` 로 직접 물어 status == VERIFIED 인지와 인증된 사람 정보를 받는다.

포트원 응답 필드 이름(verifiedCustomer.name/phoneNumber/birthDate/gender/ci)은 2026-11 포트원
공개 문서·서버 SDK 문서 기준으로 맞췄지만 실제 키로는 아직 호출해 보지 못했다. 키를 받으면 테스트
채널로 한 번 끝까지 해 보고 확인할 것.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from . import config
from .db import ISO, now_iso

log = logging.getLogger("wongaenote.identity")

PORTONE_API_BASE = "https://api.portone.io"
VALID_MINUTES = 30  # 인증을 마치고 가입 버튼을 누르기까지 허용하는 시간


class IdentityError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class VerifiedPerson:
    name: str
    phone: str
    birth_date: str  # YYYY-MM-DD
    gender: str  # 'male' | 'female' | ''
    ci: str


class IdentityProvider:
    name = "base"

    def client_config(self) -> dict:
        """프런트가 인증 창을 띄우는 데 필요한 공개 값(비밀키 아님)."""
        return {}

    def fetch(self, verification_id: str, mock: dict | None) -> VerifiedPerson:
        raise NotImplementedError


class MockIdentityProvider(IdentityProvider):
    """키가 없을 때 쓰는 기본값. 화면에서 입력한 이름·번호·생년월일을 그대로 '인증된 것'으로 본다.
    CI는 그 세 값으로 만든 가짜 값이라, 같은 값으로 두 번 가입하면 실제처럼 중복으로 막힌다."""

    name = "mock"

    def fetch(self, verification_id: str, mock: dict | None) -> VerifiedPerson:
        mock = mock or {}
        name = str(mock.get("name") or "").strip()
        phone = re.sub(r"\D", "", str(mock.get("phone") or ""))
        birth = str(mock.get("birth_date") or "").strip()
        if not name or not re.fullmatch(r"01\d{8,9}", phone) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", birth):
            raise IdentityError("이름, 휴대폰 번호(01012345678), 생년월일(1980-01-31)을 확인해 주세요.")
        if name.endswith("실패"):  # 결정적 실패 규칙(테스트용) — payments.MockProvider의 "FAIL"과 같은 역할
            raise IdentityError("본인인증에 실패했습니다(테스트).", 402)
        ci = "mock-" + hashlib.sha256(f"{name}|{phone}|{birth}".encode()).hexdigest()
        return VerifiedPerson(name=name, phone=phone, birth_date=birth, gender="", ci=ci)


class PortOneIdentityProvider(IdentityProvider):
    name = "portone"

    def __init__(self, store_id: str, channel_key: str, api_secret: str):
        self.store_id = store_id
        self.channel_key = channel_key
        self.api_secret = api_secret

    def client_config(self) -> dict:
        return {"store_id": self.store_id, "channel_key": self.channel_key}

    def fetch(self, verification_id: str, mock: dict | None) -> VerifiedPerson:
        try:
            resp = httpx.get(
                f"{PORTONE_API_BASE}/identity-verifications/{verification_id}",
                params={"storeId": self.store_id},
                headers={"Authorization": f"PortOne {self.api_secret}"},
                timeout=10.0,
            )
        except httpx.HTTPError as e:
            log.warning("portone 본인인증 조회 실패: %s", type(e).__name__)
            raise IdentityError("본인인증 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502)
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code != 200:
            log.warning("portone 본인인증 조회 응답 %s: %s", resp.status_code, data.get("type"))
            raise IdentityError("본인인증 결과를 확인하지 못했습니다.", 502)
        # 응답이 IdentityVerification 자체이거나 {"identityVerification": {...}}로 감싸진 경우 둘 다 받는다.
        iv = data.get("identityVerification") if isinstance(data.get("identityVerification"), dict) else data
        if str(iv.get("status") or "") != "VERIFIED":
            raise IdentityError("본인인증이 완료되지 않았습니다. 다시 시도해 주세요.", 402)
        c = iv.get("verifiedCustomer") or {}
        ci = str(c.get("ci") or "")
        if not ci or not c.get("name"):
            raise IdentityError("본인인증 결과에 필요한 정보가 없습니다. 포트원 채널 설정을 확인해 주세요.", 502)
        gender = str(c.get("gender") or "").lower()
        return VerifiedPerson(
            name=str(c.get("name")),
            phone=re.sub(r"\D", "", str(c.get("phoneNumber") or "")),
            birth_date=str(c.get("birthDate") or "")[:10],
            gender=gender if gender in ("male", "female") else "",
            ci=ci,
        )


def real_configured() -> bool:
    return all(config.env_str(k) for k in ("PORTONE_STORE_ID", "PORTONE_IDENTITY_CHANNEL_KEY", "PORTONE_API_SECRET"))


def enabled() -> bool:
    """본인인증을 가입·후원에 요구할지. 포트원 키가 있으면 기본으로 켜지고, 키 없이 테스트로 켜 보려면
    IDENTITY_ENABLED=1, 키가 있어도 잠시 끄려면 IDENTITY_ENABLED=0."""
    return config.env_bool("IDENTITY_ENABLED", real_configured())


def get_provider() -> IdentityProvider:
    if real_configured():
        return PortOneIdentityProvider(
            config.env_str("PORTONE_STORE_ID"), config.env_str("PORTONE_IDENTITY_CHANNEL_KEY"), config.env_str("PORTONE_API_SECRET"),
        )
    return MockIdentityProvider()


def ci_hash(ci: str) -> str:
    # CI 원문은 저장하지 않는다. 같은 사람인지 비교만 하면 되므로 해시만 남긴다.
    return hashlib.sha256(f"wongae-ci|{ci}".encode()).hexdigest()


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}-****-{phone[-4:]}" if len(phone) >= 10 else ""


# ---------------------------------------------------------------- DB 흐름


def start(db, user_id: int | None, purpose: str) -> dict:
    vid = "iv-" + secrets.token_urlsafe(18).replace("_", "x").replace("-", "y")
    db.execute(
        "INSERT INTO identity_verifications(id, user_id, purpose, status, created_at) VALUES (?,?,?, 'requested', ?)",
        (vid, user_id, purpose, now_iso()),
    )
    p = get_provider()
    return {"verification_id": vid, "provider": p.name, **p.client_config()}


def _fresh(row) -> bool:
    created = datetime.strptime(row["created_at"], ISO).replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created < timedelta(minutes=VALID_MINUTES)


def _owner_of_ci(db, h: str):
    return db.execute("SELECT id FROM users WHERE ci_hash = ?", (h,)).fetchone()


def complete(db, verification_id: str, user_id: int | None, mock: dict | None) -> dict:
    row = db.execute("SELECT * FROM identity_verifications WHERE id = ?", (verification_id,)).fetchone()
    if not row or (row["user_id"] or None) != (user_id or None):
        raise IdentityError("본인인증 요청을 찾지 못했습니다. 처음부터 다시 해 주세요.", 404)
    if row["status"] != "requested":
        raise IdentityError("이미 처리된 본인인증입니다. 다시 인증해 주세요.", 410)
    if not _fresh(row):
        raise IdentityError("본인인증 시간이 지났습니다. 다시 인증해 주세요.", 410)
    person = get_provider().fetch(verification_id, mock)
    h = ci_hash(person.ci)
    owner = _owner_of_ci(db, h)
    if owner and owner["id"] != user_id:
        db.execute("UPDATE identity_verifications SET status='failed' WHERE id = ?", (verification_id,))
        raise IdentityError("이미 이 휴대폰 명의로 가입한 계정이 있습니다. 그 계정으로 로그인해 주세요.", 409)
    db.execute(
        "UPDATE identity_verifications SET status='verified', name=?, phone=?, birth_date=?, gender=?, ci_hash=?, verified_at=? "
        "WHERE id = ?",
        (person.name, person.phone, person.birth_date, person.gender, h, now_iso(), verification_id),
    )
    if user_id is not None:  # 로그인한 계정에서 인증한 경우(기존·소셜 가입 사장님) 곧바로 계정에 붙인다
        attach(db, verification_id, user_id)
    return {"verified": True, "name": person.name, "phone": mask_phone(person.phone)}


def claim_for_signup(db, verification_id: str):
    """가입 직전에 부른다. 인증을 마친 아직 안 쓴 가입용 인증 기록을 돌려주고, 아니면 IdentityError."""
    row = db.execute("SELECT * FROM identity_verifications WHERE id = ?", (verification_id or "",)).fetchone()
    if not row or row["purpose"] != "signup" or row["user_id"] is not None:
        raise IdentityError("휴대폰 본인인증을 먼저 해 주세요.", 403)
    if row["status"] != "verified" or not _fresh(row):
        raise IdentityError("본인인증 시간이 지났습니다. 다시 인증해 주세요.", 403)
    if _owner_of_ci(db, row["ci_hash"]):
        raise IdentityError("이미 이 휴대폰 명의로 가입한 계정이 있습니다. 그 계정으로 로그인해 주세요.", 409)
    return row


def attach(db, verification_id: str, user_id: int) -> None:
    """인증 결과를 계정에 붙이고 인증 기록은 '사용됨'으로 바꾼다(한 번만 쓸 수 있음)."""
    row = db.execute("SELECT * FROM identity_verifications WHERE id = ?", (verification_id,)).fetchone()
    db.execute(
        "UPDATE users SET verified_name=?, verified_phone=?, verified_birth=?, ci_hash=?, identity_verified_at=? WHERE id = ?",
        (row["name"], row["phone"], row["birth_date"], row["ci_hash"], now_iso(), user_id),
    )
    db.execute("UPDATE identity_verifications SET status='used', user_id=? WHERE id = ?", (user_id, verification_id))


def is_verified(user: dict) -> bool:
    return bool(user.get("identity_verified_at"))


def me_summary(user: dict) -> dict:
    on = enabled()
    return {
        "enabled": on,
        "verified": is_verified(user),
        "name": user.get("verified_name") or "",
        "phone": mask_phone(user.get("verified_phone") or ""),
        # 소셜 로그인으로 새로 가입한 계정은 가입 화면을 거치지 않으므로, 들어오자마자 인증을 요구한다.
        "required": on and bool(user.get("identity_required")) and not is_verified(user),
    }
