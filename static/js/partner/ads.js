/* #/ads, #/ads/new, #/ads/:id: 떨이 광고 — 작성, 결제 신청, 노출 멈춤/재개, 예상 도달 */
import {
  h, api, field, numInput, selectOf, parseNum, n0, openDialog, busy, toast, errMsg, icon, fill,
} from '../core.js';
import { emptyBlock } from '../ui.js';
import { REGIONS, REGION_LABEL, loadCatalog, labeler, day, left } from './kit.js';

const STATUS_LABEL = { draft: '결제 전', pending_payment: '입금 확인 대기', active: '노출 중', paused: '멈춤', ended: '종료', rejected: '반려' };
const VAT_LABEL = { incl: '부가세 포함', excl: '부가세 별도', exempt: '면세' };

function statusChip(s) {
  return h('span', { class: `tag${s === 'active' ? ' ok' : s === 'rejected' ? ' bad' : s === 'pending_payment' || s === 'draft' ? ' warn' : ''}` }, STATUS_LABEL[s] || s);
}

function period(a) {
  if (a.status === 'active' && a.ends_at) { const l = left(a.ends_at); return `${day(a.ends_at)}까지 노출${l && !l.over ? ` (${l.text})` : ''}`; }
  if (a.status === 'ended' && a.ends_at) return `${day(a.ends_at)} 종료`;
  return `${a.run_days}일 노출 예정`;
}

export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '떨이 광고'), h('a', { class: 'btn sm', href: '#/ads/new' }, icon('plus', 18), '새 광고')));
  const { ads, pricing } = await api('/api/ws/ads');
  box.append(h('p', { class: 'small muted', style: 'margin:-6px 0 14px' },
    `남는 재고를 내 권역 사장님들에게 바로 알리는 광고입니다. 하루 ${n0(pricing.per_day)}원이고, 결제가 확인되면 노출이 시작됩니다. `,
    h('a', { href: '#/billing' }, '결제 내역 보기')));
  box.append(ads.length
    ? h('section', { class: 'sheet' }, h('ul', { class: 'rows' }, ads.map((a) => h('li', null,
      h('a', { class: 'row', href: `#/ads/${a.id}` },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, a.title), statusChip(a.status),
          h('div', { class: 'row-sub' }, `${a.item_name} · ${a.pack_size}${a.pack_unit} ${a.pack_price.toLocaleString()}원 · ${period(a)}`)),
        h('div', { class: 'row-end' }, h('span', { class: 'nu' }, h('span', { class: 'n' }, n0(a.amount)), h('span', { class: 'u' }, '원')))))))) 
    : h('section', { class: 'sheet' }, emptyBlock({
      title: '등록한 떨이 광고가 없습니다',
      text: '유통기한이 임박했거나 물량이 남을 때, 가격을 공개하고 빠르게 팔 수 있습니다. 블라인드 제안과 달리 광고는 가격이 사장님에게 그대로 보입니다.',
      actions: [h('a', { class: 'btn ghost sm', href: '#/ads/new' }, '새 광고 만들기')],
    })));
}

