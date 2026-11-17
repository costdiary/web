/* #/billing: 결제 내역 — 떨이 광고비(무통장 입금·카드). 도매마켓에서 결제가 생기는 곳은 광고뿐이다. */
import { h, api, n0 } from '../core.js';
import { emptyBlock } from '../ui.js';
import { statTile, day } from './kit.js';

const PAY_STATUS = { requested: '입금 확인 대기', paid: '결제 완료', cancelled: '취소', refunded: '환불', failed: '결제 실패' };
const METHOD = { invoice: '무통장 입금', pg: '카드' };

export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '결제 내역'), h('a', { class: 'btn ghost sm', href: '#/ads' }, '떨이 광고')));
  const { payments, summary, pricing } = await api('/api/ws/billing');
  const month = `${Number(summary.month.slice(5, 7))}월`;
  box.append(
    h('div', { class: 'dm-stats three' },
      statTile({ label: `${month} 광고비`, value: n0(summary.paid_month), unit: '원' }),
      statTile({ label: '누적 광고비', value: n0(summary.paid_total), unit: '원' }),
      statTile({ label: '입금 확인 대기', value: n0(summary.waiting), unit: '원', tone: summary.waiting ? 'hot' : '' })),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '요금 안내')),
      h('dl', { class: 'kv' },
        h('dt', null, '가입·수요 열람'), h('dd', null, '무료'),
        h('dt', null, '제안 등록'), h('dd', null, '무료'),
        h('dt', null, '떨이 광고'), h('dd', null, `하루 ${n0(pricing.per_day)}원 (1~14일)`)),
      pricing.bank_note ? h('p', { class: 'small muted', style: 'margin-top:10px' }, `무통장 입금 안내: ${pricing.bank_note}`) : null,
      h('p', { class: 'hint', style: 'margin-top:8px' }, '식당과의 거래 대금은 도매마켓을 거치지 않고 두 분이 직접 주고받습니다.')),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '내역'), payments.length ? h('span', { class: 'sub' }, `${payments.length}건`) : null),
      payments.length
        ? h('ul', { class: 'rows' }, payments.map((p) => h('li', null, h('a', { class: 'row', href: `#/ads/${p.ad_id}` },
          h('div', { class: 'row-main' },
            h('span', { class: 'row-title' }, p.ad_title),
            h('span', { class: `tag${p.status === 'paid' ? ' ok' : p.status === 'requested' ? ' warn' : p.status === 'failed' ? ' bad' : ''}` }, PAY_STATUS[p.status] || p.status),
            h('div', { class: 'row-sub' }, `${METHOD[p.method] || p.method} · ${p.run_days}일 노출 · ${day(p.paid_at || p.requested_at)}${p.paid_at ? ' 결제' : ' 신청'}${p.tax_invoice ? ' · 세금계산서 요청' : ''}`)),
          h('div', { class: 'row-end' }, h('span', { class: 'nu' }, h('span', { class: 'n' }, n0(p.amount)), h('span', { class: 'u' }, '원')))))))
        : emptyBlock({ title: '결제 내역이 없습니다', text: '떨이 광고를 결제하면 여기에 기록됩니다.', actions: [h('a', { class: 'btn ghost sm', href: '#/ads/new' }, '떨이 광고 내기')] })));
}
