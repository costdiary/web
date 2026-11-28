/* 공용 도구: 화면 요소 만들기, 서버 호출, 숫자 서식, 대화상자, 알림 */

export const bus = new EventTarget();
export const app = { me: null, pub: null };

/* 버전 플래그: 서버의 MARKET_ENABLED 환경변수(/api/public의 market_enabled)를 따른다. 기본은
   꺼짐(버전1) — 도매마켓·단가제안받기를 화면에서 숨긴다(기능은 그대로 두고 노출만 끈다. 실제
   사장님 반응을 먼저 보고, 서버 환경변수만 켜면 재배포 없이 버전2가 그대로 켜진다).
   내보낸 변수를 가져다 쓰는 쪽은 ES 모듈의 라이브 바인딩이라 setMarketEnabled() 이후 값이 바뀐다. */
export let MARKET_ENABLED = false;
export function setMarketEnabled(v) { MARKET_ENABLED = !!v; }

/* 같은 방식의 버전 플래그: 배달앱 주문건 연동(실제 파트너 API 키가 아직 없어 기본은 꺼짐). */
export let ORDERS_ENABLED = false;
export function setOrdersEnabled(v) { ORDERS_ENABLED = !!v; }

/* 같은 방식의 버전 플래그: 후원(도네이션). 기본은 켜짐 — 숨기고 싶을 때만 서버
   환경변수(DONATION_ENABLED=0)로 끈다. 후원 금액을 순위에 공개할지는 운영자가 미리 정하는 게
   아니라, 후원하는 사장님이 후원할 때마다 직접 고른다(donate.js). */
export let DONATE_ENABLED = true;
export function setDonateEnabled(v) { DONATE_ENABLED = !!v; }

/* ---------- 요소 만들기 (사용자 입력은 항상 글자로만 넣습니다) ---------- */

function put(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'for') el.htmlFor = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && !k.includes('-') && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  put(el, kids);
  return el;
}

/* 안의 내용을 통째로 바꿉니다. replaceChildren과 달리 null·false는 건너뛰고 배열도 펼칩니다. */
export function fill(el, ...kids) {
  el.replaceChildren();
  put(el, kids);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

const SVG = 'http://www.w3.org/2000/svg';
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12m0 0 8.5-4.5M12 12v9',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15V4h10',
  download: 'M12 4v11m-5-4 5 5 5-5M5 20h14',
  upload: 'M12 16V5m-5 4 5-5 5 5M5 20h14',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 3-3L20 16M9 9.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  trend: 'M4 17l5-5.5 4 4L20 7M15 7h5v5',
  chat: 'M4 5h16v11H10l-5 4v-4H4zM8 9h8M8 12h5',
  bell: 'M6 9a6 6 0 1 1 12 0v4.5l1.5 3h-15l1.5-3zM10 19.5a2 2 0 0 0 4 0',
  market: 'M3 9l1.5-5h15L21 9M4 9h16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM6 13v7h12v-7M9 13v7',
  tag: 'M20.5 12 13 4.5a2 2 0 0 0-2.8 0L4.5 10.2a2 2 0 0 0 0 2.8L12 20.5a2 2 0 0 0 2.8 0L20.5 14.8a2 2 0 0 0 0-2.8zM9 9h.01',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14a6.5 6.5 0 0 1 3 6',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h3',
  chevron: 'M9 5l7 7-7 7',
  cook: 'M6 13.5h12v5.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM4 13.5h16M8.5 10.5C7 9.5 7 7.5 8.5 6.5M12 10.5c-1.5-1-1.5-3 0-4M15.5 10.5c-1.5-1-1.5-3 0-4',
  book: 'M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14',
  graph: 'M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.5 5.5c5 0 4 6.5 9 6.5M7.5 18.5c5 0 4-6.5 9-6.5',
  spark: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8.5l1.2 2.3 2.3 1.2-2.3 1.2L12 15.5l-1.2-2.3L8.5 12l2.3-1.2zM6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18',
  heart: 'M12 20.3s-7.3-4.4-9.4-8.8A5 5 0 0 1 12 6a5 5 0 0 1 9.4 5.5c-2.1 4.4-9.4 8.8-9.4 8.8z',
};

