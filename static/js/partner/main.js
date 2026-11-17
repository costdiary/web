/* 도매마켓 — 식자재 판매자 센터: 로그인 확인 -> 소개 화면 또는 앱 틀 + 화면 전환 */
import { h, $, api, app, bus, icon, toast, errMsg, ApiError } from '../core.js';
import { skeleton, emptyBlock } from '../ui.js';
import { BRAND, brandMark, pic, refreshInbox } from './kit.js';
import { renderIntro } from './intro.js';
import * as verify from './verify.js';
import * as profile from './profile.js';
import * as home from './home.js';
import * as demands from './demands.js';
import * as bids from './bids.js';
import * as connections from './connections.js';
import * as ads from './ads.js';
import * as billing from './billing.js';
import * as guide from './guide.js';

const root = document.getElementById('app');
let token = 0;

/* 주 메뉴(모바일 하단 6칸 = 데스크톱 왼쪽 레일 위쪽). 인증 전에는 '내 정보'만 열린다. */
const NAV = [
  ['#/home', '홈', () => icon('home', 22)],
  ['#/demands', '수요', () => icon('box', 22)],
  ['#/bids', '내 제안', () => icon('list', 22)],
  ['#/connections', '연결 요청', () => icon('bell', 22)],
  ['#/ads', '떨이 광고', () => pic('tag', 22)],
  ['#/profile', '내 정보', () => icon('sliders', 22)],
];
/* 데스크톱 레일에만 보이는 보조 메뉴(모바일에서는 홈·내 정보 화면의 링크로 들어간다). */
const RAIL_EXTRA = [
  ['#/billing', '결제 내역', () => pic('card', 22), true],
  ['#/guide', '이용 안내', () => pic('help', 22), false],
];

