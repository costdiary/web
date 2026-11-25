/* 로그인 전 소개 화면(새로 짠 버전).
   흐름: 히어로(단가가 오르면 원가율이 바뀌는 장면) → 공감 → 기능 4가지를 직접 만져 보는 데모
   → 시작 순서 → 하는 일·안 하는 일 → 가격 → 자주 묻는 질문 → 마지막 권유.
   데모 숫자는 체험용 예시 가게(app/seed.py)와 같은 값이고, 계산식은 app/costing.py·app/labor.py를 줄여 옮긴 것.
   실제 시세나 실제 정산 금액이 아니므로 화면에도 '예시'라고 적는다. 스타일은 static/landing.css(.lp 아래). */
import { h, api, app, field, busy, errMsg, n0, n1, roundUp100, selectOf, icon } from './core.js';
import { openSignup, openLogin } from './auth.js';
import { openDataNotice, openTerms } from './legal.js';

export { openDataNotice, openTerms };

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TARGET = 35; // 목표 원가율(%)

/* ─── 예시 가게 데이터(app/seed.py와 같은 값) ─── */
/* 제육볶음 1인분. [재료, 양 표시, kg·L당 단가, 수율%, 1인분 양(kg·L)] */
const JEYUK = [
  ['돼지 앞다리살', '220g', null, 100, 0.22],
  ['양파', '60g', 18500 / 15, 90, 0.06],
  ['대파', '20g', 3900, 85, 0.02],
  ['다진 마늘', '10g', 9200, 100, 0.01],
  ['고춧가루', '8g', 24000, 100, 0.008],
  ['간장', '20ml', 6500 / 1.8, 100, 0.02],
  ['식용유', '10ml', 53500 / 18, 100, 0.01],
  ['쌀', '210g', 56000 / 20, 100, 0.21],
];
const OTHER_COST = 400; // 반찬·소스·포장

function jeyukCost(porkPerKg) {
  const rows = JEYUK.map(([name, amt, perK, yld, q]) => {
    const unit = perK == null ? porkPerKg : perK;
    return { name, amt, cost: (q * unit) / (yld / 100) };
  });
  rows.push({ name: '반찬·소스·포장', amt: '', cost: OTHER_COST });
  return { rows, total: rows.reduce((s, r) => s + r.cost, 0) };
}

/* 배달앱 기본 요율(app/channels.py 기본값). 수수료·배달비는 부가세 별도 안내라 10%를 더해 비용으로 본다. */
const APPS = [
  { key: 'store', label: '매장', fee: 0, pay: 0, deliv: 0 },
  { key: 'baemin', label: '배달의민족', fee: 7.8, pay: 3.0, deliv: 3400 },
  { key: 'coupang', label: '쿠팡이츠', fee: 6.8, pay: 3.0, deliv: 2900 },
];

/* 2026년 최저임금과 주휴수당(app/labor.py와 같은 규칙) */
const MIN_WAGE_2026 = 10320;
const WEEKS = 365 / 12 / 7;

/* 데모끼리 나눠 쓰는 값: 메뉴 원가 데모에서 바꾼 값이 배달·손익분기 데모에 그대로 이어진다. */
const state = { pork: 10800, price: 9500, listeners: new Set() };
function setState(patch) { Object.assign(state, patch); state.listeners.forEach((f) => f()); }
function onState(f) { state.listeners.add(f); f(); }

const statusOf = (r) => (r <= TARGET ? 'good' : r <= TARGET + 5 ? 'warn' : 'bad');
const STATUS_LABEL = { good: '양호', warn: '주의', bad: '위험' };
const won = (v) => `${n0(v)}원`;

