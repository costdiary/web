"""운영 도구: 사용자 확인, 이용 기간 연장, 문의 내보내기, 백업.

예)
  python manage.py stats
  python manage.py users
  python manage.py set-plan owner@example.com --days 30     # 유료 이용 기간을 오늘부터 30일로 설정(이미 유료면 거기서 연장)
  python manage.py set-trial owner@example.com --days 14    # 체험 기간을 오늘부터 14일로 다시 설정
  python manage.py set-password owner@example.com           # 비밀번호를 잊은 사장님께 임시 비밀번호 발급
  python manage.py leads --csv leads.csv
  python manage.py backup
"""
from __future__ import annotations

import argparse
import csv
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import auth, market
from app.config import load_env_file
from app.db import ISO, connect, data_dir, init_db, now_iso, parse_iso, transaction

load_env_file()


def _find_user(db, email: str):
    row = db.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
    if not row:
        sys.exit(f"가입된 이메일이 아닙니다: {email}")
    return row


def cmd_users(db, args):
    rows = db.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM ingredients WHERE user_id = u.id) AS ing, "
        "(SELECT COUNT(*) FROM menus WHERE user_id = u.id) AS menus FROM users u ORDER BY u.id"
    ).fetchall()
    if not rows:
        print("가입한 사용자가 없습니다.")
        return
    print(f"{'ID':>4}  {'이메일':<32} {'상태':<8} {'남은일':>5}  {'식자재':>4} {'메뉴':>4}  가입일")
    for r in rows:
        ps = auth.plan_status(dict(r))
        label = {"trial": "체험", "paid": "유료", "expired": "만료"}[ps["state"]]
        print(f"{r['id']:>4}  {r['email']:<32} {label:<8} {ps['days_left']:>5}  {r['ing']:>6} {r['menus']:>4}  {r['created_at'][:10]}")


def cmd_set_plan(db, args):
    u = _find_user(db, args.email)
    now = datetime.now(timezone.utc)
    base = max([d for d in (now, parse_iso(u["paid_until"])) if d])
    end = (base + timedelta(days=args.days)).strftime(ISO)
    db.execute("UPDATE users SET paid_until = ? WHERE id = ?", (end, u["id"]))
    print(f"{u['email']}: 유료 이용 기간을 {end[:10]} 까지로 설정했습니다.")


def cmd_set_trial(db, args):
    u = _find_user(db, args.email)
    end = (datetime.now(timezone.utc) + timedelta(days=args.days)).strftime(ISO)
    db.execute("UPDATE users SET trial_ends_at = ? WHERE id = ?", (end, u["id"]))
    print(f"{u['email']}: 체험 기간을 {end[:10]} 까지로 설정했습니다.")


def cmd_set_password(db, args):
    u = _find_user(db, args.email)
    temp = secrets.token_urlsafe(9)
    db.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (auth.hash_password(temp), u["id"]))
    db.execute("DELETE FROM sessions WHERE user_id = ?", (u["id"],))
    print(f"{u['email']}: 임시 비밀번호  {temp}")
    print("  본인 확인 후 사장님께 전달하고, 로그인한 뒤 설정에서 바꾸도록 안내하세요. 기존 로그인은 모두 해제했습니다.")


def cmd_leads(db, args):
    rows = db.execute("SELECT * FROM leads ORDER BY id").fetchall()
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["접수일", "이름", "연락처", "업종", "내용"])
            for r in rows:
                w.writerow([r["created_at"], r["name"], r["contact"], r["biz_type"], r["message"]])
        print(f"{len(rows)}건을 {args.csv} 로 저장했습니다.")
        return
    if not rows:
        print("접수된 문의가 없습니다.")
    for r in rows:
        print(f"[{r['created_at'][:16]}] {r['name'] or '(이름 없음)'} / {r['contact']} / {r['biz_type']}\n    {r['message']}")


def cmd_stats(db, args):
    q = lambda sql: db.execute(sql).fetchone()[0]  # noqa: E731
    now = now_iso()
    users = [auth.plan_status(dict(r)) for r in db.execute("SELECT * FROM users")]
    print(f"가입자 {len(users)}명  (체험 {sum(u['state']=='trial' for u in users)} / 유료 {sum(u['state']=='paid' for u in users)} / 만료 {sum(u['state']=='expired' for u in users)})")
    print(f"식자재 {q('SELECT COUNT(*) FROM ingredients')}개, 메뉴 {q('SELECT COUNT(*) FROM menus')}개, 반영한 명세서 {q('SELECT COUNT(*) FROM invoices')}장")
    ym = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m")
    used = db.execute("SELECT COALESCE(SUM(count),0) FROM ocr_usage WHERE ym = ?", (ym,)).fetchone()[0]
    print(f"이번 달({ym}) 자동 인식 사용 {used}회, 도입 문의 {q('SELECT COUNT(*) FROM leads')}건")
    from app import visits
    st = visits.summary(db, 30)
    v, sg = st["visits"], st["signups"]
    since = f" (방문 집계 시작 {v['tracking_since']})" if v["tracking_since"] else " (방문 집계는 아직 기록 없음)"
    print(f"가입 오늘 {sg['today']}명, 최근 7일 {sg['week']}명, 최근 30일 {sg['period']}명")
    print(f"방문자 오늘 {v['today']}명, 최근 7일 {v['week']}명, 최근 30일 {v['period']}명(조회 {v['period_views']}회){since}")
    print(f"기준 시각 {now}")


