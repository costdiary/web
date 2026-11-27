/* 식자재: 목록·검색, 추가/수정 대화상자(단가 계산, 가격 이력, 쓰는 메뉴) */
import {
  h, api, app, field, numInput, selectOf, comboSelect, parseNum, n0, n3, nPrice, ago, ymd, daysSince, openDialog, confirmDialog,
  busy, toast, errMsg, UNIT, UI_UNITS, ALL_UNITS, DISPLAY, icon, refreshRoute, fill,
} from './core.js';
import { chg, num, emptyBlock, termInput, newTag } from './ui.js';

const STALE_DAYS = 45;
const SOURCE = { manual: '직접 입력', invoice: '명세서', seed: '예시', import: '가져오기' };

function row(it) {
  const stale = it.display_price != null && (daysSince(it.price_checked_at) ?? 0) >= STALE_DAYS;
  const sub = [it.supplier, it.used_in ? `메뉴 ${it.used_in}개에 사용` : '아직 메뉴에 안 씀', it.yield_pct < 100 ? `수율 ${n3(it.yield_pct)}%` : null].filter(Boolean).join(' · ');
  const main = h('div', { class: 'row-main' },
    h('span', { class: 'row-title' }, it.name, newTag(it),
      it.from_prep_id ? h('span', { class: 'tag' }, '프렙') : (stale ? h('span', { class: 'tag warn' }, `${ago(it.price_checked_at)} 확인`) : null)),
    h('div', { class: 'row-sub' }, sub));
  const end = h('div', { class: 'row-end' },
    it.display_price == null
      ? h('span', { class: 'tag bad' }, '단가 없음')
      : [num(nPrice(it.display_price), `원/${it.display_unit}`), chg(it.change_pct)]);
  if (it.from_prep_id) {
    return h('li', null, h('a', { class: 'row', href: `#/preps/${it.from_prep_id}` }, main, end));
  }
  return h('li', null, h('button', { class: 'row', type: 'button', onclick: () => openIngredientEditor(it.id, refreshRoute) }, main, end));
}

export async function render(box) {
  const { items } = await api('/api/ingredients');
  const canWrite = app.me.plan.writable;
  const add = h('button', { class: 'btn sm', type: 'button', disabled: !canWrite, onclick: () => openIngredientEditor(null, refreshRoute) }, icon('plus', 18), '식자재 추가');
  box.append(h('div', { class: 'page-h' }, h('h1', null, '식자재', h('span', { class: 'sub' }, `${items.length}개`)), add));

  if (!items.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: '아직 등록한 식자재가 없습니다',
      text: '거래명세서 사진 한 장만 올리면 한 번에 등록됩니다. 쓰던 앱이나 엑셀 파일이 있다면 그대로 가져오고, 없으면 하나씩 입력해도 됩니다.',
      actions: [h('a', { class: 'btn', href: '#/invoice' }, '명세서로 등록'), h('a', { class: 'btn ghost', href: '#/import' }, '엑셀·다른 앱에서 가져오기'), h('button', { class: 'btn ghost', type: 'button', disabled: !canWrite, onclick: () => openIngredientEditor(null, refreshRoute) }, '직접 등록')],
    })));
    return;
  }

  let q = '';
  let mode = 'all';
  const list = h('ul', { class: 'rows' });
  const info = h('p', { class: 'small muted', style: 'padding:14px 0 4px', hidden: true }, '조건에 맞는 식자재가 없습니다.');
  const rising = items.filter((i) => (i.change_pct ?? 0) > 0).length;
  const stale = items.filter((i) => i.display_price != null && (daysSince(i.price_checked_at) ?? 0) >= STALE_DAYS).length;
  const unpriced = items.filter((i) => i.display_price == null).length;
  const chipDefs = [['all', `전체 ${items.length}`], ['up', `오른 것 ${rising}`], ['stale', `확인 필요 ${stale}`], ...(unpriced ? [['nop', `단가 없음 ${unpriced}`]] : [])];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '보기 조건' });
  const paint = () => {
    const needle = q.trim().toLowerCase();
    const shown = items.filter((i) => {
      if (needle && !(`${i.name} ${i.supplier} ${i.category}`.toLowerCase().includes(needle))) return false;
      if (mode === 'up') return (i.change_pct ?? 0) > 0;
      if (mode === 'nop') return i.display_price == null;
      if (mode === 'stale') return i.display_price != null && (daysSince(i.price_checked_at) ?? 0) >= STALE_DAYS;
      return true;
    });
    list.replaceChildren(...shown.map(row));
    info.hidden = shown.length > 0;
    chips.replaceChildren(...chipDefs.map(([k, label]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(mode === k), onclick: () => { mode = k; paint(); },
    }, label)));
  };
  const search = h('input', { class: 'input', type: 'search', placeholder: '이름·거래처로 찾기', 'aria-label': '식자재 검색', autocomplete: 'off' });
  search.addEventListener('input', () => { q = search.value; paint(); });
  paint();

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'search' }, icon('search', 18), search),
    chips, list, info,
    h('div', { style: 'margin-top:14px' }, h('a', { class: 'btn ghost sm', href: '/api/export/ingredients.csv', download: '' }, icon('download', 18), '엑셀(CSV)로 내려받기'),
      ' ', h('a', { class: 'btn ghost sm', href: '#/import' }, '다른 앱·엑셀에서 가져오기'))));
}