/* 숫자를 부드럽게 바꾸기. 동작 줄이기 설정이면 바로 바꾼다. */
function tween(el, to, fmt, ms = 650) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (REDUCED() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (t < 1 && el.dataset.v === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function numEl(v, fmt, cls = '') {
  const el = h('span', { class: `lp-num ${cls}`.trim() }, fmt(v));
  el.dataset.v = String(v);
  return el;
}

/* 원가율 막대: 목표선까지는 파랑, 넘는 부분은 상태색 */
function ratioBar() {
  const base = h('i', { class: 'lp-bar-base' });
  const over = h('i', { class: 'lp-bar-over' });
  const el = h('div', { class: 'lp-bar', role: 'img' }, base, over, h('i', { class: 'lp-bar-tick', style: { left: `${TARGET}%` } }));
  el.set = (ratio) => {
    const r = Math.max(0, Math.min(100, ratio));
    base.style.width = `${Math.min(r, TARGET)}%`;
    over.style.left = `${TARGET}%`;
    over.style.width = `${Math.max(0, r - TARGET)}%`;
    el.dataset.s = statusOf(ratio);
    el.setAttribute('aria-label', `원가율 ${n1(ratio)}%, 목표 ${TARGET}%`);
  };
  return el;
}
function badge(ratio) {
  const s = statusOf(ratio);
  return h('span', { class: `lp-stamp is-${s}` }, STATUS_LABEL[s]);
}

/* ─── 히어로: 실제 앱 화면으로 보는 '명세서 등록 → 원가 자동 계산' 과정 ───
   static/landing/step*.webp 는 실제 앱을 예시 가게 데이터로 돌려 휴대폰 크기(390px)로 찍은 화면이다.
   앱 화면이 바뀌면 다시 찍어야 한다: tools/capture_landing_shots.js */
const TOUR = [
  { img: 'step1-upload', t: '명세서 사진 올리기', d: '납품받은 거래명세서를 찍거나 앨범에서 골라요. 영수증은 직접 입력해도 돼요.' },
  { img: 'step2-review', t: '읽은 내용 확인', d: '품목·규격·단가를 읽어 와 지난 단가와 비교해 보여 줘요. 틀린 칸은 바로 고칠 수 있어요.' },
  { img: 'step3-apply', t: '한 번에 반영', d: '반영하면 그 재료가 들어간 메뉴의 원가가 모두 다시 계산돼요.' },
  { img: 'step4-menus', t: '메뉴별 원가율 확인', d: '목표를 넘은 메뉴와, 목표에 맞추려면 받아야 할 판매가까지 보여 줘요.' },
];
const TOUR_MS = 4800;

function productTour() {
  let cur = 0;
  let playing = !REDUCED();
  let hold = false; // 마우스를 올렸거나 포커스가 안에 있을 때 잠시 멈춤
  let t0 = 0; let raf = 0; let started = false;

  const shots = TOUR.map((s, i) => h('img', {
    class: `lp-shot${i === 0 ? ' is-on' : ''}`, src: `/static/landing/${s.img}.webp?v=2`, width: 390, height: 780,
    alt: `원가다이어리 앱 화면 ${i + 1}단계: ${s.t}`, loading: i === 0 ? 'eager' : 'lazy', decoding: 'async', draggable: false,
  }));
  const phone = h('div', { class: 'lp-phone' }, h('div', { class: 'lp-phone-screen' }, shots));
  const bars = [];
  const steps = TOUR.map((s, i) => {
    const bar = h('i'); bars.push(bar);
    const b = h('button', { class: `lp-tour-step${i === 0 ? ' is-on' : ''}`, type: 'button', 'aria-current': i === 0 ? 'step' : null },
      h('span', { class: 'lp-tour-no' }, String(i + 1)),
      h('span', { class: 'lp-tour-txt' }, h('b', null, s.t), h('span', null, s.d)),
      h('span', { class: 'lp-tour-bar', 'aria-hidden': 'true' }, bar));
    b.addEventListener('click', () => { go(i); });
    return b;
  });
  const toggle = h('button', { class: 'lp-tour-play', type: 'button' });
  const paintToggle = () => {
    toggle.replaceChildren(playing ? '❚❚ 멈춤' : '▶ 자동 재생');
    toggle.setAttribute('aria-label', playing ? '자동 넘김 멈추기' : '자동 넘김 시작');
  };
  toggle.addEventListener('click', () => { playing = !playing; paintToggle(); t0 = performance.now() - progress() * TOUR_MS; tick(); });
  paintToggle();

  let saved = 0;
  const progress = () => saved;
  function go(i) {
    const n = (i + TOUR.length) % TOUR.length;
    shots[cur].classList.remove('is-on'); steps[cur].classList.remove('is-on'); steps[cur].removeAttribute('aria-current');
    bars[cur].style.transform = 'scaleX(0)';
    cur = n;
    shots[cur].classList.add('is-on'); steps[cur].classList.add('is-on'); steps[cur].setAttribute('aria-current', 'step');
    saved = 0; t0 = performance.now();
    live.textContent = `${cur + 1}단계: ${TOUR[cur].t}`;
    const list = steps[cur].parentElement;
    if (list && list.scrollWidth > list.clientWidth) list.scrollTo({ left: steps[cur].offsetLeft - 16, behavior: REDUCED() ? 'auto' : 'smooth' });
  }
  function tick() {
    cancelAnimationFrame(raf);
    if (!playing || !started) { bars[cur].style.transform = `scaleX(${saved})`; return; }
    raf = requestAnimationFrame(function step(now) {
      if (!playing) return;
      if (hold) { t0 = now - saved * TOUR_MS; raf = requestAnimationFrame(step); return; }
      saved = Math.min(1, (now - t0) / TOUR_MS);
      bars[cur].style.transform = `scaleX(${saved})`;
      if (saved >= 1) go(cur + 1);
      raf = requestAnimationFrame(step);
    });
  }

  // 휴대폰 화면을 좌우로 밀어서 넘기기
  let sx = null;
  phone.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  phone.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
  });

  const live = h('p', { class: 'sr', 'aria-live': 'polite' });
  const el = h('div', { class: 'lp-tour', id: 'lp-tour', role: 'group', 'aria-label': '거래명세서를 등록하면 원가가 계산되는 과정(실제 앱 화면)' },
    h('p', { class: 'lp-tour-kicker' }, h('span', { class: 'lp-live-dot' }), '실제 앱 화면'),
    phone,
    h('div', { class: 'lp-tour-steps' }, steps),
    h('div', { class: 'lp-tour-foot' }, toggle, h('span', null, '예시 가게 데이터로 찍은 화면이에요')),
    live);
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hold = true; });
  el.addEventListener('pointerleave', () => { hold = false; });
  el.addEventListener('focusin', () => { hold = true; });
  el.addEventListener('focusout', () => { hold = false; });
  el.start = () => { if (started) return; started = true; t0 = performance.now(); tick(); };
  return el;
}

/* ─── 계산 데모 1: 메뉴 원가 ─── */
function slider({ id, label, min, max, step, value, fmt, onInput }) {
  const out = h('output', { class: 'lp-num', for: id }, fmt(value));
  const input = h('input', { type: 'range', id, min, max, step, value, class: 'lp-range' });
  const fillTrack = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); fillTrack(); onInput(Number(input.value)); });
  fillTrack();
  const el = h('div', { class: 'lp-field' }, h('label', { for: id }, h('span', null, label), out), input);
  el.set = (v) => { input.value = v; out.textContent = fmt(v); fillTrack(); };
  return el;
}

