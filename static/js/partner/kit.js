/* 도매마켓(판매자 센터) 공통 도구: 권역 표, 브랜드 로고, 전용 아이콘, 기한 표시, 통계 타일 */
import { h, api, app, bus } from '../core.js';

export const BRAND = '도매마켓';
export const BRAND_SUB = '판매자 센터';
export const LOGO = '/static/icon-market.svg';

export const REGIONS = [
  ['SEOUL_N', '서울 강북권'], ['SEOUL_S', '서울 강남권'], ['INCHEON', '인천·부천권'], ['GG_S', '경기 남부'],
  ['GG_N', '경기 북부'], ['GANGWON', '강원'], ['CHUNGCHEONG', '대전·세종·충청'], ['HONAM', '광주·전라'],
  ['DAEGU_GB', '대구·경북'], ['BUSAN_GN', '부산·울산·경남'], ['JEJU', '제주'],
];
export const REGION_LABEL = Object.fromEntries(REGIONS);

export function brandMark(cls = '', { href = '#/', sub = false } = {}) {
  const kids = [
    h('img', { src: LOGO, alt: '', width: 28, height: 28 }),
    h('span', { class: 'dm-brand-t' }, BRAND, sub ? h('small', null, BRAND_SUB) : null),
  ];
  return href ? h('a', { class: `brand dm-brand ${cls}`.trim(), href }, kids) : h('span', { class: `brand dm-brand ${cls}`.trim() }, kids);
}

/* core.js 의 icon() 에 없는 그림만 여기 둔다(같은 선 굵기·크기 규칙). */
const SVG = 'http://www.w3.org/2000/svg';
const PATHS = {
  card: 'M3.5 6.5h17v11h-17zM3.5 10.5h17M7 14.5h4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8M12 16.6h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  phone: 'M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z',
  eyeoff: 'M4 4l16 16M9.9 5.2A9.6 9.6 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.6M6.4 6.6A13 13 0 0 0 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 4-.9M9.9 9.900a3 3 0 0 0 4.2 4.2',
  shield: 'M12 3l7.5 3v5.500c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.500V6zM9 12l2.2 2.200L15.2 10',
  tag: 'M3.5 12.500V4.500h8l9 9-8 8zM8 9h.01',
  chat: 'M4 5h16v11H9.500L5 20v-4H4z',
  pin: 'M12 21s6.5-5.7 6.5-11a6.5 6.5 0 0 0-13 0c0 5.3 6.5 11 6.5 11zM12 12.500a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};
export function pic(name, size = 22) {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) s.setAttribute(k, v);
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', PATHS[name] || '');
  s.append(p);
  return s;
}

/* ---------- 날짜·기한 ---------- */

const dtf = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });
export const when = (iso) => (iso ? dtf.format(new Date(iso)) : '');
export const day = (iso) => (iso ? df.format(new Date(iso)) : '');

/** 기한까지 남은 시간. { text: '5시간 남음', urgent: true } — 지났으면 '기한 지남'. */
export function left(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { text: '기한 지남', urgent: true, over: true };
  const hours = ms / 3600000;
  if (hours < 1) return { text: `${Math.max(1, Math.round(ms / 60000))}분 남음`, urgent: true };
  if (hours < 48) return { text: `${Math.floor(hours)}시간 남음`, urgent: hours < 24 };
  return { text: `${Math.floor(hours / 24)}일 남음`, urgent: false };
}

/* ---------- 화면 조각 ---------- */

export function statTile({ label, value, unit = '', sub = null, href = null, tone = '' }) {
  const inner = [
    h('span', { class: 'dm-stat-l' }, label),
    h('span', { class: 'dm-stat-v' }, h('span', { class: 'n' }, value), unit ? h('span', { class: 'u' }, unit) : null),
    sub ? h('span', { class: 'dm-stat-s' }, sub) : null,
  ];
  const cls = `dm-stat ${tone}`.trim();
  return href ? h('a', { class: cls, href }, inner) : h('div', { class: cls }, inner);
}

export function pageHead(title, ...right) {
  return h('div', { class: 'page-h' }, h('h1', null, title), right);
}

export function backHead(href, backLabel, title) {
  return h('div', { class: 'page-h dm-back-h' },
    h('a', { class: 'btn ghost sm', href }, backLabel), h('h1', null, title));
}

/** 블라인드 원칙 안내 띠. 문구는 화면마다 다르지만 모양은 하나로 맞춘다. */
export function blindNote(strong, text) {
  return h('div', { class: 'banner info dm-blind', role: 'status' }, pic('eyeoff', 20), h('div', null, h('b', null, strong, ' '), text));
}

/* ---------- 받은 연결 요청 수(메뉴 배지) ---------- */

export function setInbox(pending) {
  if (!app.me) return;
  app.me.inbox = { pending };
  bus.dispatchEvent(new Event('inbox-changed'));
}

export async function refreshInbox() {
  if (!app.me || app.me.status !== 'verified') return;
  try {
    const me = await api('/api/ws/me');
    if (!app.me) return;
    app.me = me;
    bus.dispatchEvent(new Event('inbox-changed'));
  } catch { /* 배지는 부가 정보라 실패해도 화면을 막지 않는다 */ }
}

/* ---------- 카탈로그 표시 이름(원산지·등급 코드 -> 한글) ---------- */

let catalogPromise = null;
/** 표준 품목·원산지·등급 표. 한 번 받아 두고 화면들이 같이 쓴다(로그아웃하면 비운다). */
export function loadCatalog() {
  if (!catalogPromise) catalogPromise = api('/api/ws/catalog').catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}
bus.addEventListener('ws-logged-out', () => { catalogPromise = null; });
bus.addEventListener('auth-lost', () => { catalogPromise = null; });

export function labeler(catalog) {
  const items = new Map(catalog.items.map((i) => [i.id, i]));
  const origins = Object.fromEntries(catalog.origins.map((o) => [o.code, o.label]));
  return {
    items,
    origin: (code) => origins[code] || code,
    grade: (itemId, code) => {
      const cat = items.get(itemId)?.category;
      const hit = (catalog.grades[cat] || []).find((g) => g.code === code);
      return hit ? hit.label : (code === 'NA' ? '등급없음' : code);
    },
  };
}
