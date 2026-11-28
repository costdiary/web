"""메일 발송: SMTP 설정이 없으면 로그에만 남기는 예시 모드로 동작합니다.

ocr.py·wholesale_verify.py와 같은 원칙입니다 — 외부 서비스 계정을 아직 만들지 않았어도 화면 흐름은
먼저 써 볼 수 있게, 키가 없을 때는 실제로 메일을 보내는 대신 로그에 남깁니다. 운영자가 서버 로그에서
링크를 보고 사장님께 수동으로 전달할 수 있습니다. 실제 메일 발송 계정(네이버 웍스, SendGrid 등)은
Claude가 대신 만들 수 없으니, 만든 뒤 .env의 SMTP_* 값을 채우면 바로 실제 발송으로 바뀝니다.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from . import config

log = logging.getLogger("wongaenote.mailer")


def enabled() -> bool:
    return bool(config.env_str("SMTP_HOST"))


def send(to: str, subject: str, body: str) -> None:
    # 마지막 안전장치: 어떤 경로든 하루·한 달 전체 한도를 넘겨 보내지 않는다(자세한 방어는 mail_guard.py).
    from . import mail_guard
    if mail_guard.over_total():
        log.warning("mail skipped: daily/monthly budget used up to=%s subject=%s", to, subject)
        return
    if not enabled():
        log.info("mail(mock, SMTP_HOST 없음) to=%s subject=%s\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"] = config.env_str("SMTP_FROM") or config.env_str("CONTACT_EMAIL") or "no-reply@wongaenote.com"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    host = config.env_str("SMTP_HOST")
    port = config.env_int("SMTP_PORT", 587)
    user = config.env_str("SMTP_USER")
    pw = config.env_str("SMTP_PASS")
    try:
        with smtplib.SMTP(host, port, timeout=10) as s:
            s.starttls()
            if user:
                s.login(user, pw)
            s.send_message(msg)
    except Exception:
        # 메일 발송 실패가 API 요청 전체를 막으면 안 된다(가입 여부를 응답 차이로 알아낼 수 있음).
        log.exception("mail send failed to=%s", to)
