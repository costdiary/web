/* 그릇 채우기: 메뉴 이름을 검색하면 보통 1인분 재료가 그릇에 담기고, 오른쪽에서 양을 맞추면 원가가 바로 바뀝니다.
   검색은 서버에 받아 둔 레시피(기본 레시피·공공 레시피·사장님들이 확정한 레시피)에서 찾으므로 사진 인식 횟수를 쓰지 않습니다.
   양은 모두 '추정'으로 시작하고, 사장님이 슬라이더나 숫자로 직접 고친 재료만 추정 표시가 빠집니다. */
import {
  h, api, app, numInput, selectOf, parseNum, n0, n1, n3, busy, toast, errMsg, icon, fill,
} from './core.js';
import { menuTotals, effUnitCost } from './calc.js';
import { PHOTO_SLUGS } from './ing_photos.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const UNIT_OF = { g: 'g', ml: 'ml', ea: '개' };
const DEFAULT_QTY = { g: 50, ml: 15, ea: 1 };

/* 숫자가 휙 바뀌지 않고 짧게 굴러가듯 바뀌게(0.25초). 움직임 줄이기 설정이면 바로 바꿉니다. */
function put(el, text) {
  if (el.tagName === 'INPUT') { if (document.activeElement !== el) el.value = text; } else el.textContent = text;
}
function rollTo(el, to, fmt) {
  const from = Number(el.dataset.v);
  el.dataset.v = String(to);
  if (to == null || Number.isNaN(to)) { put(el, '–'); return; }
  if (REDUCED || !Number.isFinite(from) || from === to) { put(el, fmt(to)); return; }
  const t0 = performance.now();
  const step = (t) => {
    if (el.dataset.v !== String(to)) return; // 그새 다른 값이 들어왔으면 멈춤
    const k = Math.min(1, (t - t0) / 250);
    const e = 1 - (1 - k) ** 3;
    put(el, fmt(from + (to - from) * e));
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
/* 손질된 재료 사진(위키미디어 공용, 상업적 이용 가능한 자유 이용 사진만 · 배경 지움 · static/img/ing/photo/CREDITS.txt).
   사진이 있는 재료는 사진을, 없으면 위 그림을 씁니다. */
const PHOTOS = [
  [/달걀|계란/, 'egg'], [/김치/, 'kimchi'], [/고춧가루/, 'gochugaru'], [/청양|풋고추|홍고추|고추$|고추 /, 'chili'],
  [/고추장/, 'gochujang'], [/된장|쌈장/, 'doenjang'], [/간장/, 'soysauce'], [/삼겹/, 'porkbelly'],
  [/닭/, 'chicken'], [/소고기|양지|등심|불고기|차돌|우삼겹/, 'beef'], [/돼지|앞다리|목살|뒷다리|제육|고기/, 'pork'],
  [/햄|스팸/, 'ham'], [/소시지|비엔나/, 'sausage'], [/새우/, 'shrimp'], [/오징어/, 'squid'], [/바지락|조개|홍합/, 'clam'],
  [/어묵/, 'fishcake'], [/당근/, 'carrot'], [/양파/, 'onion'], [/마늘/, 'garlic'], [/감자/, 'potato'],
  [/콩나물|숙주/, 'sprouts'], [/팽이/, 'enoki'], [/버섯/, 'mushroom'], [/애호박|호박/, 'zucchini'], [/오이/, 'cucumber'],
  [/단무지/, 'danmuji'], [/^무$|^무 |무\(/, 'radish'], [/양배추/, 'cabbage'], [/배추|우거지/, 'napa'], [/깻잎/, 'perilla'],
  [/시금치/, 'spinach'], [/부추/, 'chives'], [/대파|쪽파|실파|^파$|^파 |송송/, 'scallion'], [/두부/, 'tofu'], [/치즈/, 'cheese'],
  [/라면/, 'ramen'], [/당면/, 'dangmyeon'], [/떡/, 'tteok'], [/면|국수|사리|우동/, 'noodle'], [/밥|쌀/, 'rice'],
  [/깨$|통깨|참깨/, 'sesame'], [/토마토/, 'tomato'],
];
const HAVE_PHOTO = new Set(PHOTO_SLUGS);
const picOf = (name) => {
  const ph = PHOTOS.find(([re]) => re.test(name));
  if (ph && HAVE_PHOTO.has(ph[1])) return `/static/img/ing/photo/${ph[1]}.webp`;
  const hit = PICS.find(([re]) => re.test(name)); return hit ? `/static/img/ing/${hit[1]}.svg` : null;
};
const toneOf = (name) => (TONES.find(([re]) => re.test(name)) || [null, '#c9a27a', '#f0d8b8']).slice(1);
const SOUPS = [
  [/짜장|자장|춘장/, '#3a2213'], [/카레/, '#c8892c'], [/된장|뼈해장|감자탕/, '#8a5a2b'],
  [/김치|부대|순두부|육개장|짬뽕|떡볶이|라볶이|제육|오징어|낙지|주꾸미|닭갈비|닭볶음|비빔|쫄면|동태|찌개/, '#a5321f'],
  [/설렁|곰탕|사골|칼국수|국수|우동|냉면|쌀국수|국밥|북엇|무국|미역|갈비탕|순대국|어묵|계란찜/, '#d9c39a'],
  [/스파게티|토마토/, '#b23a24'], [/까르보|크림/, '#efe2c4'],
];
const soupOf = (name) => (SOUPS.find(([re]) => re.test(name || '')) || [null, '#e8dcc4'])[1];

/* 양념은 꾹 눌러 붓지 않고 숟가락으로 넣습니다. 한 번 누르면 1작은술(=1/3큰술), 누르고 있으면 한 숟갈씩 이어서.
   숫자는 1큰술의 대략 무게(g). 액체(ml)는 1큰술=15ml. 가게마다 숟가락이 달라 '약'으로 보여 줍니다. */
const SPOON = [
  [/고춧가루/, 7], [/설탕/, 12], [/소금/, 15], [/후추|후춧/, 6], [/깨$|통깨|참깨/, 8], [/다진\s?마늘|다진\s?생강/, 15],
  [/고추장|된장|춘장|쌈장|다대기|양념장/, 18], [/굴소스|물엿|올리고당|조청/, 20], [/케첩|마요|소스|머스타드|겨자/, 16],
  [/간장|식초|맛술|미림|기름|액젓|청주|소주|레몬즙/, 15], [/가루|전분|조미료|다시다|미원/, 8],
];
const LIQUID = /간장|식초|맛술|미림|기름|액젓|청주|소주|즙/;
const spoonOf = (ln) => {
  if (ln.kind === 'ea' || ln.base > 60) return null;
  const hit = SPOON.find(([re]) => re.test(ln.name));
  return hit ? (ln.kind === 'ml' ? 15 : hit[1]) : null;
};
/* 재료 성질에 따라 넣는 동작이 다릅니다.
   spoon: 양념 → 숟가락, 누를 때마다 1작은술 / ladle: 육수·양념장·소스 → 국자, 누를 때마다 한 국자
   pour: 간장·기름·우유 같은 액체 → 꾹 누르는 동안 따르기 / piece: 개수 재료 → 하나씩 올리기
   grab: 김치·고기·채소·면 같은 건더기 → 집게(밥은 주걱)로 한 번에 한 집게씩 올리기 */
const LADLE = /육수|국물|양념장|소스$|카레|짜장|드레싱|다시$/;
const POUR = /간장|식초|맛술|미림|기름|액젓|청주|소주|즙|우유|생크림|^물$/;
const niceAmt = (x) => (x >= 20 ? Math.max(5, Math.round(x / 5) * 5) : x >= 5 ? Math.round(x) : Math.max(0.5, Math.round(x * 2) / 2));
function modeOf(ln) {
  const sp = spoonOf(ln);
  if (sp) return { kind: 'spoon', step: sp / 3, tool: '숟가락' };
  if (ln.batch || LADLE.test(ln.name)) return { kind: 'ladle', step: niceAmt(ln.base / 2), tool: '국자' };
  if (ln.kind === 'ml' || POUR.test(ln.name)) return { kind: 'pour', step: null, tool: '' };
  if (ln.kind === 'ea') return { kind: 'piece', step: ln.base < 1 ? 0.5 : 1, tool: '' };
  const rice = /^쌀$|밥/.test(ln.name);
  return { kind: 'grab', step: niceAmt(ln.base / (rice ? 2 : 5)), tool: rice ? '주걱' : '집게' };
}
/* 0.33 → '1작은술', 1 → '1큰술', 1.67 → '1큰술 2작은술' */
const spoonText = (tbsp) => {
  const tsp = Math.round(tbsp * 3);
  if (!tsp) return '한 꼬집';
  const T = Math.floor(tsp / 3); const t = tsp % 3;
  return [T ? `${T}큰술` : '', t ? `${t}작은술` : ''].filter(Boolean).join(' ');
};

export async function render(box) {
  const [ingRes, prepRes] = await Promise.all([api('/api/ingredients'), api('/api/preps').catch(() => ({ items: [] }))]);
  const ings = ingRes.items;
  const preps = prepRes.items; // 양념장·육수처럼 한 통 만들어 두는 것(프렙 레시피)
  const ingById = new Map(ings.map((i) => [i.id, i]));
  const canWrite = app.me.plan.writable;
  const { target_cost_ratio: target, vat_mode: vat } = app.me.settings;

  /** @type {Array<any>} */
  let lines = [];
  let picked = null; // { name, source, serving_note }
  let uid = 0;
  let held = null; // 손에 든 재료(line key)
  const rowMap = new Map(); // key → 오른쪽 줄

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
          h('span', { class: 'xs muted' }, it.count ? `${it.source} · 재료 ${it.count}개` : it.source))))
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

  /* 양념장 한 통: 프렙 레시피로 만들어 둔 양념장을 '한 통이 몇 인분인지'로 나눠 1인분만 담습니다. */
  const sauceSel = selectOf(preps.map((pr) => [String(pr.id), pr.name]), preps[0] ? String(preps[0].id) : '', { 'aria-label': '양념장', class: 'select' });
  const sauceN = numInput({ placeholder: '인분', value: '', 'aria-label': '한 통으로 몇 인분' });
  const sauceNote = h('p', { class: 'xs muted mb-sauce-note' });
  const prepOf = (id) => preps.find((pr) => pr.id === Number(id));
  const unitOfKind = (k) => UNIT_OF[k] || 'g';
  const paintSauceNote = () => {
    const pr = prepOf(sauceSel.value); const n = parseNum(sauceN.value);
    if (!pr) { sauceNote.textContent = ''; return; }
    const u = unitOfKind(pr.unit_kind);
    sauceNote.textContent = n > 0 ? `한 통 ${n3(pr.yield_qty)}${u} ÷ ${n0(n)}인분 = 1인분 ${n3(pr.yield_qty / n)}${u}${pr.unit_price != null ? ` · ${n0((pr.yield_qty / n) * pr.unit_price)}원` : ''}`
      : `한 통 ${n3(pr.yield_qty)}${u}. 한 통으로 몇 인분 나오는지 넣어 주세요.`;
  };
  sauceSel.addEventListener('change', paintSauceNote);
  sauceN.addEventListener('input', paintSauceNote);
  const addSauce = () => {
    const pr = prepOf(sauceSel.value); const n = parseNum(sauceN.value);
    if (!pr) return;
    if (!(n > 0)) { sauceN.focus(); toast('한 통으로 몇 인분이 나오는지 넣어 주세요.', 'err'); return; }
    const per = Math.round((pr.yield_qty / n) * 10) / 10;
    const ln = makeLine({ name: pr.name, qty: per, qty_low: per * 0.9, qty_high: per * 1.1, unit: unitOfKind(pr.unit_kind), kind: pr.unit_kind, confidence: 'high', note: `양념장 한 통 ${n3(pr.yield_qty)}${unitOfKind(pr.unit_kind)}을 ${n0(n)}인분으로 나눈 양`, match: { id: pr.ingredient_id } }, true);
    ln.batch = { total: pr.yield_qty, n };
    lines.push(ln);
    paintAll();
  };
  const saucePanel = h('div', { class: 'mb-add mb-sauce' },
    h('p', { class: 'xs muted', style: 'margin-bottom:6px' }, '양념장 한 통으로 넣기'),
    preps.length
      ? [h('div', { class: 'mb-add-row' }, sauceSel, sauceN, h('button', { class: 'btn sm ghost', type: 'button', onclick: addSauce, 'aria-label': '양념장 1인분 담기' }, icon('plus', 16))), sauceNote]
      : h('p', { class: 'xs muted' }, '양념장을 한 통씩 만들어 쓰신다면 ', h('a', { href: '#/preps/new' }, '프렙 레시피'), '에 한 통 기준으로 적어 두세요. 여기서 인분 수로 나눠 1인분만 담을 수 있어요.'));
  paintSauceNote();

  const findPanel = h('section', { class: 'sheet mb-find', 'aria-label': '메뉴 찾기' },
    h('h2', { class: 'mb-h' }, h('span', { class: 'mb-step' }, '1'), '메뉴 찾기'),
    h('div', { class: 'search' }, icon('search', 18), q),
    resultsHead, results,
    h('div', { class: 'mb-add' },
      h('p', { class: 'xs muted', style: 'margin-bottom:6px' }, '재료 하나씩 더하기'),
      h('div', { class: 'mb-add-row' }, addName, addKind, h('button', { class: 'btn sm ghost', type: 'button', onclick: addOne, 'aria-label': '재료 더하기' }, icon('plus', 16))),
      addList),
    saucePanel,
    h('p', { class: 'xs muted mb-photo' }, '요리 사진이 있다면 ', h('a', { href: '#/menus/photo' }, '사진으로 짐작하기'), '도 써 볼 수 있어요. (사진 인식 횟수 차감)'));

  /* ---------------- 가운데: 그릇 ---------------- */
  const menuName = h('input', { class: 'input mb-name', type: 'text', maxLength: 60, autocomplete: 'off', placeholder: '메뉴 이름', 'aria-label': '메뉴 이름' });
  const bowl = h('div', { class: 'mb-soup', role: 'list', 'aria-label': '그릇에 담긴 재료' });
  const scatter = h('div', { class: 'mb-scatter', 'aria-hidden': 'true' }); // 재료 조각들(넣은 횟수만큼 흩뿌려짐)
  const bowl3d = h('div', { class: 'mb-bowl3d' },
    h('div', { class: 'mb-light', 'aria-hidden': 'true' }),
    h('div', { class: 'mb-steam', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'mb-plate' }, h('div', { class: 'mb-rim' }, bowl)),
    h('div', { class: 'mb-shadow', 'aria-hidden': 'true' }));
  const bowlNote = h('p', { class: 'xs muted mb-bowl-note' });

  /* 표지판: 지금 무엇을 하면 되는지 한 줄로. 문구가 바뀌면 판이 한 번 뒤집힙니다. */
  const signText = h('span');
  const sign = h('p', { class: 'mb-sign', 'aria-live': 'polite' }, signText);

  /* 주방 저울: 손에 든 재료의 양을 크게 보여 주고, 보통 쓰는 양 범위 안인지 알려 줍니다. */
  const scPic = h('span', { class: 'mb-sc-pic', 'aria-hidden': 'true' });
  const scName = h('span', { class: 'mb-sc-name' });
  const scNum = numInput({ class: 'mb-sc-num n', 'aria-label': '양을 숫자로 입력' }); // 저울 숫자를 눌러 직접 입력
  const scUnit = h('span', { class: 'mb-sc-unit' });
  const scBand = h('span', { class: 'mb-sc-band' });
  const scMark = h('span', { class: 'mb-sc-mark' });
  const scState = h('span', { class: 'mb-sc-state' });
  const scSpoon = h('span', { class: 'mb-sc-spoon' });
  const scMinus = h('button', { class: 'mb-sc-btn', type: 'button', 'aria-label': '조금 덜기' }, '−');
  const scPlus = h('button', { class: 'mb-sc-btn', type: 'button', 'aria-label': '조금 더 담기' }, '+');
  const scDrop = h('button', { class: 'mb-sc-drop', type: 'button' }, '내려놓기');
  const scSound = h('button', { class: 'mb-sc-sound', type: 'button', 'aria-pressed': 'false' });
  const scale = h('div', { class: 'mb-scale', 'aria-label': '주방 저울' },
    h('div', { class: 'mb-sc-lcd' },
      h('div', { class: 'mb-sc-top' }, scPic, scName, scSound),
      h('div', { class: 'mb-sc-read', 'aria-live': 'off' }, scMinus, h('span', { class: 'mb-sc-val' }, scNum, scUnit, scSpoon), scPlus),
      h('div', { class: 'mb-sc-bar', 'aria-hidden': 'true' }, scBand, scMark),
      h('div', { class: 'mb-sc-foot' }, scState, scDrop)));

  /* 손: 집은 재료가 마우스를 따라다닙니다(마우스가 있는 화면에서만). */
  const hand = h('div', { class: 'mb-hand', 'aria-hidden': 'true' });

  const bowlPanel = h('section', { class: 'mb-mid', 'aria-label': '그릇' },
    h('p', { class: 'mb-kicker' }, '오늘의 한 그릇'), menuName, sign, bowl3d, scale, bowlNote,
    h('p', { class: 'mb-credit' }, '재료 사진: ', h('a', { href: '/static/img/ing/photo/CREDITS.txt', target: '_blank', rel: 'noopener' }, '위키미디어 공용 (사진별 작성자·이용 조건)'), ' · 그림: ', h('a', { href: 'https://github.com/jdecked/twemoji', target: '_blank', rel: 'noopener' }, 'Twemoji'), ' (CC-BY 4.0)'));

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
  const stage = h('div', { class: 'mb-stage' },
    h('div', { class: 'mb-top' },
      h('a', { class: 'btn ghost sm', href: '#/menus' }, icon('back', 18), '메뉴 목록'),
      h('h1', { class: 'mb-title' }, 'Build your ', h('em', null, 'bowl.'), h('span', { class: 'mb-title-ko' }, '그릇 채우기로 메뉴 만들기'))),
    stepper,
    h('div', { class: 'mb-grid' }, findPanel, bowlPanel, adjustPanel), hand);
  box.append(stage, sticky);
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
      lines = t.lines.map((l) => makeLine(l, !!l.confirmed));
      if (!menuName.value.trim() || (prev && menuName.value.trim() === prev.name)) menuName.value = t.name;
      if (!category.value.trim() && t.category) category.value = t.category;
      runSearch();
      paintAll();
      // 가장 많이 들어가는 재료를 바로 집어 저울에 올려 둡니다.
      const first = [...lines].sort((a, b) => (b.kind === 'ea' ? 60 * b.qty : b.qty) - (a.kind === 'ea' ? 60 * a.qty : a.qty))[0];
      if (first) pickUp(first.key);
      if (window.matchMedia('(max-width: 899px)').matches) bowlPanel.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  function removeLine(key) {
    if (held === key) putDown();
    const chip = bowl.querySelector(`.mb-tok[data-key="${key}"]`);
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
      scatter.replaceChildren();
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
    fill(bowl, scatter, ...order.map((ln, i) => {
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
        class: `mb-tok${ingOf(ln) ? '' : ' unlinked'}${ln.fresh ? ' fly' : ''}${i < 3 ? ' big' : ''}${held === ln.key ? ' held' : ''}`, role: 'listitem', 'data-key': ln.key,
        style: { left: `${x}%`, top: `${y}%`, '--z': String(size), '--c1': c1, '--c2': c2, '--fx': `${fx}px`, '--fy': `${fy}px`, '--d': `${(ln.fresh ? fresh++ : 0) * 90}ms`, 'z-index': String(100 - i) },
      },
      h('button', { class: 'mb-blob', type: 'button', onclick: (e) => { if (held !== ln.key && (held == null || e.detail === 0)) pickUp(ln.key); }, 'aria-label': `${ln.name} ${n3(ln.qty)}${ln.unit}, 집어서 붓기`, 'aria-pressed': String(held === ln.key) },
        picOf(ln.name) ? h('img', { src: picOf(ln.name), alt: '', loading: 'lazy', draggable: false }) : null),
      h('span', { class: 'mb-tag' }, h('b', null, ln.name), ' ', h('span', { class: 'mb-chip-q' }, `${n3(ln.qty)}${ln.unit}`),
        h('button', { class: 'mb-chip-x', type: 'button', 'aria-label': `${ln.name} 빼기`, onclick: () => removeLine(ln.key) }, '×')));
      ln.fresh = false;
      return tok;
    }));
    paintPieces();
    const unl = lines.filter((l) => !ingOf(l)).length;
    bowlNote.textContent = [picked ? `${picked.source} · ${picked.serving_note}` : '', unl ? `점선 재료 ${unl}개는 내 식자재와 아직 연결되지 않았어요` : '']
      .filter(Boolean).join(' · ');
  }

  /* 조각 흩뿌리기: 건더기는 한 집게(또는 한 개)마다 조각 하나가 그릇 위 아무 데나 떨어집니다.
     자리는 재료마다 같은 씨앗으로 정해서 다시 그려도 제자리에 있습니다. 액체·양념은 조각 대신 국물 색으로만. */
  const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function pieceCount(ln) {
    const m = modeOf(ln);
    if (m.kind === 'grab') return Math.max(1, Math.min(14, Math.round(ln.qty / m.step)));
    if (m.kind === 'piece') return Math.max(1, Math.min(8, Math.ceil(ln.qty)));
    return 0;
  }
  function paintPieces(only) {
    const todo = only ? [only] : lines;
    if (!only) for (const el of [...scatter.children]) if (!lines.some((l) => String(l.key) === el.dataset.key)) el.remove();
    for (const ln of todo) {
      const have = [...scatter.querySelectorAll(`[data-key="${ln.key}"]`)];
      const want = pieceCount(ln);
      for (const el of have.slice(want)) el.remove();
      const pic = picOf(ln.name);
      const rnd = seeded(ln.key * 7919);
      for (let i = 0; i < want; i++) {
        const r = Math.sqrt(rnd()) * 40; const a = rnd() * Math.PI * 2; const rot = rnd() * 360; const sz = 0.75 + rnd() * 0.5;
        if (i < have.length) continue;
        const el = h('span', { class: `mb-pc${only && !REDUCED ? ' land' : ''}`, 'data-key': ln.key,
          style: { left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%`, '--r': `${rot}deg`, '--s': String(sz) } },
        pic ? h('img', { src: pic, alt: '', draggable: false }) : h('i', { style: { background: toneOf(ln.name)[0] } }));
        scatter.append(el);
      }
    }
  }

  function flashRow(row) {
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }

  /* 오른쪽 목록: 재료마다 한 줄(이름·양·원가). 양은 그릇 아래 저울 하나에서만 바꿉니다(같은 재료를 두 곳에서 고치지 않도록).
     줄을 누르면 그 재료를 집고, 집은 줄에서만 '내 식자재 연결'을 고를 수 있어요. */
  function rowFor(ln) {
    const tag = h('span', { class: 'tag est' }, '추정');
    const qty = h('span', { class: 'mb-row-q n' });
    const cost = h('span', { class: 'xs mb-row-cost' });
    const sameKind = ings.filter((i) => i.kind === ln.kind);
    const link = selectOf([['new', '새 식자재로 등록'], ...sameKind.map((i) => [String(i.id), i.unit_price == null ? `${i.name} (단가 없음)` : i.name])],
      ln.ingId ? String(ln.ingId) : 'new', { 'aria-label': `${ln.name}에 연결할 내 식자재`, class: 'select mb-link' });
    const band = () => {
      tag.hidden = ln.touched;
      qty.textContent = `${n3(ln.qty)}${ln.unit}`;
      const c = lineCost(ln);
      cost.textContent = c == null ? (ingOf(ln) ? '단가 없음' : '새 재료') : `${n0(c)}원`;
    };
    link.addEventListener('change', () => { ln.ingId = link.value === 'new' ? null : Number(link.value); band(); paintBowl(); paintReceipt(); });
    const row = h('div', { class: 'mb-row', 'data-key': ln.key },
      h('div', { class: 'mb-row-h' },
        h('button', { class: 'mb-pick', type: 'button', onclick: () => (held === ln.key ? putDown() : pickUp(ln.key, true)), 'aria-label': `${ln.name} 집기` },
          h('b', null, ln.name), tag),
        qty, cost,
        h('button', { class: 'mb-chip-x', type: 'button', 'aria-label': `${ln.name} 빼기`, onclick: () => removeLine(ln.key) }, '×')),
      h('div', { class: 'mb-row-more' }, h('label', { class: 'xs muted' }, '내 식자재 연결 ', link), ln.note ? h('p', { class: 'xs muted' }, ln.note) : null));
    row.sync = band;
    band();
    row.classList.toggle('held', held === ln.key);
    rowMap.set(ln.key, row);
    return row;
  }

  function paintChipQty(ln) {
    const q = bowl.querySelector(`.mb-tok[data-key="${ln.key}"] .mb-chip-q`);
    if (q) q.textContent = `${n3(ln.qty)}${ln.unit}`;
  }

  function paintRows() {
    if (!lines.length) { fill(rows, h('p', { class: 'small muted' }, '재료가 담기면 여기서 양을 맞춰요. 회색 띠는 보통 쓰는 양의 범위예요.')); return; }
    rowMap.clear();
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
    const hl = held != null ? lines.find((l) => l.key === held) : null; // 휴대폰에서 부을 때 저울이 화면 밖이어도 무게가 보이게
    sticky.classList.toggle('held', !!hl);
    stickyText.textContent = `${hl ? `${hl.name} ${n3(hl.qty)}${hl.unit} · ` : ''}1인분 ${priced.length ? `${n0(t.cost)}원` : '–'}${t.ratio != null ? ` · 원가율 ${n1(t.ratio)}%` : ''}`;
  }

  /* ---------------- 집어서 담기 ----------------
     재료를 눌러 손에 들고 그릇을 누르면 담깁니다. 넣는 동작은 재료 성질(modeOf)에 따라 다릅니다:
     액체는 꾹 누르는 동안 따라지고(오래 누를수록 빨리, 1배 → 2배 → 3.5배), 건더기는 집게로 한 번에 한 집게씩,
     양념은 숟가락으로 1작은술씩, 육수·양념장은 국자로 한 국자씩 들어갑니다. 손을 떼면 멈춥니다. 키보드로는 그릇에 초점을 두고 스페이스/엔터를 누르고 있으면 됩니다. */
  const lineOf = (key) => lines.find((l) => l.key === key);
  const tspOf = (ln) => { const sp = spoonOf(ln); return sp ? sp / 3 : null; };
  const stepOf = (ln) => modeOf(ln).step; // null 이면 꾹 누르는 동안 계속 따르기
  const fineStep = (ln) => tspOf(ln) ?? (ln.kind === 'ea' ? 0.5 : ln.base >= 100 ? 5 : ln.base >= 20 ? 1 : 0.5);
  const pourGrain = (ln) => (spoonOf(ln) ? 0.1 : ln.kind === 'ea' ? 0.5 : ln.base >= 20 ? 1 : 0.5);
  const capOf = (ln) => Math.max(ln.high * 4, DEFAULT_QTY[ln.kind] * 4);
  const where = (ln) => (ln.qty < ln.low * 0.999 ? 'low' : ln.qty > ln.high * 1.001 ? 'high' : 'ok');

  let rcFrame = 0;
  const queueReceipt = () => { if (!rcFrame) rcFrame = requestAnimationFrame(() => { rcFrame = 0; paintReceipt(); }); };

  /* 양이 바뀔 때마다: 그릇 속 크기, 이름표 숫자, 저울, 영수증만 고칩니다(전체를 다시 그리지 않음). */
  function afterQty(ln) {
    paintChipQty(ln);
    paintPieces(ln);
    resizeTokens();
    if (held === ln.key) paintScale();
    queueReceipt();
  }
  function setQty(ln, v) {
    ln.qty = Math.max(0, Math.min(capOf(ln), v));
    ln.touched = true;
    rowMap.get(ln.key)?.sync();
    afterQty(ln);
  }
  function resizeTokens() {
    const w = (l) => (l.kind === 'ea' ? 60 * l.qty : l.qty);
    const total = lines.reduce((s2, l) => s2 + w(l), 0) || 1;
    for (const ln of lines) {
      const tok = bowl.querySelector(`.mb-tok[data-key="${ln.key}"]`);
      if (tok) tok.style.setProperty('--z', String(Math.round(Math.max(40, Math.min(84, 34 + (w(ln) / total) * 150)))));
    }
  }

  function signFor(ln) {
    const m = modeOf(ln);
    if (m.kind === 'spoon') return `${ln.name} 숟가락으로 떴어요 · 그릇을 누를 때마다 1작은술`;
    if (m.kind === 'ladle') return `${ln.name} 국자로 떴어요 · 누를 때마다 한 국자(${n3(m.step)}${ln.unit})`;
    if (m.kind === 'pour') return `${ln.name} 들었어요 · 그릇을 꾹 누르는 동안 따라져요`;
    if (m.kind === 'piece') return `${ln.name} 들었어요 · 누를 때마다 ${n3(m.step)}개씩 올라가요`;
    return `${ln.name} ${m.tool === '주걱' ? '주걱으로 펐어요' : '집게로 집었어요'} · 누를 때마다 한 ${m.tool}(약 ${n3(m.step)}${ln.unit})`;
  }
  const countText = (ln) => {
    const m = modeOf(ln);
    if (m.kind === 'spoon') return `약 ${spoonText(ln.qty / (m.step * 3))}`;
    if (m.kind === 'ladle' || m.kind === 'grab') return `약 ${n1(Math.round((ln.qty / m.step) * 2) / 2).replace(/\.0$/, '')}${m.tool}`;
    return '';
  };
  const handPic = (ln) => (modeOf(ln).kind === 'spoon' ? '/static/img/ing/1f944.svg' : picOf(ln.name));

  function paintSign() {
    const ln = held != null ? lineOf(held) : null;
    const text = !lines.length ? '메뉴를 고르면 재료가 그릇에 담겨요'
      : ln ? signFor(ln)
        : '재료 그림을 눌러 집어 보세요';
    if (signText.textContent === text) return;
    signText.textContent = text;
    sign.classList.toggle('on', !!ln);
    if (!REDUCED) { sign.classList.remove('flip'); void sign.offsetWidth; sign.classList.add('flip'); }
  }

  let lastWhere = 'ok';
  function paintScale() {
    paintSign();
    const ln = held != null ? lineOf(held) : null;
    scale.classList.toggle('on', !!ln);
    scale.hidden = !lines.length;
    bowl3d.classList.toggle('holding', !!ln);
    bowl3d.tabIndex = ln ? 0 : -1;
    if (!ln) bowl3d.setAttribute('aria-label', '그릇');
    for (const [k, row] of rowMap) row.classList.toggle('held', k === held);
    bowl.querySelectorAll('.mb-tok').forEach((t) => {
      const on = Number(t.dataset.key) === held;
      t.classList.toggle('held', on);
      t.querySelector('.mb-blob')?.setAttribute('aria-pressed', String(on));
    });
    if (!ln) {
      scName.textContent = '재료를 집으면 무게가 보여요';
      scNum.value = '0'; scNum.dataset.v = '0'; scNum.disabled = true; scUnit.textContent = 'g';
      scState.textContent = ''; scSpoon.textContent = ''; scPic.replaceChildren(); scale.classList.remove('spoon'); delete scale.dataset.key;
      scMinus.disabled = scPlus.disabled = true; scDrop.hidden = true;
      scale.dataset.where = 'ok';
      scBand.style.cssText = ''; scMark.style.left = '0%';
      lastWhere = 'ok';
      return;
    }
    if (scale.dataset.key !== String(ln.key)) {
      scale.dataset.key = String(ln.key);
      const pic = handPic(ln);
      scPic.replaceChildren(pic ? h('img', { src: pic, alt: '' }) : h('i', { style: { background: toneOf(ln.name)[0] } }));
      scName.textContent = ln.name;
      scNum.dataset.v = 'x'; // 다른 재료로 바꿔 들면 숫자를 굴리지 않고 바로 보여 줌
      lastWhere = where(ln);
    }
    scMinus.disabled = scPlus.disabled = false; scDrop.hidden = false; scNum.disabled = false;
    const md = modeOf(ln);
    const sp = md.kind === 'spoon';
    scale.classList.toggle('spoon', sp);
    scSpoon.textContent = [countText(ln), ln.batch ? `약 한 통의 1/${n0(Math.round(ln.batch.total / Math.max(ln.qty, 0.001)))}` : ''].filter(Boolean).join(' · ');
    scMinus.setAttribute('aria-label', sp ? '1작은술 덜기' : '조금 덜기');
    scPlus.setAttribute('aria-label', sp ? '1작은술 더 넣기' : '조금 더 담기');
    bowl3d.setAttribute('aria-label', `그릇. 스페이스: ${signFor(ln).split(' · ')[1]}`);
    scUnit.textContent = ln.unit;
    const g = pourGrain(ln);
    rollTo(scNum, ln.qty, (v) => n3(Math.round(v / g) * g));
    const top = Math.max(ln.high * 1.6, ln.qty * 1.1, 1);
    scBand.style.left = `${(ln.low / top) * 100}%`;
    scBand.style.width = `${((ln.high - ln.low) / top) * 100}%`;
    scMark.style.left = `${Math.min(100, (ln.qty / top) * 100)}%`;
    const wv = where(ln);
    scale.dataset.where = wv;
    scState.textContent = wv === 'ok' ? `보통 양이에요 (${n3(ln.low)}~${n3(ln.high)}${ln.unit})`
      : wv === 'high' ? `보통보다 많아요 · 보통 ${n3(ln.low)}~${n3(ln.high)}${ln.unit}`
        : `보통보다 적어요 · 보통 ${n3(ln.low)}~${n3(ln.high)}${ln.unit}`;
    if (wv !== lastWhere) {
      if (wv === 'high') { sfx('warn'); if (!REDUCED) { scale.classList.remove('wobble'); void scale.offsetWidth; scale.classList.add('wobble'); } }
      lastWhere = wv;
    }
  }

  function pickUp(key, fromRow = false) {
    queueReceipt();
    const ln = lineOf(key);
    if (!ln) return;
    held = key;
    const pic = handPic(ln);
    hand.dataset.mode = modeOf(ln).kind;
    hand.classList.toggle('spoon', modeOf(ln).kind === 'spoon');
    hand.replaceChildren(pic ? h('img', { src: pic, alt: '' }) : h('i', { style: { background: toneOf(ln.name)[0] } }));
    hand.classList.remove('pour');
    sfx('pick');
    paintScale();
    const row = rowMap.get(key);
    if (row) {
      flashRow(row);
      // 넓은 화면에서는 오른쪽 목록 안에서만 그 줄이 보이게, 휴대폰에서는 화면을 움직이지 않음
      if (!window.matchMedia('(max-width: 899px)').matches) {
        const r = row.getBoundingClientRect(); const b = rows.getBoundingClientRect();
        if (r.top < b.top || r.bottom > b.bottom) rows.scrollTop += r.top - b.top - (b.height - r.height) / 2;
      }
    }
    if (fromRow && window.matchMedia('(max-width: 899px)').matches) bowl3d.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  }
  function putDown() {
    stopPour();
    held = null;
    queueReceipt();
    hand.classList.remove('show', 'pour');
    paintScale();
  }

  /* 마우스가 있으면 손이 따라다님 */
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let handX = 0; let handY = 0;
  const placeHand = () => { hand.style.transform = `translate(${handX}px, ${handY}px)`; };
  stage.addEventListener('pointermove', (e) => {
    if (held == null || e.pointerType !== 'mouse' || !finePointer.matches) return;
    const r = stage.getBoundingClientRect();
    handX = e.clientX - r.left; handY = e.clientY - r.top;
    placeHand();
    hand.classList.add('show');
  });
  stage.addEventListener('pointerleave', () => hand.classList.remove('show'));

  /* 붓기 */
  let pour = null; // { ln, t0, last, acc, px, py, nextDrop, raf }
  function startPour(px, py) {
    const ln = held != null ? lineOf(held) : null;
    if (!ln || pour) return;
    const now = performance.now();
    pour = { ln, t0: now, last: now, acc: ln.qty, px, py, nextDrop: 0, nextTick: 0, raf: 0 };
    bowl3d.classList.add('pouring');
    hand.classList.add('pour');
    pour.raf = requestAnimationFrame(pourFrame);
  }
  function pourFrame(now) {
    if (!pour) return;
    const { ln } = pour;
    const secs = (now - pour.t0) / 1000;
    const m = modeOf(ln);
    if (m.step) { // 숟가락·국자·집게·하나씩: 누를 때마다 한 번, 누르고 있으면 이어서
      if (now >= pour.nextDrop) {
        setQty(ln, Math.round((ln.qty + m.step) * 10) / 10);
        if (m.kind === 'spoon') for (let i = 0; i < 6; i++) drop(ln, pour.px + (Math.random() - 0.5) * 18, pour.py, 'fine');
        else if (m.kind === 'ladle') for (let i = 0; i < 4; i++) drop(ln, pour.px + (Math.random() - 0.5) * 26, pour.py, 'splash');
        else drop(ln, pour.px, pour.py, 'chunk');
        if (!REDUCED) { hand.classList.remove('dip'); void hand.offsetWidth; hand.classList.add('dip'); }
        sfx('tick', m.kind === 'spoon' ? 0.6 : 0.2);
        pour.nextDrop = now + (secs < 1.2 ? 520 : 340);
      }
      pour.raf = requestAnimationFrame(pourFrame);
      return;
    }
    const speed = secs < 0.8 ? 1 : secs < 2 ? 2 : 3.5;
    const perSec = ln.kind === 'ea' ? 1 : Math.max(ln.base * 0.2, 2);
    pour.acc = Math.min(capOf(ln), pour.acc + perSec * speed * ((now - pour.last) / 1000));
    pour.last = now;
    const g = pourGrain(ln);
    const v = Math.round(pour.acc / g) * g;
    if (v !== ln.qty) setQty(ln, v);
    if (now >= pour.nextDrop) { drop(ln, pour.px + (Math.random() - 0.5) * 8, pour.py, 'stream'); pour.nextDrop = now + (speed > 2 ? 40 : speed > 1 ? 60 : 90); }
    if (now >= pour.nextTick) { sfx('tick', Math.min(1, secs / 2.5)); pour.nextTick = now + (speed > 2 ? 70 : 110); }
    pour.raf = requestAnimationFrame(pourFrame);
  }
  function stopPour() {
    if (!pour) return;
    cancelAnimationFrame(pour.raf);
    const { ln, swap } = pour;
    const quick = performance.now() - pour.t0 < 250;
    const was = pour;
    pour = null;
    if (swap != null && quick) {
      ln.qty = was.from; ln.touched = was.touched; queueReceipt();
      rowMap.get(ln.key)?.sync(); paintChipQty(ln); resizeTokens();
      bowl3d.classList.remove('pouring'); hand.classList.remove('pour');
      pickUp(swap);
      return;
    }
    bowl3d.classList.remove('pouring');
    hand.classList.remove('pour');
    const tok = bowl.querySelector(`.mb-tok[data-key="${ln.key}"]`);
    if (tok && !REDUCED) { tok.classList.remove('gulp'); void tok.offsetWidth; tok.classList.add('gulp'); }
    paintReceipt();
  }
  /* 떨어지는 알갱이: 손 위치에서 그릇으로 */
  function drop(ln, px, py, how = 'chunk') {
    if (REDUCED) return;
    const pic = how === 'chunk' ? picOf(ln.name) : null;
    const kind = how === 'fine' ? (LIQUID.test(ln.name) || ln.kind === 'ml' ? ' drip' : ' dust')
      : how === 'stream' || how === 'splash' ? ' drip' : ' chunk';
    const spread = how === 'stream' ? 6 : how === 'chunk' ? 20 : 40;
    const d = h('span', { class: `mb-drop${kind}`, 'aria-hidden': 'true', style: { left: `${px}px`, top: `${py}px`, '--dx': `${(Math.random() - 0.5) * spread}px`, '--rot': `${(Math.random() - 0.5) * 300}deg`, '--s': String(0.5 + Math.random() * 0.4) } },
      pic ? h('img', { src: pic, alt: '' }) : h('i', { style: { background: toneOf(ln.name)[0] } }));
    d.addEventListener('animationend', () => d.remove());
    bowl3d.append(d);
  }

  bowl3d.addEventListener('pointerdown', (e) => {
    if (held == null || e.button > 0) return;
    if (e.target.closest?.('.mb-chip-x')) return;
    e.preventDefault();
    try { bowl3d.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
    const r = bowl3d.getBoundingClientRect();
    const px = e.clientX - r.left; const py = e.clientY - r.top;
    startPour(px, py);
    // 다른 재료 위를 '톡' 누르면(짧게) 그 재료로 바꿔 들고, 꾹 누르면 들고 있던 재료를 붓습니다.
    const other = e.target.closest?.('.mb-tok');
    if (pour && other && Number(other.dataset.key) !== held) { pour.swap = Number(other.dataset.key); pour.from = pour.ln.qty; pour.touched = pour.ln.touched; }
  });
  bowl3d.addEventListener('pointermove', (e) => {
    if (!pour) return;
    const r = bowl3d.getBoundingClientRect();
    pour.px = e.clientX - r.left; pour.py = e.clientY - r.top;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) bowl3d.addEventListener(ev, stopPour);
  bowl3d.addEventListener('contextmenu', (e) => { if (held != null) e.preventDefault(); });
  bowl3d.addEventListener('keydown', (e) => {
    if (held == null || (e.key !== ' ' && e.key !== 'Enter') || e.target !== bowl3d) return;
    e.preventDefault();
    if (!pour) startPour(bowl3d.clientWidth / 2, bowl3d.clientHeight * 0.3);
  });
  bowl3d.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stopPour(); });
  bowl3d.addEventListener('blur', stopPour);
  stage.addEventListener('keydown', (e) => { if (e.key === 'Escape' && held != null) putDown(); });

  /* 저울의 −/+ : 한 번 누르면 한 칸, 누르고 있으면 계속 */
  function holdRepeat(btn, dir) {
    let t = 0;
    const once = () => { const ln = lineOf(held); if (ln) setQty(ln, Math.round((ln.qty + dir * fineStep(ln)) * 10) / 10); };
    const stop = () => { clearTimeout(t); t = 0; };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      once();
      const loop = (ms) => { t = setTimeout(() => { once(); loop(70); }, ms); };
      loop(380);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
    btn.addEventListener('click', (e) => { if (e.detail === 0) once(); }); // 키보드
  }
  scNum.addEventListener('input', () => {
    const ln = held != null ? lineOf(held) : null;
    const v = parseNum(scNum.value);
    if (ln && v >= 0) setQty(ln, v);
  });
  scNum.addEventListener('focus', () => scNum.select());
  holdRepeat(scMinus, -1);
  holdRepeat(scPlus, 1);
  scDrop.addEventListener('click', putDown);

  /* 소리: 기본은 꺼짐. 켜면 집을 때 '톡', 부을 때 '또르르', 많이 담으면 낮은 '부웅'. */
  let soundOn = false;
  try { soundOn = localStorage.getItem('mb-sound') === '1'; } catch { /* 저장소를 못 쓰는 창 */ }
  let actx = null;
  const paintSound = () => { scSound.setAttribute('aria-pressed', String(soundOn)); scSound.textContent = soundOn ? '소리 켬' : '소리 끔'; };
  scSound.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem('mb-sound', soundOn ? '1' : '0'); } catch { /* 무시 */ }
    paintSound();
    if (soundOn) sfx('pick');
  });
  paintSound();
  function sfx(kind, k = 0) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      const o = actx.createOscillator(); const gn = actx.createGain();
      o.connect(gn); gn.connect(actx.destination);
      if (kind === 'pick') { o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.08); gn.gain.setValueAtTime(0.08, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.start(t); o.stop(t + 0.13); }
      else if (kind === 'tick') { o.type = 'triangle'; o.frequency.setValueAtTime(320 + k * 420 + Math.random() * 40, t); gn.gain.setValueAtTime(0.045, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.start(t); o.stop(t + 0.06); }
      else { o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(110, t + 0.25); gn.gain.setValueAtTime(0.05, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.28); o.start(t); o.stop(t + 0.3); }
    } catch { /* 소리를 못 내는 환경 */ }
  }

  function paintAll() {
    if (held != null && !lines.some((l) => l.key === held)) held = null;
    paintBowl();
    paintRows();
    paintReceipt();
    paintScale();
  }
  price.addEventListener('input', paintReceipt);

  const saveKey = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  save.addEventListener('click', () => busy(save, async () => {
    if (!menuName.value.trim()) { menuName.focus(); toast('메뉴 이름을 입력해 주세요.', 'err'); return; }
    const bad = lines.find((l) => !(l.qty > 0));
    if (bad) { pickUp(bad.key, true); toast(`'${bad.name}'의 양을 넣어 주세요. 안 쓰는 재료는 그릇에서 빼 주세요.`, 'err'); return; }
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
