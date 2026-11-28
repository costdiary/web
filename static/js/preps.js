/* 미리 만든 재료(예전 이름 '프렙 레시피'): 육수·양념장·반죽처럼 미리 만들어 두고 여러 메뉴에 덜어 쓰는 것의 원가.
   g·ml당, 또는 1장·1국자당 원가로 바꿔 둡니다. 만들면 전용 식자재 한 줄이 자동으로 생겨,
   메뉴 재료 목록에서 식자재처럼 바로 쓸 수 있습니다. */
import { menuTabs } from './menutabs.js';
import {
  h, api, app, field, numInput, selectOf, parseNum, n0, n3, icon, go, refreshRoute, fill,
  confirmDialog, busy, toast, errMsg, UNIT, UI_UNITS, ALL_UNITS, segGroup,
} from './core.js';
import { emptyBlock, num, newTag, localSuggest } from './ui.js';

function prepRow(p) {
  const per = p.unit_kind === 'ea' ? (p.count_label || '개') : p.unit_kind;
  const sub = [p.unit_kind === 'ea' ? `한 번에 ${n3(p.yield_qty)}${per}` : `완성량 ${n3(p.yield_qty)}${per}`, `재료 ${p.items.length}개`, p.used_in_menus ? `메뉴 ${p.used_in_menus}개에 사용` : '아직 메뉴에 안 씀'].join(' · ');
  return h('li', null,
    h('a', { class: 'row', href: `#/preps/${p.id}` },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, p.name, newTag(p)),
        h('div', { class: 'row-sub' }, sub)),
      h('div', { class: 'row-end' },
        p.unit_price == null
          ? h('span', { class: 'tag bad' }, '단가 없음')
          : num(p.unit_kind === 'ea' ? n0(p.unit_price) : n3(p.unit_price), `원/${per}`))));
}

export async function renderList(box) {
  const { items } = await api('/api/preps');
  const canWrite = app.me.plan.writable;
  box.append(
    h('div', { class: 'page-h' },
      h('h1', null, '미리 만든 재료', h('span', { class: 'sub' }, `${items.length}개`))),
    menuTabs('#/preps'),
    h('div', { class: 'prep-intro' },
      h('p', null, h('b', null, '육수·양념장·반죽'), '처럼 미리 만들어 두고 여러 메뉴에 덜어 쓰는 것을 여기에 적어 두세요. 한 통 만드는 데 든 돈을 ', h('b', null, '1장·1국자·1g당'), ' 얼마인지로 바꿔서, 메뉴 원가에 식자재처럼 넣을 수 있어요.'),
      h('p', { class: 'hint' }, '주방에서 "프렙"이라고 부르는 것과 같아요. ', h('a', { href: '#/help/prep' }, '쉽게 쓰는 법 보기'))));

  if (!items.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: '아직 적어 둔 것이 없어요',
      text: '예: 김치전 반죽 한 통에 든 재료비를 적고 "김치전 20장"이 나온다고 넣으면, 김치전 1장에 드는 반죽값이 바로 나와요.',
      actions: [h('a', { class: 'btn', href: '#/preps/new', 'aria-disabled': String(!canWrite) }, icon('plus', 20), '미리 만든 재료 추가')],
    })));
    return;
  }
  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('span'), h('a', { class: 'btn sm', href: '#/preps/new', 'aria-disabled': String(!canWrite) }, icon('plus', 18), '추가')),
    h('ul', { class: 'rows' }, items.map(prepRow))));
}

