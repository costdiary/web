/* 앱 시작: 로그인 확인 → 소개 화면 또는 앱 틀 + 화면 전환 */
import { h, $, api, app, bus, refreshMe, icon, toast, errMsg, ApiError } from './core.js';
import { skeleton, emptyBlock } from './ui.js';
import { renderLanding } from './landing.js?v=4';
import * as dashboard from './dashboard.js';
import * as ingredients from './ingredients.js';
import * as menus from './menus.js';
import * as invoice from './invoice.js';
import * as settings from './settings.js';
import * as breakeven from './breakeven.js';
import * as salesPage from './sales.js';
import * as areaPage from './area.js';
import * as channels from './channels.js';
import * as recipe from './recipe.js';
import * as importer from './import.js';
import * as laborPage from './labor.js';
import * as revenuePage from './revenue.js';
import * as market from './market.js';
import { openMarketNotice } from './market.js';
import * as preps from './preps.js';
import * as orders from './orders.js';
import * as donate from './donate.js';
import * as admin from './admin.js';
import { MARKET_ENABLED, setMarketEnabled, ORDERS_ENABLED, setOrdersEnabled, DONATE_ENABLED, setDonateEnabled } from './core.js';
import { openResetPassword } from './auth.js';

const root = document.getElementById('app');
let token = 0;

// NAV·ROUTES는 함수로 둔다 — app.pub(서버 설정)이 boot()에서 로딩되기 전에 한 번만 평가되면
// MARKET_ENABLED가 그때의(항상 꺼진) 기본값으로 굳어 버리기 때문에, 쓰는 시점(로그인 이후)마다 다시 계산한다.
function getNav() {
  return [
    ['#/', '홈', 'home', 'tab'],
    ['#/ingredients', '식자재', 'box', 'tab'],
    ['#/invoice', '명세서', 'receipt', 'tab tab-main'],
    ['#/menus', '메뉴', 'list', 'tab'],
    ['#/revenue', '매출관리', 'trend', 'tab'],
    ...(MARKET_ENABLED ? [['#/market', '도매마켓', 'market', 'tab'], ['#/market/offers', '단가제안받기', 'tag', 'tab']] : []),
    ...(DONATE_ENABLED ? [['#/donate', '후원하기', 'heart', 'tab']] : []),
    ['#/settings', '설정', 'sliders', 'tab'],
  ];
}

