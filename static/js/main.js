/* 앱 시작: 로그인 확인 → 소개 화면 또는 앱 틀 + 화면 전환 */
import { h, $, api, app, bus, refreshMe, icon, toast, errMsg, ApiError, openDialog } from './core.js';
import { skeleton, emptyBlock } from './ui.js';
import { renderLanding } from './landing.js?v=22';
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
import * as more from './more.js';
import * as notifPage from './notifications.js';
import * as market from './market.js';
import { openMarketNotice } from './market.js';
import * as preps from './preps.js';
import * as orders from './orders.js';
import * as donate from './donate.js';
import * as admin from './admin.js';
import { initAnalytics, page as gaPage } from './analytics.js';
import { MARKET_ENABLED, setMarketEnabled, ORDERS_ENABLED, setOrdersEnabled, DONATE_ENABLED, setDonateEnabled } from './core.js';
import { openResetPassword, openSignup } from './auth.js';
import { consumeIdentityReturn, identityBox } from './identity.js';

const root = document.getElementById('app');
let token = 0;

// NAV·ROUTES는 함수로 둔다 — app.pub(서버 설정)이 boot()에서 로딩되기 전에 한 번만 평가되면
// MARKET_ENABLED가 그때의(항상 꺼진) 기본값으로 굳어 버리기 때문에, 쓰는 시점(로그인 이후)마다 다시 계산한다.
//
// 휴대폰 아래 메뉴는 엄지로 누르기 좋은 5칸으로 고정한다: 매일 쓰는 홈·식자재·명세서·메뉴와 나머지를 모은 '전체'.
// (예전에는 매출관리·도매마켓·후원·설정까지 7~9칸이라 390px 화면에서 '설정'이 밖으로 밀렸다.)
// PC 왼쪽 메뉴는 공간이 넉넉하니 more.js의 분류(원가·매출·손익·도매·더 보기)를 그대로 다 보여 준다.
// 화면(route)마다 tab = 휴대폰 아래 메뉴에서 켜질 칸, nav = PC 왼쪽 메뉴에서 켜질 줄(없으면 tab).
function getTabs() {
  return [
    ['#/', '홈', 'home', 'tab'],
    ['#/ingredients', '식자재', 'box', 'tab'],
    ['#/invoice', '명세서', 'camera', 'tab tab-main'],
    ['#/menus', '메뉴', 'list', 'tab'],
    ['#/more', '전체', 'grid', 'tab'],
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
    { re: /^#\/preps\/?$/, tab: '#/menus', nav: '#/preps', title: '프렙 레시피', run: (box) => preps.renderList(box) },
    { re: /^#\/preps\/new\/?$/, tab: '#/menus', nav: '#/preps', title: '새 프렙', run: (box) => preps.renderEditor(box, null) },
    { re: /^#\/preps\/(\d+)\/?$/, tab: '#/menus', nav: '#/preps', title: '프렙 수정', run: (box, m) => preps.renderEditor(box, Number(m[1])) },
    { re: /^#\/invoice\/?$/, tab: '#/invoice', title: '거래명세서', run: (box) => invoice.render(box) },
    { re: /^#\/settings\/?$/, tab: '#/more', nav: '#/settings', title: '설정', run: (box) => settings.render(box) },
    { re: /^#\/import\/?$/, tab: '#/more', nav: '#/import', title: '가져오기', run: (box) => importer.render(box) },
    { re: /^#\/more\/?$/, tab: '#/more', title: '전체 메뉴', run: (box) => more.render(box) },
    { re: /^#\/revenue\/?$/, tab: '#/more', title: '전체 메뉴', run: (box) => more.render(box) }, // 예전 '매출관리' 주소
    { re: /^#\/notifications\/?$/, tab: '#/more', nav: '#/notifications', title: '알림', run: (box) => notifPage.render(box) },
    { re: /^#\/breakeven\/?$/, tab: '#/more', nav: '#/breakeven', title: '손익분기·목표 매출', run: (box) => breakeven.render(box) },
    { re: /^#\/labor\/?$/, tab: '#/more', nav: '#/labor', title: '직원 급여', run: (box) => laborPage.render(box) },
    { re: /^#\/sales\/?$/, tab: '#/more', nav: '#/sales', title: '내 매출', run: (box) => salesPage.render(box) },
    { re: /^#\/area\/?$/, tab: '#/more', nav: '#/area', title: '주변 상권', run: (box) => areaPage.render(box) },
    { re: /^#\/delivery\/?$/, tab: '#/more', nav: '#/delivery', title: '배달앱 수수료', run: (box) => channels.render(box) },
    ...(ORDERS_ENABLED ? [{ re: /^#\/orders\/?$/, tab: '#/more', nav: '#/orders', title: '주문건 연동', run: (box) => orders.render(box) }] : []),
    ...(MARKET_ENABLED ? [
      { re: /^#\/market\/?$/, tab: '#/more', nav: '#/market', title: '도매마켓', run: (box) => market.render(box) },
      { re: /^#\/market\/offers\/?$/, tab: '#/more', nav: '#/market/offers', title: '단가제안받기', run: (box) => market.renderOffers(box) },
      { re: /^#\/market\/connections\/?$/, tab: '#/more', nav: '#/market/connections', title: '연결 요청', run: (box) => market.renderConnections(box) },
    ] : []),
    // 결제위젯이 성공·실패 후 "#/donate?paymentKey=...&orderId=..." 형태로 돌려보내므로 쿼리스트링도 받아 준다.
    ...(DONATE_ENABLED ? [{ re: /^#\/donate(?:\/|\?.*)?$/, tab: '#/more', nav: '#/donate', title: '후원하기', run: (box) => donate.render(box) }] : []),
    // 사이드바에는 안 보이고, 운영자가 주소를 직접 쳐서 들어가는 화면(권한은 서버가 막음).
    { re: /^#\/admin\/stats\/?$/, tab: '#/admin/stats', title: '운영 현황', run: (box) => admin.renderStats(box) },
    { re: /^#\/admin\/users\/?$/, tab: '#/admin/users', title: '사장님 계정', run: (box) => admin.renderUsers(box) },
    { re: /^#\/admin\/users\/(\d+)\/?$/, tab: '#/admin/users', title: '계정 상세', run: (box, m) => admin.renderUser(box, Number(m[1])) },
    { re: /^#\/admin\/db\/?$/, tab: '#/admin/db', title: 'DB 보기', run: (box) => admin.renderTables(box) },
    { re: /^#\/admin\/db\/([a-z_0-9]+)\/?$/, tab: '#/admin/db', title: 'DB 보기', run: (box, m) => admin.renderTable(box, m[1]) },
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

function renderShell() {
  // 랜딩과 같은 로고(책+그래프와 글씨). 어두운 화면에서는 크림색 글씨 판을 쓴다.
  const brand = (cls) => h('a', { class: `brand ${cls}`.trim(), href: '#/', 'aria-label': '원가다이어리 홈' },
    h('img', { class: 'brand-logo is-light', src: '/static/brand/logo.png', alt: '원가다이어리', width: 122, height: 28 }),
    h('img', { class: 'brand-logo is-dark', src: '/static/brand/logo-dark.png', alt: '', width: 122, height: 28 }));
  // 휴대폰: 아래 5칸
  const tabs = h('nav', { class: 'tabbar', 'aria-label': '주 메뉴' },
    getTabs().map(([href, label, ic, cls]) => h('a', { class: cls, href, 'data-tab': href },
      h('span', { class: 'tab-ic' }, icon(ic, 22)), h('span', null, label))));
  // PC: 왼쪽에 분류별 전체 목록
  const rail = h('nav', { class: 'rail', 'aria-label': '전체 메뉴' },
    brand('rail-brand'),
    h('a', { class: 'rail-item', href: '#/', 'data-nav': '#/' }, icon('home', 20), h('span', null, '홈')),
    more.sections().map((sec) => h('div', { class: 'rail-sec' },
      h('p', { class: 'rail-h' }, sec.title),
      sec.items.map(([href, label, ic]) => h('a', { class: `rail-item${href === '#/invoice' ? ' rail-main' : ''}`, href, 'data-nav': href },
        icon(ic, 20), h('span', null, label))))));
  root.replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
      brand(''), h('span', { class: 'topbar-store', id: 'store-name' }, app.me.store_name || app.me.email), planChip(), notifPage.bellButton())),
    h('main', { id: 'main', class: 'main', tabindex: '-1' }),
    tabs, rail));
  notifPage.startPolling();
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
  gaPage(hash, document.title);
  for (const a of document.querySelectorAll('.tab')) {
    if (a.dataset.tab === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const navKey = r.nav || r.tab;
  for (const a of document.querySelectorAll('.rail-item')) {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
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
  if (!hash.startsWith('#/notifications')) notifPage.refreshCount(); // 화면을 옮길 때 종 숫자도 새로
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

/* 소셜 로그인으로 새로 가입한 계정은 가입 화면의 본인인증을 거치지 않았으므로, 들어오자마자
   인증 창을 띄운다(서버가 me.identity.required로 알려 줌). 닫아도 인증 전까지 다시 뜬다. */
function maybeRequireIdentity() {
  if (!app.me?.identity?.required) return;
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  let done = false;
  const body = h('div', null,
    h('p', { style: 'margin-bottom:12px' }, '처음 한 번만 휴대폰 본인인증을 해 주세요. 인증을 마치면 바로 이어서 쓰실 수 있어요.'),
    err,
    identityBox({
      purpose: 'account',
      onVerified: async () => { done = true; await refreshMe(); toast('본인인증을 마쳤습니다.'); dlg.close(); },
      onError: (m) => { err.textContent = m; err.hidden = false; },
    }),
    h('p', { style: 'margin-top:12px' }, h('button', { class: 'link-btn small', type: 'button', onclick: async () => { done = true; dlg.close(); await api('/api/auth/logout', { method: 'POST' }); bus.dispatchEvent(new Event('logged-out')); } }, '로그아웃')));
  const dlg = openDialog({ title: '본인인증', content: body, onClose: () => { if (!done) setTimeout(maybeRequireIdentity, 0); } });
}

/* 모바일에서 본인인증 창이 페이지를 이동시켰다 돌아온 경우: 가입 중이었으면 가입 창을 인증 완료 상태로
   다시 열고, 로그인한 계정에서 인증한 것이면 결과만 알린다. */
async function finishIdentityReturn(ret) {
  if (!ret) return;
  if (ret.purpose === 'signup' && !app.me) {
    if (ret.error) toast(ret.error, 'err');
    openSignup({ verified: ret.result || null, prefill: ret.context || {}, onDone: boot });
    return;
  }
  if (ret.error) toast(ret.error, 'err');
  else { await refreshMe(); toast('본인인증을 마쳤습니다.'); }
}

async function boot() {
  handleAuthRedirects();
  try { app.pub = await api('/api/public'); } catch { app.pub = {}; }
  const ivReturn = await consumeIdentityReturn();
  setMarketEnabled(app.pub.market_enabled);
  setOrdersEnabled(app.pub.orders_enabled);
  setDonateEnabled(app.pub.donation_enabled);
  initAnalytics(app.pub);
  app.me = null;
  if (app.pub.logged_in) {
    try { await refreshMe(); } catch { app.me = null; }
  }
  if (!app.me) {
    document.title = '원가다이어리 · 식당 식자재 단가와 메뉴 원가율 관리';
    renderLanding(root, boot);
    gaPage('/');
    await finishIdentityReturn(ivReturn);
    return;
  }
  await finishIdentityReturn(ivReturn);
  renderShell();
  await route();
  maybeShowMarketNotice();
  maybeRequireIdentity();
}

function leaveApp(message) {
  token += 1;
  notifPage.stopPolling();
  notifPage.setUnread(0);
  app.me = null;
  noticeShown = false;
  if (location.hash) history.replaceState(null, '', location.pathname);
  document.title = '원가다이어리 · 식당 식자재 단가와 메뉴 원가율 관리';
  renderLanding(root, boot);
  gaPage('/');
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
  if (app.me?.notifications) notifPage.setUnread(app.me.notifications.unread);
});

boot();

if ('serviceWorker' in navigator) {
  // 설치형 앱(홈 화면에 추가)과 오프라인 화면 표시를 위한 등록. 실패해도 앱 사용에는 지장 없음.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