/* 추가·수정 대화상자. id가 null이면 새 식자재. 저장·삭제하면 onChange를 부릅니다. */
export async function openIngredientEditor(id, onChange, preset = {}) {
  let detail = null;
  let catalog = null;
  try {
    [detail, catalog] = await Promise.all([
      id ? api(`/api/ingredients/${id}`) : Promise.resolve(null),
      api('/api/market/catalog').catch(() => null), // 원산지 목록이 없어도 식자재 등록 자체는 막지 않습니다.
    ]);
  } catch (e) { toast(errMsg(e), 'err'); return null; }
  const it = detail?.item;
  const canWrite = app.me.plan.writable;
  const units = it && it.used_in > 0 ? UI_UNITS[it.kind] : ALL_UNITS;
  const noPrice = !!it && it.pack_price == null;

  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: it?.name ?? preset.name ?? '' });
  const supplier = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: it?.supplier ?? preset.supplier ?? '', placeholder: '예: 한우리유통' });
  const category = termInput({ kind: 'category', maxLength: 30, value: it?.category ?? '', placeholder: '예: 정육, 채소, 양념' });
  const catVal = () => category.control.value.trim();
  // 정육은 원산지가 국가별로 훨씬 다양하고(한우/육우 포함) 다른 식자재와 체계가 달라서 목록을 따로 쓴다.
  const generalOrigins = [['', '선택 안 함'], ...(catalog?.origins.map((o) => [o.code, o.label]) ?? [])];
  const meatOrigins = [['', '선택 안 함'], ...(catalog?.meat_origins.map((o) => [o.code, o.label]) ?? [])];
  const originSel = comboSelect(catVal() === '정육' ? meatOrigins : generalOrigins, it?.origin ?? preset.origin ?? '', { placeholder: '검색 또는 선택' });
  category.control.addEventListener('input', () => {
    originSel.setOptions(catVal() === '정육' ? meatOrigins : generalOrigins);
  });
  const gradeInput = termInput({ kind: 'grade', category: catVal, maxLength: 10, value: it?.grade ?? preset.grade ?? '', placeholder: '예: 1++, Prime (선택)' });
  const cut = termInput({ kind: 'cut', category: catVal, maxLength: 40, value: it?.cut ?? preset.cut ?? '', placeholder: '예: 등심, 삼겹살, 안심 (선택)' });
  const size = numInput({ value: it ? (it.pack_size == null ? '' : n3(it.pack_size)) : preset.pack_size ? n3(preset.pack_size) : '', placeholder: '예: 15' });
  const unit = selectOf(units, it?.pack_unit ?? preset.pack_unit ?? (it ? DISPLAY[it.kind][0] : 'kg'));
  const price = numInput({ value: it ? (it.pack_price == null ? '' : n3(it.pack_price)) : preset.pack_price ? n3(preset.pack_price) : '', placeholder: '예: 18,000' });
  const yld = numInput({ value: n3(it?.yield_pct ?? 100) });
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });

  const upd = () => {
    const s = parseNum(size.value);
    const p = parseNum(price.value);
    const y = parseNum(yld.value);
    if (!(s > 0 && p > 0)) { fill(preview, '규격과 가격을 넣으면 단가가 계산됩니다.'); return; }
    const u = UNIT[unit.value];
    const [du, df] = DISPLAY[u.kind];
    const per = (p / (s * u.f)) * df;
    const eff = y > 0 && y < 100 ? per / (y / 100) : null;
    const breakdown = u.kind === 'ea' ? null : h('p', { class: 'xs muted', style: 'margin-top:4px' },
      `100${du === 'kg' ? 'g' : 'ml'}당 ${nPrice(per / 10)}원 · 10${du === 'kg' ? 'g' : 'ml'}당 ${nPrice(per / 100)}원`);
    fill(preview, du === '개' ? '1개당 ' : `1${du}당 `, h('b', { class: 'n' }, nPrice(per)), '원',
      eff ? [` · 수율 ${n3(y)}% 반영 시 `, h('b', { class: 'n' }, nPrice(eff)), '원'] : null,
      breakdown);
  };
  for (const el of [size, price, yld]) el.addEventListener('input', upd);
  unit.addEventListener('change', upd);
  upd();

  const save = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, '저장');
  const form = h('form', { novalidate: true },
    err,
    field('식자재 이름', name),
    h('div', { class: 'two keep' }, field('거래처 (선택)', supplier), field('분류 (선택)', category)),
    h('div', { class: 'two keep' }, field('원산지 (선택)', originSel),
      field('등급 (선택)', gradeInput, '목록에 없으면 직접 입력해도 됩니다.')),
    field('부위 (선택)', cut, '정육류에 주로 씁니다. 그 외 식자재는 비워 둬도 됩니다.'),
    h('div', { class: 'lbl', style: 'margin-bottom:6px' }, '구매 규격과 가격'),
    h('div', { class: 'pair', style: 'margin-bottom:10px' },
      h('div', null, h('label', { class: 'sr', for: 'ie-size' }, '구매 수량'), size),
      h('div', null, h('label', { class: 'sr', for: 'ie-unit' }, '단위'), unit)),
    noPrice ? h('p', { class: 'note-warn' }, h('b', null, '단가가 없는 식자재입니다. '), '구매 규격과 가격을 넣으면 이 식자재를 쓰는 메뉴의 원가에 반영됩니다. 거래명세서를 올려도 채워집니다.') : null,
    field('구매 가격 (원)', price, '명세서에 적힌 한 포장의 가격입니다. 바뀌면 가격 이력에 남고, 쓰는 메뉴의 원가가 다시 계산됩니다.'),
    preview,
    field('수율 (%)', yld, '다듬고 남는 비율입니다. 양파 90, 대파 85처럼 넣으면 실제로 쓰는 양 기준으로 계산합니다. 모르면 100.'),
    it && it.used_in > 0 ? h('p', { class: 'hint', style: 'margin:-4px 0 12px' }, '메뉴에서 쓰는 식자재라서 무게/부피/개수 단위 종류는 바꿀 수 없습니다.') : null,
    h('div', { class: 'btn-row' }, save,
      it ? h('button', { class: 'btn danger', type: 'button', disabled: !canWrite, onclick: onDelete }, '삭제') : null),
    !canWrite ? h('p', { class: 'hint', style: 'margin-top:10px' }, '지금은 수정할 수 없습니다.') : null);
  size.id = 'ie-size';
  unit.id = 'ie-unit';

  if (detail) {
    form.append(
      h('div', { class: 'h-sec' }, '가격 이력'),
      h('ul', { class: 'hist' }, detail.history.slice(0, 10).map((x) => h('li', null,
        h('span', { class: 'muted' }, ymd(x.date)),
        h('span', null, `${n3(x.pack_size)}${x.pack_unit} ${n0(x.pack_price)}원 `, h('span', { class: 'xs muted' }, SOURCE[x.source] || x.source)),
        h('span', { class: 'nu' }, h('span', { class: 'n' }, nPrice(x.display_price)), h('span', { class: 'u' }, `원/${it.display_unit}`))))),
      h('div', { class: 'h-sec' }, '쓰고 있는 메뉴'),
      detail.used_in.length
        ? h('ul', { class: 'hist' }, detail.used_in.map((m) => h('li', null,
          h('a', { href: `#/menus/${m.menu_id}` }, m.name), h('span', null), h('span', { class: 'nu' }, h('span', { class: 'n' }, n3(m.qty)), h('span', { class: 'u' }, m.unit)))))
        : h('p', { class: 'small muted' }, '아직 어느 메뉴에도 넣지 않았습니다.'));
  }

  async function onDelete() {
    const ok = await confirmDialog({ title: '식자재 삭제', message: `'${it.name}'과(와) 가격 이력을 삭제합니다. 되돌릴 수 없습니다.`, confirmText: '삭제', danger: true });
    if (!ok) return;
    try {
      await api(`/api/ingredients/${it.id}`, { method: 'DELETE' });
    } catch (e) { toast(errMsg(e), 'err'); return; }
    dlg.close();
    toast('삭제했습니다.');
    if (onChange) onChange(null);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const body = {
      name: name.value.trim(), supplier: supplier.value.trim(), category: catVal(),
      pack_size: parseNum(size.value), pack_unit: unit.value, pack_price: parseNum(price.value), yield_pct: parseNum(yld.value),
      origin: originSel.value.trim(), grade: gradeInput.control.value.trim(), cut: cut.control.value.trim(),
    };
    const problem = !body.name ? '식자재 이름을 입력해 주세요.'
      : !(body.pack_size > 0) ? '구매 수량을 입력해 주세요.'
        : !(body.pack_price > 0) ? '구매 가격을 입력해 주세요.'
          : !(body.yield_pct > 0 && body.yield_pct <= 100) ? '수율은 1에서 100 사이로 넣어 주세요.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    await busy(save, async () => {
      let res;
      try {
        res = await api(it ? `/api/ingredients/${it.id}` : '/api/ingredients', { method: it ? 'PUT' : 'POST', body });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast(it ? '저장했습니다.' : `'${res.item.name}'을(를) 등록했습니다.`);
      if (onChange) onChange(res.item);
    });
  });

  const dlg = openDialog({ title: it ? '식자재 수정' : '식자재 추가', content: form });
  if (!it) name.focus();
  return dlg;
}
