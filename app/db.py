"""SQLite 연결과 스키마.

- 요청마다 연결을 새로 열고 닫습니다(check_same_thread=False: FastAPI가 스레드풀에서 실행하기 때문).
- 자동 커밋 모드(isolation_level=None)로 두고, 여러 줄을 한 번에 바꿔야 할 때만 `transaction()`을 씁니다.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from . import market_catalog
from .config import ROOT

ISO = "%Y-%m-%dT%H:%M:%SZ"


def data_dir() -> Path:
    p = Path(os.getenv("DATA_DIR") or (ROOT / "data"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "wongaenote.db"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO)


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.strptime(s, ISO).replace(tzinfo=timezone.utc)


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  store_name TEXT NOT NULL DEFAULT '',
  trial_ends_at TEXT NOT NULL,
  paid_until TEXT,
  target_cost_ratio REAL NOT NULL DEFAULT 35,
  alert_pct REAL NOT NULL DEFAULT 5,
  vat_mode TEXT NOT NULL DEFAULT 'incl',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 카카오·네이버·구글 소셜 로그인 연결(14). 한 사장님 계정에 여러 제공자를 연결할 수 있어 users와는
-- 별도 표로 둔다. 비밀번호 없이 소셜로만 가입한 계정도 users.pw_hash는 NOT NULL이라 아무도 모르는
-- 임의 값을 넣어 두고(auth.unusable_password_hash), 비밀번호 로그인 경로는 항상 막힌다.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

-- 비밀번호 찾기 링크(14). 계정당 하나만 유지하고(새로 요청하면 이전 링크는 지움), 30분 뒤 만료.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 이메일 인증번호(21). 주소·용도마다 하나만 두고(새로 받으면 덮어씀), 10분 뒤 만료, 다섯 번 틀리면 무효.
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('g', 'ml', 'ea')),
  unit_price REAL,
  yield_pct REAL NOT NULL DEFAULT 100,
  supplier TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  pack_size REAL,
  pack_unit TEXT,
  pack_price REAL,
  price_checked_at TEXT,
  updated_at TEXT NOT NULL,
  mk_item_id INTEGER REFERENCES mk_items(id),
  origin TEXT,
  grade TEXT,
  UNIQUE (user_id, name)
);
-- [v9] 식자재 등록 화면에서 직접 입력하는 부위(등심/안심/삼겹살 등). 품목마다 표현이 달라 자유 텍스트.
-- ALTER TABLE로 추가되므로(기존 DB 호환) 이 CREATE TABLE에는 없고 migrate()에서 더합니다.

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_price REAL NOT NULL,
  pack_size REAL,
  pack_unit TEXT,
  pack_price REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  invoice_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist_user_ing ON price_history (user_id, ingredient_id, created_at);

CREATE TABLE IF NOT EXISTS ingredient_aliases (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, alias)
);

CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  other_cost REAL NOT NULL DEFAULT 0,
  delivery_price REAL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menus_user ON menus (user_id);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL CHECK (qty > 0),
  position INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  qty_low REAL,
  qty_high REAL
);
CREATE INDEX IF NOT EXISTS idx_items_menu ON menu_items (menu_id);
CREATE INDEX IF NOT EXISTS idx_items_ing ON menu_items (ingredient_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT '',
  invoice_date TEXT,
  total REAL,
  line_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS ocr_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ym TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ym)
);

CREATE TABLE IF NOT EXISTS fixed_costs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fixed_costs_user ON fixed_costs(user_id);

CREATE TABLE IF NOT EXISTS shop_profile (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_share REAL NOT NULL DEFAULT 0,
  open_days INTEGER NOT NULL DEFAULT 26,
  target_profit REAL NOT NULL DEFAULT 0,
  payment_fee_pct REAL NOT NULL DEFAULT 0,
  labor_5plus INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_sales (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'store',
  amount REAL NOT NULL DEFAULT 0,
  orders INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (user_id, day, channel)
);

-- 하루 매출을 입력할 때 메뉴별로 몇 개 팔렸는지 선택해 두면(선택 사항), 그 날 실제 원가를 빼서
-- 순이익을 보여 줄 수 있다. daily_sales의 금액(amount)과는 독립적으로 저장하고 비교만 한다.
CREATE TABLE IF NOT EXISTS sales_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, menu_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_items_user_day ON sales_items (user_id, day);

-- 직원(아르바이트) 급여: 시급과 주 근무시간으로 한 달 인건비(주휴수당 포함)를 계산해 손익분기 고정비에 더합니다
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hourly_wage REAL NOT NULL,
  weekly_hours REAL NOT NULL,
  work_days INTEGER NOT NULL DEFAULT 5,
  night_hours REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON staff(user_id);

CREATE TABLE IF NOT EXISTS shop_location (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 500,
  label TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- 공공데이터를 불러온 결과(모든 사용자가 같은 공개 자료를 씁니다. 개인정보 없음)
CREATE TABLE IF NOT EXISTS area_cache (
  cache_key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

-- 로그인·차단 같은 보안 사건 기록(계정을 지워도 남기되 user_id 는 비웁니다)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  ip TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event, at);

CREATE TABLE IF NOT EXISTS channels (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT '',
  fee_pct REAL NOT NULL DEFAULT 0,
  pay_pct REAL NOT NULL DEFAULT 0,
  delivery_fee REAL NOT NULL DEFAULT 0,
  coupon_cost REAL NOT NULL DEFAULT 0,
  pack_cost REAL NOT NULL DEFAULT 0,
  vat_extra INTEGER NOT NULL DEFAULT 1,
  checked_on TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- 명세서 한 줄 한 줄의 구매 기록(식자재별 '최근 몇 건 평균 단가' 계산에 씁니다. price_history는
-- 단가가 바뀔 때만 쌓이는 변경 이력이라 평균을 낼 수 없어서 따로 둡니다)
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  pack_size REAL NOT NULL,
  pack_unit TEXT NOT NULL,
  pack_price REAL NOT NULL,
  unit_price REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_ing ON invoice_lines (user_id, ingredient_id, created_at);

-- ═══════════════ 도매 마켓(역경매 + 떨이 광고) ═══════════════

-- 도매업체 계정(사장님 users와 완전히 분리된 테이블·쿠키)
CREATE TABLE IF NOT EXISTS ws_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','rejected','suspended')),
  biz_no TEXT,
  biz_name TEXT NOT NULL DEFAULT '',
  ceo_name TEXT NOT NULL DEFAULT '',
  open_date TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_bizno ON ws_accounts(biz_no) WHERE biz_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS ws_sessions (
  token_hash TEXT PRIMARY KEY,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 도매업체가 배송 가능한 권역(여러 개)
CREATE TABLE IF NOT EXISTS ws_regions (
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  PRIMARY KEY (ws_id, region_code)
);

-- 도매업체 인증 시도 이력. 사업자등록증 이미지는 저장하지 않고 해시만 남긴다.
CREATE TABLE IF NOT EXISTS ws_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  step TEXT NOT NULL DEFAULT 'ocr_done'
    CHECK (step IN ('ocr_done','approved','rejected','retry')),
  image_sha256 TEXT NOT NULL DEFAULT '',
  ocr_provider TEXT NOT NULL DEFAULT 'mock',
  ocr_json TEXT NOT NULL DEFAULT '{}',
  biz_no TEXT, biz_name TEXT, ceo_name TEXT, open_date TEXT,
  nts_provider TEXT NOT NULL DEFAULT '',
  nts_valid INTEGER,
  nts_status TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wsver_ws ON ws_verifications(ws_id, created_at);

-- 표준 품목 사전(사장님 간 '같은 품목'을 묶는 키)
CREATE TABLE IF NOT EXISTS mk_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '',
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('g','ml','ea')),
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'seed'
);
CREATE TABLE IF NOT EXISTS mk_item_aliases (
  norm_alias TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES mk_items(id) ON DELETE CASCADE
);

-- 카탈로그에 없는 품목을 사장님이 요청(leads처럼 접수만, 수동으로 검토 후 mk_items에 추가)
CREATE TABLE IF NOT EXISTS mk_item_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('g','ml','ea')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkreq_user ON mk_item_requests(user_id, status);

-- 사장님별 마켓 설정(수요 노출 opt-in, 임계값, 권역, 안내 확인 시각)
CREATE TABLE IF NOT EXISTS mk_buyer_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  demand_optin INTEGER NOT NULL DEFAULT 1,
  ad_optin INTEGER NOT NULL DEFAULT 1,
  threshold_pct REAL NOT NULL DEFAULT 5 CHECK (threshold_pct >= 1 AND threshold_pct <= 30),
  region_code TEXT,
  notice_ack_at TEXT,
  optout_at TEXT,
  updated_at TEXT NOT NULL
);

-- 수요 신호: 익명화 '전'(사장님×식자재, 비공개)
CREATE TABLE IF NOT EXISTS mk_demand_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES mk_items(id),
  origin TEXT NOT NULL,
  grade TEXT NOT NULL,
  region_code TEXT NOT NULL,
  avg_unit_price REAL NOT NULL,
  invoice_count INTEGER NOT NULL,
  monthly_base_qty REAL,
  last_bought_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_signal_key ON mk_demand_signals(item_id, origin, grade, region_code, active);

-- 수요 공개 집계: 익명화 '후'(도매업체가 보는 유일한 수요 데이터)
CREATE TABLE IF NOT EXISTS mk_demand_public (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES mk_items(id),
  origin TEXT NOT NULL,
  grade TEXT NOT NULL,
  region_code TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 0,
  buyer_band TEXT NOT NULL DEFAULT '',
  qty_low REAL, qty_high REAL,
  refreshed_at TEXT NOT NULL,
  UNIQUE (item_id, origin, grade, region_code)
);

-- 도매업체의 블라인드 제안
CREATE TABLE IF NOT EXISTS mk_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES mk_items(id),
  origin TEXT NOT NULL,
  grade TEXT NOT NULL,
  region_code TEXT NOT NULL,
  pack_size REAL NOT NULL, pack_unit TEXT NOT NULL, pack_price REAL NOT NULL,
  vat_type TEXT NOT NULL DEFAULT 'incl' CHECK (vat_type IN ('incl','excl','exempt')),
  unit_price REAL NOT NULL,
  min_order_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','expired')),
  price_changes INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bid_active
  ON mk_bids(ws_id, item_id, origin, grade, region_code) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bid_key ON mk_bids(item_id, origin, grade, region_code, status);

-- 프리미엄 광고(떨이). mk_connections가 참조하므로 먼저 선언한다.
CREATE TABLE IF NOT EXISTS ws_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES mk_items(id),
  origin TEXT NOT NULL,
  grade TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pack_size REAL NOT NULL, pack_unit TEXT NOT NULL, pack_price REAL NOT NULL,
  vat_type TEXT NOT NULL DEFAULT 'incl' CHECK (vat_type IN ('incl','excl','exempt')),
  unit_price REAL NOT NULL,
  stock_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_payment','active','paused','ended','rejected')),
  run_days INTEGER NOT NULL DEFAULT 3,
  starts_at TEXT, ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ads_live ON ws_ads(status, ends_at, item_id);

CREATE TABLE IF NOT EXISTS ws_ad_regions (
  ad_id INTEGER NOT NULL REFERENCES ws_ads(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  PRIMARY KEY (ad_id, region_code)
);

CREATE TABLE IF NOT EXISTS ws_ad_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL REFERENCES ws_ads(id) ON DELETE CASCADE,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'invoice' CHECK (method IN ('invoice','pg')),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','paid','cancelled','refunded','failed')),
  depositor_name TEXT NOT NULL DEFAULT '',
  tax_invoice INTEGER NOT NULL DEFAULT 0,
  pg_provider TEXT, pg_tx_id TEXT, pg_payload TEXT,
  memo TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  paid_at TEXT,
  confirmed_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_adpay_status ON ws_ad_payments(status, requested_at);

CREATE TABLE IF NOT EXISTS ws_ad_deliveries (
  ad_id INTEGER NOT NULL REFERENCES ws_ads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','dismissed','inquired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (ad_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_addeliv_user ON ws_ad_deliveries(user_id, status);

-- 매칭/알림 기록. 사장님 쪽에서만 조회하며 도매업체 API에는 조회 경로가 없다.
CREATE TABLE IF NOT EXISTS mk_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id INTEGER NOT NULL REFERENCES mk_bids(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  base_avg_price REAL NOT NULL,
  threshold_pct REAL NOT NULL,
  bid_unit_price REAL NOT NULL,
  saving_pct REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','dismissed','connected','stale')),
  created_at TEXT NOT NULL,
  seen_at TEXT,
  UNIQUE (bid_id, user_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_match_user ON mk_matches(user_id, status, created_at);

-- 연결 요청(역경매 제안과 떨이 광고 공용)
CREATE TABLE IF NOT EXISTS mk_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('bid','ad')),
  match_id INTEGER REFERENCES mk_matches(id) ON DELETE SET NULL,
  ad_id INTEGER REFERENCES ws_ads(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ws_id INTEGER NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES mk_items(id),
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_contact TEXT NOT NULL DEFAULT '',
  buyer_message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','declined','expired','closed')),
  buyer_outcome TEXT CHECK (buyer_outcome IN ('done','failed')),
  ws_outcome TEXT CHECK (ws_outcome IN ('done','failed')),
  invoice_verified INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conn_ws ON mk_connections(ws_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_conn_user ON mk_connections(user_id, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_match ON mk_connections(match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_ad ON mk_connections(ad_id, user_id) WHERE ad_id IS NOT NULL;

-- 도매업체 신뢰 지표(캐시. 원자료는 mk_connections)
CREATE TABLE IF NOT EXISTS ws_stats (
  ws_id INTEGER PRIMARY KEY REFERENCES ws_accounts(id) ON DELETE CASCADE,
  conn_total INTEGER NOT NULL DEFAULT 0,
  conn_answered INTEGER NOT NULL DEFAULT 0,
  deals_done INTEGER NOT NULL DEFAULT 0,
  deals_failed INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);

-- [v9] 원산지별로 다른 등급 용어를 검색으로 매칭하기 위한 표(국산 소고기 1++/1+/1 vs 미국산 Prime/Choice 등).
-- origin이 NULL이면 원산지 무관 공통 등급(계란 특란/대란, 채소 상/중/하 등).
CREATE TABLE IF NOT EXISTS mk_grade_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  origin TEXT,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  norm_label TEXT NOT NULL,
  UNIQUE(category, origin, code)
);

-- [v11] 분류·등급·부위 자동완성 시드. kind: category|grade|cut (ingredients 열 이름과 같다).
CREATE TABLE IF NOT EXISTS mk_terms (
  kind TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL,
  UNIQUE(kind, category, term)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL,
  biz_type TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- [v12] 프렙 레시피(미리 끓여 두는 육수·소스 등)를 g/ml당 원가로 관리. 프렙 결과물은 전용 식자재 한 줄
-- (ingredients.from_prep_id, migrate()에서 ALTER로 추가)로 자동 관리되어, 메뉴 원가 계산(costing.py)이
-- 그대로 재사용된다. prep_items의 재료는 다른 프렙 결과물이 아닌 '원재료'만 허용한다(1단계만, 순환 방지).
CREATE TABLE IF NOT EXISTS preps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('g', 'ml')),
  yield_qty REAL NOT NULL DEFAULT 0,
  ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS prep_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prep_id INTEGER NOT NULL REFERENCES preps(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty REAL NOT NULL CHECK (qty > 0),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prepitems_prep ON prep_items(prep_id);

-- [v13] 배달앱 주문건 연동(배민·쿠팡이츠). 실제 파트너 API 키가 없으면 예시 주문으로 틀만 보여 준다
-- (order_integrations.py). 메뉴 이름이 같으면 메뉴에 연결해 건별 재료비·순이익·마진율을 계산한다.
CREATE TABLE IF NOT EXISTS order_platforms (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('baemin', 'coupangeats')),
  connected INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT,
  PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  menu_id INTEGER REFERENCES menus(id) ON DELETE SET NULL,
  menu_name TEXT NOT NULL DEFAULT '',
  order_amount REAL NOT NULL DEFAULT 0,
  commission_fee REAL NOT NULL DEFAULT 0,
  payment_fee REAL NOT NULL DEFAULT 0,
  delivery_fee REAL NOT NULL DEFAULT 0,
  ad_fee REAL NOT NULL DEFAULT 0,
  ingredient_cost REAL,
  net_profit REAL,
  margin_pct REAL,
  ordered_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'mock',
  UNIQUE (user_id, platform, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_user_day ON orders(user_id, ordered_at);

-- 후원(도네이션) — 결제사는 아직 정하지 않아 UI/표만 먼저 만든다. payments.py의
-- PaymentProvider 추상화(지금은 MockProvider)를 그대로 재사용하므로, 나중에 실제
-- PG를 붙일 때도 이 표/코드는 바뀔 일이 없고 get_provider()만 바꾸면 된다.
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'failed', 'cancelled')),
  pg_order_id TEXT UNIQUE,
  pg_tx_id TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_donations_paid_day ON donations(status, paid_at);

-- 알림 센터(notifications.py). 상태를 보고 만드는 알림은 dedupe_key로 한 번만 넣는다.
-- category는 kind에서 정해지지만 분류별 끄기·거르기를 빠르게 하려고 같이 저장한다.
-- 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로 기존 DB에도 바로 생긴다(버전 번호 불필요).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT,
  data TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 알림 분류(cost/sales/market/system)별 켜고 끄기. 행이 없으면 켜진 것으로 본다.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, category)
);

-- 휴대폰 본인인증(19) — identity.py. id는 포트원에 넘기는 추측 불가능한 인증 번호.
-- 가입 전 인증은 user_id가 비어 있다가 가입하면서 채워진다(status 'used'). CI 원문은 저장하지 않고 해시만.
CREATE TABLE IF NOT EXISTS identity_verifications (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'account')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'verified', 'used', 'failed')),
  name TEXT,
  phone TEXT,
  birth_date TEXT,
  gender TEXT,
  ci_hash TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT
);

-- OCR 인식 로그 — 사장님이 올린 거래명세서/요리 사진마다 남겨서, 운영자(ADMIN_EMAILS)가
-- 인식이 이상할 때 원본 사진과 모델 응답을 같이 볼 수 있게 한다. image는 ocr.py가 이미
-- API로 보내기 전에 줄인 JPEG(긴 변 1568px 이하)라서 원본보다 훨씬 작다.
-- 사진을 서버에 남기는 건 ocr.py 원래 설계(저장 안 함)에서 바뀐 부분이라는 점을 기억할 것 —
-- 사장님께 안내할 개인정보 처리 방침과 함께 다뤄야 한다.
CREATE TABLE IF NOT EXISTS ocr_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'recipe')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'demo', 'error')),
  summary TEXT NOT NULL DEFAULT '',
  result_json TEXT,
  error_text TEXT,
  image BLOB,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ocr_logs_user_day ON ocr_logs(user_id, created_at);

-- 방문자 수(운영자 화면 #/admin/stats). 쿠키·외부 분석 도구 없이 서버가 첫 화면 요청을 직접 센다(visits.py).
-- 날짜별 숫자만 오래 남기고, 같은 사람을 하루 한 번만 세는 데 쓰는 해시(visit_seen)와 그날의 소금(visit_salts)은
-- 이틀 뒤 지운다. 새 표뿐이라 CREATE TABLE IF NOT EXISTS로 기존 DB에도 바로 생긴다(버전 번호 불필요).
CREATE TABLE IF NOT EXISTS visit_daily (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  member_visitors INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visit_sources (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);
CREATE TABLE IF NOT EXISTS visit_seen (
  day TEXT NOT NULL,
  vhash TEXT NOT NULL,
  member INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, vhash)
);
CREATE TABLE IF NOT EXISTS visit_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=15, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")
    return conn


# 이미 쓰고 있는 데이터베이스에 새 칸을 더하는 작업은 여기서 번호를 올려 가며 합니다.
# 1: 배달앱 판매가(menus.delivery_price), 사진으로 추정한 재료 표시와 범위(menu_items.estimated/qty_low/qty_high)
# 4: 명세서 줄 저장(invoice_lines) — 새 표라서 SCHEMA의 CREATE TABLE IF NOT EXISTS가 기존 DB에도 그대로 적용됨(ALTER 불필요)
# 5: 도매 마켓(ingredients.mk_item_id/origin/grade, invoices.source, 도매업체·표준품목·수요신호·제안·연결·광고 새 표, 표준 품목 시드)
# 6: PG 결제 연동 기반(ws_ad_payments.pg_order_id) — 웹훅이 결제를 되찾을 때 쓰는 가맹점 주문번호
# 7: 품목 매핑 데이터 구조화 강화 — mk_item_requests는 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로
#    기존 DB에도 바로 적용됨(ALTER 불필요). 번호만 올린다.
# 8: 품목 분류(mk_items.match_mode) 추가 — 간장/고추장/된장은 'brand'(단가제안받기 매칭 제외).
#    식용유/설탕/소금을 세분화된 품목으로 쪼개고(구 레코드는 지우지 않고 active=0만), 밀가루 3종을 새로 시드.
# 9: 식자재 등록란에서 원산지·등급과 함께 부위(ingredients.cut)를 직접 입력할 수 있게 함.
#    mk_grade_terms는 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로 기존 DB에도 바로 적용됨(ALTER 불필요).
#    원산지별 등급 용어 시드(국산 1++/1+/1 vs 미국산 Prime/Choice/Select 등)를 여기서 넣는다.
# 10: 표준 품목 "고르기" 단계를 없애고 식자재 이름으로 자동 매핑(없으면 즉시 mk_items에 새 행 생성).
#    mk_items.source('seed'|'auto')로 자동 생성된 행을 구분. 등급 자동완성용으로 ingredients(category, grade),
#    부위 자동완성용으로 ingredients(category, cut)에 색인을 둔다(전체 사용자 집계 쿼리 성능).
# 11: 분류·등급·부위 자동완성용 용어 표 mk_terms(새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로 적용) + TERMS_SEED 시드.
# 12: 프렙 레시피 — preps/prep_items는 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로 적용됨.
#     ingredients.from_prep_id(이 식자재가 어느 프렙의 결과물인지)만 ALTER로 추가한다.
# 13: 배달앱 주문건 연동 — order_platforms/orders는 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로
#     적용됨(ALTER 불필요). 번호만 올린다.
# 14: 소셜 로그인(oauth_accounts)·비밀번호 찾기(password_resets) — 둘 다 새 표라 SCHEMA의
#     CREATE TABLE IF NOT EXISTS로 적용됨(ALTER 불필요). 번호만 올린다.
# 16: 후원(donations) — 새 표라 SCHEMA의 CREATE TABLE IF NOT EXISTS로 기존 DB에도 바로
#     적용됨(ALTER 불필요). 번호만 올린다. 결제사는 미정이라 지금은 payments.py의
#     MockProvider로만 동작(화면/표만 먼저 완성, 실 결제는 나중에 get_provider()만 교체).
# 17: OCR 인식 로그(ocr_logs) — 새 표라 ALTER 불필요, 번호만 올린다. 사장님이 올린 사진을
#     (줄인 크기로) 서버에 남기기 시작하는 변경이라, ocr.py 맨 위 설명도 같이 고쳤다.
# 18: donations.amount_public — 후원 금액을 순위에 공개할지를 운영자 환경변수가 아니라 후원하는
#     사장님이 후원할 때마다 직접 고르게 바꾸면서 생긴 칸. 기존 행(있다면)은 공개(1)로 채운다.
# 19: 휴대폰 본인인증 — identity_verifications는 새 표(SCHEMA). users에 인증 결과 칸
#     (verified_name/phone/birth, ci_hash, identity_verified_at, identity_required)을 ALTER로 더하고,
#     한 사람 한 계정을 지키려고 ci_hash에 부분 UNIQUE 색인을 건다(기존 계정은 모두 NULL이라 충돌 없음).
# 20: 도매마켓과 원가다이어리 분리 — 원가다이어리 알림 센터에서 '도매' 분류를 없앴다. 남아 있던
#     도매 알림(kind가 ws_로 시작)과 '도매' 분류 켜고 끄기 기록을 지운다. 도매 소식은 도매마켓 화면에서 본다.
# 21: 이메일 인증 — users.email_verified_at, email_codes 표. 기존 계정 중 소셜 로그인으로 들어와
#     제공자가 확인해 준 진짜 이메일이 있는 계정은 확인된 것으로 채운다(이메일 가입 계정은 비워 둔다).
SCHEMA_VERSION = 21


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    # table 이름은 이 파일 안의 고정 문자열만 넘깁니다.
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def migrate(conn: sqlite3.Connection) -> None:
    """예전 버전으로 만든 데이터베이스를 지금 구조로 맞춥니다. 칸만 더하고 기존 데이터는 건드리지 않습니다."""
    if conn.execute("PRAGMA user_version").fetchone()[0] >= SCHEMA_VERSION:
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        # 다른 프로세스가 먼저 끝냈을 수 있어 잠근 뒤에 한 번 더 확인합니다.
        if conn.execute("PRAGMA user_version").fetchone()[0] < 1:
            if "delivery_price" not in _columns(conn, "menus"):
                conn.execute("ALTER TABLE menus ADD COLUMN delivery_price REAL")
            have = _columns(conn, "menu_items")
            if "estimated" not in have:
                conn.execute("ALTER TABLE menu_items ADD COLUMN estimated INTEGER NOT NULL DEFAULT 0")
            if "qty_low" not in have:
                conn.execute("ALTER TABLE menu_items ADD COLUMN qty_low REAL")
            if "qty_high" not in have:
                conn.execute("ALTER TABLE menu_items ADD COLUMN qty_high REAL")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 2:
            if "checked_on" not in _columns(conn, "channels"):
                conn.execute("ALTER TABLE channels ADD COLUMN checked_on TEXT")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 3:
            if "night_hours" not in _columns(conn, "staff"):
                conn.execute("ALTER TABLE staff ADD COLUMN night_hours REAL NOT NULL DEFAULT 0")
            if "labor_5plus" not in _columns(conn, "shop_profile"):
                conn.execute("ALTER TABLE shop_profile ADD COLUMN labor_5plus INTEGER NOT NULL DEFAULT 0")
        # v4: invoice_lines는 새 표라 init_db()가 SCHEMA를 먼저 실행할 때 CREATE TABLE IF NOT EXISTS로
        # 이미 만들어집니다. 여기서는 번호만 올립니다.
        if conn.execute("PRAGMA user_version").fetchone()[0] < 5:
            have = _columns(conn, "ingredients")
            if "mk_item_id" not in have:
                conn.execute("ALTER TABLE ingredients ADD COLUMN mk_item_id INTEGER REFERENCES mk_items(id)")
            if "origin" not in have:
                conn.execute("ALTER TABLE ingredients ADD COLUMN origin TEXT")
            if "grade" not in have:
                conn.execute("ALTER TABLE ingredients ADD COLUMN grade TEXT")
            if "source" not in _columns(conn, "invoices"):
                conn.execute("ALTER TABLE invoices ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
            # 새 칸(mk_item_id)에 거는 색인은 SCHEMA가 아니라 여기서 만듭니다: init_db()는 SCHEMA를 먼저
            # 실행하는데, 기존 DB에서는 그 시점에 이 컬럼이 아직 없어 SCHEMA 안에 두면 기동이 실패합니다.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ing_mkitem ON ingredients(mk_item_id)")
            # 예시(데모) 명세서는 이미 들어와 있을 수 있으니 표시해 둡니다(수요 신호 계산에서 제외).
            conn.execute("UPDATE invoices SET source = 'demo' WHERE supplier LIKE '%(예시)%' AND source = 'manual'")
            # 표준 품목 시드(이미 있으면 건너뜀)
            for name, category, kind in market_catalog.SEED_ITEMS:
                conn.execute(
                    "INSERT OR IGNORE INTO mk_items(name, norm_name, category, unit_kind) VALUES (?,?,?,?)",
                    (name, market_catalog.norm(name), category, kind),
                )
        if conn.execute("PRAGMA user_version").fetchone()[0] < 6:
            if "pg_order_id" not in _columns(conn, "ws_ad_payments"):
                conn.execute("ALTER TABLE ws_ad_payments ADD COLUMN pg_order_id TEXT")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_adpay_pgorder ON ws_ad_payments(pg_order_id) WHERE pg_order_id IS NOT NULL")
        # v7: mk_item_requests는 새 표라 SCHEMA가 이미 만들어 뒀다. 여기서는 번호만 올린다.
        if conn.execute("PRAGMA user_version").fetchone()[0] < 8:
            if "match_mode" not in _columns(conn, "mk_items"):
                conn.execute("ALTER TABLE mk_items ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'commodity'")
            # 브랜드/맛 민감 품목: 단가제안받기 매칭에서 제외(매핑 자체는 계속 받을 수 있음)
            for name in market_catalog.BRAND_SENSITIVE_NAMES:
                conn.execute(
                    "UPDATE mk_items SET match_mode = 'brand' WHERE norm_name = ?",
                    (market_catalog.norm(name),),
                )
            # 식용유/설탕/소금 -> 세분화. 기존 매핑이 깨지지 않도록 구 레코드는 지우지 않고 비활성화만 한다.
            for old_name in market_catalog.RETIRED_COMMODITY_NAMES:
                conn.execute(
                    "UPDATE mk_items SET active = 0 WHERE norm_name = ?",
                    (market_catalog.norm(old_name),),
                )
            for name, category, kind in market_catalog.SPLIT_SEED_ITEMS_V8:
                conn.execute(
                    "INSERT OR IGNORE INTO mk_items(name, norm_name, category, unit_kind, match_mode) VALUES (?,?,?,?,'commodity')",
                    (name, market_catalog.norm(name), category, kind),
                )
        if conn.execute("PRAGMA user_version").fetchone()[0] < 9:
            if "cut" not in _columns(conn, "ingredients"):
                conn.execute("ALTER TABLE ingredients ADD COLUMN cut TEXT")
            # mk_grade_terms는 SCHEMA가 이미 만들어 뒀다(새 표). 여기서는 시드만 넣는다(이미 있으면 건너뜀).
            for category, origin, code, label in market_catalog.GRADE_TERMS_SEED:
                conn.execute(
                    "INSERT OR IGNORE INTO mk_grade_terms(category, origin, code, label, norm_label) VALUES (?,?,?,?,?)",
                    (category, origin, code, label, market_catalog.norm(label)),
                )
        if conn.execute("PRAGMA user_version").fetchone()[0] < 10:
            if "source" not in _columns(conn, "mk_items"):
                conn.execute("ALTER TABLE mk_items ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ing_cat_grade ON ingredients(category, grade)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ing_cat_cut ON ingredients(category, cut)")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 11:
            conn.executemany("INSERT OR IGNORE INTO mk_terms(kind, category, term) VALUES (?,?,?)", market_catalog.TERMS_SEED)
        if conn.execute("PRAGMA user_version").fetchone()[0] < 12:
            if "from_prep_id" not in _columns(conn, "ingredients"):
                conn.execute("ALTER TABLE ingredients ADD COLUMN from_prep_id INTEGER REFERENCES preps(id) ON DELETE CASCADE")
        # v13: order_platforms/orders는 SCHEMA가 이미 만들어 뒀다(새 표). 추가 ALTER 없음.
        if conn.execute("PRAGMA user_version").fetchone()[0] < 15:
            # [2026-11-18] 정육 원산지 세분화(한우/육우 + 수입국 확대). 새로 추가된 등급 용어만
            # 들어가고 기존 행은 그대로 둔다(INSERT OR IGNORE).
            for category, origin, code, label in market_catalog.GRADE_TERMS_SEED:
                conn.execute(
                    "INSERT OR IGNORE INTO mk_grade_terms(category, origin, code, label, norm_label) VALUES (?,?,?,?,?)",
                    (category, origin, code, label, market_catalog.norm(label)),
                )
        if conn.execute("PRAGMA user_version").fetchone()[0] < 18:
            if "amount_public" not in _columns(conn, "donations"):
                conn.execute("ALTER TABLE donations ADD COLUMN amount_public INTEGER NOT NULL DEFAULT 1")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 19:
            have = _columns(conn, "users")
            for col, ddl in (
                ("verified_name", "TEXT"), ("verified_phone", "TEXT"), ("verified_birth", "TEXT"), ("ci_hash", "TEXT"),
                ("identity_verified_at", "TEXT"), ("identity_required", "INTEGER NOT NULL DEFAULT 0"),
            ):
                if col not in have:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ci ON users(ci_hash) WHERE ci_hash IS NOT NULL")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 20:
            conn.execute("DELETE FROM notifications WHERE substr(kind, 1, 3) = 'ws_'")
            conn.execute("DELETE FROM notification_prefs WHERE category = 'market'")
        if conn.execute("PRAGMA user_version").fetchone()[0] < 21:
            if "email_verified_at" not in _columns(conn, "users"):
                conn.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT")
            conn.execute(
                "UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL "
                "AND email NOT LIKE '%@oauth.wongaenote.local' "
                "AND id IN (SELECT user_id FROM oauth_accounts)"
            )
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def init_db() -> None:
    conn = connect()
    try:
        try:
            conn.execute("PRAGMA journal_mode = WAL")
        except sqlite3.OperationalError:
            pass  # 네트워크 드라이브처럼 WAL을 못 쓰는 곳에서는 기본 방식으로 동작합니다.
        conn.executescript(SCHEMA)
        migrate(conn)
    finally:
        conn.close()


def get_db():
    """FastAPI 의존성: 요청 하나당 연결 하나."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection):
    """여러 문장을 한 덩어리로 저장합니다. 예외가 나면 전부 되돌립니다."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
