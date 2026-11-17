/* #/demands: 권역·분류·검색으로 수요를 찾고 블라인드 제안을 등록 */
import {
  h, api, app, field, numInput, selectOf, parseNum, n0, nPrice, openDialog, busy, toast, errMsg, icon, fill, UI_UNITS, UNIT, DISPLAY,
} from '../core.js';
import { REGIONS, blindNote, loadCatalog, labeler, day } from './kit.js';

const VAT = [['incl', '부가세 포함'], ['excl', '부가세 별도'], ['exempt', '면세']];

export function openBidDialog(d, lab, onDone) {
  const item = lab.items.get(d.item.id);
  const units = item ? UI_UNITS[item.unit_kind] : ['kg', 'g'];
  const size = numInput({ value: '', placeholder: '예: 15' });
  const unit = selectOf(units, units[0]);
  const price = numInput({ value: '', placeholder: '예: 18,000' });
  const vat = selectOf(VAT, 'incl');
  const minOrder = h('input', { class: 'input', type: 'text', maxLength: 200, value: d.my_bid?.min_order_note || '', placeholder: '예: 10박스 이상 (선택)' });
  const validDays = numInput({ value: '14' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn', type: 'submit' }, d.my_bid ? '제안 수정' : '제안 등록');
  if (d.my_bid) {
    size.value = String(d.my_bid.pack.size);
    unit.value = d.my_bid.pack.unit;
    price.value = String(d.my_bid.pack.price);
    vat.value = d.my_bid.vat_type || 'incl';
  }
  // 내가 넣은 값만으로 계산하는 확인용 단가(입력 실수 방지). 사장님 쪽 가격과는 아무 비교도 하지 않는다.
  const preview = h('p', { class: 'dm-preview', 'aria-live': 'polite' });
  function paintPreview() {
    const s = parseNum(size.value);
    const p = parseNum(price.value);
    const u = UNIT[unit.value];
    if (!(s > 0 && p > 0) || !u) { preview.textContent = ''; return; }
    const [dispUnit, per] = DISPLAY[u.kind];
    const incl = vat.value === 'excl' ? p * 1.1 : p;
    preview.textContent = `내 제안 단가: ${dispUnit}당 약 ${nPrice((incl / (s * u.f)) * per)}원${vat.value === 'excl' ? ' (부가세 포함 환산)' : ''}`;
  }
  for (const el of [size, price]) el.addEventListener('input', paintPreview);
  for (const el of [unit, vat]) el.addEventListener('change', paintPreview);
  paintPreview();

  const locked = d.my_bid?.price_locked_until;
  const form = h('form', { novalidate: true },
    err,
    blindNote('현재 거래가는 공개되지 않습니다.', '이 사장님들이 지금 얼마에 사고 있는지는 저희도 보여 드리지 않습니다. 비교 대신, 받아들일 수 있는 가격을 자유롭게 제안해 주세요.'),
    h('p', { class: 'small muted' }, `${d.item.name} · ${lab.origin(d.origin)} · ${lab.grade(d.item.id, d.grade)} · ${d.region.label}`),
    h('div', { class: 'pair' }, field('규격 수량', size), field('단위', unit)),
    field('규격 가격 (원)', price, locked ? `가격은 ${day(locked)}부터 다시 바꿀 수 있습니다.` : null),
    preview,
    field('부가세', vat),
    field('최소 주문 (선택)', minOrder),
    field('제안 유효 기간 (일)', validDays, d.my_bid ? '1~30일. 저장한 날부터 다시 셉니다.' : '1~30일. 지나면 제안이 자동으로 만료됩니다.'),
    d.my_bid
      ? h('p', { class: 'hint' }, '가격을 바꾸면 7일 동안 다시 바꿀 수 없습니다. 규격·최소 주문·유효 기간만 바꾸는 것은 제한이 없습니다.')
      : h('p', { class: 'hint' }, '등록한 뒤 가격은 7일에 한 번만 바꿀 수 있고, 철회하면 같은 조건으로 7일 동안 다시 제안할 수 없습니다. 신중하게 정해 주세요.'),
    submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const s = parseNum(size.value);
    const p = parseNum(price.value);
    const vd = parseNum(validDays.value);
    if (!(s > 0)) { err.textContent = '규격 수량을 입력해 주세요.'; err.hidden = false; return; }
    if (!(p > 0)) { err.textContent = '가격을 입력해 주세요.'; err.hidden = false; return; }
    if (!(vd >= 1 && vd <= 30)) { err.textContent = '유효 기간은 1에서 30 사이로 넣어 주세요.'; err.hidden = false; return; }
    await busy(submit, async () => {
      const body = { demand_id: d.demand_id, pack_size: s, pack_unit: unit.value, pack_price: p, vat_type: vat.value, min_order_note: minOrder.value.trim(), valid_days: vd };
      try {
        if (d.my_bid) await api(`/api/ws/bids/${d.my_bid.id}`, { method: 'PUT', body });
        else await api('/api/ws/bids', { method: 'POST', body });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast(d.my_bid ? '제안을 수정했습니다.' : '제안을 등록했습니다.');
      if (onDone) onDone();
    });
  });
  const dlg = openDialog({ title: d.my_bid ? '제안 수정' : '제안 등록', content: form });
  size.focus();
}

function demandRow(d, lab, onChange) {
  const qty = d.qty_band ? `월 ${n0(d.qty_band.low)}~${d.qty_band.high != null ? n0(d.qty_band.high) : '∞'}` : '수량 미집계';
  const btn = h('button', { class: `btn sm${d.my_bid ? ' ghost' : ''}`, type: 'button' }, d.my_bid ? '내 제안 수정' : '제안하기');
  btn.addEventListener('click', () => openBidDialog(d, lab, onChange));
  return h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, d.item.name), h('span', { class: 'xs muted' }, ` · ${lab.origin(d.origin)} · ${lab.grade(d.item.id, d.grade)}`),
      h('div', { class: 'row-sub' }, `${d.region.label} · ${qty} · 구매처 ${d.buyer_band}`,
        d.my_bid ? h('span', { class: 'tag ok' }, '제안함') : null)),
    btn));
}