async function adForm(box, existing, perDay) {
  const catalog = await loadCatalog();
  const itemSel = selectOf([['', '표준 품목 선택'], ...catalog.items.map((i) => [String(i.id), i.name])], existing ? String(existing.item_id) : '');
  const originSel = selectOf(catalog.origins.map((o) => [o.code, o.label]), existing?.origin || '');
  const gradeSel = h('select', { class: 'select' });
  const title = h('input', { class: 'input', type: 'text', maxLength: 40, value: existing?.title || '', placeholder: '예: 대파 재고 떨이 (3일 한정)' });
  const body = h('textarea', { class: 'textarea', maxLength: 500, value: existing?.body || '' });
  const size = numInput({ value: existing ? String(existing.pack_size) : '' });
  const unit = selectOf(['kg', 'g', 'L', 'ml', '개'], existing?.pack_unit || 'kg');
  const price = numInput({ value: existing ? String(existing.pack_price) : '' });
  const vat = selectOf([['incl', '부가세 포함'], ['excl', '부가세 별도'], ['exempt', '면세']], existing?.vat_type || 'incl');
  const stock = h('input', { class: 'input', type: 'text', maxLength: 100, value: existing?.stock_note || '', placeholder: '예: 50박스 한정' });
  const runDays = numInput({ value: existing ? String(existing.run_days) : '3' });
  const regionChecks = REGIONS.map(([code, label]) => {
    const c = h('input', { type: 'checkbox', value: code, checked: (existing?.regions || []).includes(code) });
    return h('label', { class: 'radio' }, c, h('span', null, label));
  });
  function paintGrades() {
    const item = catalog.items.find((i) => String(i.id) === itemSel.value);
    const grades = (item && catalog.grades[item.category]) || [{ code: 'NA', label: '등급없음' }];
    fill(gradeSel, grades.map((g) => h('option', { value: g.code }, g.label)));
    if (existing?.grade && grades.some((g) => g.code === existing.grade)) gradeSel.value = existing.grade;
  }
  itemSel.addEventListener('change', paintGrades);
  paintGrades();

  // 광고비 미리 보기(서버가 알려 준 일 단가 기준. 실제 청구 금액은 결제 신청 때 서버가 다시 계산한다).
  const cost = h('p', { class: 'dm-preview', 'aria-live': 'polite' });
  const paintCost = () => {
    const rd = parseNum(runDays.value);
    cost.textContent = rd >= 1 && rd <= 14 && perDay ? `광고비: ${n0(perDay)}원 × ${rd}일 = ${n0(perDay * rd)}원` : '';
  };
  runDays.addEventListener('input', paintCost);
  paintCost();

  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn', type: 'submit' }, existing ? '저장' : '만들기');
  const form = h('form', { novalidate: true },
    err,
    field('표준 품목', itemSel), field('원산지', originSel), field('등급', gradeSel),
    field('제목', title), field('내용 (선택)', body),
    h('div', { class: 'pair' }, field('규격 수량', size), field('단위', unit)),
    field('규격 가격 (원)', price), field('부가세', vat),
    field('재고 안내 (선택)', stock),
    field('노출 기간 (일)', runDays, '1~14일'),
    cost,
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, '노출할 권역 (1개 이상)'), h('div', { class: 'radios' }, regionChecks)),
    submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const s = parseNum(size.value);
    const p = parseNum(price.value);
    const rd = parseNum(runDays.value);
    const regions = regionChecks.filter((l) => l.firstChild.checked).map((l) => l.firstChild.value);
    if (!itemSel.value) { err.textContent = '표준 품목을 선택해 주세요.'; err.hidden = false; return; }
    if (!title.value.trim()) { err.textContent = '제목을 입력해 주세요.'; err.hidden = false; return; }
    if (!(s > 0 && p > 0)) { err.textContent = '규격과 가격을 입력해 주세요.'; err.hidden = false; return; }
    if (!(rd >= 1 && rd <= 14)) { err.textContent = '노출 기간은 1에서 14일 사이로 넣어 주세요.'; err.hidden = false; return; }
    if (!regions.length) { err.textContent = '권역을 1개 이상 선택해 주세요.'; err.hidden = false; return; }
    const payload = { item_id: Number(itemSel.value), origin: originSel.value, grade: gradeSel.value, title: title.value.trim(), body: body.value.trim(), pack_size: s, pack_unit: unit.value, pack_price: p, vat_type: vat.value, stock_note: stock.value.trim(), run_days: rd, regions };
    await busy(submit, async () => {
      let res;
      try {
        res = existing ? await api(`/api/ws/ads/${existing.id}`, { method: 'PUT', body: payload }) : await api('/api/ws/ads', { method: 'POST', body: payload });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      toast(existing ? '저장했습니다.' : '만들었습니다. 결제를 신청하면 노출이 시작됩니다.');
      location.hash = `#/ads/${res.id}`;
    });
  });
  box.append(h('section', { class: 'sheet' }, form));
}

export async function renderNew(box) {
  box.append(h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: '#/ads' }, icon('back', 18), '떨이 광고'), h('h1', { style: 'font-size:1.125rem' }, '새 광고')));
  const { pricing } = await api('/api/ws/ads');
  await adForm(box, null, pricing.per_day);
}

