/* 여러 화면에서 쓰는 표시 부품: 도장, 가격 변동 표시, 마진 막대 */
import { h, fill, api, n0, n1, nT } from './core.js';

export const STATUS_LABEL = { good: '양호', warn: '주의', bad: '위험', unknown: '미정' };

export const stamp = (status, extra = '') => h('span', { class: `stamp ${status} ${extra}`.trim() }, STATUS_LABEL[status] || '');

/* 숫자(Barlow) + 단위(한글) */
export const num = (value, unit, cls = '') =>
  h('span', { class: `nu ${cls}`.trim() }, h('span', { class: 'n' }, value), unit ? h('span', { class: 'u' }, unit) : null);

/* 가격이 오르면 노란 형광펜, 내리면 초록 */
export function chg(pct) {
  if (pct == null || Math.abs(pct) < 0.05) return null;
  const up = pct > 0;
  return h('span', { class: `chg${up ? '' : ' down'}`, title: up ? '이전 단가보다 올랐습니다' : '이전 단가보다 내렸습니다' },
    `${up ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%`);
}

/* 재료비 | 남는 돈. 목표 원가율 눈금, 목표를 넘은 부분은 붉게, 방금 오른 부분은 빗금. */
export function marginBar({ ratio, target, up = 0, big = false, labels = false }) {
  const wrap = h('div', { class: `mbar-wrap${big ? ' has-t' : ''}` });
  if (ratio == null) {
    wrap.append(h('div', { class: 'mbar' }));
    return wrap;
  }
  const cost = Math.max(0, Math.min(100, ratio));
  const base = Math.min(cost, target);
  const over = Math.max(0, cost - target);
  const hatch = Math.min(up, cost);
  const bar = h('div', { class: `mbar${big ? ' big' : ''}`, role: 'img', 'aria-label': `원가율 ${n1(ratio)}%, 목표 ${nT(target)}%` },
    h('i', { class: 'mbar-base', style: { width: `${base}%` } }),
    over > 0 ? h('i', { class: 'mbar-over', style: { left: `${base}%`, width: `${over}%` } }) : null,
    hatch > 0 ? h('i', { class: 'mbar-up', style: { left: `${cost - hatch}%`, width: `${hatch}%` } }) : null,
    h('i', { class: 'mbar-tick', style: { left: `${target}%` } }));
  if (big) wrap.append(h('span', { class: 'mbar-t', style: { left: `${target}%` } }, `목표 ${nT(target)}%`));
  wrap.append(bar);
  if (labels) {
    wrap.append(h('div', { class: 'mbar-l' },
      h('span', null, '재료비 ', h('b', { class: 'n' }, n1(ratio)), '%'),
      h('span', null, '남는 돈 ', h('b', { class: 'n' }, n1(100 - ratio)), '%')));
  }
  return wrap;
}

export function emptyBlock({ title, text, actions = [] }) {
  return h('div', { class: 'empty' }, h('h2', null, title), text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'btn-row' }, actions) : null);
}

export const skeleton = (n = 2) => h('div', null, Array.from({ length: n }, () => h('div', { class: 'skel' })));

/* 부호를 붙인 금액: +1,234 / −1,234 (뺄셈 기호는 진짜 마이너스 기호) */
export const sgn = (v) => (v == null || Number.isNaN(v) ? '–' : v < 0 ? `−${n0(-v)}` : v > 0 ? `+${n0(v)}` : '0');

/* 명세표처럼 '항목 …… 금액' 줄을 맞춰 보여 줍니다. rows: [이름, 금액(글자나 요소), 종류('minus'|'total'|'')] */
export function stmt(rows, label = '계산 내역') {
  return h('dl', { class: 'stmt', 'aria-label': label }, rows.filter(Boolean).map(([k, v, cls = '']) =>
    h('div', { class: `stmt-r ${cls}`.trim() }, h('dt', null, k), h('dd', null, v))));
}

/* 분류·등급·부위 자동완성 입력. 포커스·타이핑마다 DB에서 후보를 받아 아래에 보여 주고,
   목록에 없는 값을 직접 입력해도 그대로 둔다. field()에 넘기면 라벨은 .control(입력칸)에 연결된다.
   category: 지금 분류 값을 돌려주는 함수(등급·부위 후보의 정렬 가산점용). */
let termUid = 0;
export function termInput({ kind, category = () => '', value = '', maxLength, placeholder }) {
  const listId = `term-${++termUid}`;
  const input = h('input', { class: 'input', type: 'text', maxLength, placeholder, value, autocomplete: 'off',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId });
  const list = h('ul', { class: 'ti-list', id: listId, role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'ti' }, input, list);
  wrap.control = input;
  let seq = 0;
  let timer;
  let cur = -1;
  const mark = (i) => {
    cur = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', list.children[i].id); else input.removeAttribute('aria-activedescendant');
  };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); mark(-1); };
  const pick = (t) => { input.value = t; input.dispatchEvent(new Event('input', { bubbles: true })); close(); };
  async function load() {
    const my = ++seq; // 늦게 온 옛 응답은 버린다
    let terms;
    try {
      ({ terms } = await api(`/api/market/terms?kind=${kind}&q=${encodeURIComponent(input.value.trim())}&category=${encodeURIComponent(category())}`));
    } catch { return; } // 후보를 못 받아도 직접 입력은 그대로 된다
    if (my !== seq || document.activeElement !== input) return;
    fill(list, terms.map((t, i) => h('li', { id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false',
      onmousedown: (e) => { e.preventDefault(); pick(t); } }, t)));
    list.hidden = !terms.length;
    input.setAttribute('aria-expanded', String(terms.length > 0));
    mark(-1);
  }
  input.addEventListener('focus', load);
  input.addEventListener('input', (e) => { if (!e.isTrusted) return; /* pick()이 보낸 이벤트는 목록을 다시 열지 않는다 */ clearTimeout(timer); timer = setTimeout(load, 150); });
  input.addEventListener('blur', () => { seq++; clearTimeout(timer); close(); });
  input.addEventListener('keydown', (e) => {
    const n = list.hidden ? 0 : list.children.length;
    if (e.key === 'Escape' && n) { e.stopPropagation(); close(); } // 대화상자까지 닫히지 않게
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) { e.preventDefault(); mark((cur + 1 + (e.key === 'ArrowDown' ? 1 : n)) % (n + 1) - 1); }
    else if (e.key === 'Enter' && cur >= 0) { e.preventDefault(); pick(list.children[cur].textContent); }
  });
  return wrap;
}
