/* 메뉴: 목록(원가율 순)과 편집(재료·양 입력 → 원가율·권장 판매가·배달앱 손익 즉시 계산) */
import {
  h, api, app, field, numInput, selectOf, parseNum, n0, n1, n3, nT, confirmDialog, busy, toast, errMsg,
  UNIT, UI_UNITS, ALL_UNITS, icon, go, refreshRoute, fill,
} from './core.js';
import { marginBar, stamp, num, emptyBlock, stmt, sgn } from './ui.js';
import { menuTotals, channelResult, flatChannel, effUnitCost } from './calc.js';

/* ------------------------------------------------------------ 목록 */

const lossChannels = (m) => (m.delivery?.channels ?? []).filter((c) => c.profit != null && c.profit < 0);

function menuRow(m, target) {
  const est = m.estimated_count > 0;
  const loss = lossChannels(m);
  const sub = [m.category, m.item_count ? `재료 ${m.item_count}개` : '재료 없음', `판매가 ${n0(m.price)}원`].filter(Boolean).join(' · ');
  return h('li', null,
    h('a', { class: 'row', href: `#/menus/${m.id}` },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, m.name, ' '), stamp(m.status),
        est ? h('span', { class: 'tag est', title: '사진으로 추정한 양이 들어 있습니다' }, '추정 포함') : null,
        h('div', { class: 'row-sub' }, sub)),
      h('div', { class: 'row-end' },
        m.cost_ratio == null
          ? h('span', { class: 'small muted' }, '판매가 없음')
          : h('span', { class: 'nu', style: 'font-size:1.375rem' }, h('span', { class: 'n' }, n1(m.cost_ratio)), h('span', { class: 'u' }, '%')),
        h('span', { class: 'xs muted' }, `재료비 ${n0(m.cost)}원`)),
      h('div', { class: 'row-wide' },
        marginBar({ ratio: m.cost_ratio, target }),
        est && m.ratio_low != null
          ? h('p', { class: 'xs muted list-note' }, '사진 추정이 들어 있어 원가율은 ', h('b', { class: 'n' }, n1(m.ratio_low)), '~', h('b', { class: 'n' }, n1(m.ratio_high)), '% 사이일 수 있습니다.')
          : null,
        m.incomplete ? h('p', { class: 'xs list-note', style: 'color:var(--red)' }, `단가가 없는 재료가 있어 원가가 실제보다 낮게 나옵니다: ${m.missing.join(', ')}`) : null,
        m.status !== 'good' && m.recommended_price && m.price_gap > 0
          ? h('p', { class: 'xs muted list-note' }, `목표 ${nT(target)}%에 맞는 판매가 `, h('b', { class: 'n' }, n0(m.recommended_price)), `원 (지금보다 +${n0(m.price_gap)}원)`)
          : null,
        loss.length
          ? h('p', { class: 'xs list-note bad' }, `배달앱에서 팔면 적자: ${loss.map((c) => `${c.short} ${sgn(c.profit)}원`).join(' · ')}`)
          : null)));
}

