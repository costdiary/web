/* #/home: 판매자 홈 — 오늘 할 일, 내 영업 현황, 응답·거래 성과, 시작 가이드.
   여기 숫자는 전부 "내가 이미 아는 것"(내 제안·광고·받은 연결 요청)과 수요 화면에 공개된 건수뿐이다.
   제안이 어느 식당에 닿았는지는 이 화면에서도 알려 주지 않는다. */
import { h, api, app, n0, icon } from '../core.js';
import { pic, statTile, left, setInbox } from './kit.js';

const TODO = {
  regions: () => ({ ic: pic('pin'), title: '배송 가능 권역을 먼저 골라 주세요', sub: '권역을 고르기 전에는 수요가 보이지 않습니다.', href: '#/profile', cta: '권역 설정' }),
  respond: (t) => ({ ic: icon('bell'), title: `응답을 기다리는 연결 요청 ${t.count}건`, sub: '72시간 안에 수락하거나 거절해 주세요. 지나면 자동으로 만료됩니다.', href: '#/connections', cta: '응답하기' }),
  outcome: (t) => ({ ic: icon('check'), title: `거래 결과를 기록할 연결 ${t.count}건`, sub: '거래했는지 기록해 두면 판매자 신뢰도에 반영됩니다.', href: '#/connections', cta: '기록하기' }),
  bids_expiring: (t) => ({ ic: pic('clock'), title: `곧 만료되는 제안 ${t.count}건`, sub: '유효 기간을 늘리려면 제안을 열어 다시 저장하세요. 가격을 그대로 두면 횟수 제한이 없습니다.', href: '#/bids', cta: '제안 보기' }),
  ads_unpaid: (t) => ({ ic: pic('card'), title: `결제 전인 떨이 광고 ${t.count}건`, sub: '결제를 마쳐야 사장님 화면에 노출됩니다.', href: '#/ads', cta: '광고 보기' }),
  ads_pending: (t) => ({ ic: pic('card'), title: `입금 확인을 기다리는 광고 ${t.count}건`, sub: '입금이 확인되면 바로 노출이 시작됩니다.', href: '#/billing', cta: '결제 내역' }),
};

function todoList(todo) {
  if (!todo.length) {
    return h('div', { class: 'dm-clear' }, icon('check', 22), h('div', null,
      h('b', null, '지금 처리할 일이 없습니다.'), h('p', { class: 'small muted' }, '새 수요가 올라왔는지 확인하고 제안을 넓혀 보세요.')));
  }
  return h('ul', { class: 'dm-todo' }, todo.map((t) => {
    const v = (TODO[t.kind] || (() => null))(t);
    if (!v) return null;
    const due = left(t.due);
    return h('li', null, h('a', { class: `dm-todo-row${due?.urgent ? ' urgent' : ''}`, href: v.href },
      h('span', { class: 'dm-todo-ic' }, v.ic),
      h('span', { class: 'dm-todo-main' }, h('b', null, v.title), due ? h('span', { class: `tag${due.urgent ? ' bad' : ''}` }, due.text) : null,
        h('span', { class: 'dm-todo-sub' }, v.sub)),
      h('span', { class: 'dm-todo-cta' }, v.cta, pic('arrow', 16))));
  }));
}

function weeksChart(weeks) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const total = weeks.reduce((a, w) => a + w.count, 0);
  return h('figure', { class: 'dm-weeks' },
    h('figcaption', { class: 'small muted' }, `최근 8주 동안 받은 연결 요청 ${total}건`),
    h('ol', { class: 'dm-weeks-bars', 'aria-label': '주별 연결 요청 수' }, weeks.map((w, i) => {
      const md = `${Number(w.week_start.slice(5, 7))}/${Number(w.week_start.slice(8, 10))}`;
      return h('li', { class: i === weeks.length - 1 ? 'now' : null },
        h('span', { class: 'n' }, w.count ? String(w.count) : ''),
        h('i', { style: `height:${Math.max(4, Math.round((w.count / max) * 56))}px`, 'aria-hidden': 'true' }),
        h('span', { class: 'lbl' }, h('span', { class: 'sr' }, `${md} 주 ${w.count}건 `), h('span', { 'aria-hidden': 'true' }, i === weeks.length - 1 ? '이번 주' : md)));
    })));
}

function onboarding(o) {
  const steps = [
    [o.verified, '사업자 인증', '#/verify'],
    [o.regions, '배송 가능 권역 설정', '#/profile'],
    [o.contact, '담당자 연락처 등록', '#/profile'],
    [o.intro, '업체 소개 한 줄 쓰기', '#/profile'],
    [o.first_bid, '첫 제안 등록', '#/demands'],
  ];
  const done = steps.filter(([ok]) => ok).length;
  if (done === steps.length) return null;
  return h('section', { class: 'sheet', 'aria-labelledby': 'ob-t' },
    h('div', { class: 'sheet-h' }, h('h2', { id: 'ob-t' }, '시작 가이드'), h('span', { class: 'sub' }, `${done}/${steps.length} 완료`)),
    h('div', { class: 'meter', role: 'img', 'aria-label': `시작 가이드 ${steps.length}단계 중 ${done}단계 완료` }, h('i', { style: `width:${Math.round((done / steps.length) * 100)}%` })),
    h('ul', { class: 'dm-check' }, steps.map(([ok, label, href]) => h('li', { class: ok ? 'done' : null },
      h('span', { class: 'dm-check-ic', 'aria-hidden': 'true' }, ok ? icon('check', 16) : null),
      ok ? h('span', null, label, h('span', { class: 'sr' }, ' (완료)')) : h('a', { href }, label)))));
}