export async function render(box) {
  const count = h('span', { class: 'sub' });
  box.append(h('div', { class: 'page-h' }, h('h1', null, '수요', count)));

  const catalog = await loadCatalog();
  const lab = labeler(catalog);
  const categories = [...new Set(catalog.items.map((i) => i.category))].filter(Boolean);
  const myRegions = REGIONS.filter(([code]) => (app.me.regions || []).includes(code));

  const regionSel = selectOf([['', myRegions.length > 1 ? `내 권역 전체 (${myRegions.length}곳)` : '내 권역 전체'], ...myRegions], '');
  const catSel = selectOf([['', '전체 분류'], ...categories.map((c) => [c, c])], '');
  const q = h('input', { class: 'input', type: 'search', placeholder: '품목 검색', autocomplete: 'off', 'aria-label': '품목 검색' });
  const onlyOpen = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, '아직 제안하지 않은 것만');
  const list = h('ul', { class: 'rows' });
  const info = h('p', { class: 'small muted', style: 'padding:14px 0 4px' });

  async function load() {
    fill(list, h('div', { class: 'skel' }));
    const params = new URLSearchParams();
    if (regionSel.value) params.set('region', regionSel.value);
    if (catSel.value) params.set('category', catSel.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const { demands } = await api(`/api/ws/demands?${params}`);
    const shown = onlyOpen.getAttribute('aria-pressed') === 'true' ? demands.filter((d) => !d.my_bid) : demands;
    fill(list, shown.map((d) => demandRow(d, lab, load)));
    count.textContent = shown.length ? `${shown.length}건` : '';
    if (shown.length) info.textContent = '';
    else if (!myRegions.length) fill(info, '배송 가능 권역을 아직 고르지 않았습니다. ', h('a', { href: '#/profile' }, '내 정보에서 권역 고르기'));
    else if (demands.length) info.textContent = '보이는 수요에는 이미 모두 제안했습니다.';
    else fill(info, '조건에 맞는 수요가 없습니다. ', h('a', { href: '#/profile' }, '내 정보'), '에서 배송 가능 권역을 넓혀 보세요.');
  }
  for (const el of [regionSel, catSel]) el.addEventListener('change', load);
  q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(load, 250); });
  onlyOpen.addEventListener('click', () => {
    onlyOpen.setAttribute('aria-pressed', onlyOpen.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    load();
  });

  box.append(h('section', { class: 'sheet' },
    blindNote('현재 거래가는 공개되지 않습니다.', '보이는 정보는 품목·원산지·등급·권역·구간별 수량·구매처 수뿐입니다.'),
    h('div', { class: 'two' }, field('권역', regionSel), field('분류', catSel)),
    h('div', { class: 'search' }, icon('search', 18), q),
    h('div', { class: 'chips' }, onlyOpen),
    list, info),
  h('p', { class: 'hint', style: 'margin-top:10px' }, `수요는 여러 식당의 구매 기록이 모였을 때만 공개되고, 내 배송 권역(${myRegions.map(([, l]) => l).join(', ') || '미설정'})의 것만 보입니다.`));
  await load();
}