export async function renderEdit(box, id) {
  box.append(h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: `#/ads/${id}` }, icon('back', 18), '광고'), h('h1', { style: 'font-size:1.125rem' }, '광고 수정')));
  const { ads, pricing } = await api('/api/ws/ads');
  const ad = ads.find((a) => a.id === id);
  if (!ad) { box.append(h('section', { class: 'sheet' }, h('p', null, '찾지 못했습니다.'))); return; }
  if (ad.status !== 'draft' && ad.status !== 'rejected') {
    box.append(h('section', { class: 'sheet' }, h('p', null, '결제를 신청한 뒤에는 광고 내용을 바꿀 수 없습니다.'),
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('a', { class: 'btn ghost sm', href: `#/ads/${id}` }, '광고로 돌아가기'))));
    return;
  }
  await adForm(box, ad, pricing.per_day);
}

function openPayDialog(ad, onDone) {
  const depositor = h('input', { class: 'input', type: 'text', maxLength: 40 });
  const taxInvoice = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn', type: 'submit' }, '결제 신청');
  const form = h('form', { novalidate: true },
    err,
    h('p', null, `${ad.run_days}일 노출 · 결제 금액 `, h('b', null, `${n0(ad.amount)}원`)),
    h('p', { class: 'hint', style: 'margin-bottom:12px' }, '신청한 뒤 안내된 계좌로 입금하면, 운영팀이 확인하는 대로 노출이 시작됩니다.'),
    field('입금자명', depositor),
    h('label', { class: 'radio' }, taxInvoice, h('span', null, '세금계산서 발행 요청')),
    submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (!depositor.value.trim()) { err.textContent = '입금자명을 입력해 주세요.'; err.hidden = false; return; }
    await busy(submit, async () => {
      let res;
      try { res = await api(`/api/ws/ads/${ad.id}/request-payment`, { method: 'POST', body: { depositor_name: depositor.value.trim(), tax_invoice: taxInvoice.checked } }); } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast('결제를 신청했습니다. 입금 확인 후 노출이 시작됩니다.');
      if (res.payment?.bank_note) toast(res.payment.bank_note);
      if (onDone) onDone();
    });
  });
  const dlg = openDialog({ title: '결제 신청 (무통장 입금)', content: form });
}

async function payWithCard(ad, onDone) {
  // 토스페이먼츠 등 PG 연동 기반: 서버가 주문정보를 내려주면, 실제 서비스에서는 그 정보로
  // 결제위젯을 띄운다. 지금은 연동 기반 단계라 위젯 대신, 모의(mock) 모드에서만 결제를
  // 끝까지 흘려볼 수 있다(실제 PG 키가 없으면 결제창 없이 바로 승인까지 확인).
  let res;
  try { res = await api(`/api/ws/ads/${ad.id}/pay/pg`, { method: 'POST', body: {} }); } catch (e) { toast(errMsg(e), 'err'); return; }
  const pay = res.payment;
  if (pay.provider !== 'mock') {
    toast('카드 결제창 연결은 다음 단계에서 준비됩니다. 지금은 무통장 입금으로 결제해 주세요.');
    if (onDone) onDone();
    return;
  }
  try {
    await api('/api/ws/ads/pay/pg/confirm', { method: 'POST', body: { order_id: pay.order_id, payment_key: `mock-${pay.id}` } });
  } catch (e) { toast(errMsg(e), 'err'); return; }
  toast('결제가 완료되어 노출을 시작합니다. (모의 결제)');
  if (onDone) onDone();
}

