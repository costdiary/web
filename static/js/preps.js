/* 프렙 레시피: 미리 끓여 두는 육수·소스처럼 메뉴에 재사용하는 중간 재료를 g(또는 ml)당 원가로 관리합니다.
   만들면 전용 식자재 한 줄이 자동으로 생겨, 메뉴 재료 목록에서 식자재처럼 바로 쓸 수 있습니다. */
import {
  h, api, app, field, numInput, selectOf, parseNum, n0, n3, icon, go, refreshRoute, fill,
  confirmDialog, busy, toast, errMsg, UNIT, UI_UNITS, ALL_UNITS,
} from './core.js';
import { emptyBlock, num } from './ui.js';

function prepRow(p) {
  const sub = [`완성량 ${n3(p.yield_qty)}${p.unit_kind}`, `재료 ${p.items.length}개`, p.used_in_menus ? `메뉴 ${p.used_in_menus}개에 사용` : '아직 메뉴에 안 씀'].join(' · ');
  return h('li', null,
    h('a', { class: 'row', href: `#/preps/${p.id}` },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, p.name),
        h('div', { class: 'row-sub' }, sub)),
      h('div', { class: 'row-end' },
        p.unit_price == null
          ? h('span', { class: 'tag bad' }, '단가 없음')
          : num(n0(p.unit_price), `원/${p.unit_kind}`))));
}

export async function renderList(box) {
  const { items } = await api('/api/preps');
  const canWrite = app.me.plan.writable;
  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/menus' }, icon('back', 18), '메뉴 목록'),
      h('h1', null, '프렙 레시피', h('span', { class: 'sub' }, `${items.length}개`))),
    h('p', { class: 'hint', style: 'margin-bottom:10px' }, '멸치육수·양념소스처럼 미리 만들어 두는 중간 재료의 재료비를 g(ml)당 원가로 바꿔서, 메뉴 원가 계산에 식자재처럼 바로 씁니다.'));

  if (!items.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: '아직 등록한 프렙이 없습니다',
      text: '예: 멸치육수 5kg을 끓이는 데 든 재료비를 g당 원가로 바꿔서, 국·탕 메뉴 원가 계산에 바로 쓸 수 있습니다.',
      actions: [h('a', { class: 'btn', href: '#/preps/new', 'aria-disabled': String(!canWrite) }, icon('plus', 20), '프렙 추가하기')],
    })));
    return;
  }
  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('span'), h('a', { class: 'btn sm', href: '#/preps/new', 'aria-disabled': String(!canWrite) }, icon('plus', 18), '프렙 추가')),
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
  const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: prep?.name ?? '', placeholder: '예: 멸치육수, 양념소스' });
  const unitKind = selectOf([['g', '무게(g)'], ['ml', '부피(ml)']], prep?.unit_kind ?? 'g');
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
  unitKind.addEventListener('change', syncYieldUnits);
  if (prep) {
    const big = prep.unit_kind === 'g' ? 'kg' : 'L';
    if (prep.yield_qty >= 1000) { yieldUnit.value = big; yieldQty.value = n3(prep.yield_qty / 1000); }
    else { yieldUnit.value = prep.unit_kind; yieldQty.value = n3(prep.yield_qty); }
  }

  const datalist = h('datalist', { id: 'prep-ing-options' }, ings.map((i) => h('option', { value: i.name })));
  const rowsBox = h('div', { 'aria-label': '재료 목록' });
  const rows = [];
  const totalCost = h('span', { class: 'n' }, '–');
  const unitCost = h('span', { class: 'n' }, '–');
  const unitLabel = h('dt', null, `1${unitKind.value}당 원가`);
  unitKind.addEventListener('change', () => { fill(unitLabel, `1${unitKind.value}당 원가`); });

  function addRow(pre = {}) {
    const r = {
      name: h('input', { class: 'input', type: 'text', list: 'prep-ing-options', autocomplete: 'off', placeholder: '재료 이름', value: pre.name ?? '' }),
      qty: numInput({ placeholder: '양', value: pre.qty != null ? n3(pre.qty) : '' }),
      unit: selectOf(ALL_UNITS, pre.unit ?? 'g'),
      cost: h('span', { class: 'm-cost muted' }, '–'),
      err: h('div', { class: 'err', role: 'alert' }),
    };
    const del = h('button', { class: 'icon-btn m-del', type: 'button', 'aria-label': '이 재료 빼기', onclick: () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); recalc(); } }, icon('trash', 20));
    r.name.classList.add('m-name'); r.qty.classList.add('m-qty'); r.unit.classList.add('m-unit');
    r.el = h('div', { class: 'mrow' }, r.name, r.qty, r.unit, r.cost, del, r.err);
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
    const yq = parseNum(yieldQty.value);
    const yu = UNIT[yieldUnit.value]?.f ?? 1;
    const yieldBase = yq * yu;
    unitCost.textContent = yieldBase > 0 ? n3(total / yieldBase) : '–';
  }
  for (const el of [yieldQty, yieldUnit]) { el.addEventListener('input', recalc); el.addEventListener('change', recalc); }

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
    const body = {
      name: name.value.trim(), unit_kind: unitKind.value,
      yield_qty: parseNum(yieldQty.value), yield_unit: yieldUnit.value, items: itemsBody,
    };
    if (!body.name) { err.textContent = '프렙 이름을 입력해 주세요.'; err.hidden = false; name.focus(); return; }
    if (!(body.yield_qty > 0)) { err.textContent = '완성량을 입력해 주세요.'; err.hidden = false; yieldQty.focus(); return; }
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
    const ok = await confirmDialog({ title: '프렙 삭제', message: `'${prep.name}' 프렙을 삭제합니다. 되돌릴 수 없습니다.`, confirmText: '삭제', danger: true });
    if (!ok) return;
    try { await api(`/api/preps/${prep.id}`, { method: 'DELETE' }); } catch (e) { toast(errMsg(e), 'err'); return; }
    toast('삭제했습니다.');
    go('#/preps');
  }

  const form = h('form', { novalidate: true, onsubmit: onSave },
    err,
    h('section', { class: 'sheet' },
      h('div', { class: 'two keep' }, field('프렙 이름', name), field('단위 종류', unitKind)),
      h('div', { class: 'two keep' }, field('완성량', yieldQty, '이 재료로 실제로 만들어지는 양(예: 멸치육수 5kg)'), field('완성량 단위', yieldUnit))),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '재료와 양')),
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
      h('a', { class: 'btn ghost sm', href: '#/preps' }, icon('back', 18), '프렙 목록'),
      h('h1', { style: 'font-size:1.125rem' }, prep ? '프렙 수정' : '새 프렙')),
    datalist, form);
  if (!prep) name.focus();
}
