/* 주문건 연동(배민·쿠팡이츠): 지금은 파트너 API 키가 없어 '연결하기'를 누르면 예시 주문으로 틀을 보여 줍니다.
   메뉴 이름이 같으면 자동으로 재료비와 연결되어 건별 손익이 계산됩니다. 실제 키가 들어오면 서버 쪽
   (order_integrations.py)만 바꾸면 되고, 이 화면은 그대로 씁니다. */
import { h, api, icon, busy, toast, errMsg, refreshRoute, n0, n1 } from './core.js';
import { emptyBlock, num } from './ui.js';

const PLATFORM_LABEL = { baemin: '배민', coupangeats: '쿠팡이츠' };

function platformRow(p, onSync) {
  const btn = h('button', { class: 'btn ghost sm', type: 'button' }, p.connected ? '다시 가져오기' : '연결하기(예시 주문)');
  btn.addEventListener('click', () => onSync(p.platform, btn));
  return h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, p.label),
      h('div', { class: 'row-sub' }, p.connected ? '연결됨 · 예시 주문으로 동작 중' : '아직 연결 안 함')),
    btn));
}

function orderRow(o) {
  const tone = o.margin_pct == null ? '' : o.margin_pct < 0 ? 'neg' : 'pos';
  return h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, o.menu_name, o.ad_fee > 0 ? h('span', { class: 'tag warn' }, '광고 유입') : null),
      h('div', { class: 'row-sub' }, `${PLATFORM_LABEL[o.platform] || o.platform} · ${o.ordered_at.slice(0, 10)} · 주문금액 ${n0(o.order_amount)}원`)),
    h('div', { class: 'row-end' },
      o.margin_pct == null
        ? h('span', { class: 'tag bad' }, '메뉴 연결 필요')
        : h('span', { class: `nu ${tone}` }, h('span', { class: 'n' }, n1(o.margin_pct)), h('span', { class: 'u' }, '%')))));
}

export async function render(box) {
  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/revenue' }, icon('back', 18), '매출관리'),
      h('h1', null, '주문건 연동')),
    h('p', { class: 'hint', style: 'margin-bottom:10px' },
      '실제 배달앱 파트너 연동 전이라 지금은 예시 주문으로 화면을 확인합니다. 메뉴 이름이 똑같으면 자동으로 재료비와 연결되어 건별 손익이 계산됩니다.'));

  const [platRes, ordRes] = await Promise.all([api('/api/orders/platforms'), api('/api/orders')]);

  const onSync = async (platform, btn) => {
    await busy(btn, async () => {
      try { await api(`/api/orders/platforms/${platform}/sync`, { method: 'POST' }); } catch (e) { toast(errMsg(e), 'err'); return; }
      toast('가져왔습니다.');
      refreshRoute();
    });
  };
  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '연동')),
    h('ul', { class: 'rows' }, platRes.items.map((p) => platformRow(p, onSync)))));

  const s = ordRes.summary;
  if (!s.count) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: '아직 가져온 주문이 없습니다',
      text: '위에서 배달앱을 연결하면 예시 주문 20건을 가져옵니다.',
    })));
    return;
  }

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '요약'), h('span', { class: 'sub' }, '최근 가져온 주문 기준')),
    h('dl', { class: 'sum-grid' },
      h('div', null, h('dt', null, '주문 건수'), h('dd', null, num(n0(s.count), '건'))),
      h('div', null, h('dt', null, '매출'), h('dd', null, num(n0(s.total_sales || 0), '원'))),
      h('div', null, h('dt', null, '순이익'), h('dd', null, num(n0(s.total_profit || 0), '원'))),
      h('div', null, h('dt', null, '평균 마진율'), h('dd', null, s.avg_margin_pct == null ? '–' : num(n1(s.avg_margin_pct), '%')))),
    s.ad_avg_margin_pct != null
      ? h('p', { class: 'xs muted', style: 'margin-top:8px' },
        '광고로 들어온 주문 평균 마진 ', h('b', { class: 'n' }, n1(s.ad_avg_margin_pct)), '% · 일반 주문 평균 마진 ', h('b', { class: 'n' }, n1(s.plain_avg_margin_pct)), '%',
        s.ad_avg_margin_pct < s.plain_avg_margin_pct ? ' — 광고로 들어온 주문이 더 적게 남고 있습니다.' : '')
      : null,
    s.unmatched
      ? h('p', { class: 'xs', style: 'margin-top:6px;color:var(--warn-ink, var(--ink))' }, `메뉴 이름이 안 맞아 연결되지 않은 주문 ${s.unmatched}건. 메뉴 이름을 원가다이어리에 등록한 이름과 똑같이 맞춰 보세요.`)
      : null));

  if (ordRes.worst_menus?.length) {
    box.append(h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '덜 남는 메뉴')),
      h('ul', { class: 'rows' }, ordRes.worst_menus.map((m) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, m.name), h('div', { class: 'row-sub' }, `주문 ${m.count}건`)),
        h('div', { class: 'row-end' }, h('span', { class: 'nu' }, h('span', { class: 'n' }, n1(m.avg_margin_pct)), h('span', { class: 'u' }, '%')))))))));
  }

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '주문 목록'), h('span', { class: 'sub' }, `${s.count}건`)),
    h('ul', { class: 'rows' }, ordRes.items.slice(0, 50).map(orderRow))));
}