export function icon(name, size = 22) {
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

/* ---------- 서버 호출 ---------- */

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export async function api(path, { method = 'GET', body, form, key } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') opt.headers['X-Requested-With'] = 'fetch';
  if (key) opt.headers['Idempotency-Key'] = key; // 같은 키의 요청은 서버가 한 번만 처리합니다.
  if (form) opt.body = form;
  else if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opt);
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try { data = await res.json(); } catch { /* 본문이 비어 있음 */ }
  }
  if (!res.ok) {
    const detail = (data && typeof data.detail === 'string' && data.detail) || `요청을 처리하지 못했습니다(${res.status}).`;
    if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/ws/auth/')) bus.dispatchEvent(new Event('auth-lost'));
    throw new ApiError(res.status, detail);
  }
  // 저장이 끝난 요청을 알려 준다(analytics.js가 가입·메뉴 등록 같은 행동을 세는 데 씀). 본문은 넘기지 않는다.
  if (method !== 'GET') bus.dispatchEvent(new CustomEvent('api-ok', { detail: { method, path } }));
  return data;
}

export async function refreshMe() {
  app.me = await api('/api/me');
  bus.dispatchEvent(new Event('me-changed'));
  return app.me;
}

/* 지금 보고 있는 화면을 서버에서 다시 불러옵니다. */
export const refreshRoute = () => bus.dispatchEvent(new Event('refresh-route'));

/* ---------- 숫자·날짜 ---------- */