export async function renderEditor(box, id) {
  const [ingRes, prepRes] = await Promise.all([
    api('/api/ingredients'),
    id ? api(`/api/preps/${id}`) : Promise.resolve(null),
  ]);
  const ings = ingRes.items.filter((i) => !i.from_prep_id); // 다른 프렙 결과물은 프렙 재료로 못 씀(1단계만 허용)
  const byName = new Map(ings.map((i) => [i.name, i]));
  const prep = prepRes?.item ?? null;
  const canWrite = app.me.plan.writable;

  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: prep?.name ?? '', placeholder: '예: 김치전 반죽, 멸치육수, 제육 양념장' });

  /* ----- 다 만들면 얼마나 나오나요? -----
     count: 몇 장·몇 개 나오는지 안다(김치전 20장) → 메뉴에서 '1장'
     ladle: 몇 국자 나오는지로 센다(반죽·찌개 양념) → 메뉴에서 '1국자'
     amount: 무게나 부피를 안다(멸치육수 5L) → 메뉴에서 g·ml
     count·ladle은 서버에서 unit_kind 'ea'(1개 = 1장 = 1국자)이고, 보여 줄 말만 count_label로 다르다. */
  const initMode = !prep ? 'count' : prep.unit_kind !== 'ea' ? 'amount' : prep.count_label === '국자' ? 'ladle' : 'count';
  let mode = initMode;
  const modeName = `ym${Math.random().toString(36).slice(2, 7)}`;
  const modeOpt = (val, title, sub) => h('label', { class: 'radio prep-mode' },
    h('input', { type: 'radio', name: modeName, value: val, checked: val === mode, disabled: !!prep && val !== initMode && (prep.unit_kind !== 'ea' || val === 'amount') }),
    h('span', null, h('b', null, title), h('span', { class: 'hint' }, sub)));
  const modes = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': '세는 방법' },
    modeOpt('count', '몇 장·몇 개 나오는지 알아요', '예: 김치전 반죽 한 통 → 김치전 20장'),
    modeOpt('ladle', '잘 모르면 국자로 셀래요', '예: 반죽 한 통 → 약 25국자. 메뉴에는 "2국자"처럼 넣어요'),
    modeOpt('amount', '무게나 부피를 알아요', '예: 멸치육수 5L, 양념장 3kg'));

  // count
  const countQty = numInput({ placeholder: '예: 20' });
  const countLabel = selectOf([['장', '장'], ['개', '개'], ['인분', '인분']], prep?.count_label && prep.count_label !== '국자' ? prep.count_label : '장');
  const countBox = h('div', { class: 'two keep' }, field('몇 개 나오나요?', countQty), field('세는 말', countLabel));

  // ladle
  const ladleQty = numInput({ placeholder: '예: 25' });
  const tubL = numInput({ placeholder: '예: 3' });
  let ladleMl = 120;
  const ladleSeg = segGroup('우리 가게 국자 크기', [[60, '작은 국자 · 약 60ml'], [120, '보통 국자 · 약 120ml'], [180, '큰 국자 · 약 180ml']], ladleMl, (v) => { ladleMl = v; fromTub(); });
  const tubOut = h('p', { class: 'prep-calc', 'aria-live': 'polite' });
  function fromTub() {
    const l = parseNum(tubL.value);
    if (!(l > 0)) { fill(tubOut, '통에 담긴 양(L)을 넣으면 몇 국자인지 계산해 드려요.'); return; }
    const n = Math.max(1, Math.round((l * 1000) / ladleMl));
    fill(tubOut, `${n3(l)}L ÷ ${ladleMl}ml = 약 `, h('b', { class: 'n' }, n), '국자');
    ladleQty.value = n3(n);
    recalc();
  }
  tubL.addEventListener('input', fromTub);
  const ladleBox = h('div', null,
    field('몇 국자 나오나요?', ladleQty, '한 통을 다 떠 보면서 세면 가장 정확해요.'),
    h('details', { class: 'prep-help' },
      h('summary', null, '몇 국자인지 모르겠어요 (통 크기로 계산)'),
      h('div', { class: 'prep-help-body' },
        field('통에 담긴 양 (L)', tubL, '통 옆 눈금을 보세요. 생수 큰 병이 2L예요.'),
        h('p', { class: 'small', style: 'margin:10px 0 4px;font-weight:700' }, '우리 가게 국자 크기'),
        ladleSeg,
        h('p', { class: 'hint' }, '국자로 물을 떠서 종이컵(약 180ml)에 부어 보세요. 3분의 1이면 작은 국자, 3분의 2면 보통, 가득 차면 큰 국자예요.'),
        tubOut,
        h('a', { class: 'small', href: '#/help/prep' }, '국자·숟가락 용량표 보기')))
  );

  // amount
  const unitKind = selectOf([['g', '무게 (kg·g)'], ['ml', '부피 (L·ml)']], prep && prep.unit_kind !== 'ea' ? prep.unit_kind : 'g');
  if (prep) unitKind.disabled = true;
  const yieldQty = numInput({ placeholder: '예: 5' });
  const yieldUnit = selectOf(['kg', 'g'], 'kg');
  const syncYieldUnits = () => {
    const cur = yieldUnit.value;
    const opts = unitKind.value === 'g' ? ['kg', 'g'] : ['L', 'ml'];
    yieldUnit.replaceChildren(...opts.map((u) => h('option', { value: u }, u)));
    yieldUnit.value = opts.includes(cur) ? cur : opts[0];
  };
  syncYieldUnits();
  const amountBox = h('div', null,
    field('무게로 셀까요, 부피로 셀까요?', unitKind),
    h('div', { class: 'two keep' }, field('완성량', yieldQty, '이 재료로 실제로 만들어지는 양'), field('단위', yieldUnit)));

  if (prep) {
    if (prep.unit_kind === 'ea') (initMode === 'ladle' ? ladleQty : countQty).value = n3(prep.yield_qty);
    else {
      const big = prep.unit_kind === 'g' ? 'kg' : 'L';
      if (prep.yield_qty >= 1000) { yieldUnit.value = big; yieldQty.value = n3(prep.yield_qty / 1000); } else { yieldUnit.value = prep.unit_kind; yieldQty.value = n3(prep.yield_qty); }
    }
  }
  fromTub();

  const perLabel = () => (mode === 'count' ? countLabel.value : mode === 'ladle' ? '국자' : unitKind.value);
  const unitLabel = h('dt');
  function paintMode() {
    countBox.hidden = mode !== 'count';
    ladleBox.hidden = mode !== 'ladle';
    amountBox.hidden = mode !== 'amount';
    fill(unitLabel, `1${perLabel()}당 원가`);
  }
  modes.addEventListener('change', (e) => { if (e.target.name === modeName) { mode = e.target.value; paintMode(); recalc(); } });
  unitKind.addEventListener('change', () => { syncYieldUnits(); paintMode(); recalc(); });
  countLabel.addEventListener('change', paintMode);
  // 한 번에 나오는 양(기본 단위). count·ladle은 센 수 그대로.
  const yieldBase = () => (mode === 'count' ? parseNum(countQty.value) : mode === 'ladle' ? parseNum(ladleQty.value) : parseNum(yieldQty.value) * (UNIT[yieldUnit.value]?.f ?? 1));

  const ingNames = ings.map((i) => i.name);
  const rowsBox = h('div', { 'aria-label': '재료 목록' });
  const rows = [];
  const totalCost = h('span', { class: 'n' }, '–');
  const unitCost = h('span', { class: 'n' }, '–');

  function addRow(pre = {}) {
    const r = {
      name: h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: '재료 이름', 'aria-label': '재료 이름', value: pre.name ?? '' }),
      qty: numInput({ placeholder: '양', value: pre.qty != null ? n3(pre.qty) : '' }),
      unit: selectOf(ALL_UNITS, pre.unit ?? 'g'),
      cost: h('span', { class: 'm-cost muted' }, '–'),
      err: h('div', { class: 'err', role: 'alert' }),
    };
    const del = h('button', { class: 'icon-btn m-del', type: 'button', 'aria-label': '이 재료 빼기', onclick: () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); recalc(); } }, icon('trash', 20));
    const nameBox = localSuggest(r.name, ingNames); // 내 식자재 이름 중에서 글자로 찾기
    nameBox.classList.add('m-name'); r.qty.classList.add('m-qty'); r.unit.classList.add('m-unit');
    r.el = h('div', { class: 'mrow' }, nameBox, r.qty, r.unit, r.cost, del, r.err);
    const setUnits = () => {
      const ing = byName.get(r.name.value.trim());
      if (!ing) return;
      const opts = UI_UNITS[ing.kind];
      const cur = r.unit.value;
      r.unit.replaceChildren(...opts.map((u) => h('option', { value: u }, u)));
      r.unit.value = opts.includes(cur) ? cur : opts[0];
    };
    setUnits();
    if (pre.unit && [...r.unit.options].some((o) => o.value === pre.unit)) r.unit.value = pre.unit;
    r.name.addEventListener('input', () => { setUnits(); recalc(); });
    r.name.addEventListener('change', () => { setUnits(); recalc(); });
    r.qty.addEventListener('input', recalc);
    r.unit.addEventListener('change', recalc);
    rows.push(r);
    rowsBox.append(r.el);
    return r;
  }

  function recalc() {
    let total = 0;
    for (const r of rows) {
      const nm = r.name.value.trim();
      const q = parseNum(r.qty.value);
      const ing = byName.get(nm);
      r.err.textContent = '';
      if (!nm && !r.qty.value.trim()) { r.cost.className = 'm-cost muted'; r.cost.textContent = '–'; continue; }
      if (!ing) { r.err.textContent = nm ? `'${nm}'은(는) 등록된 식자재가 아닙니다.` : '재료 이름을 골라 주세요.'; r.cost.className = 'm-cost muted'; r.cost.textContent = '–'; continue; }
      if (!(q > 0)) { r.cost.className = 'm-cost muted'; r.cost.textContent = '–'; continue; }
      if (ing.unit_price == null) { r.cost.className = 'm-cost noprice'; r.cost.textContent = '단가 없음'; continue; }
      const f = UNIT[r.unit.value].f;
      const y = (ing.yield_pct || 100) / 100;
      const c = q * f * (ing.unit_price / y);
      total += c;
      r.cost.className = 'm-cost';
      r.cost.replaceChildren(h('span', { class: 'n' }, n0(c)), '원');
    }
    totalCost.textContent = n0(total);
    const yb = yieldBase();
    unitCost.textContent = yb > 0 ? n3(total / yb) : '–';
  }
  for (const el of [yieldQty, yieldUnit, countQty, ladleQty]) { el.addEventListener('input', recalc); el.addEventListener('change', recalc); }
  paintMode();

  const items = prep?.items ?? [];
  if (items.length) items.forEach((it) => addRow({ name: it.name, qty: it.qty, unit: it.kind }));
  else addRow();
  recalc();

  const save = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, '저장');
  async function onSave(ev) {
    ev.preventDefault();
    err.hidden = true;
    const itemsBody = [];
    for (const r of rows) {
      const nm = r.name.value.trim();
      if (!nm && !r.qty.value.trim()) continue;
      const ing = byName.get(nm);
      const q = parseNum(r.qty.value);
      if (!ing || !(q > 0)) { r.err.textContent = ing ? '양을 입력해 주세요.' : '등록된 식자재를 골라 주세요.'; (ing ? r.qty : r.name).focus(); return; }
      itemsBody.push({ ingredient_id: ing.id, qty: q, unit: r.unit.value });
    }
    if (!itemsBody.length) { err.textContent = '재료를 1개 이상 넣어 주세요.'; err.hidden = false; return; }
    const counted = mode !== 'amount';
    const qtyEl = mode === 'count' ? countQty : mode === 'ladle' ? ladleQty : yieldQty;
    const body = {
      name: name.value.trim(), unit_kind: counted ? 'ea' : unitKind.value,
      yield_qty: parseNum(qtyEl.value), yield_unit: counted ? '개' : yieldUnit.value,
      count_label: mode === 'count' ? countLabel.value : mode === 'ladle' ? '국자' : null,
      items: itemsBody,
    };
    if (!body.name) { err.textContent = '이름을 입력해 주세요.'; err.hidden = false; name.focus(); return; }
    if (!(body.yield_qty > 0)) { err.textContent = mode === 'amount' ? '완성량을 입력해 주세요.' : `몇 ${perLabel()} 나오는지 입력해 주세요.`; err.hidden = false; qtyEl.focus(); return; }
    await busy(save, async () => {
      let res;
      try {
        res = await api(prep ? `/api/preps/${prep.id}` : '/api/preps', { method: prep ? 'PUT' : 'POST', body });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      toast('저장했습니다.');
      if (prep) refreshRoute(); else go(`#/preps/${res.item.id}`);
    });
  }

  async function onDelete() {
    const ok = await confirmDialog({ title: '미리 만든 재료 삭제', message: `'${prep.name}'을(를) 삭제합니다. 되돌릴 수 없습니다.`, confirmText: '삭제', danger: true });
    if (!ok) return;
    try { await api(`/api/preps/${prep.id}`, { method: 'DELETE' }); } catch (e) { toast(errMsg(e), 'err'); return; }
    toast('삭제했습니다.');
    go('#/preps');
  }

  const form = h('form', { novalidate: true, onsubmit: onSave },
    err,
    h('section', { class: 'sheet' },
      field('이름', name)),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '다 만들면 얼마나 나오나요?')),
      modes,
      h('div', { class: 'prep-yield' }, countBox, ladleBox, amountBox)),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '한 통 만드는 데 들어간 재료')),
      ings.length ? null : h('p', { class: 'small', style: 'margin-bottom:8px' }, '등록된 식자재가 없습니다. ', h('a', { href: '#/ingredients' }, '식자재를 먼저 등록'), '해 주세요.'),
      rowsBox,
      h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => addRow().name.focus() }, icon('plus', 18), '재료 추가'))),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '계산 결과')),
      h('dl', { class: 'sum-grid' },
        h('div', null, h('dt', null, '재료비 합계'), h('dd', null, totalCost, '원')),
        h('div', null, unitLabel, h('dd', null, unitCost, '원')))),
    h('div', { class: 'btn-row', style: 'margin-top:16px' }, save,
      prep ? h('button', { class: 'btn danger', type: 'button', disabled: !canWrite, onclick: onDelete }, '삭제') : null));

  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/preps' }, icon('back', 18), '목록'),
      h('h1', { style: 'font-size:1.125rem' }, prep ? '미리 만든 재료 고치기' : '미리 만든 재료 추가')),
    form);
  if (!prep) name.focus();
}
