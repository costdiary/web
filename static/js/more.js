/* 전체 메뉴: 휴대폰 아래 메뉴(홈·식자재·명세서·메뉴)에 다 넣을 수 없는 화면을 한곳에 모은다.
   PC에서는 왼쪽 메뉴에 같은 목록이 다 보이므로, 이 화면은 주로 휴대폰용이다.
   예전 '매출관리' 화면(#/revenue)도 이 화면으로 온다. */
import { h, icon, app, ORDERS_ENABLED, DONATE_ENABLED } from './core.js';

/* main.js의 PC 왼쪽 메뉴도 이 목록을 그대로 쓴다. [주소, 이름, 아이콘, 한 줄 설명] */
export function sections() {
  return [
    { title: '원가', items: [
      ['#/invoice', '명세서 올리기', 'camera', '거래명세서·영수증 사진을 올리면 단가가 바뀐 식자재를 찾아 반영해요.'],
      ['#/ingredients', '식자재', 'box', '사 오는 재료와 단가, 가격이 바뀐 기록.'],
      ['#/menus', '메뉴', 'list', '메뉴별 재료비와 원가율, 목표에 맞는 판매가.'],
      ['#/preps', '프렙 레시피', 'cook', '육수·소스처럼 미리 만들어 두는 것의 원가.'],
    ] },
    { title: '매출·손익', items: [
      ['#/sales', '내 매출', 'trend', '날짜별 매출을 넣고 이번 달 목표와 비교해요.'],
      ['#/delivery', '배달앱 수수료', 'receipt', '배민·쿠팡이츠로 팔면 한 건에 얼마 남는지 메뉴마다 계산해요.'],
      ['#/breakeven', '손익분기·목표 매출', 'calc', '월세·전기세 같은 고정비를 넣으면 한 달에 얼마를 팔아야 남는지 알려 드려요.'],
      ['#/labor', '직원 급여', 'users', '시급에 주휴·야간수당까지 더한 한 달 인건비.'],
      ...(ORDERS_ENABLED ? [['#/orders', '주문건 연동', 'receipt', '배달앱 주문을 가져와 건별 손익을 보여 줘요(지금은 예시 주문).']] : []),
    ] },
    { title: '더 보기', items: [
      ['#/notifications', '알림', 'bell', '단가 변동, 배달 적자, 단가 확인할 때를 한곳에서.'],
      ['#/feedback', '개선사항 요청', 'chat', '있었으면 하는 기능, 불편한 점을 운영자에게 알려 주세요.'],
      ['#/import', '가져오기', 'upload', '쓰던 앱·엑셀의 단가표와 레시피를 옮겨 와요.'],
      ...(DONATE_ENABLED ? [['#/donate', '후원하기', 'heart', '원가다이어리는 무료예요. 도움이 됐다면 응원해 주세요.']] : []),
      ['#/settings', '설정', 'sliders', '목표 원가율, 알림, 내 데이터 내려받기, 계정.'],
    ] },
    // 운영자(ADMIN_EMAILS)에게만 보인다. 서버도 운영자가 아니면 막는다.
    ...(app.me?.is_admin ? [{ title: '운영자', items: [
      ['#/admin/stats', '운영 현황', 'trend', '가입자 수와 방문자 수, 어디서 왔는지.'],
      ['#/admin/feedback', '개선사항 요청', 'chat', '사장님들이 보낸 기능 제안·불편한 점.'],
      ['#/admin/users', '사장님 계정', 'users', '계정 찾기, 쓴 만큼 보기, 임시 비밀번호.'],
      ['#/admin/db', 'DB 보기', 'list', '서버 데이터베이스 표를 읽기 전용으로.'],
      ['#/admin/ocr', 'OCR 인식 로그', 'camera', '사진 자동 인식이 어떻게 읽혔는지.'],
    ] }] : []),
  ];
}

export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '전체 메뉴')));
  box.append(h('div', { class: 'stack' }, sections().map((s) => h('section', { class: 'sheet more-sec', 'aria-label': s.title },
    h('div', { class: 'sheet-h' }, h('h2', null, s.title)),
    h('ul', { class: 'rows' }, s.items.map(([href, label, ic, desc]) => h('li', null,
      h('a', { class: 'row more-row', href },
        h('span', { class: 'more-ic', 'aria-hidden': 'true' }, icon(ic, 20)),
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, label), h('div', { class: 'row-sub' }, desc)),
        h('span', { class: 'more-go', 'aria-hidden': 'true' }, icon('chevron', 18))))))))));
}
