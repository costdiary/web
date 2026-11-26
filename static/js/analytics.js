/* 구글 애널리틱스(GA4)와 쿠키 동의.

   - 서버에 GA4_MEASUREMENT_ID가 있어야 켜진다(/api/public의 ga4_id). 없으면 아무 일도 하지 않는다.
   - 사장님이 쿠키 동의 창에서 "통계"를 허용하기 전에는 구글 스크립트를 아예 불러오지 않는다(요청 0건).
     허용하면 그때 불러와서, 이후 화면 이동과 아래 행동(가입·메뉴 등록 등)을 보낸다.
   - 광고 쿠키는 ADS_ENABLED가 켜졌을 때만 동의 창에 항목이 생긴다(광고를 아직 안 붙였으므로 기본은 숨김).
   - 이메일·가게 이름·금액 같은 개인정보나 입력값은 보내지 않는다. 보내는 건 "무슨 행동을 했는지"뿐.
   - 선택은 이 브라우저(localStorage)에만 저장한다. 바닥글·설정의 "쿠키 설정"으로 언제든 바꿀 수 있다. */
import { h, app, bus, openDialog } from './core.js';

const KEY = 'cd-consent-v1';
let gaId = '';
let loaded = false;
let lastPage = '';

function readChoice() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function saveChoice(c) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...c, at: new Date().toISOString() })); } catch { /* 저장 못 하면 다음에 다시 물어본다 */ }
}

const adsOffered = () => !!app.pub?.ads_enabled;

function gtag() { window.dataLayer.push(arguments); } // eslint-disable-line prefer-rest-params

function applyConsent(c) {
  if (!gaId) return;
  const analytics = !!c?.analytics;
  const ads = adsOffered() && !!c?.ads;
  if (!loaded && !analytics && !ads) return; // 허용 전에는 구글 스크립트를 불러오지 않는다
  window.dataLayer = window.dataLayer || [];
  if (!loaded) {
    gtag('consent', 'default', {
      analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
  }
  gtag('consent', 'update', {
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: ads ? 'granted' : 'denied',
    ad_user_data: ads ? 'granted' : 'denied',
    ad_personalization: ads ? 'granted' : 'denied',
  });
  if (!loaded) {
    loaded = true;
    gtag('js', new Date());
    // 화면 이동은 직접 보낸다(앱이 주소의 # 뒤만 바꾸므로 자동 집계로는 안 잡힌다).
    gtag('config', gaId, { send_page_view: false });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.append(s);
    if (lastPage) sendPage(lastPage, document.title);
  }
}

const allowed = () => loaded && !!readChoice()?.analytics;

function sendPage(path, title) {
  gtag('event', 'page_view', { page_location: location.origin + path, page_path: path, page_title: title });
}

/* 화면 하나를 봤다. '#/menus/12' → '/app/menus/:id' 처럼 번호는 지워서 화면 단위로 모은다. */
export function page(hashOrPath, title = document.title) {
  let path = hashOrPath || '/';
  if (path.startsWith('#')) {
    path = '/app' + (path.slice(1).split('?')[0] || '/').replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/$/, '');
    if (path === '/app') path = '/app/home';
  }
  if (path === lastPage) return;
  lastPage = path;
  if (allowed()) sendPage(path, title);
}

/* 행동 하나. 이름은 GA4 권장 이름(sign_up, login)과 우리 이름(menu_create 등)을 쓴다. */
export function track(name, params = {}) {
  if (allowed()) gtag('event', name, params);
}

/* 서버에 저장이 끝난 요청만 행동으로 센다(core.js api()가 성공하면 'api-ok'를 알려 준다).
   [방식, 주소(정규식), 행동 이름, 붙일 값] */
const API_EVENTS = [
  ['POST', /^\/api\/auth\/signup$/, 'sign_up', { method: 'email' }],
  ['POST', /^\/api\/auth\/login$/, 'login', { method: 'email' }],
  ['POST', /^\/api\/ingredients$/, 'ingredient_create'],
  ['POST', /^\/api\/menus$/, 'menu_create'],
  ['POST', /^\/api\/menus\/\d+\/duplicate$/, 'menu_duplicate'],
  ['POST', /^\/api\/invoices\/parse$/, 'invoice_scan'],
  ['POST', /^\/api\/invoices\/confirm$/, 'invoice_confirm'],
  ['POST', /^\/api\/recipe\/estimate$/, 'recipe_photo'],
  ['POST', /^\/api\/recipe\/confirm$/, 'recipe_confirm'],
  ['POST', /^\/api\/preps$/, 'prep_create'],
  ['POST', /^\/api\/import\/commit$/, 'import_commit'],
  ['POST', /^\/api\/sales\/import$/, 'sales_import'],
  ['POST', /^\/api\/demo\/seed$/, 'demo_seed'],
  ['POST', /^\/api\/donations\/confirm$/, 'donation'],
];

bus.addEventListener('api-ok', (e) => {
  const { method, path } = e.detail;
  const p = path.split('?')[0];
  const hit = API_EVENTS.find(([m, re]) => m === method && re.test(p));
  if (hit) track(hit[2], hit[3] || {});
});

/* 소셜 로그인은 서버가 첫 화면으로 돌려보내면서 ?joined=kakao 또는 ?login=kakao 를 붙인다. */
function consumeSocialReturn() {
  const q = new URLSearchParams(location.search);
  const joined = q.get('joined');
  const login = q.get('login');
  if (!joined && !login) return;
  q.delete('joined');
  q.delete('login');
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (joined) track('sign_up', { method: joined });
  else track('login', { method: login });
}

/* ---------------------------------------------------------------- 동의 창 */

let bar = null;

function closeBar() { if (bar) { bar.remove(); bar = null; } }

function decide(c) {
  saveChoice(c);
  closeBar();
  applyConsent(c);
  bus.dispatchEvent(new Event('consent-changed'));
}

function showBar() {
  if (bar) return;
  const ads = adsOffered();
  bar = h('section', { class: 'consent-bar', role: 'region', 'aria-label': '쿠키 사용 안내' },
    h('p', null,
      ads
        ? '원가다이어리는 방문 통계와 광고를 위해 쿠키를 써요. 허용해 주시면 더 쓰기 좋은 서비스를 만드는 데 큰 도움이 돼요. '
        : '원가다이어리는 어떤 화면이 쓸모 있는지 알아보려고 구글 애널리틱스 쿠키로 방문 통계를 모아요. 이메일이나 입력한 숫자는 보내지 않아요. ',
      h('button', { class: 'link-btn small', type: 'button', onclick: () => import('./legal.js').then((m) => m.openDataNotice()) }, '자세히')),
    h('div', { class: 'consent-btns' },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openCookieSettings() }, '고르기'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => decide({ analytics: false, ads: false }) }, '필요한 것만'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => decide({ analytics: true, ads: ads }) }, '모두 허용')));
  document.body.append(bar);
}

