/* 여러 화면에서 쓰는 표시 부품: 도장, 가격 변동 표시, 마진 막대 */
import { h, api, n0, n1, nT, attachSuggest, searchRank } from './core.js';

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
export function marginBar({ ratio, target, up = 0, big = false, labels = false, animate = false }) {
  const wrap = h('div', { class: `mbar-wrap${big ? ' has-t' : ''}` });
  if (ratio == null) {
    wrap.append(h('div', { class: 'mbar' }));
    return wrap;
  }
  const cost = Math.max(0, Math.min(100, ratio));
  const base = Math.min(cost, target);
  const over = Math.max(0, cost - target);
  const hatch = Math.min(up, cost);
  // animate 옵션: 0에서 최종값으로 카운팅
  const startBase = animate ? 0 : base;
  const startOver = animate ? 0 : over;
  const baseEl = h('i', { class: 'mbar-base', style: { width: `${startBase}%` } });
  const overEl = over > 0 ? h('i', { class: 'mbar-over', style: { left: `${base}%`, width: `${startOver}%` } }) : null;
  const hatchEl = hatch > 0 ? h('i', { class: 'mbar-up', style: { left: `${cost - hatch}%`, width: `${hatch}%` } }) : null;
  const bar = h('div', { class: `mbar${big ? ' big' : ''}`, role: 'img', 'aria-label': `원가율 ${n1(ratio)}%, 목표 ${nT(target)}%` },
    baseEl, overEl, hatchEl,
    h('i', { class: 'mbar-tick', style: { left: `${target}%` } }));
  if (animate) {
    // 렌더 후 다음 프레임에 애니메이션 시작
    requestAnimationFrame(() => {
      const duration = 700;
      const startTime = performance.now();
      function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        baseEl.style.width = `${base * ease}%`;
        if (overEl) overEl.style.width = `${over * ease}%`;
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  if (big) wrap.append(h('span', { class: 'mbar-t', style: { left: `${target}%` } }, `목표 ${nT(target)}%`));
  wrap.append(bar);
  if (labels) {
    wrap.append(h('div', { class: 'mbar-l' },
      h('span', null, '재료비 ', h('b', { class: 'n' }, n1(ratio)), '%'),
      h('span', null, '남는 돈 ', h('b', { class: 'n' }, n1(100 - ratio)), '%')));
  }
  return wrap;
}

/* 새로 추가한 식자재·프렙(서버가 is_new로 알려 줌, 3일 동안) 이름 옆에 붙는 NEW 표시 */
export function newTag(it) {
  return it.is_new ? h('span', { class: 'tag new', title: '최근 3일 안에 추가했습니다' }, 'NEW') : null;
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

/* 분류·등급·부위 자동완성 입력. 빈칸으로 누르면 지금 분류에 맞는 후보 몇 개만 보여 주고,
   글자를 치면 DB에서 맞는 후보만 찾아 보여 준다(초성 검색 됨). 목록에 없는 값을 직접 입력해도 그대로 둔다.
   field()에 넘기면 라벨은 .control(입력칸)에 연결된다.
   category: 지금 분류 값을 돌려주는 함수(빈칸일 때는 그 분류 후보만, 검색할 때는 그 분류를 먼저). */
export function termInput({ kind, category = () => '', value = '', maxLength, placeholder }) {
  const input = h('input', { class: 'input', type: 'text', maxLength, placeholder, value });
  return attachSuggest(input, {
    delay: 150,
    source: async (q) => (await api(`/api/market/terms?kind=${kind}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(category())}`)).terms,
  });
}

/* 내 식자재 이름처럼 이미 받아 둔 목록에서 찾는 자유 입력 후보(예전 <datalist> 대신). */
export const localSuggest = (input, names) => attachSuggest(input, { source: (q) => searchRank(names, q).slice(0, 40) });
