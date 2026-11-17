"""카카오·네이버·구글 소셜 로그인(OAuth2 authorization code 방식).

각 서비스의 개발자 콘솔에서 애플리케이션을 만들고, 콜백 주소
(APP_BASE_URL + /api/auth/oauth/<provider>/callback)를 "Redirect URI"로 등록한 뒤 발급받은
키를 .env의 KAKAO_CLIENT_ID 등에 넣어야 로그인 화면에 해당 버튼이 나타납니다. 개발자 계정·앱
등록·결제 수단 연결은 사장님(남기) 본인만 할 수 있어 Claude가 대신 만들어 줄 수 없습니다.

  - 카카오: https://developers.kakao.com → 내 애플리케이션 → 카카오 로그인 활성화
  - 네이버: https://developers.naver.com/apps → 애플리케이션 등록 (네이버 로그인 API)
  - 구글: https://console.cloud.google.com → API 및 서비스 → OAuth 동의 화면 → 사용자 인증 정보
"""
from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

import httpx

from . import config

log = logging.getLogger("wongaenote.oauth")

PROVIDERS: dict[str, dict] = {
    "kakao": {
        "label": "카카오",
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "profile_url": "https://kapi.kakao.com/v2/user/me",
        "scope": "",
    },
    "naver": {
        "label": "네이버",
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "profile_url": "https://openapi.naver.com/v1/nid/me",
        "scope": "",
    },
    "google": {
        "label": "구글",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "profile_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email",
    },
}


class OAuthError(Exception):
    pass


def client_id(provider: str) -> str:
    return config.env_str(f"{provider.upper()}_CLIENT_ID")


def client_secret(provider: str) -> str:
    return config.env_str(f"{provider.upper()}_CLIENT_SECRET")


def configured_providers() -> dict[str, bool]:
    """키가 설정된(= 화면에 버튼을 보여줄) 제공자만 True."""
    return {p: bool(client_id(p)) for p in PROVIDERS}


def redirect_uri(provider: str) -> str:
    base = config.env_str("APP_BASE_URL").rstrip("/")
    return f"{base}/api/auth/oauth/{provider}/callback"


def new_state() -> str:
    return secrets.token_urlsafe(24)


def authorize_url(provider: str, state: str) -> str:
    p = PROVIDERS[provider]
    params = {
        "client_id": client_id(provider),
        "redirect_uri": redirect_uri(provider),
        "response_type": "code",
        "state": state,
    }
    if p["scope"]:
        params["scope"] = p["scope"]
    return f"{p['authorize_url']}?{urlencode(params)}"


def _token(provider: str, code: str) -> str:
    p = PROVIDERS[provider]
    data = {
        "grant_type": "authorization_code",
        "client_id": client_id(provider),
        "client_secret": client_secret(provider),
        "redirect_uri": redirect_uri(provider),
        "code": code,
    }
    try:
        resp = httpx.post(p["token_url"], data=data, headers={"Accept": "application/json"}, timeout=10.0)
    except httpx.HTTPError as e:
        raise OAuthError(f"token request failed: {type(e).__name__}") from e
    if resp.status_code != 200:
        log.warning("%s token http %s: %s", provider, resp.status_code, resp.text[:300])
        raise OAuthError("로그인 서버 응답이 올바르지 않습니다.")
    access_token = resp.json().get("access_token")
    if not access_token:
        raise OAuthError("로그인 서버에서 토큰을 받지 못했습니다.")
    return access_token


def _profile(provider: str, access_token: str) -> tuple[str, str | None]:
    """(provider_uid, email) 반환. 이메일은 사용자가 동의하지 않았으면 None일 수 있습니다."""
    p = PROVIDERS[provider]
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = httpx.get(p["profile_url"], headers=headers, timeout=10.0)
    except httpx.HTTPError as e:
        raise OAuthError(f"profile request failed: {type(e).__name__}") from e
    if resp.status_code != 200:
        log.warning("%s profile http %s: %s", provider, resp.status_code, resp.text[:300])
        raise OAuthError("로그인 서버에서 프로필을 받지 못했습니다.")
    data = resp.json()
    if provider == "kakao":
        uid = str(data.get("id") or "")
        email = (data.get("kakao_account") or {}).get("email")
    elif provider == "naver":
        acc = data.get("response") or {}
        uid = str(acc.get("id") or "")
        email = acc.get("email")
    elif provider == "google":
        uid = str(data.get("sub") or "")
        email = data.get("email")
    else:
        raise OAuthError("알 수 없는 로그인 제공자입니다.")
    if not uid:
        raise OAuthError("로그인 서버 응답에서 사용자 식별값을 찾지 못했습니다.")
    return uid, (str(email).strip() if email else None)


def resolve(provider: str, code: str) -> tuple[str, str | None]:
    """인증 코드를 교환해 (provider_uid, email)을 반환합니다."""
    if provider not in PROVIDERS:
        raise OAuthError("알 수 없는 로그인 제공자입니다.")
    if not client_id(provider):
        raise OAuthError("이 로그인 방법은 아직 설정되지 않았습니다.")
    access_token = _token(provider, code)
    return _profile(provider, access_token)