const ROUTES = [
  { re: /^#?\/?$/, tab: '', title: BRAND, gate: false, run: () => { location.replace(app.me.status === 'verified' ? '#/home' : '#/verify'); } },
  { re: /^#\/verify\/?$/, tab: '', title: '사업자 인증', gate: false, run: (box) => verify.render(box) },
  { re: /^#\/profile\/?$/, tab: '#/profile', title: '내 정보', gate: false, run: (box) => profile.render(box) },
  { re: /^#\/guide\/?$/, tab: '#/guide', title: '이용 안내', gate: false, run: (box) => guide.render(box) },
  { re: /^#\/home\/?$/, tab: '#/home', title: '홈', run: (box) => home.render(box) },
  { re: /^#\/demands\/?$/, tab: '#/demands', title: '수요', run: (box) => demands.render(box) },
  { re: /^#\/bids\/?$/, tab: '#/bids', title: '내 제안', run: (box) => bids.render(box) },
  { re: /^#\/connections\/?$/, tab: '#/connections', title: '연결 요청', run: (box) => connections.render(box) },
  { re: /^#\/ads\/?$/, tab: '#/ads', title: '떨이 광고', run: (box) => ads.render(box) },
  { re: /^#\/ads\/new\/?$/, tab: '#/ads', title: '새 광고', run: (box) => ads.renderNew(box) },
  { re: /^#\/ads\/(\d+)\/edit\/?$/, tab: '#/ads', title: '광고 수정', run: (box, m) => ads.renderEdit(box, Number(m[1])) },
  { re: /^#\/ads\/(\d+)\/?$/, tab: '#/ads', title: '광고', run: (box, m) => ads.renderDetail(box, Number(m[1])) },
  { re: /^#\/billing\/?$/, tab: '#/billing', title: '결제 내역', run: (box) => billing.render(box) },
];

const STATUS_TEXT = { pending: '인증 대기', verified: '인증 판매자', rejected: '인증 반려', suspended: '이용 정지' };

function navLink([href, label, ic, needsVerified = true], extra = '') {
  const locked = needsVerified && href !== '#/profile' && app.me.status !== 'verified';
  return h('a', {
    class: `tab ${extra}${locked ? ' tab-disabled' : ''}`.replace(/\s+/g, ' ').trim(),
    href: locked ? '#/verify' : href, 'data-tab': href,
    'aria-disabled': locked ? 'true' : null,
  }, h('span', { class: 'tab-ic' }, ic(), href === '#/connections' ? h('span', { class: 'dm-badge', id: 'inbox-badge', hidden: true }) : null),
  h('span', { class: 'tab-t' }, label));
}

function paintInbox() {
  const badge = $('#inbox-badge');
  if (!badge || !app.me) return;
  const n = app.me.inbox?.pending || 0;
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? '9+' : String(n);
  const tab = badge.closest('.tab');
  if (tab) tab.setAttribute('aria-label', n ? `연결 요청, 응답 대기 ${n}건` : '연결 요청');
}

function renderShell() {
  const ws = app.me;
  const nav = h('nav', { class: 'tabbar dm-nav', 'aria-label': '주 메뉴' },
    brandMark('rail-brand', { sub: true }),
    NAV.map((n) => navLink(n)),
    h('div', { class: 'dm-rail-sep', 'aria-hidden': 'true' }),
    RAIL_EXTRA.map((n) => navLink(n, 'rail-only')),
    h('p', { class: 'dm-rail-foot' }, '현재 거래가·경쟁 제안가는', h('br'), '누구에게도 공개되지 않습니다.'));
  root.replaceChildren(h('div', { class: 'app dm-app' },
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
      brandMark(''), h('span', { class: 'topbar-store', id: 'ws-name' }, ws.biz_name || ws.email),
      ws.ws_verify_mock ? h('span', { class: 'tag warn' }, '시험 모드') : null,
      h('span', { class: `tag${ws.status === 'verified' ? ' ok' : ws.status === 'rejected' ? ' bad' : ''}` }, STATUS_TEXT[ws.status] || ws.status),
      h('a', { class: 'icon-btn dm-help', href: '#/guide', 'aria-label': '이용 안내' }, pic('help', 22)))),
    h('main', { id: 'main', class: 'main', tabindex: '-1' }),
    nav));
  paintInbox();
}

async function route() {
  const main = $('#main');
  if (!main || !app.me) return;
  const hash = location.hash || '#/';
  const r = ROUTES.find((x) => x.re.test(hash)) || ROUTES[0];
  const m = hash.match(r.re) || [];
  if (r.gate !== false && app.me.status !== 'verified') { location.replace('#/verify'); return; }
  const mine = ++token;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  document.title = r.title === BRAND ? BRAND : `${r.title} · ${BRAND}`;
  for (const a of document.querySelectorAll('.tab')) {
    if (a.dataset.tab && a.dataset.tab === r.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  main.replaceChildren(skeleton(2));
  const box = h('div', { class: 'dm-page' });
  try {
    await r.run(box, m);
  } catch (e) {
    if (mine !== token) return;
    if (e instanceof ApiError && e.status === 401) return;
    box.replaceChildren(h('section', { class: 'sheet' }, emptyBlock({
      title: '불러오지 못했습니다', text: errMsg(e),
      actions: [h('button', { class: 'btn', type: 'button', onclick: route }, '다시 시도')],
    })));
  }
  if (mine !== token) return;
  main.replaceChildren(box);
  window.scrollTo(0, 0);
}

async function refreshWsMe() {
  app.me = await api('/api/ws/me');
  bus.dispatchEvent(new Event('me-changed'));
  return app.me;
}

async function boot() {
  let logged = false;
  try { await refreshWsMe(); logged = true; } catch { app.me = null; }
  if (!logged) {
    document.title = `${BRAND} — 식자재 판매자 센터`;
    renderIntro(root, boot);
    return;
  }
  renderShell();
  await route();
}

function leaveApp(message) {
  token += 1;
  app.me = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  document.title = `${BRAND} — 식자재 판매자 센터`;
  renderIntro(root, boot);
  window.scrollTo(0, 0);
  if (message) toast(message, 'err');
}

window.addEventListener('hashchange', () => { if (app.me) route(); });
bus.addEventListener('refresh-route', () => { if (app.me) route(); });
bus.addEventListener('ws-logged-out', () => leaveApp());
bus.addEventListener('auth-lost', () => { if (app.me) leaveApp('로그인이 만료되었습니다. 다시 로그인해 주세요.'); });
bus.addEventListener('inbox-changed', paintInbox);
bus.addEventListener('me-changed', () => {
  const name = $('#ws-name');
  if (name && app.me) name.textContent = app.me.biz_name || app.me.email;
  paintInbox();
});
/* 인증이 방금 끝났으면(메뉴 잠금 해제) 틀을 다시 그린다. */
bus.addEventListener('ws-status-changed', () => {
  if (!app.me) return;
  const keep = [...($('#main')?.childNodes || [])]; // 방금 보여 준 인증 결과 화면은 그대로 둔다
  renderShell();
  $('#main').replaceChildren(...keep);
});
/* 다른 일을 하다 돌아왔을 때 새 연결 요청이 왔는지 한 번 확인한다(주기적 폴링은 하지 않는다). */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshInbox(); });

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 전용 도메인이면 '/', 원가노트와 같은 주소를 쓰면 '/partner' 범위만 맡는다(원가노트의 /sw.js 와 겹치지 않게).
    const scope = location.pathname.startsWith('/partner') ? '/partner' : '/';
    navigator.serviceWorker.register('/sw-market.js', { scope }).catch(() => {});
  });
}