export async function renderList(box) {
  const { items, summary } = await api('/api/menus');
  const canWrite = app.me.plan.writable;
  const add = h('a', { class: 'btn sm', href: '#/menus/new', 'aria-disabled': String(!canWrite) }, icon('plus', 18), '메뉴 추가');
  const photo = h('a', { class: 'btn ghost sm', href: '#/menus/photo', 'aria-disabled': String(!canWrite) }, icon('camera', 18), '사진으로 만들기');
  const preps = h('a', { class: 'btn ghost sm', href: '#/preps' }, '프렙 레시피');
  box.append(h('div', { class: 'page-h' }, h('h1', null, '메뉴', h('span', { class: 'sub' }, `${items.length}개`)), h('div', { class: 'btn-row' }, preps, photo, add)));

  if (!items.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: '아직 등록한 메뉴가 없습니다',
      text: '메뉴마다 재료와 양을 넣으면 원가율과 권장 판매가가 계산됩니다. 재료 양을 잘 모르겠다면 완성된 요리 사진을 올려 보세요. 재료와 양을 짐작해서 초안을 만들어 드립니다. 쓰던 앱이나 엑셀이 있으면 그대로 가져올 수도 있습니다.',
      actions: [
        h('a', { class: 'btn', href: '#/menus/photo' }, icon('camera', 20), '요리 사진으로 만들기'),
        h('a', { class: 'btn ghost', href: '#/menus/new' }, '직접 입력하기'),
        h('a', { class: 'btn ghost', href: '#/import' }, '엑셀·다른 앱에서 가져오기'),
      ],
    })));
    return;
  }

  let sort = 'ratio';
  const list = h('ul', { class: 'rows' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '정렬' });
  const paint = () => {
    const sorted = [...items].sort(sort === 'ratio'
      ? (a, b) => (b.cost_ratio ?? -1) - (a.cost_ratio ?? -1)
      : (a, b) => a.name.localeCompare(b.name, 'ko'));
    list.replaceChildren(...sorted.map((m) => menuRow(m, summary.target)));
    chips.replaceChildren(...[['ratio', '원가율 높은 순'], ['name', '이름순']].map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(sort === k), onclick: () => { sort = k; paint(); } }, label)));
  };
  paint();

  box.append(h('section', { class: 'sheet' },
    h('p', { class: 'small muted' }, summary.avg_cost_ratio == null ? '판매가를 넣으면 평균 원가율이 계산됩니다.'
      : [`평균 원가율 `, h('b', { class: 'n' }, n1(summary.avg_cost_ratio)), `% · 목표 ${nT(summary.target)}% 초과 ${summary.over_target}개`]),
    chips, list,
    h('div', { class: 'sheet-tools' },
      h('a', { class: 'btn ghost sm', href: '/api/export/menus.csv', download: '' }, icon('download', 18), '엑셀(CSV)로 내려받기'),
      h('a', { class: 'btn ghost sm', href: '#/import' }, '다른 앱·엑셀에서 가져오기'))));
}

/* ------------------------------------------------------------ 편집 */

