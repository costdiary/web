/* #/connections: 받은 연결 요청 — 수락·거절(72시간), 수락 뒤 할 일 안내, 거래 결과 기록 */
import { h, api, busy, toast, errMsg, fill, confirmDialog } from '../core.js';
import { emptyBlock } from '../ui.js';
import { pic, left, when, setInbox } from './kit.js';

const STATUS_LABEL = { requested: '응답 대기', accepted: '수락함', declined: '거절함', expired: '기간 만료', closed: '종료' };
const SOURCE_LABEL = { bid: '내 제안을 보고', ad: '떨이 광고를 보고' };

const telHref = (s) => { const d = String(s || '').replace(/[^\d+]/g, ''); return d.length >= 8 ? `tel:${d}` : null; };

function contactLine(c) {
  const tel = telHref(c.buyer.contact);
  return h('div', { class: 'dm-contact' },
    h('span', null, c.buyer.name ? `가게 ${c.buyer.name}` : '가게 이름 비공개'),
    tel
      ? h('a', { class: 'btn ghost sm', href: tel }, pic('phone', 16), c.buyer.contact)
      : h('span', null, `연락처 ${c.buyer.contact}`));
}

function nextSteps() {
  return h('ol', { class: 'dm-next' },
    h('li', null, h('b', null, '먼저 연락하세요. '), '위 연락처로 전화나 문자를 주세요. 빠를수록 좋습니다.'),
    h('li', null, h('b', null, '견적과 배송 조건을 맞추세요. '), '제안한 단가·최소 주문·배송 요일을 직접 협의합니다. 대금도 두 분이 직접 주고받습니다.'),
    h('li', null, h('b', null, '거래 결과를 기록하세요. '), '거래했는지 아래에서 눌러 주면 판매자 신뢰도에 반영됩니다.'));
}

function card(c, onChange) {
  const actions = [];
  const act = (label, cls, fn) => h('button', { class: cls, type: 'button', onclick: (e) => busy(e.currentTarget, fn) }, label);
  if (c.status === 'requested') {
    actions.push(
      act('수락하고 연락하기', 'btn sm', async () => {
        try { await api(`/api/ws/connections/${c.id}/respond`, { method: 'POST', body: { accept: true } }); } catch (er) { toast(errMsg(er), 'err'); return; }
        toast('수락했습니다. 사장님께 먼저 연락해 주세요.'); onChange();
      }),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: '연결 요청 거절', message: '거절하면 이 요청은 되돌릴 수 없습니다. 재고나 배송이 맞지 않을 때만 거절해 주세요.', confirmText: '거절', danger: true });
        if (!ok) return;
        try { await api(`/api/ws/connections/${c.id}/respond`, { method: 'POST', body: { accept: false } }); } catch (er) { toast(errMsg(er), 'err'); return; }
        toast('거절했습니다.'); onChange();
      } }, '거절'));
  } else if (c.status === 'accepted' && c.my_outcome == null) {
    const record = (outcome) => async () => {
      try { await api(`/api/ws/connections/${c.id}/outcome`, { method: 'POST', body: { outcome } }); } catch (er) { toast(errMsg(er), 'err'); return; }
      toast('기록했습니다.'); onChange();
    };
    actions.push(act('거래했어요', 'btn sm', record('done')), act('안 했어요', 'btn ghost sm', record('failed')));
  }
  const due = c.status === 'requested' ? left(c.respond_by) : null;
  return h('li', null, h('article', { class: 'dm-conn' },
    h('div', { class: 'row-main' },
      h('h3', { class: 'row-title' }, c.item_name),
      h('span', { class: `tag${c.status === 'accepted' ? ' ok' : c.status === 'requested' ? ' warn' : ''}` }, STATUS_LABEL[c.status] || c.status),
      due ? h('span', { class: `tag${due.urgent ? ' bad' : ''}` }, due.text) : null),
    h('p', { class: 'row-sub' }, `${SOURCE_LABEL[c.source] || ''}${c.ad_title ? ` “${c.ad_title}”` : ''} · ${when(c.requested_at)} 요청`),
    contactLine(c),
    c.buyer.message ? h('blockquote', { class: 'dm-quote' }, c.buyer.message) : null,
    c.status === 'requested' && c.respond_by ? h('p', { class: 'xs muted' }, `${when(c.respond_by)}까지 응답해 주세요 (72시간 내). 지나면 자동으로 만료되고 신뢰도에 불리하게 반영됩니다.`) : null,
    c.status === 'accepted' && c.my_outcome == null ? nextSteps() : null,
    c.my_outcome ? h('p', { class: 'xs muted' }, c.my_outcome === 'done' ? '거래 완료로 기록함' : '거래하지 않음으로 기록함') : null,
    actions.length ? h('div', { class: 'btn-row', style: 'margin-top:10px' }, actions) : null));
}

function group(title, sub, items, onChange) {
  if (!items.length) return null;
  return h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, title), h('span', { class: 'sub' }, sub)),
    h('ul', { class: 'rows' }, items.map((c) => card(c, onChange))));
}

export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '연결 요청')));
  const body = h('div', { class: 'stack' });
  box.append(body);
  async function load() {
    fill(body, h('div', { class: 'skel' }));
    const { connections } = await api('/api/ws/connections');
    const waiting = connections.filter((c) => c.status === 'requested');
    const going = connections.filter((c) => c.status === 'accepted' && c.my_outcome == null);
    const past = connections.filter((c) => !waiting.includes(c) && !going.includes(c));
    setInbox(waiting.length);
    if (!connections.length) {
      fill(body, h('section', { class: 'sheet' }, emptyBlock({
        title: '받은 연결 요청이 없습니다',
        text: '사장님이 내 제안이나 떨이 광고를 보고 연결 요청을 보내면 여기에 나타납니다. 요청이 오기 전에는 서로 누구인지 알 수 없습니다.',
        actions: [h('a', { class: 'btn ghost sm', href: '#/demands' }, '수요 보고 제안하기'), h('a', { class: 'btn ghost sm', href: '#/ads/new' }, '떨이 광고 내기')],
      })));
      return;
    }
    fill(body,
      group('응답 대기', `${waiting.length}건 · 72시간 안에 응답`, waiting, load),
      group('진행 중', `${going.length}건 · 연락하고 거래 결과 기록`, going, load),
      group('지난 요청', `${past.length}건`, past, load));
  }
  await load();
}