function demoMenu() {
  const costN = numEl(0, won);
  const marginN = numEl(0, won);
  const ratioN = numEl(0, (v) => `${n1(v)}%`);
  const recN = numEl(0, won);
  const bar = ratioBar();
  const stampBox = h('span');
  const stack = h('div', { class: 'lp-stack', role: 'list', 'aria-label': '재료별 원가' });
  const legend = h('ul', { class: 'lp-stack-legend' });

  const pork = slider({ id: 'lp-pork', label: '돼지 앞다리살 1kg', min: 8000, max: 14000, step: 100, value: state.pork, fmt: won, onInput: (v) => setState({ pork: v }) });
  const price = slider({ id: 'lp-price', label: '판매가', min: 8000, max: 13000, step: 500, value: state.price, fmt: won, onInput: (v) => setState({ price: v }) });

  onState(() => {
    pork.set(state.pork); price.set(state.price);
    const c = jeyukCost(state.pork);
    const ratio = (c.total / state.price) * 100;
    tween(costN, c.total, won); tween(marginN, state.price - c.total, won);
    tween(ratioN, ratio, (v) => `${n1(v)}%`); tween(recN, roundUp100(c.total / (TARGET / 100)), won);
    bar.set(ratio); stampBox.replaceChildren(badge(ratio));
    const top = [...c.rows].sort((a, b) => b.cost - a.cost);
    stack.replaceChildren(...c.rows.map((r, i) => h('i', {
      role: 'listitem', title: `${r.name} ${won(r.cost)}`, 'aria-label': `${r.name} ${won(r.cost)}`,
      style: { width: `${(r.cost / c.total) * 100}%`, '--k': i },
    })));
    legend.replaceChildren(...top.slice(0, 4).map((r) => {
      const i = c.rows.indexOf(r);
      return h('li', { style: { '--k': i } }, h('i'), r.name, h('b', { class: 'lp-num' }, won(r.cost)));
    }));
  });

  return h('div', { class: 'lp-demo-grid' },
    h('div', { class: 'lp-demo-copy' },
      h('h3', null, '메뉴마다 남는 돈이 보여요'),
      h('p', null, '재료와 양만 넣으면 원가율과 한 그릇에 남는 돈이 나와요. 목표 원가율에 맞추려면 얼마를 받아야 하는지도 같이 계산해 둬요.'),
      h('ul', { class: 'lp-ticks' },
        h('li', null, '육수·소스 같은 프렙 레시피도 g·ml당 원가로'),
        h('li', null, '부가세 포함·별도 기준 중에 고를 수 있어요'),
        h('li', null, '막대를 움직여 보세요. 배달 손익·손익분기 탭에도 이어져요'))),
    h('div', { class: 'lp-panel' },
      h('div', { class: 'lp-menu-h' }, h('div', null, h('b', null, '제육볶음'), h('span', null, '1인분 · 예시 단가')), stampBox),
      pork, price,
      h('dl', { class: 'lp-kv' },
        h('div', { class: 'is-cost' }, h('dt', null, '재료비'), h('dd', null, costN)),
        h('div', { class: 'is-margin' }, h('dt', null, '남는 돈'), h('dd', null, marginN)),
        h('div', { class: 'is-ratio' }, h('dt', null, '원가율'), h('dd', null, ratioN))),
      bar,
      h('p', { class: 'lp-rec' }, `원가율 ${TARGET}%로 맞추려면 `, recN, ' 받으면 돼요'),
      h('div', { class: 'lp-stack-wrap' }, h('span', { class: 'lp-mini' }, '재료비 구성'), stack, legend)));
}

/* ─── 계산 데모 2: 배달 한 건 손익 ─── */
function demoDelivery() {
  let ch = APPS[1];
  let deliv = ch.deliv;
  const rows = h('ol', { class: 'lp-fall' });
  const netN = numEl(0, won);
  const recLine = h('p', { class: 'lp-rec' });
  const verdict = h('p', { class: 'lp-verdict' });

  const delivS = slider({ id: 'lp-deliv', label: '사장님 부담 배달비', min: 0, max: 4500, step: 100, value: deliv, fmt: won, onInput: (v) => { deliv = v; paint(); } });
  const seg = h('div', { class: 'lp-seg', role: 'radiogroup', 'aria-label': '판매 채널' },
    APPS.map((a) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(a === ch) }, a.label);
      b.addEventListener('click', () => {
        ch = a; deliv = a.deliv; delivS.set(deliv);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        delivS.hidden = a.key === 'store';
        paint();
      });
      return b;
    }));

  function paint() {
    const sale = state.price;
    const cost = jeyukCost(state.pork).total;
    const vat = ch.key === 'store' ? 1 : 1.1;
    const fee = (sale * ch.fee) / 100 * vat;
    const pay = (sale * ch.pay) / 100 * vat;
    const dv = ch.key === 'store' ? 0 : deliv * vat;
    const net = sale - fee - pay - dv - cost;
    const max = sale;
    const line = (label, v, cls, note) => h('li', { class: cls },
      h('span', { class: 'lp-fall-l' }, label, note ? h('small', null, note) : null),
      h('span', { class: 'lp-fall-bar' }, h('i', { style: { width: `${Math.min(100, (Math.abs(v) / max) * 100)}%` } })),
      h('b', { class: 'lp-num' }, `${v < 0 ? '−' : ''}${won(Math.abs(v))}`));
    rows.replaceChildren(
      line('판매가', sale, 'is-sale'),
      ch.fee ? line('중개 수수료', -fee, 'is-minus', `${ch.fee}% + 부가세`) : null,
      ch.pay ? line('결제 수수료', -pay, 'is-minus', `${ch.pay}% + 부가세`) : null,
      dv ? line('배달비', -dv, 'is-minus', '부가세 포함') : null,
      line('재료비', -cost, 'is-cost'));
    tween(netN, net, (v) => `${v < 0 ? '−' : ''}${won(Math.abs(v))}`);
    netN.closest('.lp-net')?.setAttribute('data-neg', String(net < 0));
    const rate = (net / sale) * 100;
    verdict.textContent = ch.key === 'store'
      ? `매장에서 팔면 판매가의 ${n1(rate)}%가 남아요.`
      : `${ch.label}로 한 그릇 팔면 판매가의 ${n1(rate)}%만 남아요.`;
    if (ch.key === 'store') { recLine.hidden = true; return; }
    const a = ((ch.fee + ch.pay) / 100) * vat;
    const rec = roundUp100((cost / (TARGET / 100) + dv) / (1 - a));
    recLine.hidden = false;
    recLine.replaceChildren(`원가율 ${TARGET}%를 지키려면 이 앱에서는 `, h('b', { class: 'lp-num' }, won(rec)), ' 받아야 해요');
  }
  onState(paint);

  return h('div', { class: 'lp-demo-grid' },
    h('div', { class: 'lp-demo-copy' },
      h('h3', null, '배달 한 건에 실제로 남는 돈'),
      h('p', null, '배달의민족·쿠팡이츠 수수료와 배달비, 부가세까지 빼고 나면 한 그릇에 얼마가 남는지 보여 줘요. 앱별 권장 판매가도 따로 계산해요.'),
      h('ul', { class: 'lp-ticks' },
        h('li', null, '공개된 요율을 기본값으로 넣어 두었어요'),
        h('li', null, '정산서와 다르면 구간·요율을 직접 고쳐 쓰면 돼요'),
        h('li', null, '앱과 자동 연동하지는 않아요'))),
    h('div', { class: 'lp-panel' },
      seg, delivS, rows,
      h('div', { class: 'lp-net' }, h('span', null, '한 그릇 남는 돈'), netN),
      verdict, recLine,
      h('p', { class: 'lp-fine' }, '제육볶음 예시 · 공개 요율 기준(부가세 포함 매출) · 쿠폰·포장비 제외')));
}

