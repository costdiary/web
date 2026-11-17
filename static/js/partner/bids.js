/* #/bids: 내가 등록한 제안 목록 — 수정(7일 쿨다운 안내)·철회·기간 연장.
   제안이 어느 사장님에게 닿았는지는 절대 보여주지 않습니다(블라인드 원칙). */
import { h, api, confirmDialog, toast, errMsg, fill } from '../core.js';
import { emptyBlock } from '../ui.js';
import { openBidDialog } from './demands.js';
import { blindNote, loadCatalog, labeler, left, day } from './kit.js';

const STATUS_LABEL = { active: '제안 중', withdrawn: '철회함', expired: '기간 만료' };
const FILTERS = [['active', '제안 중'], ['ended', '끝난 제안'], ['all', '전체']];
const SOON_MS = 3 * 86400000;

function asDemandShape(bid) {
  return {
    demand_id: null,
    item: bid.item, origin: bid.origin, grade: bid.grade, region: { label: bid.region_label || bid.region },
    my_bid: { id: bid.id, pack: bid.pack, vat_type: bid.vat_type, min_order_note: bid.min_order_note || '', price_locked_until: bid.price_locked_until },
  };
}

const isSoon = (bid) => bid.status === 'active' && bid.valid_until && new Date(bid.valid_until).getTime() - Date.now() < SOON_MS;

function row(bid, lab, onChange) {
  const live = bid.status === 'active';
  const editBtn = h('button', { class: 'btn ghost sm', type: 'button', disabled: !live }, isSoon(bid) ? '기간 연장·수정' : '수정');
  editBtn.addEventListener('click', () => openBidDialog(asDemandShape(bid), lab, onChange));
  const withdrawBtn = h('button', { class: 'btn ghost sm', type: 'button', disabled: !live }, '철회');
  withdrawBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '제안 철회', message: '철회하면 같은 품목·원산지·등급·권역으로는 7일 동안 다시 제안할 수 없습니다.', confirmText: '철회', danger: true });
    if (!ok) return;
    try { await api(`/api/ws/bids/${bid.id}`, { method: 'DELETE' }); } catch (e) { toast(errMsg(e), 'err'); return; }
    toast('철회했습니다.');
    onChange();
  });
  const due = live ? left(bid.valid_until) : null;
  return h('li', { class: live ? null : 'dm-ended' }, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, bid.item.name), h('span', { class: `tag${live ? ' ok' : ''}` }, STATUS_LABEL[bid.status] || bid.status),
      isSoon(bid) && due ? h('span', { class: 'tag warn' }, `만료까지 ${due.text.replace(' 남음', '')}`) : null,
      h('div', { class: 'row-sub' }, `${bid.origin_label || lab.origin(bid.origin)} · ${lab.grade(bid.item.id, bid.grade)} · ${bid.region_label || bid.region}`),
      h('div', { class: 'row-sub' }, h('b', { class: 'dm-price' }, `${bid.pack.size}${bid.pack.unit} ${bid.pack.price.toLocaleString()}원`),
        bid.valid_until ? ` · ${day(bid.valid_until)}까지` : '',
        bid.min_order_note ? ` · 최소 주문 ${bid.min_order_note}` : ''),
      bid.price_locked_until ? h('div', { class: 'row-sub' }, `가격은 ${day(bid.price_locked_until)}부터 다시 바꿀 수 있습니다.`) : null),
    h('div', { class: 'btn-row' }, editBtn, withdrawBtn)));
}

export async function render(box) {
  const count = h('span', { class: 'sub' });
  box.append(h('div', { class: 'page-h' }, h('h1', null, '내 제안', count), h('a', { class: 'btn sm', href: '#/demands' }, '수요 보기')));
  const body = h('div');
  let filter = 'active';
  const chips = FILTERS.map(([key, label]) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': key === filter ? 'true' : 'false' }, label);
    b.addEventListener('click', () => { filter = key; for (const c of chips) c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); paint(); });
    return b;
  });
  box.append(
    blindNote('블라인드 제안입니다.', ['어느 사장님이 이 제안을 봤는지, 골랐는지는 이 화면에서도 알려 드리지 않습니다. 사장님이 연결 요청을 보내면 ', h('a', { href: '#/connections' }, '연결 요청'), ' 화면에 나타납니다.']),
    h('div', { class: 'chips', role: 'group', 'aria-label': '제안 상태로 걸러 보기' }, chips),
    body);

  let all = [];
  let lab = null;
  function paint() {
    const shown = all.filter((b) => (filter === 'all' ? true : filter === 'active' ? b.status === 'active' : b.status !== 'active'));
    const active = all.filter((b) => b.status === 'active');
    const soon = active.filter(isSoon).length;
    count.textContent = active.length ? `제안 중 ${active.length}건${soon ? ` · 곧 만료 ${soon}건` : ''}` : '';
    if (!all.length) {
      fill(body, h('section', { class: 'sheet' }, emptyBlock({ title: '등록한 제안이 없습니다', text: '수요 화면에서 팔 수 있는 품목을 골라 가격을 제안해 보세요. 제안 등록에는 비용이 들지 않습니다.', actions: [h('a', { class: 'btn ghost sm', href: '#/demands' }, '수요 보러 가기')] })));
      return;
    }
    fill(body, shown.length
      ? h('section', { class: 'sheet' }, h('ul', { class: 'rows' }, shown.map((b) => row(b, lab, load))))
      : h('section', { class: 'sheet' }, h('p', { class: 'muted' }, filter === 'active' ? '지금 진행 중인 제안이 없습니다.' : '끝난 제안이 없습니다.')));
  }
  async function load() {
    fill(body, h('div', { class: 'skel' }));
    const [{ bids }, catalog] = await Promise.all([api('/api/ws/bids'), loadCatalog()]);
    all = bids;
    lab = labeler(catalog);
    if (filter === 'active' && bids.length && !bids.some((b) => b.status === 'active')) {
      filter = 'all';
      for (const [i, c] of chips.entries()) c.setAttribute('aria-pressed', FILTERS[i][0] === 'all' ? 'true' : 'false');
    }
    paint();
  }
  await load();
}