function getRoutes() {
  return [
    { re: /^#?\/?$/, tab: '#/', title: '홈', run: (box) => dashboard.render(box) },
    { re: /^#\/ingredients\/?$/, tab: '#/ingredients', title: '식자재', run: (box) => ingredients.render(box) },
    { re: /^#\/menus\/?$/, tab: '#/menus', title: '메뉴', run: (box) => menus.renderList(box) },
    { re: /^#\/menus\/photo\/?$/, tab: '#/menus', title: '사진으로 메뉴 만들기', run: (box) => recipe.render(box) },
    { re: /^#\/menus\/new\/?$/, tab: '#/menus', title: '새 메뉴', run: (box) => menus.renderEditor(box, null) },
    { re: /^#\/menus\/(\d+)\/?$/, tab: '#/menus', title: '메뉴 수정', run: (box, m) => menus.renderEditor(box, Number(m[1])) },
    { re: /^#\/preps\/?$/, tab: '#/menus', title: '프렙 레시피', run: (box) => preps.renderList(box) },
    { re: /^#\/preps\/new\/?$/, tab: '#/menus', title: '새 프렙', run: (box) => preps.renderEditor(box, null) },
    { re: /^#\/preps\/(\d+)\/?$/, tab: '#/menus', title: '프렙 수정', run: (box, m) => preps.renderEditor(box, Number(m[1])) },
    { re: /^#\/invoice\/?$/, tab: '#/invoice', title: '거래명세서', run: (box) => invoice.render(box) },
    { re: /^#\/settings\/?$/, tab: '#/settings', title: '설정', run: (box) => settings.render(box) },
    { re: /^#\/import\/?$/, tab: '#/settings', title: '가져오기', run: (box) => importer.render(box) },
    { re: /^#\/revenue\/?$/, tab: '#/revenue', title: '매출관리', run: (box) => revenuePage.render(box) },
    { re: /^#\/breakeven\/?$/, tab: '#/revenue', title: '손익분기·목표 매출', run: (box) => breakeven.render(box) },
    { re: /^#\/labor\/?$/, tab: '#/revenue', title: '직원 급여', run: (box) => laborPage.render(box) },
    { re: /^#\/sales\/?$/, tab: '#/revenue', title: '내 매출', run: (box) => salesPage.render(box) },
    { re: /^#\/area\/?$/, tab: '#/revenue', title: '주변 상권', run: (box) => areaPage.render(box) },
    { re: /^#\/delivery\/?$/, tab: '#/revenue', title: '배달앱 수수료', run: (box) => channels.render(box) },
    ...(ORDERS_ENABLED ? [{ re: /^#\/orders\/?$/, tab: '#/revenue', title: '주문건 연동', run: (box) => orders.render(box) }] : []),
    ...(MARKET_ENABLED ? [
      { re: /^#\/market\/?$/, tab: '#/market', title: '도매마켓', run: (box) => market.render(box) },
      { re: /^#\/market\/offers\/?$/, tab: '#/market/offers', title: '단가제안받기', run: (box) => market.renderOffers(box) },
      { re: /^#\/market\/connections\/?$/, tab: '#/market', title: '연결 요청', run: (box) => market.renderConnections(box) },
    ] : []),
    // 결제위젯이 성공·실패 후 "#/donate?paymentKey=...&orderId=..." 형태로 돌려보내므로 쿼리스트링도 받아 준다.
    ...(DONATE_ENABLED ? [{ re: /^#\/donate(?:\/|\?.*)?$/, tab: '#/donate', title: '후원하기', run: (box) => donate.render(box) }] : []),
    // 사이드바에는 안 보이고, 운영자가 주소를 직접 쳐서 들어가는 화면(권한은 서버가 막음).
    { re: /^#\/admin\/ocr\/?$/, tab: '#/admin/ocr', title: 'OCR 인식 로그', run: (box) => admin.renderOcrLogs(box) },
    { re: /^#\/admin\/ocr\/(\d+)\/?$/, tab: '#/admin/ocr', title: 'OCR 인식 로그', run: (box, m) => admin.renderOcrLog(box, Number(m[1])) },
  ];
}

/* 모든 기능이 무료라 "무료 이용 중" 칩은 모든 사장님에게 항상 같은 말만 하게 된다. 묻지도 않은
   요금 얘기를 화면마다 띄우는 셈이라 없앴다. 나중에 개별 프리미엄 기능을 팔게 되면 그때만 보인다. */
function planChip() {
  const p = app.me.plan;
  if (p.state !== 'paid') return null;
  return h('a', { class: `plan-chip ${p.state}`, href: '#/settings', id: 'plan-chip' }, '이용 중');
}

function marketBell() {
  if (!MARKET_ENABLED) return null;
  const unread = (app.me.market.unread_offers || 0) + (app.me.market.unread_deals || 0);
  return h('a', { class: 'icon-btn market-bell', href: '#/market', id: 'market-bell', 'aria-label': unread ? `도매마켓 (읽지 않은 알림 ${unread}개)` : '도매마켓' },
    icon('bell', 20), unread ? h('span', { class: 'badge' }, unread > 9 ? '9+' : String(unread)) : null);
}

function renderShell() {
  const brand = (cls) => h('a', { class: `brand ${cls}`.trim(), href: '#/' }, h('img', { src: '/static/icon.svg', alt: '', width: 26, height: 26 }), '원가다이어리');
  const nav = h('nav', { class: 'tabbar', 'aria-label': '주 메뉴' },
    brand('rail-brand'),
    getNav().map(([href, label, ic, cls]) => h('a', { class: cls, href, 'data-tab': href },
      h('span', { class: 'tab-ic' }, icon(ic, 22)), h('span', null, label))));
  root.replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
      brand(''), h('span', { class: 'topbar-store', id: 'store-name' }, app.me.store_name || app.me.email), marketBell(), planChip())),
    h('main', { id: 'main', class: 'main', tabindex: '-1' }),
    nav));
}

let noticeShown = false;
function maybeShowMarketNotice() {
  if (!MARKET_ENABLED || noticeShown || !app.me || !app.me.market || !app.me.market.notice_required) return;
  noticeShown = true;
  openMarketNotice({ onDone: () => { refreshMe(); if (location.hash.startsWith('#/market')) route(); } });
}

async function route() {
  const main = $('#main');
  if (!main || !app.me) return;
  const hash = location.hash || '#/';
  const routes = getRoutes();
  const r = routes.find((x) => x.re.test(hash)) || routes[0];
  const m = hash.match(r.re) || [];
  const mine = ++token;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  document.title = `${r.title} · 원가다이어리`;
  for (const a of document.querySelectorAll('.tab')) {
    if (a.dataset.tab === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  main.replaceChildren(skeleton(2));
  const box = h('div');
  try {
    await r.run(box, m);
  } catch (e) {
    if (mine !== token) return;
    if (e instanceof ApiError && e.status === 401) return; // 로그인 만료는 아래 auth-lost 처리기가 맡습니다.
    box.replaceChildren(h('section', { class: 'sheet' }, emptyBlock({
      title: '불러오지 못했습니다', text: errMsg(e),
      actions: [h('button', { class: 'btn', type: 'button', onclick: route }, '다시 시도')],
    })));
  }
  if (mine !== token) return;
  main.replaceChildren(box);
  window.scrollTo(0, 0);
}

/* 비밀번호 재설정 메일 속 링크(/?reset_token=...)와, 소셜 로그인 실패 뒤 돌아오는 주소(/?login_error=1)
   는 둘 다 로그인 여부와 무관하게 한 번만 처리하고 주소창에서 지운다. */
function handleAuthRedirects() {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset_token');
  const loginError = params.get('login_error');
  if (!resetToken && !loginError) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (resetToken) openResetPassword(resetToken);
  else toast('로그인에 실패했습니다. 다시 시도해 주세요.', 'err');
}

async function boot() {
  handleAuthRedirects();
  try { app.pub = await api('/api/public'); } catch { app.pub = {}; }
  setMarketEnabled(app.pub.market_enabled);
  setOrdersEnabled(app.pub.orders_enabled);
  setDonateEnabled(app.pub.donation_enabled);
  app.me = null;
  if (app.pub.logged_in) {
    try { await refreshMe(); } catch { app.me = null; }
  }
  if (!app.me) {
    document.title = '원가다이어리 · 식당 식자재 단가와 메뉴 원가율 관리';
    renderLanding(root, boot);
    return;
  }
  renderShell();
  await route();
  maybeShowMarketNotice();
}

function leaveApp(message) {
  token += 1;
  app.me = null;
  noticeShown = false;
  if (location.hash) history.replaceState(null, '', location.pathname);
  document.title = '원가다이어리 · 식당 식자재 단가와 메뉴 원가율 관리';
  renderLanding(root, boot);
  window.scrollTo(0, 0);
  if (message) toast(message, 'err');
}

window.addEventListener('hashchange', () => { if (app.me) route(); });
bus.addEventListener('refresh-route', () => { if (app.me) route(); });
bus.addEventListener('logged-out', () => leaveApp());
bus.addEventListener('auth-lost', () => { if (app.me) leaveApp('로그인이 만료되었습니다. 다시 로그인해 주세요.'); });
bus.addEventListener('me-changed', () => {
  const chip = $('#plan-chip');
  if (chip && app.me) { const next = planChip(); if (next) chip.replaceWith(next); else chip.remove(); }
  const store = $('#store-name');
  if (store && app.me) store.textContent = app.me.store_name || app.me.email;
  const bell = $('#market-bell');
  if (bell && app.me) bell.replaceWith(marketBell());
});

boot();

if ('serviceWorker' in navigator) {
  // 설치형 앱(홈 화면에 추가)과 오프라인 화면 표시를 위한 등록. 실패해도 앱 사용에는 지장 없음.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