/* ─── 계산 데모 3: 손익분기 ─── */
function demoBreakeven() {
  let rent = 2500000;
  let hours = 20;
  let days = 26;
  const out = h('div', { class: 'lp-be' });
  const bowlsN = numEl(0, (v) => n0(v));
  const salesN = numEl(0, won);
  const fixedN = numEl(0, won);
  const laborLine = h('p', { class: 'lp-fine' });

  const rentS = slider({ id: 'lp-rent', label: '월세·관리비·공과금', min: 500000, max: 6000000, step: 100000, value: rent, fmt: won, onInput: (v) => { rent = v; paint(); } });
  const hoursS = slider({ id: 'lp-hours', label: '아르바이트 주 근무시간', min: 0, max: 40, step: 1, value: hours, fmt: (v) => `${v}시간`, onInput: (v) => { hours = v; paint(); } });
  const daysS = slider({ id: 'lp-days', label: '한 달 영업일', min: 20, max: 31, step: 1, value: days, fmt: (v) => `${v}일`, onInput: (v) => { days = v; paint(); } });

  function paint() {
    const base = MIN_WAGE_2026 * hours * WEEKS;
    const holiday = hours >= 15 ? (Math.min(hours, 40) / 40) * 8 * MIN_WAGE_2026 * WEEKS : 0;
    const labor = base + holiday;
    const fixed = rent + labor;
    const cost = jeyukCost(state.pork).total;
    const cm = (state.price - cost) / state.price;
    const sales = cm > 0 ? fixed / cm : Infinity;
    const bowls = Number.isFinite(sales) ? Math.ceil(sales / state.price / days) : 0;
    tween(fixedN, fixed, won); tween(salesN, sales, won); tween(bowlsN, bowls, (v) => n0(v));
    laborLine.textContent = hours
      ? `인건비 ${won(labor)} = 2026년 최저임금 ${n0(MIN_WAGE_2026)}원 × 주 ${hours}시간${holiday ? ` + 주휴수당 ${won(holiday)}` : ' (주 15시간 미만은 주휴수당 없음)'}`
      : '아르바이트 없이 혼자 운영하는 경우';
    const filled = Math.min(40, bowls);
    out.replaceChildren(...Array.from({ length: 40 }, (_, i) => h('i', { class: i < filled ? 'on' : '', style: { '--i': i } })));
  }
  onState(paint);

  return h('div', { class: 'lp-demo-grid' },
    h('div', { class: 'lp-demo-copy' },
      h('h3', null, '하루 몇 그릇 팔아야 본전인지'),
      h('p', null, '월세 같은 고정비와 직원 급여를 넣으면 한 달에 얼마를 팔아야 남는지 계산해요. 직원 급여에는 주휴수당까지 들어가요.'),
      h('ul', { class: 'lp-ticks' },
        h('li', null, '배달 비중을 넣으면 배달 수수료까지 반영'),
        h('li', null, '내 매출을 올리면 목표와 나란히 비교'),
        h('li', null, '법률 상담이 아닌 참고용 계산이에요'))),
    h('div', { class: 'lp-panel' },
      rentS, hoursS, daysS,
      h('div', { class: 'lp-be-res' },
        h('p', { class: 'lp-be-line' }, '하루에 ', h('b', null, '제육볶음 ', bowlsN, '그릇'), '을 팔아야 본전이에요'),
        out),
      h('dl', { class: 'lp-kv is-2' },
        h('div', null, h('dt', null, '한 달 고정비'), h('dd', null, fixedN)),
        h('div', null, h('dt', null, '손익분기 매출'), h('dd', null, salesN))),
      laborLine,
      h('p', { class: 'lp-fine' }, '위 메뉴 원가 데모의 판매가·재료비로 계산 · 카드 수수료·세금 제외')));
}