def cmd_backup(db, args):
    dest_dir = Path(args.to) if args.to else data_dir() / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"wongaenote-{stamp}.db"
    out = sqlite3.connect(dest)
    try:
        db.backup(out)  # 서비스 중에도 안전하게 복사됩니다
    finally:
        out.close()
    # 오래된 백업 정리(최근 14개만 유지)
    olds = sorted(dest_dir.glob("wongaenote-*.db"))[:-14]
    for p in olds:
        p.unlink()
    print(f"백업 완료: {dest}  (보관 {min(len(olds) + 14, 14)}개 이내)")


# ------------------------------------------------------------------ 도매 마켓(운영자, G7: 관리자 웹 없음)

def _find_ws(db, email: str):
    row = db.execute("SELECT * FROM ws_accounts WHERE email = ?", (email.strip().lower(),)).fetchone()
    if not row:
        sys.exit(f"가입된 도매업체 이메일이 아닙니다: {email}")
    return row


def cmd_ws_list(db, args):
    q = "SELECT * FROM ws_accounts"
    params: tuple = ()
    if args.status:
        q += " WHERE status = ?"
        params = (args.status,)
    rows = db.execute(q + " ORDER BY id", params).fetchall()
    if not rows:
        print("도매업체 계정이 없습니다.")
        return
    print(f"{'ID':>4}  {'이메일':<28} {'상태':<10} {'상호':<24} 인증수단  가입일")
    for r in rows:
        last = db.execute(
            "SELECT nts_provider FROM ws_verifications WHERE ws_id = ? ORDER BY id DESC LIMIT 1", (r["id"],)
        ).fetchone()
        provider = (last["nts_provider"] if last else "") or "-"
        print(f"{r['id']:>4}  {r['email']:<28} {r['status']:<10} {r['biz_name']:<24} {provider:<8} {r['created_at'][:10]}")


def cmd_ws_suspend(db, args):
    w = _find_ws(db, args.email)
    db.execute("UPDATE ws_accounts SET status='suspended', updated_at=? WHERE id=?", (now_iso(), w["id"]))
    db.execute("DELETE FROM ws_sessions WHERE ws_id = ?", (w["id"],))
    print(f"{w['email']}: 이용을 정지했습니다.")


def cmd_ws_restore(db, args):
    w = _find_ws(db, args.email)
    db.execute("UPDATE ws_accounts SET status='verified', updated_at=? WHERE id=?", (now_iso(), w["id"]))
    print(f"{w['email']}: 이용 정지를 해제했습니다(인증 상태로 복귀).")


def cmd_ad_payments(db, args):
    q = "SELECT p.*, a.title FROM ws_ad_payments p JOIN ws_ads a ON a.id = p.ad_id"
    params: tuple = ()
    if args.status:
        q += " WHERE p.status = ?"
        params = (args.status,)
    rows = db.execute(q + " ORDER BY p.requested_at", params).fetchall()
    if not rows:
        print("결제 신청이 없습니다.")
        return
    for r in rows:
        print(f"[{r['id']}] {r['title']}  {r['amount']:,}원  입금자:{r['depositor_name']}  상태:{r['status']}  신청일:{r['requested_at'][:16]}")


def cmd_ad_approve(db, args):
    with transaction(db):
        try:
            out = market.approve_ad_payment(db, args.payment_id, by="cli")
        except ValueError as e:
            sys.exit(str(e))
        if args.memo:
            db.execute("UPDATE ws_ad_payments SET memo=? WHERE id=?", (args.memo, args.payment_id))
    print(f"결제 {args.payment_id}번 승인, 광고 {out['ad_id']}번이 노출을 시작합니다.")


def cmd_ad_reject(db, args):
    cur = db.execute(
        "UPDATE ws_ad_payments SET status='cancelled', memo=? WHERE id=? AND status='requested'",
        (args.memo, args.payment_id),
    )
    if cur.rowcount == 0:
        sys.exit("대기 중인 결제 신청을 찾지 못했습니다.")
    ad_id = db.execute("SELECT ad_id FROM ws_ad_payments WHERE id = ?", (args.payment_id,)).fetchone()["ad_id"]
    db.execute("UPDATE ws_ads SET status='rejected', updated_at=? WHERE id=?", (now_iso(), ad_id))
    print(f"결제 {args.payment_id}번을 반려했습니다: {args.memo}")


