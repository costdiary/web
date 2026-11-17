"""결제(PG) 연동 — provider-agnostic 추상화 레이어.

``wholesale_verify.py``와 같은 원칙입니다: 비밀키(``TOSS_SECRET_KEY``)가 없으면 외부로 나가는
요청 없이 결정적인 모의(mock) 결과를 돌려줘서, 결제 화면·웹훅·정산 흐름을 실제 가맹점 계약 전에
먼저 만들고 검증할 수 있게 합니다.

지금 단계는 "연동 기반"입니다 — 실제 PG 가맹점 계약, 실결제, 환불 처리 창구 운영은
이 코드의 범위 밖입니다. 토스페이먼츠를 기본 구현으로 둔 이유는 결제위젯 방식이라 프런트에서
결제창을 띄우고 서버는 승인(confirm) API 한 번만 책임지면 되기 때문입니다(작성자 기억 기준,
2026-11-13 — 실제 연동 전 https://docs.tosspayments.com 로 다시 대조할 것).

흐름:
  1) 서버: create_intent 로 주문번호(order_id) 발급 + ws_ad_payments 에 method='pg' 로 기록
  2) 프런트: (실결제 시) 토스 결제위젯이 그 주문번호로 결제창을 띄움
  3) 서버: 위젯이 돌려준 paymentKey 로 confirm 호출 → 성공하면 결제 확정
  4) 서버: 토스가 보내는 웹훅(/api/payments/toss/webhook)으로 지연·취소·환불도 반영
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass

import httpx

from . import config

log = logging.getLogger("wongaenote.payments")

TOSS_API_BASE = "https://api.tosspayments.com/v1"


@dataclass
class PaymentIntent:
    provider: str
    order_id: str
    amount: int
    client_key: str = ""  # 토스 결제위젯이 프런트에서 필요로 하는 공개 키(비밀키 아님)
    checkout_url: str | None = None  # 목 모드에서만 채워짐(화면 흐름 확인용)


@dataclass
class PaymentConfirmation:
    provider: str
    order_id: str
    paid: bool
    amount: int | None = None
    pg_tx_id: str | None = None  # PG사 측 결제 키(토스: paymentKey)
    raw: dict | None = None
    error: str = ""


class PaymentProvider:
    """모든 PG 구현이 따르는 인터페이스."""

    name = "base"

    def create_intent(self, order_id: str, amount: int, order_name: str) -> PaymentIntent:
        raise NotImplementedError

    def confirm(self, payment_key: str, order_id: str, amount: int) -> PaymentConfirmation:
        raise NotImplementedError

    def parse_webhook(self, headers: dict, body: bytes) -> dict | None:
        """서명을 확인하고 통과하면 payload(dict)를, 실패하면 None을 돌려준다."""
        raise NotImplementedError


class MockProvider(PaymentProvider):
    """비밀키가 없을 때 쓰는 기본값. 외부로 어떤 요청도 보내지 않는다."""

    name = "mock"

    def create_intent(self, order_id: str, amount: int, order_name: str) -> PaymentIntent:
        return PaymentIntent(provider=self.name, order_id=order_id, amount=amount, client_key="mock_client_key", checkout_url=f"/mock-pay/{order_id}")

    def confirm(self, payment_key: str, order_id: str, amount: int) -> PaymentConfirmation:
        # 결정적 규칙(테스트용): 주문번호가 "FAIL"로 끝나면 실패를 흉내낸다.
        if order_id.endswith("FAIL"):
            return PaymentConfirmation(provider=self.name, order_id=order_id, paid=False, error="mock decline")
        return PaymentConfirmation(provider=self.name, order_id=order_id, paid=True, amount=amount, pg_tx_id=f"mock_{payment_key}")

    def parse_webhook(self, headers: dict, body: bytes) -> dict | None:
        try:
            return json.loads(body or b"{}")
        except ValueError:
            return None


class TossPaymentsProvider(PaymentProvider):
    """토스페이먼츠 결제 승인 API. 샌드박스/운영 키는 동일한 엔드포인트를 쓰고 키로만 구분된다."""

    name = "toss"

    def __init__(self, secret_key: str, client_key: str = "", webhook_secret: str = ""):
        self.secret_key = secret_key
        self.client_key = client_key
        self.webhook_secret = webhook_secret

    def create_intent(self, order_id: str, amount: int, order_name: str) -> PaymentIntent:
        # 토스 결제위젯은 클라이언트 키로 프런트에서 결제창을 띄우므로, 서버는 주문 정보만 내려준다.
        return PaymentIntent(provider=self.name, order_id=order_id, amount=amount, client_key=self.client_key)

    def confirm(self, payment_key: str, order_id: str, amount: int) -> PaymentConfirmation:
        try:
            resp = httpx.post(
                f"{TOSS_API_BASE}/payments/confirm",
                json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
                auth=(self.secret_key, ""),
                timeout=10.0,
            )
        except httpx.HTTPError as e:
            log.warning("toss confirm 요청 실패: %s", type(e).__name__)
            return PaymentConfirmation(provider=self.name, order_id=order_id, paid=False, error=str(type(e).__name__))
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code != 200:
            return PaymentConfirmation(provider=self.name, order_id=order_id, paid=False, error=str(data.get("message") or resp.status_code), raw=data)
        status = str(data.get("status") or "")
        paid = status in ("DONE", "WAITING_FOR_DEPOSIT")
        return PaymentConfirmation(provider=self.name, order_id=order_id, paid=paid, amount=data.get("totalAmount"), pg_tx_id=payment_key, raw=data)

    def parse_webhook(self, headers: dict, body: bytes) -> dict | None:
        if self.webhook_secret:
            sig = headers.get("toss-signature") or headers.get("Toss-Signature") or ""
            mac = hmac.new(self.webhook_secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, mac):
                log.warning("toss 웹훅 서명이 일치하지 않습니다.")
                return None
        try:
            return json.loads(body or b"{}")
        except ValueError:
            return None


def get_provider() -> PaymentProvider:
    secret = config.env_str("TOSS_SECRET_KEY")
    if secret:
        return TossPaymentsProvider(secret, config.env_str("TOSS_CLIENT_KEY", ""), config.env_str("TOSS_WEBHOOK_SECRET", ""))
    return MockProvider()


def make_order_id(kind: str, row_id: int) -> str:
    """영수증·웹훅에서 거래를 되찾을 수 있는 고유 주문번호. PG사 쪽 길이 제한(보통 6~64자)에 맞춘다."""
    return f"wongae-{kind}-{row_id}"