/* ─── 기능 쇼케이스(탭) ─── */
function showcase() {
  const tabs = [
    { id: 'menu', ic: 'list', label: '메뉴 원가', make: demoMenu },
    { id: 'deliv', ic: 'trend', label: '배달 손익', make: demoDelivery },
    { id: 'be', ic: 'home', label: '손익분기', make: demoBreakeven },
  ];
  let active = 0;
  const panels = tabs.map((t, i) => h('div', { class: 'lp-tabpanel', role: 'tabpanel', id: `lp-p-${t.id}`, 'aria-labelledby': `lp-t-${t.id}`, hidden: i !== 0, tabindex: '0' }, t.make()));
  const btns = tabs.map((t, i) => h('button', {
    class: 'lp-tab', role: 'tab', id: `lp-t-${t.id}`, type: 'button', 'aria-controls': `lp-p-${t.id}`,
    'aria-selected': String(i === 0), tabindex: i === 0 ? '0' : '-1',
  }, h('span', { class: 'lp-tab-no' }, String(i + 1)), icon(t.ic, 18), h('span', null, t.label)));
  const ink = h('span', { class: 'lp-tab-ink', 'aria-hidden': 'true' });
  const list = h('div', { class: 'lp-tabs', role: 'tablist', 'aria-label': '기능 둘러보기' }, btns, ink);
  const moveInk = () => {
    const b = btns[active];
    ink.style.width = `${b.offsetWidth}px`;
    ink.style.transform = `translateX(${b.offsetLeft}px)`;
  };
  const go = (i, focus) => {
    if (i === active) return;
    btns[active].setAttribute('aria-selected', 'false'); btns[active].tabIndex = -1; panels[active].hidden = true;
    active = i;
    btns[active].setAttribute('aria-selected', 'true'); btns[active].tabIndex = 0; panels[active].hidden = false;
    panels[active].classList.remove('is-enter'); void panels[active].offsetWidth; panels[active].classList.add('is-enter');
    if (focus) btns[active].focus();
    moveInk();
    if (list.scrollWidth > list.clientWidth) btns[active].scrollIntoView({ block: 'nearest', inline: 'center', behavior: REDUCED() ? 'auto' : 'smooth' });
  };
  btns.forEach((b, i) => {
    b.addEventListener('click', () => go(i));
    b.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); go((active + k + tabs.length) % tabs.length, true); }
      if (e.key === 'Home') { e.preventDefault(); go(0, true); }
      if (e.key === 'End') { e.preventDefault(); go(tabs.length - 1, true); }
    });
  });
  const el = h('div', { class: 'lp-show' }, list, h('div', { class: 'lp-tabpanels' }, panels));
  el.moveInk = moveInk;
  return el;
}

/* ─── 시작 순서 ─── */
function startSteps() {
  const ways = {
    receipt: [
      ['영수증·명세서 등록', '장 본 영수증이나 납품받은 거래명세서의 품목·규격·단가를 넣어요.'],
      ['식자재 한 번 연결', '명세서마다 이름이 달라도 한 번 연결하면 다음부터 알아봐요.'],
      ['메뉴에 재료 담기', '재료와 양을 담으면 원가율이 계산되고, 단가가 바뀔 때마다 다시 계산돼요.'],
    ],
    excel: [
      ['엑셀·CSV 올리기', '쓰던 파일을 그대로 올리면 제목 줄을 읽어 칸을 맞춰요.'],
      ['미리 보고 저장', '칸이 틀리면 직접 고르고, 확인하기 전에는 아무것도 저장되지 않아요.'],
      ['바로 원가 계산', '가져온 식자재로 메뉴 원가를 바로 계산해요.'],
    ],
  };
  let way = 'receipt';
  const ol = h('ol', { class: 'lp-steps' });
  const paint = () => ol.replaceChildren(...ways[way].map(([t, d], i) => h('li', { style: { '--i': i } },
    h('span', { class: 'lp-step-no' }, String(i + 1)), h('h3', null, t), h('p', null, d))));
  const seg = h('div', { class: 'lp-seg is-center', role: 'radiogroup', 'aria-label': '시작 방법' },
    [['receipt', '영수증·명세서로'], ['excel', '쓰던 엑셀로']].map(([k, label]) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === way) }, label);
      b.addEventListener('click', () => { way = k; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); paint(); });
      return b;
    }));
  paint();
  return h('div', null, seg, ol);
}