def cmd_market_refresh(db, args):
    with transaction(db):
        market.refresh_public_all(db)
    print("도매 마켓 공개 집계·만료 처리·신뢰 점수를 갱신했습니다.")


def cmd_market_stats(db, args):
    sig_total = db.execute("SELECT COUNT(*) AS c FROM mk_demand_signals WHERE active = 1").fetchone()["c"]
    pub_visible = db.execute("SELECT COUNT(*) AS c FROM mk_demand_public WHERE visible = 1").fetchone()["c"]
    pub_hidden = db.execute("SELECT COUNT(*) AS c FROM mk_demand_public WHERE visible = 0").fetchone()["c"]
    bids = db.execute("SELECT COUNT(*) AS c FROM mk_bids WHERE status = 'active'").fetchone()["c"]
    matches = db.execute("SELECT COUNT(*) AS c FROM mk_matches").fetchone()["c"]
    conns = db.execute("SELECT COUNT(*) AS c FROM mk_connections").fetchone()["c"]
    done = db.execute("SELECT COUNT(*) AS c FROM mk_connections WHERE invoice_verified = 1").fetchone()["c"]
    print(f"활성 수요 신호 {sig_total}개 (공개 {pub_visible} / k 미달로 숨김 {pub_hidden})")
    print(f"활성 제안 {bids}개, 매칭 기록 {matches}건, 연결 요청 {conns}건(명세서로 성사 확인 {done}건)")


def main() -> None:
    p = argparse.ArgumentParser(description="원가노트 운영 도구")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("users", help="가입자 목록").set_defaults(fn=cmd_users)
    sub.add_parser("stats", help="요약 통계").set_defaults(fn=cmd_stats)
    sp = sub.add_parser("set-plan", help="유료 이용 기간 설정(입금 확인 후)")
    sp.add_argument("email")
    sp.add_argument("--days", type=int, default=30)
    sp.set_defaults(fn=cmd_set_plan)
    st = sub.add_parser("set-trial", help="체험 기간 다시 설정")
    st.add_argument("email")
    st.add_argument("--days", type=int, default=14)
    st.set_defaults(fn=cmd_set_trial)
    sw = sub.add_parser("set-password", help="비밀번호를 잊은 사용자에게 임시 비밀번호 발급")
    sw.add_argument("email")
    sw.set_defaults(fn=cmd_set_password)
    sl = sub.add_parser("leads", help="도입 문의 보기/내보내기")
    sl.add_argument("--csv", help="CSV 파일로 저장")
    sl.set_defaults(fn=cmd_leads)
    sb = sub.add_parser("backup", help="DB 백업(최근 14개 보관)")
    sb.add_argument("--to", help="백업 폴더(기본: DATA_DIR/backups)")
    sb.set_defaults(fn=cmd_backup)

    wl = sub.add_parser("ws-list", help="도매업체 계정 목록")
    wl.add_argument("--status", choices=["pending", "verified", "rejected", "suspended"])
    wl.set_defaults(fn=cmd_ws_list)
    ws_sp = sub.add_parser("ws-suspend", help="도매업체 이용 정지")
    ws_sp.add_argument("email")
    ws_sp.set_defaults(fn=cmd_ws_suspend)
    ws_rs = sub.add_parser("ws-restore", help="도매업체 이용 정지 해제")
    ws_rs.add_argument("email")
    ws_rs.set_defaults(fn=cmd_ws_restore)
    ap = sub.add_parser("ad-payments", help="떨이 광고 결제 신청 목록(입금 대기)")
    ap.add_argument("--status", choices=["requested", "paid", "cancelled", "refunded", "failed"])
    ap.set_defaults(fn=cmd_ad_payments)
    aa = sub.add_parser("ad-approve", help="입금 확인 후 광고 결제 승인 -> 노출 시작")
    aa.add_argument("payment_id", type=int)
    aa.add_argument("--memo", default="")
    aa.set_defaults(fn=cmd_ad_approve)
    ar = sub.add_parser("ad-reject", help="광고 결제 신청 반려")
    ar.add_argument("payment_id", type=int)
    ar.add_argument("--memo", required=True, help="반려 사유")
    ar.set_defaults(fn=cmd_ad_reject)
    sub.add_parser("market-refresh", help="수요 공개 집계·만료 처리·신뢰 점수 재계산(크론용)").set_defaults(fn=cmd_market_refresh)
    sub.add_parser("market-stats", help="도매 마켓 요약 통계").set_defaults(fn=cmd_market_stats)

    args = p.parse_args()
    init_db()
    db = connect()
    try:
        args.fn(db, args)
    finally:
        db.close()


if __name__ == "__main__":
    main()