export async function renderDetail(box, id) {
  box.append(h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: '#/ads' }, icon('back', 18), '떨이 광고'), h('h1', { style: 'font-size:1.125rem' }, '광고')));
  const body = h('div', { class: 'stack' });
  box.append(body);
  const lab = labeler(await loadCatalog());
  async function load() {
    const { ads } = await api('/api/ws/ads');
    const ad = ads.find((a) => a.id === id);
    if (!ad) { fill(body, h('section', { class: 'sheet' }, h('p', null, '찾지 못했습니다.'))); return; }
    const unpaid = ad.status === 'draft' || ad.status === 'rejected';
    const actions = [];
    if (unpaid) {
      actions.push(h('button', { class: 'btn', type: 'button', onclick: () => openPayDialog(ad, load) }, '결제 신청 (무통장 입금)'));
      actions.push(h('button', { class: 'btn ghost', type: 'button', onclick: (e) => busy(e.currentTarget, () => payWithCard(ad, load)) }, '카드로 결제'));
      actions.push(h('a', { class: 'btn ghost', href: `#/ads/${ad.id}/edit` }, '내용 수정'));
    }
    if (ad.status === 'active') actions.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api(`/api/ws/ads/${ad.id}/pause`, { method: 'POST' }); toast('멈췄습니다.'); load(); }) }, '노출 멈추기'));
    if (ad.status === 'paused') actions.push(h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api(`/api/ws/ads/${ad.id}/resume`, { method: 'POST' }); toast('다시 시작했습니다.'); load(); }) }, '다시 시작'));
    const reachBtn = h('button', { class: 'btn ghost sm', type: 'button' }, '예상 도달 보기');
    const reachOut = h('p', { class: 'small', style: 'margin-top:8px', 'aria-live': 'polite' });
    reachBtn.addEventListener('click', () => busy(reachBtn, async () => {
      const r = await api(`/api/ws/ads/${ad.id}/reach`);
      reachOut.textContent = `이 광고가 전달된 식당: ${r.reach_band}`;
    }));
    const next = {
      draft: '결제를 마치면 노출이 시작됩니다. 결제 전에는 내용을 자유롭게 고칠 수 있습니다.',
      rejected: '반려된 광고입니다. 내용을 고친 뒤 다시 결제를 신청해 주세요.',
      pending_payment: '입금 확인을 기다리고 있습니다. 확인되는 대로 자동으로 노출이 시작됩니다.',
      active: '내 권역 사장님들에게 노출되고 있습니다. 문의는 ‘연결 요청’으로 들어옵니다.',
      paused: '노출을 멈춘 상태입니다. 멈춘 동안에도 노출 기간은 그대로 흐릅니다.',
      ended: '노출 기간이 끝났습니다. 같은 내용으로 다시 내려면 새 광고를 만들어 주세요.',
    }[ad.status];
    fill(body,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, ad.title), statusChip(ad.status)),
        next ? h('p', { class: 'small muted' }, next) : null,
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, actions, ad.status === 'active' || ad.status === 'paused' || ad.status === 'ended' ? reachBtn : null), reachOut),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '광고 내용')),
        h('dl', { class: 'kv' },
          h('dt', null, '품목'), h('dd', null, `${ad.item_name} · ${lab.origin(ad.origin)} · ${lab.grade(ad.item_id, ad.grade)}`),
          h('dt', null, '가격'), h('dd', null, `${ad.pack_size}${ad.pack_unit} ${ad.pack_price.toLocaleString()}원 (${VAT_LABEL[ad.vat_type] || ''})`),
          ad.stock_note ? [h('dt', null, '재고 안내'), h('dd', null, ad.stock_note)] : null,
          h('dt', null, '노출 권역'), h('dd', null, ad.regions.map((r) => REGION_LABEL[r] || r).join(', ') || '–'),
          h('dt', null, '노출 기간'), h('dd', null, ad.starts_at ? `${day(ad.starts_at)} ~ ${day(ad.ends_at)} (${ad.run_days}일)` : `${ad.run_days}일 (결제 확인 뒤 시작)`),
          h('dt', null, '광고비'), h('dd', null, `${n0(ad.payment ? ad.payment.amount : ad.amount)}원`, ad.payment ? ` · ${{ requested: '입금 확인 대기', paid: '결제 완료', failed: '결제 실패', cancelled: '취소', refunded: '환불' }[ad.payment.status] || ''}` : ' · 결제 전')),
        ad.body ? h('p', { class: 'dm-quote', style: 'margin-top:12px' }, ad.body) : null,
        h('p', { style: 'margin-top:12px' }, h('a', { href: '#/billing' }, '결제 내역 보기'))));
  }
  await load();
}