/* ─── 자주 묻는 질문 ─── */
const FAQ = [
  ['정말 무료인가요?', '네. 식자재 단가 관리, 메뉴 원가 계산, 배달 손익, 손익분기, 엑셀 가져오기·내려받기 등 지금 있는 기능은 개수 제한 없이 모두 무료예요. 거래명세서 사진 자동 인식만 한 달 5회인데, 인식할 때마다 외부 API 비용이 나가기 때문이에요. 테스트중이라 결과가 부정확할 수 있고, 넘기면 직접 입력하면 돼요.'],
  ['쓰던 앱이나 엑셀 자료를 옮길 수 있나요?', '엑셀(.xlsx)과 CSV 파일을 올리면 제목 줄을 읽어 칸을 자동으로 맞추고, 저장하기 전에 미리 보여 드려요. 칸이 틀리면 직접 고를 수 있어요. 가격이 없는 식자재도 \'단가 없음\'으로 옮겨 두었다가 명세서로 채울 수 있어요.'],
  ['메뉴별 재료 양(g)을 몰라도 쓸 수 있나요?', '어림잡아 넣어 두고 단가만 먼저 넣어도 돼요. 나중에 실제로 계량한 값으로 고치면 원가율이 자동으로 다시 계산돼요.'],
  ['배달의민족·쿠팡이츠 수수료도 반영되나요?', '쓰는 앱을 켜고 구간·요율을 맞추면 메뉴마다 배달 한 건에 남는 돈과 배달용 권장 판매가를 계산해요. 앱과 연동하는 것이 아니라 공개된 안내를 바탕으로 한 기본값이라, 정산서와 다르면 직접 고쳐 쓰세요.'],
  ['명세서 사진은 어디에 저장되나요?', '글자를 읽기 위해 사진을 Anthropic의 Claude API로 보내고, 잘못 읽었을 때 확인할 수 있도록 원가다이어리 서버에도 보관해요. 계정을 삭제하면 사진도 함께 삭제돼요. 반영하기 전에 모든 줄을 보여 드리고, 확인하고 누르기 전에는 아무것도 저장되지 않아요.'],
  ['명세서마다 식자재 이름이 달라요.', '비슷한 이름은 자동으로 연결하고, 못 찾은 이름은 한 번만 골라 주시면 다음부터 기억해요.'],
  ['수율은 어떻게 계산하나요?', '식자재마다 수율(다듬고 남는 비율)을 넣으면 실제로 쓰는 양 기준으로 계산해요. 수율이 90%이면 단가를 0.9로 나눈 값을 원가에 써요.'],
  ['그만 쓰고 싶어요.', '설정에서 계정을 삭제하면 입력한 식자재·메뉴·가격 이력이 모두 지워져요. 그 전에 엑셀(CSV)로 내려받아 둘 수 있어요.'],
];

function faqList() {
  const items = FAQ.map(([q, a], i) => h('details', { class: 'lp-faq-item', hidden: i >= 5 },
    h('summary', null, h('span', null, q), h('span', { class: 'lp-faq-ic', 'aria-hidden': 'true' })),
    h('p', null, a)));
  const more = h('button', { class: 'lp-link is-more', type: 'button' }, `질문 ${FAQ.length - 5}개 더 보기`);
  more.addEventListener('click', () => { items.forEach((d) => { d.hidden = false; }); more.remove(); items[5].querySelector('summary').focus(); });
  return h('div', { class: 'lp-faq' }, items, more);
}

