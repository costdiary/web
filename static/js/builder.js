/* 그릇 채우기: 메뉴 이름을 검색하면 보통 1인분 재료가 그릇에 담기고, 오른쪽에서 양을 맞추면 원가가 바로 바뀝니다.
   검색은 서버에 받아 둔 레시피(기본 레시피·공공 레시피·사장님들이 확정한 레시피)에서 찾으므로 사진 인식 횟수를 쓰지 않습니다.
   양은 모두 '추정'으로 시작하고, 사장님이 슬라이더나 숫자로 직접 고친 재료만 추정 표시가 빠집니다. */
import {
  h, api, app, numInput, selectOf, parseNum, n0, n1, n3, busy, toast, errMsg, icon, fill,
} from './core.js';
import { menuTotals, effUnitCost } from './calc.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const UNIT_OF = { g: 'g', ml: 'ml', ea: '개' };
const DEFAULT_QTY = { g: 50, ml: 15, ea: 1 };

/* 숫자가 휙 바뀌지 않고 짧게 굴러가듯 바뀌게(0.25초). 움직임 줄이기 설정이면 바로 바꿉니다. */
function rollTo(el, to, fmt) {
  const from = Number(el.dataset.v);
  el.dataset.v = String(to);
  if (to == null || Number.isNaN(to)) { el.textContent = '–'; return; }
  if (REDUCED || !Number.isFinite(from) || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    if (el.dataset.v !== String(to)) return; // 그새 다른 값이 들어왔으면 멈춤
    const k = Math.min(1, (t - t0) / 250);
    const e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* 재료 이름으로 그릇 속 색을 고릅니다(사진 대신 색 덩어리로 보여 주기 위함). */
const TONES = [
  [/달걀|계란/, '#f2c14e', '#fff3c4'],
  [/김치|고추장|고춧가루|다대기|비빔장|케첩|토마토|양념/, '#c2412d', '#f08a6c'],
  [/돼지|소고기|소갈비|양지|닭|삼겹|등심|우삼겹|고기|편육|머리|베이컨/, '#a4553a', '#e0a083'],
  [/햄|소시지|순대/, '#c46a66', '#f1b2a8'],
  [/오징어|낙지|주꾸미|새우|바지락|홍합|동태|고등어|황태|맛살|어묵|참치/, '#e3896d', '#ffd2bf'],
  [/당근/, '#e2873b', '#ffc48f'],
  [/파|부추|시금치|깻잎|상추|오이|애호박|쑥갓|고수|양배추|우거지|고사리|고추|라임/, '#5f9443', '#b6dc8f'],
  [/양파|무|감자|마늘|배$|콩나물|숙주|고구마|목이|버섯|단무지/, '#d9c49b', '#fbf1da'],
  [/두부|치즈|순두부|유부|생크림|마요/, '#efe6cf', '#ffffff'],
  [/간장|된장|춘장|굴소스|소스|카레|맛술|쌈장|새우젓|국간장|데미/, '#6b3f22', '#b07a4f'],
  [/육수|국물/, '#d8b67a', '#f6e2b8'],
  [/기름|유$|올리브/, '#e3c157', '#fff0a8'],
  [/쌀|면|국수|사리|떡|가루|빵가루|전분|당면|김밥/, '#efe4cc', '#ffffff'],
  [/김$/, '#2c3a2a', '#5b6b55'],
  [/설탕|소금|식초|겨자/, '#e9e4da', '#ffffff'],
];
/* 재료 그림(Twemoji, CC-BY 4.0 · static/img/ing/CREDITS.txt). 위에서부터 먼저 맞는 그림을 씁니다. */
const PICS = [
  [/달걀|계란/, '1f95a'], [/김치/, '1f96c'], [/고춧가루|청양|고추$|고추 /, '1f336'],
  [/고추장|된장|춘장|쌈장|새우젓|다대기|비빔장|양념/, '1fad9'], [/케첩|마요|소스|굴소스|데미/, '1f9f4'],
  [/간장|맛술|식초|국간장/, '1f376'], [/토마토/, '1f345'], [/카레/, '1f372'],
  [/닭/, '1f357'], [/삼겹|베이컨/, '1f953'], [/갈비|등뼈/, '1f356'], [/돼지|소고기|양지|등심|우삼겹|고기|편육|머리/, '1f969'],
  [/햄|소시지/, '1f32d'], [/새우/, '1f990'], [/오징어/, '1f991'], [/낙지|주꾸미/, '1f419'],
  [/바지락|홍합/, '1f9aa'], [/동태|고등어|황태|참치/, '1f41f'], [/어묵|맛살|순대/, '1f362'],
  [/당근/, '1f955'], [/양파/, '1f9c5'], [/마늘/, '1f9c4'], [/고구마/, '1f360'], [/감자/, '1f954'],
  [/콩나물|숙주/, '1f331'], [/버섯/, '1f344'], [/오이|애호박|단무지/, '1f952'], [/^배$/, '1f350'], [/라임|레몬/, '1f34b'],
  [/배추|상추|시금치|깻잎|양배추|우거지|고사리/, '1f96c'], [/파|부추|쑥갓|고수/, '1f33f'],
  [/두부|유부/, '1f9c8'], [/치즈/, '1f9c0'], [/생크림|우유/, '1f95b'],
  [/스파게티/, '1f35d'], [/면|국수|사리|당면/, '1f35c'], [/떡/, '1f361'], [/쌀|밥/, '1f35a'], [/^김$/, '1f359'],
  [/빵가루/, '1f35e'], [/가루|전분/, '1f33e'], [/설탕|소금|겨자/, '1f9c2'], [/캔/, '1f96b'],
  [/올리브/, '1fad2'], [/기름|유$/, '1fad7'], [/육수|국물/, '1f963'],
];
const picOf = (name) => { const hit = PICS.find(([re]) => re.test(name)); return hit ? `/static/img/ing/${hit[1]}.svg` : null; };
const toneOf = (name) => (TONES.find(([re]) => re.test(name)) || [null, '#c9a27a', '#f0d8b8']).slice(1);
const SOUPS = [
  [/짜장|자장|춘장/, '#3a2213'], [/카레/, '#c8892c'], [/된장|뼈해장|감자탕/, '#8a5a2b'],
  [/김치|부대|순두부|육개장|짬뽕|떡볶이|라볶이|제육|오징어|낙지|주꾸미|닭갈비|닭볶음|비빔|쫄면|동태|찌개/, '#a5321f'],
  [/설렁|곰탕|사골|칼국수|국수|우동|냉면|쌀국수|국밥|북엇|무국|미역|갈비탕|순대국|어묵|계란찜/, '#d9c39a'],
  [/스파게티|토마토/, '#b23a24'], [/까르보|크림/, '#efe2c4'],
];
const soupOf = (name) => (SOUPS.find(([re]) => re.test(name || '')) || [null, '#e8dcc4'])[1];

const niceStep = (max) => (max > 400 ? 5 : max > 60 ? 1 : max > 6 ? 0.5 : 0.1);

export async function render(box) {
  const ingRes = await api('/api/ingredients');
  const ings = ingRes.items;
  const ingById = new Map(ings.map((i) => [i.id, i]));
  const canWrite = app.me.plan.writable;
  const { target_cost_ratio: target, vat_mode: vat } = app.me.settings;

  /** @type {Array<any>} */
  let lines = [];
  let picked = null; // { name, source, serving_note }
  let uid = 0;

  /* ---------------- 왼쪽: 메뉴 찾기 ---------------- */
  const q = h('input', { class: 'input', type: 'search', maxLength: 60, autocomplete: 'off', placeholder: '예: 제육볶음, 김치찌개', 'aria-label': '메뉴 이름으로 찾기' });
  const results = h('ul', { class: 'mb-results', role: 'list' });
  const resultsHead = h('p', { class: 'xs muted mb-res-h' });
  let seq = 0;
  let timer = 0;
  async function runSearch() {
    const my = ++seq;
    try {
      const res = await api(`/api/recipe/search?q=${encodeURIComponent(q.value.trim())}`);
      if (my !== seq) return;
      resultsHead.textContent = q.value.trim() ? (res.items.length ? '찾은 메뉴' : '') : '자주 만드는 메뉴';
      fill(results, res.items.length ? res.items.map((it) => h('li', null,
        h('button', { class: 'mb-res', type: 'button', 'aria-pressed': String(picked?.id === it.id), onclick: () => loadTemplate(it) },
          h('span', { class: 'mb-res-name' }, it.name),
          h('span', { class: 'xs muted' }, `${it.source} · 재료 ${it.count}개`))))
        : h('li', { class: 'small muted mb-none' }, '비슷한 메뉴가 없어요. 아래에서 재료를 하나씩 담아 보세요.'));
    } catch (e) {
      if (my === seq) fill(results, h('li', { class: 'small muted' }, errMsg(e)));
    }
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 180); });

  const addName = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', placeholder: '재료 이름', 'aria-label': '더할 재료 이름', list: 'mb-ing-list' });
  const addList = h('datalist', { id: 'mb-ing-list' }, ings.map((i) => h('option', { value: i.name })));
  const addKind = selectOf([['g', 'g'], ['ml', 'ml'], ['ea', '개']], 'g', { 'aria-label': '단위' });
  addName.addEventListener('input', () => {
    const hit = ings.find((i) => i.name === addName.value.trim());
    if (hit) addKind.value = hit.kind;
  });
  const addOne = () => {
    const name = addName.value.trim();
    if (!name) { addName.focus(); return; }
    const kind = addKind.value;
    const hit = ings.find((i) => i.name === name && i.kind === kind);
    const qty = DEFAULT_QTY[kind];
    lines.push(makeLine({ name, qty, qty_low: qty * 0.5, qty_high: qty * 1.5, unit: UNIT_OF[kind], kind, confidence: 'low', note: '', match: hit ? { id: hit.id } : null }, true));
    addName.value = '';
    paintAll();
  };
  addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });

  const findPanel = h('section', { class: 'sheet mb-find', 'aria-label': '메뉴 찾기' },
    h('h2', { class: 'mb-h' }, h('span', { class: 'mb-step' }, '1'), '메뉴 찾기'),
    h('div', { class: 'search' }, icon('search', 18), q),
    resultsHead, results,
    h('div', { class: 'mb-add' },
      h('p', { class: 'xs muted', style: 'margin-bottom:6px' }, '재료 하나씩 더하기'),
      h('div', { class: 'mb-add-row' }, addName, addKind, h('button', { class: 'btn sm ghost', type: 'button', onclick: addOne, 'aria-label': '재료 더하기' }, icon('plus', 16))),
      addList),
    h('p', { class: 'xs muted mb-photo' }, '요리 사진이 있다면 ', h('a', { href: '#/menus/photo' }, '사진으로 짐작하기'), '도 써 볼 수 있어요. (사진 인식 횟수 차감)'));

  /* ---------------- 가운데: 그릇 ---------------- */
  const menuName = h('input', { class: 'input mb-name', type: 'text', maxLength: 60, autocomplete: 'off', placeholder: '메뉴 이름', 'aria-label': '메뉴 이름' });
  const bowl = h('div', { class: 'mb-soup', role: 'list', 'aria-label': '그릇에 담긴 재료' });
  const bowl3d = h('div', { class: 'mb-bowl3d' },
    h('div', { class: 'mb-light', 'aria-hidden': 'true' }),
    h('div', { class: 'mb-steam', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'mb-plate' }, h('div', { class: 'mb-rim' }, bowl)),
    h('div', { class: 'mb-shadow', 'aria-hidden': 'true' }));
  const bowlNote = h('p', { class: 'xs muted mb-bowl-note' });
  const bowlPanel = h('section', { class: 'mb-mid', 'aria-label': '그릇' },
    h('p', { class: 'mb-kicker' }, '오늘의 한 그릇'), menuName, bowl3d, bowlNote,
    h('p', { class: 'mb-credit' }, '재료 그림: ', h('a', { href: 'https://github.com/jdecked/twemoji', target: '_blank', rel: 'noopener' }, 'Twemoji'), ' (CC-BY 4.0)'));

  /* ---------------- 오른쪽: 양 조절과 원가 ---------------- */
  const portion = h('div', { class: 'seg mb-portion', role: 'group', 'aria-label': '양 전체 바꾸기' },
    [['low', '적게'], ['mid', '보통'], ['high', '많이']].map(([k, label]) => h('button', {
      class: 'btn sm ghost', type: 'button', onclick: () => {
        for (const ln of lines) if (!ln.touched) ln.qty = k === 'low' ? ln.low : k === 'high' ? ln.high : ln.base;
        paintAll();
      },
    }, label)));
  const rows = h('div', { class: 'mb-rows' });
  const price = numInput({ placeholder: '예: 9,500', 'aria-label': '판매가(원)' });
  const category = h('input', { class: 'input', type: 'text', maxLength: 30, autocomplete: 'off', placeholder: '분류 (선택)', 'aria-label': '분류' });
  const rcLines = h('ul', { class: 'mb-rc-lines' });
  const rcCost = h('b', { class: 'n' });
  const rcRange = h('span', { class: 'xs muted' });
  const rcRatio = h('b', { class: 'n mb-ratio' });
  const rcHint = h('p', { class: 'xs muted mb-rc-hint', 'aria-live': 'polite' });
  const save = h('button', { class: 'btn block', type: 'button' });
  const receipt = h('div', { class: 'mb-receipt', 'aria-label': '원가 영수증' },
    h('p', { class: 'mb-rc-title' }, '원가 영수증', h('span', { class: 'xs muted' }, '1인분')),
    rcLines,
    h('div', { class: 'mb-rc-row mb-rc-total' }, h('span', null, '재료 원가'), h('span', null, rcCost, '원 ', rcRange)),
    h('label', { class: 'mb-rc-row' }, h('span', null, '판매가'), h('span', { class: 'mb-price' }, price, '원')),
    h('div', { class: 'mb-rc-row mb-rc-ratio' }, h('span', null, '원가율'), h('span', null, rcRatio)),
    rcHint);
  const adjustPanel = h('section', { class: 'sheet mb-adjust', 'aria-label': '양 조절과 원가' },
    h('div', { class: 'mb-adjust-h' }, h('h2', { class: 'mb-h' }, h('span', { class: 'mb-step' }, '3'), '양 조절'), portion),
    rows, receipt, category, save);

  /* 휴대폰: 화면 아래에 원가 한 줄 고정 */
  const stickyText = h('span', { class: 'small' });
  const sticky = h('div', { class: 'mb-sticky', hidden: true },
    stickyText, h('button', { class: 'btn sm', type: 'button', onclick: () => receipt.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }) }, '영수증 보기'));

  const stepNames = ['메뉴 고르기', '그릇 채우기', '양·가격 맞추기', '저장'];
  const steps = stepNames.map((t, i) => h('li', { class: 'mb-stp' }, h('span', { class: 'mb-stp-n' }, String(i + 1)), h('span', null, t)));
  const stepper = h('ol', { class: 'mb-stepper', 'aria-label': '진행 단계' }, steps);
  box.append(h('div', { class: 'mb-stage' },
    h('div', { class: 'mb-top' },
      h('a', { class: 'btn ghost sm', href: '#/menus' }, icon('back', 18), '메뉴 목록'),
      h('h1', { class: 'mb-title' }, 'Build your ', h('em', null, 'bowl.'), h('span', { class: 'mb-title-ko' }, '그릇 채우기로 메뉴 만들기'))),
    stepper,
    h('div', { class: 'mb-grid' }, findPanel, bowlPanel, adjustPanel)),
    sticky);
  const setStep = (n) => steps.forEach((el, i) => { el.classList.toggle('done', i < n); el.classList.toggle('now', i === n); });

  /* ---------------- 재료 한 줄 ---------------- */
  function makeLine(src, touched = false) {
    const ing = src.match ? ingById.get(src.match.id) : null;
    return {
      key: ++uid, name: src.name, alias: src.name, unit: src.unit, kind: src.kind,
      base: src.qty, low: src.qty_low ?? src.qty, high: src.qty_high ?? src.qty, qty: src.qty,
      touched, ingId: ing ? ing.id : null, conf: src.confidence, note: src.note || '', fresh: true,
    };
  }
  const ingOf = (ln) => (ln.ingId ? ingById.get(ln.ingId) : null);
  const lineCost = (ln) => {
    const ing = ingOf(ln);
    return ing && ing.unit_price != null ? ln.qty * effUnitCost(ing.unit_price, ing.yield_pct) : null;
  };
  const rangeOf = (ln) => [Math.min(ln.low, ln.qty), Math.max(ln.high, ln.qty)];

  async function loadTemplate(it) {
    try {
      const t = await api(`/api/recipe/template?id=${encodeURIComponent(it.id)}`);
      const prev = picked;
      picked = { id: it.id, name: t.name, source: t.source, serving_note: t.serving_note };
      lines = t.lines.map((l) => makeLine(l));
      if (!menuName.value.trim() || (prev && menuName.value.trim() === prev.name)) menuName.value = t.name;
      if (!category.value.trim() && t.category) category.value = t.category;
      runSearch();
      paintAll();
      if (window.matchMedia('(max-width: 899px)').matches) bowlPanel.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  function removeLine(key) {
    const chip = bowl.querySelector(`[data-key="${key}"]`);
    const done = () => { lines = lines.filter((l) => l.key !== key); paintAll(); };
    if (chip && !REDUCED) { chip.classList.add('out'); setTimeout(done, 180); } else done();
  }

  /* ---------------- 그리기 ---------------- */
  /* 그릇 속 자리: 가장 많은 재료는 가운데, 나머지는 안쪽·바깥 고리에 고르게 놓습니다(위에서 본 타원 그릇). */
  function slots(n) {
    const out = [[50, 50]];
    const inner = Math.min(n - 1, 6);
    for (let i = 0; i < inner; i++) {
      const a = (i / inner) * Math.PI * 2 - Math.PI / 2;
      out.push([50 + 27 * Math.cos(a), 50 + 31 * Math.sin(a)]);
    }
    const outer = n - 1 - inner;
    for (let i = 0; i < outer; i++) {
      const a = (i / outer) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(outer, 1);
      out.push([50 + 41 * Math.cos(a), 50 + 39 * Math.sin(a)]);
    }
    return out;
  }

  function paintBowl() {
    bowl3d.style.setProperty('--soup', soupOf(picked?.name || menuName.value));
    bowl3d.classList.toggle('full', lines.length > 0);
    if (!lines.length) {
      fill(bowl, h('p', { class: 'mb-empty' }, '메뉴를 고르면', h('br'), '재료가 여기로 날아와요'));
      bowlNote.textContent = '';
      return;
    }
    const w = (l) => (l.kind === 'ea' ? 60 * l.qty : l.qty);
    const total = lines.reduce((s2, l) => s2 + w(l), 0) || 1;
    const order = [...lines].sort((a, b) => w(b) - w(a));
    const pos = slots(order.length);
    const soupBox = bowl.getBoundingClientRect();
    const from = findPanel.getBoundingClientRect();
    const fromX = from.left + from.width / 2;
    const fromY = from.top + Math.min(from.height / 2, 200);
    let fresh = 0;
    fill(bowl, order.map((ln, i) => {
      const share = w(ln) / total;
      const size = Math.round(Math.max(40, Math.min(84, 34 + share * 150)));
      const [x, y] = pos[i];
      const [c1, c2] = toneOf(ln.name);
      const px = soupBox.left + (soupBox.width * x) / 100;
      const py = soupBox.top + (soupBox.height * y) / 100;
      const narrow = window.matchMedia('(max-width: 899px)').matches;
      const fx = narrow ? 0 : fromX - px;
      const fy = narrow ? -260 : fromY - py;
      const tok = h('div', {
        class: `mb-tok${ingOf(ln) ? '' : ' unlinked'}${ln.fresh ? ' fly' : ''}${i < 3 ? ' big' : ''}`, role: 'listitem', 'data-key': ln.key,
        style: { left: `${x}%`, top: `${y}%`, '--z': String(size), '--c1': c1, '--c2': c2, '--fx': `${fx}px`, '--fy': `${fy}px`, '--d': `${(ln.fresh ? fresh++ : 0) * 90}ms`, 'z-index': String(100 - i) },
      },
      h('button', { class: 'mb-blob', type: 'button', onclick: () => focusRow(ln.key), 'aria-label': `${ln.name} ${n3(ln.qty)}${ln.unit}, 양 조절로 가기` },
        picOf(ln.name) ? h('img', { src: picOf(ln.name), alt: '', loading: 'lazy', draggable: false }) : null),
      h('span', { class: 'mb-tag' }, h('b', null, ln.name), ' ', h('span', { class: 'mb-chip-q' }, `${n3(ln.qty)}${ln.unit}`),
        h('button', { class: 'mb-chip-x', type: 'button', 'aria-label': `${ln.name} 빼기`, onclick: () => removeLine(ln.key) }, '×')));
      ln.fresh = false;
      return tok;
    }));
    const unl = lines.filter((l) => !ingOf(l)).length;
    bowlNote.textContent = [picked ? `${picked.source} · ${picked.serving_note}` : '', unl ? `점선 재료 ${unl}개는 내 식자재와 아직 연결되지 않았어요` : '']
      .filter(Boolean).join(' · ');
  }

  function focusRow(key) {
    const row = rows.querySelector(`[data-key="${key}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    row.querySelector('input[type=range]')?.focus({ preventScroll: true });
  }

  function rowFor(ln) {
    const [lo, hi] = rangeOf(ln);
    const max = Math.max(hi * 1.8, ln.qty * 1.2, DEFAULT_QTY[ln.kind]);
    const step = niceStep(max);
    const slider = h('input', { type: 'range', min: 0, max: String(max), step: String(step), value: String(ln.qty), 'aria-label': `${ln.name} 양(${ln.unit})` });
    const num = numInput({ value: n3(ln.qty), 'aria-label': `${ln.name} 양 숫자로 입력(${ln.unit})` });
    const tag = h('span', { class: 'tag est' }, '추정');
    const cost = h('span', { class: 'xs mb-row-cost' });
    const sameKind = ings.filter((i) => i.kind === ln.kind);
    const link = selectOf([['new', '새 식자재로 등록'], ...sameKind.map((i) => [String(i.id), i.unit_price == null ? `${i.name} (단가 없음)` : i.name])],
      ln.ingId ? String(ln.ingId) : 'new', { 'aria-label': `${ln.name}에 연결할 내 식자재`, class: 'select mb-link' });
    const band = () => {
      const [a, b] = rangeOf(ln);
      slider.style.setProperty('--lo', `${(a / max) * 100}%`);
      slider.style.setProperty('--hi', `${(b / max) * 100}%`);
      slider.classList.toggle('touched', ln.touched);
      tag.hidden = ln.touched;
      const c = lineCost(ln);
      cost.textContent = c == null ? (ingOf(ln) ? '단가 없음' : '새 재료 · 단가 없음') : `${n0(c)}원`;
    };
    const set = (v, from) => {
      if (!(v >= 0)) return;
      ln.qty = v;
      ln.touched = true;
      if (from !== 'num') num.value = n3(v);
      if (from !== 'slider') slider.value = String(Math.min(v, max));
      band();
      paintChipQty(ln);
      paintReceipt();
    };
    slider.addEventListener('input', () => set(Number(slider.value), 'slider'));
    num.addEventListener('input', () => { const v = parseNum(num.value); if (v > 0) set(v, 'num'); });
    link.addEventListener('change', () => { ln.ingId = link.value === 'new' ? null : Number(link.value); band(); paintBowl(); paintReceipt(); });
    const row = h('div', { class: 'mb-row', 'data-key': ln.key },
      h('div', { class: 'mb-row-h' }, h('b', null, ln.name), tag, cost,
        h('button', { class: 'mb-chip-x', type: 'button', 'aria-label': `${ln.name} 빼기`, onclick: () => removeLine(ln.key) }, '×')),
      h('div', { class: 'mb-row-ctl' }, slider, h('span', { class: 'mb-num' }, num, h('span', { class: 'xs muted' }, ln.unit))),
      link,
      ln.note ? h('p', { class: 'xs muted' }, ln.note) : null);
    row.sync = () => { slider.value = String(Math.min(ln.qty, max)); num.value = n3(ln.qty); band(); };
    band();
    return row;
  }

  function paintChipQty(ln) {
    const q = bowl.querySelector(`[data-key="${ln.key}"] .mb-chip-q`);
    if (q) q.textContent = `${n3(ln.qty)}${ln.unit}`;
  }

  function paintRows() {
    if (!lines.length) { fill(rows, h('p', { class: 'small muted' }, '재료가 담기면 여기서 양을 맞춰요. 회색 띠는 보통 쓰는 양의 범위예요.')); return; }
    fill(rows, lines.map(rowFor));
  }

  function paintReceipt() {
    const parts = lines.map((ln) => {
      const ing = ingOf(ln);
      const [lo, hi] = rangeOf(ln);
      return { unitPrice: ing ? ing.unit_price : null, yieldPct: ing ? ing.yield_pct : 100, qty: ln.qty, est: !ln.touched, low: lo, high: hi };
    });
    const p = parseNum(price.value) || 0;
    const t = menuTotals(parts, 0, p, vat, target);
    const priced = lines.map((ln) => [ln, lineCost(ln)]).filter(([, c]) => c != null).sort((a, b) => b[1] - a[1]);
    fill(rcLines,
      priced.slice(0, 3).map(([ln, c]) => h('li', null, h('span', null, ln.name), h('span', { class: 'n' }, `${n0(c)}원`))),
      priced.length > 3 ? h('li', { class: 'muted' }, h('span', null, `외 ${priced.length - 3}개`), h('span', { class: 'n' }, `${n0(priced.slice(3).reduce((s, [, c]) => s + c, 0))}원`)) : null);
    rollTo(rcCost, priced.length ? t.cost : null, n0);
    rcRange.textContent = t.costLow != null && Math.round(t.costLow) !== Math.round(t.costHigh) ? `(${n0(t.costLow)}~${n0(t.costHigh)})` : '';
    rollTo(rcRatio, t.ratio, (v) => `${n1(v)}%${t.missing ? ' 이상' : ''}`);
    rcRatio.dataset.status = t.missing && t.status === 'good' ? 'unknown' : t.status; // 단가 없는 재료가 있으면 '양호'로 단정하지 않음
    const hints = [];
    if (t.missing) hints.push(`단가 없는 재료 ${t.missing}개는 빠져 있어 실제 원가는 더 높아요. 명세서를 올리면 채워집니다.`);
    if (t.ratio == null && priced.length) hints.push('판매가를 넣으면 원가율이 나와요.');
    if (t.recommended && priced.length) hints.push(`목표 원가율 ${target}%면 권장 판매가는 약 ${n0(t.recommended)}원이에요.`);
    rcHint.textContent = hints.join(' ');
    setStep(!lines.length ? 0 : (!lines.some((l) => l.touched) && !(p > 0)) ? 1 : 2);
    receipt.classList.toggle('printed', lines.length > 0);
    save.textContent = lines.length ? `재료 ${lines.length}개로 메뉴 저장` : '재료를 담아 주세요';
    save.disabled = !lines.length || !canWrite;
    sticky.hidden = !lines.length;
    stickyText.textContent = `1인분 ${priced.length ? `${n0(t.cost)}원` : '–'}${t.ratio != null ? ` · 원가율 ${n1(t.ratio)}%` : ''}`;
  }

  function paintAll() {
    paintBowl();
    paintRows();
    paintReceipt();
  }
  price.addEventListener('input', paintReceipt);

  const saveKey = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  save.addEventListener('click', () => busy(save, async () => {
    if (!menuName.value.trim()) { menuName.focus(); toast('메뉴 이름을 입력해 주세요.', 'err'); return; }
    const bad = lines.find((l) => !(l.qty > 0));
    if (bad) { focusRow(bad.key); toast(`'${bad.name}'의 양을 넣어 주세요. 안 쓰는 재료는 그릇에서 빼 주세요.`, 'err'); return; }
    const body = {
      name: menuName.value.trim(), price: parseNum(price.value) || 0, category: category.value.trim(),
      lines: lines.map((ln) => {
        const ing = ingOf(ln);
        const [lo, hi] = rangeOf(ln);
        const est = !ln.touched;
        return {
          apply: true, ingredient_id: ing ? ing.id : null, name: ing ? ing.name : ln.name, alias: ln.alias,
          qty: ln.qty, unit: ln.unit, estimated: est, qty_low: est ? lo : null, qty_high: est ? hi : null,
        };
      }),
    };
    const res = await api('/api/recipe/confirm', { method: 'POST', key: saveKey, body });
    showDone(res);
  }));

  function showDone(res) {
    const m = res.item;
    sticky.hidden = true;
    fill(box.querySelector('.mb-grid'),
      h('section', { class: 'sheet mb-done' },
        h('div', { class: 'sheet-h' }, h('h2', null, `'${m.name}' 메뉴를 만들었어요`)),
        h('p', null, `재료 ${m.item_count}개를 담았습니다.${res.created_ingredients ? ` 새 식자재 ${res.created_ingredients}개도 함께 등록했어요.` : ''}`),
        res.unpriced ? h('div', { class: 'note-warn', style: 'margin-top:10px' }, h('b', null, `단가가 없는 재료 ${res.unpriced}개. `), '거래명세서를 올리면 이름이 같은 재료의 단가가 자동으로 채워집니다.') : null,
        m.cost_ratio != null ? h('p', { style: 'margin-top:10px' }, '지금 원가율은 ', h('b', { class: 'n' }, `${n1(m.cost_ratio)}%`), '입니다.') : null,
        h('div', { class: 'btn-row', style: 'margin-top:16px' },
          h('a', { class: 'btn', href: `#/menus/${m.id}` }, '메뉴 열어 보기'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { box.replaceChildren(); render(box); } }, '다른 메뉴 만들기'))));
    window.scrollTo(0, 0);
  }

  paintAll();
  runSearch();
  q.focus({ preventScroll: true });
}
