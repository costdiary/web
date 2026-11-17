/* 매출관리: 배달앱 수수료·손익분기·직원 급여·내 매출·주변 상권으로 가는 허브 화면.
   예전에는 '설정'의 '배달앱 수수료' 아래에 모여 있었는데, 실제로는 매출과 관련된 여러 기능이라 따로 뺐습니다. */
import { h, icon, ORDERS_ENABLED } from './core.js';

const LINKS = [
  ['#/delivery', '배달앱 수수료', 'receipt', '배민·쿠팡이츠 등 쓰는 앱의 수수료를 켜 두면 배달 주문 한 건에 메뉴마다 얼마가 남는지 나옵니다.'],
  ['#/breakeven', '손익분기·목표 매출', 'trend', '고정비(월세·전기세·인건비 등)와 메뉴 원가를 넣으면 한 달에 얼마를 팔아야 남는지 알려 드립니다.'],
  ['#/labor', '직원 급여', 'list', '아르바이트 직원 시급에 주휴수당·야간수당까지 더해 한 달 인건비가 얼마나 되는지 뽑아 줍니다.'],
  ['#/sales', '내 매출', 'box', '날짜별 매출을 넣으면 손익분기와 비교해 보여 줍니다.'],
  ['#/area', '주변 상권', 'search', '가게 주변에 어떤 상권이 있는지 보여 줍니다.'],
];

export async function render(box) {
  const links = ORDERS_ENABLED
    ? [...LINKS, ['#/orders', '주문건 연동', 'receipt', '배민·쿠팡이츠 주문을 가져와 건별 손익과 마진이 낮은 메뉴를 보여 줍니다(지금은 예시 주문).']]
    : LINKS;
  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '매출관리')),
    h('div', { class: 'stack' },
      h('section', { class: 'sheet' },
        h('p', { class: 'small muted' }, '매출·수수료·고정비·인건비를 한곳에서 관리합니다.'),
        h('ul', { class: 'plain', style: 'margin-top:10px' },
          links.map(([href, label, ic, desc]) => h('li', { style: 'margin-bottom:14px' },
            h('a', { class: 'btn ghost', href }, icon(ic, 18), label),
            h('p', { class: 'small muted', style: 'margin-top:4px' }, desc))))),
    ));
}