const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
export const n0 = (v) => (v == null || Number.isNaN(v) ? '–' : nf0.format(Math.round(v)));
export const n3 = (v) => (v == null || Number.isNaN(v) ? '–' : nf3.format(v));
export const n1 = (v) => (v == null || Number.isNaN(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1));
/* 목표값처럼 35 → '35', 32.5 → '32.5' */
export const nT = (v) => (v == null || Number.isNaN(v) ? '–' : Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));
/* 단가 표시: 100원 미만(개당 가격 등)은 소수 첫째 자리까지 */
export const nPrice = (v) => (v == null || Number.isNaN(v) ? '–' : v >= 100 ? nf0.format(Math.round(v)) : String(Math.round(v * 10) / 10));
export const parseNum = (s) => {
  const t = String(s ?? '').replace(/[,\s원%]/g, '');
  return t === '' ? NaN : Number(t);
};
export const roundUp100 = (x) => Math.ceil(x / 100 - 1e-9) * 100;

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
export function ago(iso) {
  const d = daysSince(iso);
  if (d == null) return '';
  if (d <= 0) return '오늘';
  if (d < 31) return `${d}일 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}
export const ymd = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '.') : '');

/* ---------- 단위 (서버 units.py와 같은 규칙) ---------- */

export const UNIT = { g: { kind: 'g', f: 1 }, kg: { kind: 'g', f: 1000 }, ml: { kind: 'ml', f: 1 }, L: { kind: 'ml', f: 1000 }, 개: { kind: 'ea', f: 1 } };
export const UI_UNITS = { g: ['g', 'kg'], ml: ['ml', 'L'], ea: ['개'] };
export const ALL_UNITS = ['kg', 'g', 'L', 'ml', '개'];
export const DISPLAY = { g: ['kg', 1000], ml: ['L', 1000], ea: ['개', 1] };
export const KIND_HINT = { g: 'g/kg', ml: 'ml/L', ea: '개' };

/* ---------- 양식 도우미 ---------- */

let uid = 0;
export function field(label, input, hint) {
  const id = `f${++uid}`;
  (input.control || input).id = id; // termInput처럼 입력칸을 감싼 요소는 control이 라벨 대상
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
}

export function numInput(props = {}) {
  const el = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input num', ...props });
  el.addEventListener('blur', () => {
    const v = parseNum(el.value);
    if (Number.isFinite(v)) el.value = nf3.format(v);
  });
  return el;
}

/* 여러 버튼 중 하나만 고르는 가로 칩 그룹(세그먼트 컨트롤). 접근성(role=group + aria-pressed)과
   "선택됨" 스타일(.btn.sm 채움 / .btn.sm.ghost 테두리)을 한 곳에서 관리해, 화면마다 다르게
   구현되는 걸 막습니다(area.js의 반경 선택이 원래 쓰던 바로 그 패턴입니다. 다만 여기 것은 선택 즉시
   눌린 버튼이 바로 "선택됨"으로 바뀌는 화면 — 서버 저장 결과를 기다려야 하는 화면은 area.js처럼
   직접 구현해 성급하게 하이라이트가 바뀌지 않게 하세요).
   options: [[값, 라벨], ...]. value는 null/undefined 등 옵션에 없는 값이면 "선택 없음" 상태가 됩니다
   (예: 후원 금액 직접 입력 중일 때). 21st.dev의 "Chip Filter" 컴포넌트(role=radiogroup, 단일 선택,
   비제어 상태 보관) 구조를 참고해 바닐라 JS + 기존 .seg 스타일로 옮겼습니다. */
export function segGroup(ariaLabel, options, initial, onChange) {
  let value = initial;
  const btns = options.map(([, label]) => h('button', { class: 'btn sm', type: 'button' }, label));
  const mark = () => btns.forEach((b, i) => {
    const on = options[i][0] === value;
    b.classList.toggle('ghost', !on);
    b.setAttribute('aria-pressed', String(on));
  });
  btns.forEach((b, i) => b.addEventListener('click', () => {
    const v = options[i][0];
    if (v === value) return;
    value = v;
    mark();
    onChange(value, b);
  }));
  mark();
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel }, btns);
  wrap.getValue = () => value;
  wrap.setValue = (v) => { value = v; mark(); }; // onChange 없이 바깥에서(예: 직접 입력란) 하이라이트만 바꿀 때
  return wrap;
}

export function selectOf(options, value, props = {}) {
  const el = h('select', { class: 'select', ...props }, options.map((o) => {
    const [val, text] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: val }, text);
  }));
  if (value != null) el.value = value;
  return el;
}

/* ---------- 검색형 드롭다운 공통 ---------- */

/* 글자 검색: 띄어쓰기·대소문자 무시, 초성만 쳐도 찾는다(예: 'ㄷㅍ' → 대파).
   searchRank(labels, q)는 맞는 것만 남기고 '앞글자가 같은 것'을 먼저 보여 준다. */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const squash = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const choOf = (s) => [...s].map((c) => { const k = c.charCodeAt(0) - 0xac00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c; }).join('');
function hitAt(label, q) {
  const l = squash(label);
  const i = l.indexOf(q);
  if (i >= 0) return i;
  return /^[ㄱ-ㅎ]+$/.test(q) ? choOf(l).indexOf(q) : -1;
}
export function searchRank(items, q, labelOf = (x) => x) {
  const nq = squash(q);
  if (!nq) return items.slice();
  return items.map((it, i) => [it, hitAt(labelOf(it), nq), i]).filter(([, at]) => at >= 0)
    .sort((a, b) => (a[1] === 0 ? 0 : 1) - (b[1] === 0 ? 0 : 1) || a[2] - b[2]).map(([it]) => it);
}

const COMBO_FEW = 8; // 이 개수 이하면 보통 드롭다운처럼 처음부터 다 보여 준다
const COMBO_PREVIEW = 5; // 그보다 많으면 처음엔 이만큼만 보여 주고 검색을 권한다
const COMBO_MAX = 40; // 검색 결과도 너무 많으면 여기까지만

/* 펼침 목록 하나를 그리는 공통 부품(comboSelect·attachSuggest가 같이 씀).
   items: [{ key, label }], note: 목록 아래 회색 안내(없으면 ''). */
function popList(listId, input) {
  const list = h('ul', { class: 'ti-list', id: listId, role: 'listbox', hidden: true });
  let cur = -1;
  let items = [];
  const opts = () => [...list.querySelectorAll('[role="option"]')];
  const mark = (i) => {
    cur = i;
    opts().forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', opts()[i].id); else input.removeAttribute('aria-activedescendant');
    if (i >= 0) opts()[i].scrollIntoView({ block: 'nearest' });
  };
  return {
    list,
    get open() { return !list.hidden; },
    show(next, note, onPick, current) {
      items = next;
      fill(list, items.map((it, i) => h('li', {
        id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', class: it.key === current ? 'on' : null,
        onmousedown: (e) => { e.preventDefault(); onPick(it); },
      }, it.label)), note ? h('li', { class: 'ti-note', role: 'presentation' }, note) : null);
      list.hidden = !items.length && !note;
      input.setAttribute('aria-expanded', String(!list.hidden));
      mark(-1);
    },
    close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); mark(-1); },
    /* 화살표·Enter·Esc. 처리했으면 true */
    key(e, onPick) {
      const n = list.hidden ? 0 : items.length;
      if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); this.close(); return true; } // 대화상자까지 닫히지 않게
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) { e.preventDefault(); mark((cur + 1 + (e.key === 'ArrowDown' ? 1 : n)) % (n + 1) - 1); return true; }
      if (e.key === 'Enter' && cur >= 0 && n) { e.preventDefault(); onPick(items[cur]); return true; }
      return false;
    },
  };
}

/* 검색되는 드롭다운: selectOf처럼 정해진 [코드, 라벨] 목록 중에서만 고르지만, 글자를 치면
   라벨로 걸러 준다(띄어쓰기 무시, 초성 검색 됨). 목록이 짧으면(8개 이하) 누르자마자 다 보여 주고,
   길면 앞의 몇 개와 "글자를 입력해 찾아 보세요" 안내만 보여 준다. 서버를 부르지 않고 받아 둔
   options 안에서만 찾으며, 목록에 없는 값은 고를 수 없다(blur하면 마지막으로 고른 값으로 되돌아감).
   wrap.value로 코드를 읽고 쓰고, 고르면 wrap에서 'change'가 올라온다(select처럼 쓰면 된다).
   wrap.setOptions(opts)로 목록 자체를 바꿀 수 있다. field()에 넘기면 라벨은 wrap.control에 붙는다. */
let comboUid = 0;
export function comboSelect(options, value = '', props = {}) {
  const listId = `cb-${++comboUid}`;
  const { placeholder = '', disabled = false, ...rest } = props;
  const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: placeholder || '검색 또는 선택', disabled,
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, ...rest });
  const pop = popList(listId, input);
  const wrap = h('div', { class: 'ti combo' }, input, pop.list);
  wrap.control = input;
  let opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  let code = '';
  const labelOf = (c) => opts.find(([v]) => v === c)?.[1] ?? '';
  const setCode = (c) => { c = c == null ? '' : String(c); code = opts.some(([v]) => v === c) ? c : ''; input.value = labelOf(code); };
  setCode(value);
  const pick = (it) => { setCode(it.key); pop.close(); wrap.dispatchEvent(new Event('change', { bubbles: true })); };
  const render = (all = false) => {
    // 포커스 직후(all=true)는 지금 골라진 값의 글자로 걸러지면 안 되니 검색어 없이 그린다.
    const q = all ? '' : input.value.trim();
    const hits = searchRank(opts, q, ([, label]) => label);
    const many = !q && opts.length > COMBO_FEW;
    const shown = hits.slice(0, many ? COMBO_PREVIEW : COMBO_MAX);
    const rest = hits.length - shown.length;
    const note = q && !hits.length ? `'${q}'와(과) 맞는 항목이 없어요`
      : rest > 0 ? (q ? `${rest}개 더 있어요. 글자를 더 입력해 좁혀 보세요` : `전체 ${opts.length}개 · 글자를 입력해 찾아 보세요`) : '';
    pop.show(shown.map(([key, label]) => ({ key, label })), note, pick, code);
  };
  input.addEventListener('focus', () => { input.select(); render(true); });
  input.addEventListener('click', () => { if (!pop.open) render(true); });
  input.addEventListener('input', () => render());
  input.addEventListener('change', (e) => e.stopPropagation()); // 타이핑 중 생기는 입력칸 change는 밖으로 안 보냄(고를 때만 wrap에서 올림)
  input.addEventListener('blur', () => { pop.close(); input.value = labelOf(code); }); // 직접 입력은 못 하니 원래 값으로 되돌림
  input.addEventListener('keydown', (e) => {
    if (pop.key(e, pick)) return;
    if (e.key === 'ArrowDown' && !pop.open) { e.preventDefault(); render(true); }
  });
  Object.defineProperty(wrap, 'value', { get: () => code, set: setCode });
  Object.defineProperty(wrap, 'disabled', { get: () => input.disabled, set: (v) => { input.disabled = !!v; } });
  wrap.focus = () => input.focus();
  wrap.setOptions = (next, keepIfPresent = true) => {
    opts = next.map((o) => (Array.isArray(o) ? o : [o, o]));
    setCode(keepIfPresent ? code : '');
    if (pop.open) render(true); // 목록이 펼쳐진 채로 분류가 바뀌면 새 목록으로 다시 그린다
  };
  return wrap;
}

/* 자유 입력칸에 검색 후보를 붙인다(목록에 없는 값도 그대로 입력 가능). 이미 만든 input을 받아
   감싼 div(.ti)를 돌려준다. source(q)는 후보 글자 배열(또는 그 Promise)을 돌려주는 함수.
   빈칸으로 누르면 앞의 preview개만 보여 주고, 글자를 치면 맞는 후보만 보여 준다. */
let sugUid = 0;
export function attachSuggest(input, { source, preview = COMBO_PREVIEW, delay = 0 }) {
  const listId = `sg-${++sugUid}`;
  input.setAttribute('autocomplete', 'off');
  input.removeAttribute('list');
  Object.entries({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId })
    .forEach(([k, v]) => input.setAttribute(k, v));
  const pop = popList(listId, input);
  const wrap = h('div', { class: 'ti' }, input, pop.list);
  wrap.control = input;
  let seq = 0;
  let timer;
  const pick = (it) => {
    input.value = it.label;
    pop.close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  async function load() {
    const my = ++seq; // 늦게 온 옛 응답은 버린다
    const q = input.value.trim();
    let terms;
    try { terms = await source(q); } catch { return; } // 후보를 못 받아도 직접 입력은 그대로 된다
    if (my !== seq || document.activeElement !== input) return;
    const shown = q ? terms.slice(0, COMBO_MAX) : terms.slice(0, preview);
    const note = !q && terms.length > preview ? '글자를 입력하면 맞는 것만 찾아 드려요' : '';
    // 이미 정확히 같은 값 하나만 남았으면 굳이 펼치지 않는다
    if (q && shown.length === 1 && shown[0] === q) { pop.close(); return; }
    pop.show(shown.map((t) => ({ key: t, label: t })), note, pick, q);
  }
  input.addEventListener('focus', load);
  input.addEventListener('input', (e) => {
    if (!e.isTrusted) return; // pick()이 보낸 이벤트는 목록을 다시 열지 않는다
    clearTimeout(timer);
    if (delay) timer = setTimeout(load, delay); else load();
  });
  input.addEventListener('blur', () => { seq++; clearTimeout(timer); pop.close(); });
  input.addEventListener('keydown', (e) => {
    if (pop.key(e, pick)) return;
    if (e.key === 'ArrowDown' && !pop.open) { e.preventDefault(); load(); }
  });
  return wrap;
}

/* ---------- 대화상자·알림 ---------- */

export function openDialog({ title, content, wide = false, onClose }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' wide' : ''}`, 'aria-label': title });
  dlg.append(
    h('div', { class: 'dlg-h' }, h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'dlg-b' }, content),
  );
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.showModal();
  return { el: dlg, close: () => dlg.close() };
}

export function confirmDialog({ title, message, confirmText = '확인', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { class: `btn${danger ? ' danger' : ''}`, type: 'button', onclick: () => { answer = true; d.close(); } }, confirmText);
    const body = h('div', null,
      h('p', { style: 'margin-bottom:16px' }, message),
      h('div', { class: 'btn-row' }, ok, h('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, '취소')));
    const d = openDialog({ title, content: body, onClose: () => resolve(answer) });
  });
}

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3400);
}

export function errMsg(e) {
  return e instanceof ApiError ? e.detail : '알 수 없는 오류가 났습니다. 잠시 후 다시 시도해 주세요.';
}

/* 버튼을 누르는 동안 중복 클릭을 막고, 실패하면 알려 줍니다. */
export async function busy(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) toast(errMsg(e), 'err');
    return undefined;
  } finally {
    btn.disabled = false;
  }
}

export const go = (path) => { location.hash = path; };