export async function renderEditor(box, id) {
  const [ingRes, menuRes, chRes] = await Promise.all([
    api('/api/ingredients'),
    id ? api(`/api/menus/${id}`) : Promise.resolve(null),
    api('/api/channels'),
  ]);
  const ings = ingRes.items;
  const byName = new Map(ings.map((i) => [i.name, i]));
  const menu = menuRes?.item ?? null;
  const chans = chRes.items.filter((c) => c.state.enabled);
  const { target_cost_ratio: target, vat_mode: vat } = app.me.settings;
  const canWrite = app.me.plan.writable;

  const datalist = h('datalist', { id: 'ing-options' }, ings.map((i) => h('option', { value: i.name })));
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: menu?.name ?? '', placeholder: '예: 제육볶음' });
  const price = numInput({ value: menu ? n3(menu.price) : '', placeholder: '예: 9,500' });
  const deliveryPrice = numInput({ value: menu?.delivery_price ? n3(menu.delivery_price) : '', placeholder: '비워 두면 매장 판매가' });
  const category = h('input', { class: 'input', type: 'text', maxLength: 30, autocomplete: 'off', value: menu?.category ?? '', placeholder: '예: 볶음, 찌개' });
  const other = numInput({ value: menu ? n3(menu.other_cost) : '0' });
  const note = h('textarea', { class: 'textarea', maxLength: 300, placeholder: '조리법이나 1인분 기준 메모' });
  note.value = menu?.note ?? '';

  /* ----- 재료 줄 ----- */
  const rowsBox = h('div', { 'aria-label': '재료 목록' });
  const rows = [];
  const defaultUnit = (kind) => ({ g: 'g', ml: 'ml', ea: '개' }[kind]);

  function setUnits(r, kind) {
    const opts = kind ? UI_UNITS[kind] : ALL_UNITS;
    const cur = r.unit.value;
    if ([...r.unit.options].map((o) => o.value).join() === opts.join()) return;
    r.unit.replaceChildren(...opts.map((u) => h('option', { value: u }, u)));
    r.unit.value = opts.includes(cur) ? cur : (kind ? defaultUnit(kind) : 'g');
  }

  /* 사진으로 짐작한 양: 사장님이 양이나 재료를 고치면 '추정'이 풀립니다. */
  function paintEst(r) {
    r.estLine.hidden = !r.est;
    if (!r.est) return;
    const rng = r.low != null && r.high != null && r.low !== r.high ? `${n3(r.low)}~${n3(r.high)}${r.unit.value}` : '';
    fill(r.estLine,
      h('span', { class: 'tag est' }, '추정'),
      h('span', null, rng ? `사진으로 짐작한 양입니다 (범위 ${rng})` : '사진으로 짐작한 양입니다'),
      h('button', { class: 'link-btn', type: 'button', disabled: !canWrite, onclick: () => { confirmEst(r); recalc(); } }, '이 양으로 확정'));
  }
  function confirmEst(r) {
    r.est = false;
    r.low = null;
    r.high = null;
    paintEst(r);
  }

  function addRow(pre = {}) {
    const r = {
      est: !!pre.estimated, low: pre.qty_low ?? null, high: pre.qty_high ?? null,
      name: h('input', { class: 'input', type: 'text', list: 'ing-options', autocomplete: 'off', placeholder: '재료 이름', 'aria-label': '재료 이름', value: pre.name ?? '' }),
      qty: numInput({ placeholder: '양', 'aria-label': '사용량', value: pre.qty != null ? n3(pre.qty) : '' }),
      unit: selectOf(ALL_UNITS, 'g', { 'aria-label': '단위' }),
      cost: h('span', { class: 'm-cost muted' }, '–'),
      estLine: h('div', { class: 'm-est' }),
      err: h('div', { class: 'err', role: 'alert' }),
    };
    const del = h('button', { class: 'icon-btn m-del', type: 'button', 'aria-label': '이 재료 빼기', onclick: () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); recalc(); } }, icon('trash', 20));
    r.name.classList.add('m-name');
    r.qty.classList.add('m-qty');
    r.unit.classList.add('m-unit');
    r.el = h('div', { class: 'mrow' }, r.name, r.qty, r.unit, r.cost, del, r.estLine, r.err);
    const ing0 = byName.get(r.name.value.trim());
    setUnits(r, ing0?.kind);
    if (pre.unit && [...r.unit.options].some((o) => o.value === pre.unit)) r.unit.value = pre.unit;
    const edited = () => { if (r.est) confirmEst(r); recalc(); };
    r.name.addEventListener('input', () => { setUnits(r, byName.get(r.name.value.trim())?.kind); edited(); });
    r.name.addEventListener('change', () => { setUnits(r, byName.get(r.name.value.trim())?.kind); edited(); });
    r.qty.addEventListener('input', edited);
    r.unit.addEventListener('change', edited);
    paintEst(r);
    rows.push(r);
    rowsBox.append(r.el);
    return r;
  }

  /* ----- 요약(화면에서 바로 계산. 서버 계산과 같은 식: static/js/calc.js) ----- */
  const sumRatio = h('span', { class: 'n ratio' }, '–');
  const sumStamp = h('span');
  const sumBar = h('div');
  const sumEst = h('p', { class: 'sum-est', hidden: true });
  const dCost = h('dd');
  const dMargin = h('dd');
  const dBasis = h('dd');
  const recText = h('span');
  const applyRec = h('button', { class: 'btn ghost sm', type: 'button', hidden: true });
  const missingBox = h('div', { class: 'note-warn', role: 'status', hidden: true });
  /* 위에 붙어 다니는 막대(원가율만) / 재료 아래의 계산 결과(자세한 값과 권장 판매가) */
  const stickyBar = h('div', { class: 'sticky-sum', 'aria-live': 'polite', 'aria-atomic': 'true' },
    h('div', { class: 'sum-top' },
      h('span', { class: 'lbl' }, '원가율'),
      h('span', { class: 'nu' }, sumRatio, h('span', { class: 'u', style: 'font-size:1.125rem' }, '%')),
      sumStamp,
      h('span', { class: 'tgt' }, `목표 ${nT(target)}%`)),
    sumBar, sumEst);
  const detail = h('section', { class: 'sheet', 'aria-label': '계산 결과' },
    h('div', { class: 'sheet-h' }, h('h2', null, '계산 결과')),
    h('dl', { class: 'sum-grid' },
      h('div', null, h('dt', null, '재료비'), dCost),
      h('div', null, h('dt', null, '한 그릇에 남는 돈'), dMargin),
      h('div', null, h('dt', null, vat === 'excl' ? '공급가(부가세 뺀 값)' : '판매가'), dBasis)),
    h('div', { class: 'rec' }, recText, applyRec),
    missingBox);

  /* ----- 배달앱에서 팔면 ----- */
  const chanBox = h('div', { class: 'chan-list' });
  const deliverySec = h('section', { class: 'sheet', 'aria-label': '배달앱에서 팔면' },
    h('div', { class: 'sheet-h' }, h('h2', null, '배달앱에서 팔면'), h('a', { class: 'xs', href: '#/delivery' }, '수수료 설정')),
    field('배달앱 판매가 (원)', deliveryPrice, '매장과 다른 가격으로 팔 때만 넣으세요. 비워 두면 매장 판매가로 계산합니다.'),
    chanBox);

  function channelBlock(c, r, sale, t) {
    const incomplete = t.missing > 0;
    const status = incomplete ? 'unknown' : r.status;
    let range = null;
    if (t.estimatedCount && t.costLow != null) {
      const best = channelResult(t.costLow, sale, flatChannel(c), target, vat).profit;
      const worst = channelResult(t.costHigh, sale, flatChannel(c), target, vat).profit;
      if (best != null && worst != null && Math.round(best) !== Math.round(worst)) range = [worst, best];
    }
    const note = !c.fee_verified ? '요율 확인 필요' : c.stale ? '요율 오래됨' : !c.pay_verified ? '결제수수료 임시값' : null;
    const tone = r.profit == null ? '' : r.profit < 0 ? 'neg' : 'pos';
    const rows2 = [
      ['판매가', num(n0(sale), '원')],
      vat === 'excl' ? ['부가세 10% 제외', num(`−${n0(sale - sale / 1.1)}`, '원'), 'minus'] : null,
      ...r.fee_items.map((i) => [i.label, num(`−${n0(i.amount)}`, '원'), 'minus']),
      ['받는 돈', num(n0(r.net), '원'), 'total'],
      [c.state.pack_cost > 0 ? '재료비·기타 원가·포장비' : '재료비·기타 원가', num(`−${n0(r.cost)}`, '원'), 'minus'],
      ['남는 돈', num(`${sgn(r.profit)}`, '원'), `total ${tone}`],
    ];
    const rec = r.recommended_price;
    const useRec = h('button', { class: 'btn ghost sm', type: 'button', disabled: !canWrite, onclick: () => { deliveryPrice.value = n3(rec); recalc(); } }, '배달 판매가로 쓰기');
    return h('div', { class: 'chan-res' },
      h('div', { class: 'chan-res-h' }, h('b', null, c.short), stamp(status),
        note ? h('a', { class: 'tag warn', href: '#/delivery', title: '설정 화면에서 정산내역서와 비교해 고쳐 주세요' }, note) : null),
      h('div', { class: 'chan-res-main' },
        h('span', { class: 'small muted' }, '한 건 팔면 남는 돈'),
        r.profit == null ? '–' : h('span', { class: `nu ${tone}` }, h('span', { class: 'n' }, sgn(r.profit)), h('span', { class: 'u' }, '원'))),
      range ? h('p', { class: 'xs muted' }, `추정한 양에 따라 ${sgn(range[0])} ~ ${sgn(range[1])}원`) : null,
      incomplete ? h('p', { class: 'xs', style: 'color:var(--warn-ink, var(--ink))' }, `단가가 없는 재료 ${t.missing}개가 빠져 있어 실제로는 이보다 적게 남을 수 있습니다.`) : null,
      r.ratio_raw == null
        ? h('p', { class: 'small', style: 'color:var(--red);font-weight:600' }, '받는 돈이 0원 이하입니다. 수수료와 배달비가 판매가보다 큽니다.')
        : [marginBar({ ratio: r.ratio_raw, target }),
          h('p', { class: 'xs muted', style: 'margin-top:4px' }, '배달 원가율 ', h('b', { class: 'n' }, n1(r.ratio_raw)), `% · 받는 돈 ${n0(r.net)}원 기준 (목표 ${nT(target)}%)`)],
      h('details', null, h('summary', null, '계산 내역 보기'), stmt(rows2, `${c.short} 계산 내역`)),
      rec
        ? h('div', { class: 'rec' },
          h('span', null, `목표 ${nT(target)}%에 맞는 배달 판매가 `, h('b', { class: 'n' }, n0(rec)), '원', r.price_gap > 0 ? ` (지금보다 +${n0(r.price_gap)}원)` : ''),
          Math.abs(rec - sale) >= 1 ? useRec : null)
        : null);
  }

  function paintDelivery(t) {
    if (!chans.length) {
      fill(chanBox, h('p', { class: 'small muted' }, '쓰는 배달앱의 수수료를 켜 두면, 배달 주문 한 건에 실제로 얼마가 남는지 계산합니다.'),
        h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('a', { class: 'btn ghost sm', href: '#/delivery' }, '배달앱 수수료 설정하기')));
      return;
    }
    const p = parseNum(price.value);
    const dp = parseNum(deliveryPrice.value);
    const sale = dp > 0 ? dp : (p > 0 ? p : 0);
    if (!(sale > 0)) { fill(chanBox, h('p', { class: 'small muted' }, '판매가를 넣으면 배달 손익을 계산합니다.')); return; }
    if (!(t.cost > 0)) { fill(chanBox, h('p', { class: 'small muted' }, '재료와 양을 넣으면 배달 손익을 계산합니다.')); return; }
    fill(chanBox, chans.map((c) => channelBlock(c, channelResult(t.cost, sale, flatChannel(c), target, vat), sale, t)));
  }

  let recommended = null;
  function recalc() {
    const parts = [];
    const missingNames = [];
    let bad = false;
    for (const r of rows) {
      const nm = r.name.value.trim();
      const q = parseNum(r.qty.value);
      const ing = byName.get(nm);
      r.err.textContent = '';
      r.cost.className = 'm-cost muted';
      if (!nm && !r.qty.value.trim()) { r.cost.textContent = '–'; continue; }
      if (!ing) { r.err.textContent = nm ? `'${nm}'은(는) 등록된 식자재가 아닙니다. 목록에서 골라 주세요.` : '재료 이름을 골라 주세요.'; r.cost.textContent = '–'; bad = true; continue; }
      if (!(q > 0)) { r.cost.textContent = '–'; continue; }
      const f = UNIT[r.unit.value].f;
      if (ing.unit_price == null) {
        r.cost.className = 'm-cost noprice';
        r.cost.textContent = '단가 없음';
        if (!missingNames.includes(ing.name)) missingNames.push(ing.name);
        parts.push({ unitPrice: null, yieldPct: ing.yield_pct, qty: q * f, est: r.est, low: null, high: null });
        continue;
      }
      parts.push({
        unitPrice: ing.unit_price, yieldPct: ing.yield_pct, qty: q * f, est: r.est,
        low: r.est && r.low != null ? r.low * f : null, high: r.est && r.high != null ? r.high * f : null,
      });
      r.cost.replaceChildren(h('span', { class: 'n' }, n0(q * f * effUnitCost(ing.unit_price, ing.yield_pct))), '원');
    }
    const p = parseNum(price.value);
    const t = menuTotals(parts, parseNum(other.value) || 0, p, vat, target);
    sumRatio.textContent = t.ratio == null ? '–' : n1(t.ratio);
    sumStamp.replaceChildren(t.ratio == null ? '' : stamp(t.status));
    sumBar.replaceChildren(marginBar({ ratio: t.ratio, target }));
    sumEst.hidden = !(t.estimatedCount && t.ratioLow != null);
    if (!sumEst.hidden) {
      fill(sumEst, '사진 추정이 들어 있어 원가율은 ', h('b', { class: 'n' }, n1(t.ratioLow)), '~', h('b', { class: 'n' }, n1(t.ratioHigh)), '% 사이일 수 있습니다.');
    }
    dCost.replaceChildren(num(n0(t.cost), '원'));
    dMargin.replaceChildren(t.basis > 0 ? num(n0(t.basis - t.cost), '원') : '–');
    dBasis.replaceChildren(t.basis > 0 ? num(n0(t.basis), '원') : '–');
    recommended = t.recommended;
    if (recommended) {
      recText.replaceChildren(`목표 ${nT(target)}%에 맞는 판매가 `, h('b', { class: 'n' }, n0(recommended)), '원');
      applyRec.hidden = !(p > 0) || Math.abs(recommended - p) < 1 || !canWrite;
      applyRec.textContent = '이 가격으로 바꾸기';
    } else {
      recText.textContent = '재료와 양을 넣으면 권장 판매가를 알려 드립니다.';
      applyRec.hidden = true;
    }
    missingBox.hidden = !missingNames.length;
    if (missingNames.length) {
      fill(missingBox, h('b', null, `단가가 없는 재료 ${missingNames.length}개: `), missingNames.join(', '), '. ',
        '이 재료는 원가에 들어가지 않아 실제보다 낮게 나옵니다. ',
        h('a', { href: '#/invoice' }, '거래명세서를 올리면'), ' 단가가 채워지고, ', h('a', { href: '#/ingredients' }, '식자재 화면'), '에서 직접 넣을 수도 있습니다.');
    }
    estTools.hidden = !rows.some((r) => r.est);
    paintDelivery(t);
    return bad;
  }
  applyRec.addEventListener('click', () => { price.value = n3(recommended); recalc(); });
  for (const el of [price, other, deliveryPrice]) el.addEventListener('input', recalc);

  const lines = menu?.lines ?? [];
  if (lines.length) {
    lines.forEach((l) => addRow({ name: l.name, qty: l.qty, unit: l.unit, estimated: l.estimated, qty_low: l.qty_low, qty_high: l.qty_high }));
  } else addRow();

  const estTools = h('div', { class: 'sheet-tools', hidden: true },
    h('button', { class: 'btn ghost sm', type: 'button', disabled: !canWrite, onclick: () => { rows.forEach(confirmEst); recalc(); toast('추정한 양을 모두 확정했습니다. 저장하면 반영됩니다.'); } }, '추정한 양 모두 확정'),
    h('span', { class: 'xs muted' }, '실제로 재 보고 맞다고 판단되면 눌러 주세요.'));

  /* ----- 저장·복제·삭제 ----- */
  const save = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, '저장');
  async function onSave(ev) {
    ev.preventDefault();
    err.hidden = true;
    const items = [];
    for (const r of rows) {
      const nm = r.name.value.trim();
      if (!nm && !r.qty.value.trim()) continue;
      const ing = byName.get(nm);
      const q = parseNum(r.qty.value);
      if (!ing || !(q > 0)) {
        recalc();
        if (ing) r.err.textContent = `'${nm}'의 사용량을 입력해 주세요.`;
        (ing ? r.qty : r.name).focus();
        return;
      }
      items.push({
        ingredient_id: ing.id, qty: q, unit: r.unit.value,
        estimated: r.est, qty_low: r.est ? r.low : null, qty_high: r.est ? r.high : null,
      });
    }
    const dp = parseNum(deliveryPrice.value);
    const body = {
      name: name.value.trim(), price: parseNum(price.value), delivery_price: dp > 0 ? dp : null,
      category: category.value.trim(), note: note.value.trim(), other_cost: parseNum(other.value) || 0, items,
    };
    const problem = !body.name ? '메뉴 이름을 입력해 주세요.' : !(body.price > 0) ? '판매가를 입력해 주세요.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; (body.name ? price : name).focus(); return; }
    await busy(save, async () => {
      let res;
      try {
        res = await api(menu ? `/api/menus/${menu.id}` : '/api/menus', { method: menu ? 'PUT' : 'POST', body });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }
      toast('저장했습니다.');
      if (menu) refreshRoute(); else go(`#/menus/${res.item.id}`);
    });
  }

  async function onDuplicate(ev) {
    await busy(ev.currentTarget, async () => {
      const res = await api(`/api/menus/${menu.id}/duplicate`, { method: 'POST' });
      toast('복제했습니다. 이름과 양을 바꿔 보세요.');
      go(`#/menus/${res.item.id}`);
    });
  }

  async function onDelete() {
    const ok = await confirmDialog({ title: '메뉴 삭제', message: `'${menu.name}' 메뉴를 삭제합니다. 되돌릴 수 없습니다.`, confirmText: '삭제', danger: true });
    if (!ok) return;
    try { await api(`/api/menus/${menu.id}`, { method: 'DELETE' }); } catch (e) { toast(errMsg(e), 'err'); return; }
    toast('삭제했습니다.');
    go('#/menus');
  }

  const moreBox = h('details', { class: 'more', open: !!menu?.note },
    h('summary', null, '분류·메모 (선택)'),
    field('분류', category),
    field('메모', note));

  const form = h('form', { novalidate: true, onsubmit: onSave },
    stickyBar,
    err,
    h('section', { class: 'sheet' },
      h('div', { class: 'two keep' },
        field('메뉴 이름', name),
        field('판매가 (원)', price, vat === 'excl' ? '부가세 포함 가격' : null)),
      moreBox),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '재료와 양'), h('span', { class: 'sub' }, '1인분 기준')),
      ings.length ? null : h('p', { class: 'small', style: 'margin-bottom:8px' }, '등록된 식자재가 없습니다. ', h('a', { href: '#/ingredients' }, '식자재를 먼저 등록'), '해 주세요.'),
      menu ? null : h('p', { class: 'hint', style: 'margin-bottom:6px' }, '재료 양을 잘 모르겠다면 ', h('a', { href: '#/menus/photo' }, '완성된 요리 사진으로 시작'), '해 보세요. 재료와 양을 짐작해 드립니다.'),
      rowsBox,
      h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => addRow().name.focus() }, icon('plus', 18), '재료 추가')),
      estTools,
      h('div', { class: 'other' }, field('기타 원가 (원)', other, '소스·포장처럼 식자재 목록에 없는 비용. 한 그릇 기준.'))),
    detail,
    deliverySec,
    h('div', { class: 'btn-row', style: 'margin-top:16px' }, save,
      menu ? h('button', { class: 'btn ghost', type: 'button', disabled: !canWrite, onclick: onDuplicate }, icon('copy', 18), '복제') : null,
      menu ? h('button', { class: 'btn danger', type: 'button', disabled: !canWrite, onclick: onDelete }, '삭제') : null),
    !canWrite ? h('p', { class: 'hint', style: 'margin-top:10px' }, '체험 기간이 끝나 지금은 수정할 수 없습니다.') : null);

  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/menus' }, icon('back', 18), '메뉴 목록'),
      h('h1', { style: 'font-size:1.125rem' }, menu ? '메뉴 수정' : '새 메뉴')),
    datalist, form);
  recalc();
  if (!menu) name.focus();
}