export async function render(box) {
  const ws = app.me;
  const d = await api('/api/ws/dashboard');
  setInbox(d.connections.pending);
  const c = d.connections;
  const rate = c.response_rate == null ? '–' : String(Math.round(c.response_rate * 100));
  const hello = new Date().getHours() < 11 ? '좋은 아침입니다' : '안녕하세요';

  box.append(
    h('div', { class: 'dm-hello' },
      h('p', { class: 'dm-hello-k' }, '판매자 홈'),
      h('h1', null, `${hello}, ${ws.biz_name || ws.contact_name || '판매자'}님`),
      h('p', { class: 'muted' }, d.demand.regions
        ? `내 배송 권역 ${d.demand.regions}곳에 공개된 수요가 ${n0(d.demand.total)}건 있습니다.`
        : '배송 가능 권역을 고르면 그 권역의 수요가 보입니다.')),

    h('section', { class: 'sheet', 'aria-labelledby': 'todo-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'todo-t' }, '오늘 할 일'), d.todo.length ? h('span', { class: 'sub' }, `${d.todo.length}가지`) : null),
      todoList(d.todo)),

    h('section', { 'aria-labelledby': 'now-t', class: 'dm-block' },
      h('h2', { id: 'now-t', class: 'dm-block-h' }, '내 영업 현황'),
      h('div', { class: 'dm-stats' },
        statTile({ label: '아직 제안하지 않은 수요', value: n0(d.demand.open), unit: '건', sub: `내 권역 전체 ${n0(d.demand.total)}건`, href: '#/demands', tone: d.demand.open ? 'hot' : '' }),
        statTile({ label: '진행 중인 제안', value: n0(d.bids.active), unit: '건', sub: d.bids.expiring ? `${d.bids.expiring}건 곧 만료` : '만료 임박 없음', href: '#/bids' }),
        statTile({ label: '응답 대기 연결 요청', value: n0(c.pending), unit: '건', sub: `누적 ${n0(c.total)}건 받음`, href: '#/connections', tone: c.pending ? 'hot' : '' }),
        statTile({ label: '노출 중인 떨이 광고', value: n0(d.ads.active), unit: '건', sub: d.ads.paused ? `${d.ads.paused}건 멈춤` : `이번 달 광고비 ${n0(d.spend.month)}원`, href: '#/ads' }))),

    h('section', { class: 'sheet', 'aria-labelledby': 'perf-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'perf-t' }, '응답·거래 성과'), h('a', { class: 'sub', href: '#/guide' }, '어떻게 반영되나요?')),
      c.total === 0
        ? h('p', { class: 'muted' }, '아직 받은 연결 요청이 없습니다. 사장님이 내 제안이나 떨이 광고를 보고 연결 요청을 보내면 여기에 성과가 쌓입니다.')
        : [
          h('dl', { class: 'dm-perf' },
            h('div', null, h('dt', null, '응답률'), h('dd', null, h('span', { class: 'n' }, rate), c.response_rate == null ? null : h('span', { class: 'u' }, '%'))),
            h('div', null, h('dt', null, '평균 응답 시간'), h('dd', null, h('span', { class: 'n' }, c.avg_response_hours == null ? '–' : String(c.avg_response_hours)), c.avg_response_hours == null ? null : h('span', { class: 'u' }, '시간'))),
            h('div', null, h('dt', null, '거래 완료'), h('dd', null, h('span', { class: 'n' }, n0(c.deals_done)), h('span', { class: 'u' }, '건'))),
            h('div', null, h('dt', null, '거래 안 함'), h('dd', null, h('span', { class: 'n' }, n0(c.deals_failed)), h('span', { class: 'u' }, '건')))),
          weeksChart(c.weeks),
        ],
      h('p', { class: 'hint', style: 'margin-top:10px' }, '기한 안에 응답하고 거래 완료 기록이 쌓일수록 내 제안이 사장님에게 더 앞에 소개됩니다.')),

    onboarding(d.onboarding),

    h('nav', { class: 'dm-quick', 'aria-label': '바로 가기' },
      h('a', { class: 'btn', href: '#/demands' }, icon('box', 18), '수요 보고 제안하기'),
      h('a', { class: 'btn ghost', href: '#/ads/new' }, pic('tag', 18), '떨이 광고 내기'),
      h('a', { class: 'btn ghost', href: '#/billing' }, pic('card', 18), '결제 내역'),
      h('a', { class: 'btn ghost', href: '#/guide' }, pic('help', 18), '이용 안내')));
}