/* ─── 도입 문의 ─── */
function leadForm() {
  const name = h('input', { class: 'input', type: 'text', name: 'name', maxLength: 60, autocomplete: 'name' });
  const contact = h('input', { class: 'input', type: 'text', maxLength: 120, name: 'contact', placeholder: '예: 010-1234-5678 또는 me@example.com', autocomplete: 'off', spellcheck: false });
  const biz = selectOf(['한식', '분식', '고깃집', '주점', '카페·베이커리', '기타'], '한식');
  const msg = h('textarea', { class: 'textarea', maxLength: 1000, placeholder: '메뉴 수, 쓰고 계신 방식(수기·엑셀 등)을 적어 주시면 답변이 빨라요.' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const btn = h('button', { class: 'lp-btn is-primary', type: 'submit' }, '문의 보내기');
  const form = h('form', { class: 'lp-form', novalidate: true }, err,
    h('div', { class: 'two' }, field('이름', name), field('연락처', contact)),
    field('업종', biz), field('문의 내용 (선택)', msg), btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (contact.value.trim().length < 3) { err.textContent = '답변받을 연락처를 입력해 주세요.'; err.hidden = false; return; }
    await busy(btn, async () => {
      try {
        await api('/api/leads', { method: 'POST', body: { name: name.value, contact: contact.value, biz_type: biz.value, message: msg.value } });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      form.replaceChildren(h('p', { role: 'status' }, '문의를 접수했어요. 남겨 주신 연락처로 답변드릴게요.'));
    });
  });
  return form;
}

/* 로고: 밝은 화면용(짙은 갈색 글씨)과 어두운 화면용(크림색 글씨)을 함께 두고 CSS로 하나만 보인다 */
function logo() {
  return [
    h('img', { class: 'lp-logo is-light', src: '/static/brand/logo.png', alt: '원가다이어리', width: 521, height: 120 }),
    h('img', { class: 'lp-logo is-dark', src: '/static/brand/logo-dark.png', alt: '원가다이어리', width: 521, height: 120 }),
  ];
}

/* 가입 문구: 키가 설정된 소셜 로그인만 이름을 적는다(app.pub.oauth_providers) */
function socialLine(pub) {
  const names = { kakao: '카카오', naver: '네이버', google: '구글' };
  const on = Object.entries(pub.oauth_providers || {}).filter(([, v]) => v).map(([k]) => names[k]).filter(Boolean);
  return on.length ? `이메일이나 ${on.join('·')} 계정으로 바로 가입할 수 있어요.` : '이메일만 있으면 바로 가입하고 써 볼 수 있어요.';
}

/* ─── 페이지 ─── */
export function renderLanding(root, onAuth) {
  const pub = app.pub || {};
  const start = () => openSignup({ onDone: () => { launchConfetti(); onAuth(); } });
  const login = () => openLogin({ onDone: onAuth });
  const jump = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' });
  };
  const cta = (label, cls = 'is-primary is-lg') => h('button', { class: `lp-btn ${cls}`, type: 'button', onclick: start }, label);

  const tour = productTour();
  const show = showcase();

  const top = h('header', { class: 'lp-top' },
    h('div', { class: 'lp-wrap lp-top-in' },
      h('a', { class: 'lp-brand', href: '#/', 'aria-label': '원가다이어리 홈' }, logo()),
      h('nav', { class: 'lp-nav', 'aria-label': '소개 페이지' },
        h('a', { href: '#lp-tour', onclick: jump('lp-tour') }, '실제 화면'),
        h('a', { href: '#lp-features', onclick: jump('lp-features') }, '계산해 보기'),
        h('a', { href: '#lp-start', onclick: jump('lp-start') }, '시작 방법'),
        h('a', { href: '#lp-price', onclick: jump('lp-price') }, '가격'),
        h('a', { href: '#lp-faq', onclick: jump('lp-faq') }, '자주 묻는 질문')),
      h('div', { class: 'lp-top-act' },
        h('button', { class: 'lp-btn is-ghost is-sm', type: 'button', onclick: login }, '로그인'),
        h('button', { class: 'lp-btn is-primary is-sm', type: 'button', onclick: start }, '회원가입'))));

  const page = h('div', { class: 'lp' },
    top,
    h('main', { id: 'main' },
      /* 히어로 */
      h('section', { class: 'lp-hero', 'aria-labelledby': 'lp-hero-t' },
        h('div', { class: 'lp-wrap lp-hero-in' },
          h('div', { class: 'lp-hero-copy' },
            h('p', { class: 'lp-eyebrow rv' }, '식당·카페 사장님을 위한 원가 계산기'),
            h('h1', { id: 'lp-hero-t', class: 'rv' }, '흩어진 원가를', h('br'), h('span', { class: 'lp-hl' }, '한곳에서'), ' 정리하세요'),
            h('p', { class: 'lp-lead rv' }, '엑셀로 계산하던 원가, 이제 영수증·거래명세서만 입력하면 메뉴별로 바로 계산해 드려요.'),
            h('div', { class: 'lp-cta-row rv' },
              cta('무료로 시작하기'),
              h('a', { class: 'lp-btn is-ghost is-lg lp-hide-m', href: '#lp-features', onclick: jump('lp-features') }, '직접 계산해 보기')),
            h('ul', { class: 'lp-proof rv' },
              h('li', null, icon('check', 16), '모든 기능 무료'),
              h('li', null, icon('check', 16), '개수 제한 없음'),
              h('li', null, icon('check', 16), '예시 가게로 먼저 둘러보기'))),
          h('div', { class: 'lp-hero-art rv' }, tour))),

      /* 공감 */
      h('section', { class: 'lp-sec', 'aria-labelledby': 'lp-pain-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-sec-h rv' },
            h('h2', { id: 'lp-pain-t' }, '이런 고민, 해보신 적 있으신가요?')),
          h('div', { class: 'lp-pains' },
            [
              ['trend', '“삼겹살 가격이 올랐는데, 메뉴 가격은 그대로?”', '원가 변동을 바로 파악하고, 판매가를 조정할 시점을 놓치지 마세요.'],
              ['receipt', '“영수증이 여기저기 흩어져서 원가 계산을 못 하고 있어요”', '영수증·거래명세서를 한곳에 모아 메뉴별 원가를 자동으로 계산해 드려요.'],
              ['list', '“마진이 얼마인지 감으로만 알고 있어요”', '숫자로 정확한 마진율을 확인하고, 자신 있게 가격을 정하세요.'],
            ].map(([ic, q, c], i) => h('article', { class: 'lp-pain rv', style: { '--d': `${i * 80}ms` } },
              h('span', { class: 'lp-pain-ic' }, icon(ic, 22)),
              h('h3', null, q),
              h('p', null, c)))))),

      /* 기능 쇼케이스 */
      h('section', { class: 'lp-sec is-tint', id: 'lp-features', 'aria-labelledby': 'lp-feat-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-sec-h rv' },
            h('h2', { id: 'lp-feat-t' }, '숫자를 직접 바꿔 보세요'),
            h('p', null, '앱과 같은 계산식으로 움직여요. 메뉴 원가에서 바꾼 값이 배달 손익과 손익분기까지 이어져요.')),
          h('div', { class: 'rv' }, show))),

      /* 시작 방법 */
      h('section', { class: 'lp-sec', id: 'lp-start', 'aria-labelledby': 'lp-start-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-sec-h rv' },
            h('h2', { id: 'lp-start-t' }, '이렇게 시작해요'),
            h('p', null, '가입하면 예시 가게 데이터로 먼저 둘러볼 수 있어요. 내 가게 숫자는 편한 방법으로 넣으면 돼요.')),
          h('div', { class: 'rv' }, startSteps()))),

      /* 하는 일·안 하는 일 */
      h('section', { class: 'lp-sec is-tint', 'aria-labelledby': 'lp-scope-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-sec-h rv' },
            h('h2', { id: 'lp-scope-t' }, '단가와 원가율, 이것만 제대로'),
            h('p', null, '재고·발주까지 다 하려다 숫자가 틀리는 것보다, 원가 하나를 정확하게 보는 데 집중했어요.')),
          h('div', { class: 'lp-scope' },
            h('div', { class: 'lp-scope-yes rv' }, h('h3', null, '이런 건 잘해요'), h('ul', null,
              ['식자재 단가와 가격 변동 이력', '수율을 반영한 실제 사용 단가', '메뉴별 원가율·남는 돈·권장 판매가', '육수·소스 프렙 레시피 원가', '배달앱 수수료를 뺀 배달 손익', '고정비·직원 급여로 손익분기 매출', '엑셀·CSV 가져오기와 내려받기'].map((t) => h('li', null, icon('check', 16), t)))),
            h('div', { class: 'lp-scope-no rv' }, h('h3', null, '이건 안 해요'), h('ul', null,
              ['재고 수량 관리', '발주·주문', 'POS·배달앱 자동 연동', '세금계산서 발행'].map((t) => h('li', null, icon('x', 16), t))))))),

      /* 가격 */
      h('section', { class: 'lp-sec', id: 'lp-price', 'aria-labelledby': 'lp-price-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-price rv' },
            h('div', { class: 'lp-price-l' },
              h('h2', { id: 'lp-price-t' }, '가격'),
              h('p', { class: 'lp-price-big' }, h('span', null, '0'), '원'),
              h('p', { class: 'lp-price-head' }, '체험판도, 개수 제한도, 기간도 없습니다'),
              h('p', null, '원가다이어리의 모든 기능은 무료입니다. 광고와 후원으로만 운영되기 때문에 사장님은 아무 비용 없이 사용하실 수 있습니다.'),
              cta('무료로 시작하기', 'is-accent is-lg')),
            h('ul', { class: 'lp-price-r' },
              h('li', null, icon('check', 18), '식자재·메뉴 등록 개수 제한 없음'),
              h('li', null, icon('check', 18), '가격 이력과 원가 알림'),
              h('li', null, icon('check', 18), '배달 손익·손익분기·직원 급여 계산'),
              h('li', null, icon('check', 18), '언제든 엑셀(CSV)로 내려받기'),
              h('li', null, icon('check', 18), h('span', null, '명세서 사진 자동 인식 - 테스트중(월한도 5회)', h('small', null, '결과가 부정확할 수 있어 등록 전에 꼭 확인해 주세요'))))))),

      /* 자주 묻는 질문 */
      h('section', { class: 'lp-sec is-tint', id: 'lp-faq', 'aria-labelledby': 'lp-faq-t' },
        h('div', { class: 'lp-wrap lp-faq-wrap' },
          h('div', { class: 'lp-sec-h is-left rv' },
            h('h2', { id: 'lp-faq-t' }, '자주 묻는 질문'),
            h('p', null, '더 궁금한 점은 아래 문의로 남겨 주세요.')),
          h('div', { class: 'rv' }, faqList()))),

      /* 마지막 권유 + 문의 */
      h('section', { class: 'lp-sec lp-final', 'aria-labelledby': 'lp-final-t' },
        h('div', { class: 'lp-wrap' },
          h('div', { class: 'lp-final-in rv' },
            h('h2', { id: 'lp-final-t' }, '오늘 받은 명세서 한 장으로', h('br'), '시작해 보세요'),
            h('p', null, socialLine(pub)),
            h('div', { class: 'lp-cta-row is-center' }, cta('무료로 시작하기', 'is-accent is-lg'))),
          h('details', { class: 'lp-lead-box rv' },
            h('summary', null, h('span', null, h('b', null, '도입 문의'), ' 우리 가게에 맞는지 먼저 물어보셔도 돼요'), h('span', { class: 'lp-faq-ic', 'aria-hidden': 'true' })),
            leadForm())))),

    h('footer', { class: 'lp-foot' },
      h('div', { class: 'lp-wrap lp-foot-in' },
        h('span', { class: 'lp-brand is-sm' }, logo(), pub.business_name && pub.business_name !== '원가다이어리' ? h('span', null, pub.business_name) : null),
        pub.contact_email ? h('a', { href: `mailto:${pub.contact_email}` }, pub.contact_email) : null,
        h('button', { class: 'lp-link', type: 'button', onclick: openTerms }, '이용약관'),
        h('button', { class: 'lp-link', type: 'button', onclick: openDataNotice }, h('b', null, '개인정보처리방침')))),

    /* 모바일: 스크롤하면 아래에 붙는 가입 버튼 */
    h('div', { class: 'lp-dock', 'aria-hidden': 'true' },
      h('button', { class: 'lp-btn is-primary is-lg', type: 'button', tabindex: '-1', onclick: start }, '무료로 시작하기')));

  root.replaceChildren(page);

  requestAnimationFrame(() => {
    show.moveInk();
    window.addEventListener('resize', show.moveInk, { passive: true });
    reveal(page);
    // 실제 화면 둘러보기는 화면에 보일 때부터 자동으로 넘긴다
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); tour.start(); }
    }, { threshold: 0.3 });
    io.observe(tour);
    // 헤더 그림자, 모바일 하단 가입 버튼
    const hero = page.querySelector('.lp-hero');
    const final = page.querySelector('.lp-final');
    const dock = page.querySelector('.lp-dock');
    let heroOut = false; let finalIn = false;
    const sync = () => dock.classList.toggle('is-on', heroOut && !finalIn);
    new IntersectionObserver(([e]) => { top.classList.toggle('is-stuck', !e.isIntersecting); }, { rootMargin: '-1px 0px 0px 0px', threshold: 0 })
      .observe(page.querySelector('.lp-hero-copy'));
    new IntersectionObserver(([e]) => { heroOut = !e.isIntersecting; sync(); }).observe(hero.querySelector('.lp-cta-row'));
    new IntersectionObserver(([e]) => { finalIn = e.isIntersecting; sync(); }).observe(final);
    spotlight(page);
  });
}

function reveal(root) {
  const els = root.querySelectorAll('.rv');
  if (REDUCED() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((el) => io.observe(el));
}

/* 마우스를 쓰는 기기에서만: 카드 위 커서를 따라오는 은은한 빛 */
function spotlight(root) {
  if (REDUCED() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  root.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.lp-pain, .lp-panel, .lp-price');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/* 가입 직후 축하 효과 */
function launchConfetti() {
  if (REDUCED()) return;
  const colors = ['#D97706', '#B45309', '#92400E', '#F5C060', '#166534'];
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '9999' });
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const pieces = Array.from({ length: 110 }, () => ({
    x: Math.random() * canvas.width, y: -20 - Math.random() * 100, w: 8 + Math.random() * 8, h: 4 + Math.random() * 6,
    rot: Math.random() * Math.PI * 2, vx: (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 4, vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)], alpha: 1,
  }));
  let frame = 0;
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (frame > 60) p.alpha -= 0.015;
      if (p.y < canvas.height + 20 && p.alpha > 0) alive = true;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    frame++;
    if (alive) requestAnimationFrame(draw); else canvas.remove();
  })();
}