/* 바닥글·설정의 "쿠키 설정". GA4가 꺼져 있어도 열 수 있다(지금 무엇을 쓰는지 알려 주는 창). */
export function openCookieSettings() {
  const cur = readChoice() || { analytics: false, ads: false };
  const row = (title, text, input) => h('label', { class: 'consent-row' },
    h('div', null, h('b', null, title), h('p', { class: 'xs muted' }, text)), input);
  const on = (v, disabled = false) => h('input', { type: 'checkbox', class: 'switch', checked: v, disabled });
  const a = on(!!cur.analytics, !gaId);
  const ad = on(!!cur.ads);
  const dlg = openDialog({
    title: '쿠키 설정',
    content: h('div', { class: 'stack' },
      row('꼭 필요한 쿠키', '로그인 유지와 보안에 쓰여요. 끌 수 없어요.', on(true, true)),
      row('방문 통계 (구글 애널리틱스)',
        gaId ? '어떤 화면을 많이 보는지, 가입·메뉴 등록까지 몇 명이 오는지 알아봐요. 이메일·가게 이름·입력한 숫자는 보내지 않아요.'
          : '지금은 쓰지 않아요.', a),
      adsOffered() ? row('광고', '관심사에 맞는 광고를 보여 주는 데 쓰여요. 꺼도 광고는 보일 수 있지만 맞춤 광고가 아니에요.', ad) : null,
      h('p', { class: 'xs muted' }, '언제든 이 창에서 바꿀 수 있어요. 브라우저 설정에서 쿠키를 지워도 처음 상태로 돌아가요.'),
      h('div', { class: 'consent-btns' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { decide({ analytics: a.checked && !!gaId, ads: adsOffered() && ad.checked }); dlg.close(); } }, '저장'))),
  });
  return dlg;
}

/* boot()에서 /api/public을 받은 뒤 한 번 부른다. */
export function initAnalytics(pub, { banner = true } = {}) {
  gaId = /^G-[A-Z0-9]{4,16}$/.test(pub?.ga4_id || '') ? pub.ga4_id : '';
  if (!gaId && !adsOffered()) return;
  const c = readChoice();
  if (c) applyConsent(c);
  else if (banner) showBar();
  consumeSocialReturn();
}
