/* 로그인 전 소개 화면: 원가율을 직접 만져보는 계산기, 사용 순서, 요금, 문의 */
import { h, api, app, field, openDialog, busy, errMsg, n0, n1, roundUp100, selectOf, toast, icon } from './core.js';
import { marginBar, stamp, num } from './ui.js';
import { openSignup, openLogin } from './auth.js';

/* 제육볶음 한 그릇 예시. 단가는 예시이며 실제 시세가 아닙니다. [재료, 양, 단위, 원/kg 또는 원/L, 수율%] */
const RECIPE = [
  ['양파', 60, 'g', 18500 / 15, 90],
  ['대파', 20, 'g', 3900, 85],
  ['다진 마늘', 10, 'g', 9200, 100],
  ['고춧가루', 8, 'g', 24000, 100],
  ['간장', 20, 'ml', 6500 / 1.8, 100],
  ['식용유', 10, 'ml', 53500 / 18, 100],
  ['밥 한 공기', 210, 'g', 2800, 100],
];
const PORK_G = 220;
const OTHER_COST = 400;
const TARGET = 35;

function simulate(porkPerKg, price) {
  const rows = [['돼지 앞다리살', `${PORK_G}g`, porkPerKg, (PORK_G / 1000) * porkPerKg]];
  for (const [name, amt, unit, perK, yld] of RECIPE) rows.push([name, `${amt}${unit}`, perK, ((amt / 1000) * perK) / (yld / 100)]);
  rows.push(['반찬·소스·포장', '', null, OTHER_COST]);
  const cost = rows.reduce((s, r) => s + r[3], 0);
  const ratio = (cost / price) * 100;
  return { rows, cost, ratio, margin: price - cost, rec: roundUp100(cost / (TARGET / 100)) };
}

function statusOf(r) {
  return r <= TARGET ? 'good' : r <= TARGET + 5 ? 'warn' : 'bad';
}

function simulator() {
  const pork = h('input', { type: 'range', min: 8000, max: 14000, step: 100, value: 10800, id: 'sim-pork' });
  const price = h('input', { type: 'range', min: 8000, max: 13000, step: 500, value: 9500, id: 'sim-price' });
  const porkV = h('span', { class: 'n' });
  const priceV = h('span', { class: 'n' });
  const out = h('div', { class: 'sim-res', 'aria-live': 'polite' });
  const tbody = h('tbody');

  const paint = () => {
    const p = Number(pork.value);
    const pr = Number(price.value);
    const s = simulate(p, pr);
    porkV.textContent = `${n0(p)}원`;
    priceV.textContent = `${n0(pr)}원`;
    out.replaceChildren(
      h('div', { class: 'money-row' },
        h('div', { class: 'money-item' },
          h('dt', null, '판매가'),
          h('dd', null, h('span', { class: 'n' }, n0(pr)), h('span', { class: 'u' }, '원'))),
        h('div', { class: 'money-item' },
          h('dt', null, '재료비'),
          h('dd', null, h('span', { class: 'n' }, n0(s.cost)), h('span', { class: 'u' }, '원')))),
      h('p', { class: 'ratio-line' },
        '원가율 ', h('span', { class: 'n' }, n1(s.ratio)), '%', stamp(statusOf(s.ratio))),
      marginBar({ ratio: s.ratio, target: TARGET, big: true, animate: true }),
      h('dl', { class: 'sim-facts' },
        h('div', null, h('dt', null, '한 그릇에 남는 돈'), h('dd', null, num(n0(s.margin), '원'))),
        h('div', null, h('dt', null, `원가율 ${TARGET}%로 맞추려면`), h('dd', null, num(n0(s.rec), '원')))));
    tbody.replaceChildren(...s.rows.map(([name, amt, perK, cost]) =>
      h('tr', null, h('td', null, name), h('td', null, amt), h('td', null, perK == null ? '' : `${n0(perK)}원`), h('td', null, `${n0(cost)}원`))));
  };
  pork.addEventListener('input', paint);
  price.addEventListener('input', paint);

  const el = h('article', { class: 'sheet sim', 'aria-labelledby': 'sim-t' },
    h('div', { class: 'sim-h' }, h('h2', { id: 'sim-t' }, '제육볶음 한 그릇'), h('span', { class: 'xs muted' }, '예시 계산 · 목표 원가율 35%')),
    h('div', { class: 'sim-ctl' },
      h('label', { for: 'sim-pork' }, h('span', { class: 'v' }, '돼지 앞다리살 1kg 가격', porkV), pork),
      h('label', { for: 'sim-price' }, h('span', { class: 'v' }, '판매가', priceV), price)),
    out,
    h('details', null, h('summary', null, '계산에 쓴 값 보기'),
      h('table', { class: 'calc' },
        h('thead', null, h('tr', null, h('th', null, '재료'), h('th', null, '양'), h('th', null, '단가(kg·L당)'), h('th', null, '원가'))),
        tbody),
      h('p', { class: 'xs muted', style: 'margin-top:8px' }, '수율(다듬고 남는 비율)을 반영한 값입니다. 단가는 예시이며 실제 시세가 아닙니다.')));
  paint();
  return el;
}

const FAQ = [
  ['명세서·요리 사진은 어디에 저장되나요?', '글자나 재료를 읽기 위해 사진을 Anthropic의 Claude API로 보내고, 인식이 잘못됐을 때 확인할 수 있도록 원가다이어리 서버에도 함께 보관합니다. 계정을 삭제하면 보관하던 사진도 함께 삭제됩니다. 자동 인식을 설정하기 전에는 예시 명세서로 화면을 먼저 써볼 수 있습니다.'],
  ['쓰던 앱이나 엑셀 자료를 옮길 수 있나요?', '엑셀(.xlsx)과 CSV 파일을 올리면 제목 줄을 읽어 칸을 자동으로 맞추고, 저장하기 전에 미리 보여 드립니다. 앱마다 내려받는 파일의 모양이 달라서 칸이 틀리면 직접 고를 수 있습니다. 가격이 없는 식자재도 \'단가 없음\'으로 옮겨 두었다가 명세서로 채울 수 있습니다.'],
  ['메뉴별 재료 양(g)을 몰라도 쓸 수 있나요?', '재료 양을 모를 때는 일단 어림잡아 입력해 두고, 단가만 먼저 넣어도 됩니다. 나중에 실제로 계량한 값으로 고치면 원가율이 자동으로 다시 계산됩니다.'],
  ['배달의민족·쿠팡이츠 수수료도 반영되나요?', '쓰는 앱을 켜고 구간·요율을 맞추면 메뉴마다 배달 주문 한 건에 남는 돈과 배달용 권장 판매가를 계산합니다. 앱과 연동하는 것이 아니라 공개된 안내를 바탕으로 한 기본값이며, 정산내역서와 다르면 직접 고쳐 쓰세요. 확인하지 못한 요율에는 \'확인 필요\' 표시가 붙습니다.'],
  ['글자를 잘못 읽으면 어떻게 되나요?', '반영하기 전에 모든 줄을 보여드리고, 규격과 가격은 직접 고칠 수 있습니다. 확인하고 누르기 전에는 아무것도 저장되지 않습니다.'],
  ['명세서마다 식자재 이름이 달라요.', '비슷한 이름은 자동으로 연결하고, 못 찾은 이름은 한 번만 골라 주시면 다음부터 기억합니다.'],
  ['수율은 어떻게 계산하나요?', '식자재마다 수율(다듬고 남는 비율)을 넣으면 실제로 쓰는 양 기준으로 계산합니다. 수율이 90%이면 단가를 0.9로 나눈 값을 원가에 씁니다.'],
  ['돈을 내야 하나요?', '아니요. 식자재 단가 관리, 메뉴 원가 계산, 엑셀 가져오기·내려받기 등 지금 있는 기능은 개수 제한 없이 모두 쓸 수 있습니다. 거래명세서 사진 자동 인식만 한 달 5회로 묶어 두었는데(시범 운영 중이라 인식 결과가 부정확할 수 있습니다), 한 번 인식할 때마다 외부 API 비용이 나가기 때문입니다. 5회를 넘기거나 결과가 맞지 않으면 직접 입력하시면 됩니다.'],
  ['그만 쓰고 싶어요.', '설정에서 계정을 삭제하면 입력한 식자재·메뉴·가격 이력이 모두 지워집니다.'],
];

/* 이용약관(제1조~제12조)과 개인정보처리방침(1~11)의 전체 조문. 짧은 요약 대신 실제 내용을
   넓은 다이얼로그(openDialog wide:true)에 통째로 보여 준다 — 새 라우트를 만들지 않기 위함. */
const TERMS_ARTICLES = [
  ['제1조 (목적)', [
    '이 약관은 원가다이어리(이하 "서비스")를 운영하는 사업자(이하 "운영자")가 제공하는 서비스의 이용과 관련하여 운영자와 이용자 사이의 권리, 의무 및 책임사항을 정하는 것을 목적으로 합니다.',
  ]],
  ['제2조 (정의)', [
    '1. "서비스"란 운영자가 제공하는 식자재 단가·메뉴 원가 관리 웹 애플리케이션(원가다이어리) 및 이에 부수하는 일체의 서비스를 말합니다.',
    '2. "이용자"란 이 약관에 따라 운영자가 제공하는 서비스를 이용하는 회원을 말합니다.',
    '3. "계정"이란 이용자가 서비스를 이용하기 위하여 등록한 이메일·비밀번호 등 식별정보의 조합을 말합니다.',
    '4. "콘텐츠"란 이용자가 서비스 이용 과정에서 직접 입력하거나 사진·파일 등을 통해 등록한 식자재, 메뉴, 가격, 거래명세서, 요리 사진 등 일체의 자료를 말합니다.',
  ]],
  ['제3조 (약관의 효력 및 변경)', [
    '이 약관은 서비스 화면에 게시하거나 기타의 방법으로 공지함으로써 효력이 발생합니다.',
    '운영자는 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경된 약관은 적용일자 7일 전부터(이용자에게 불리한 변경은 30일 전부터) 서비스 내 공지합니다.',
    '이용자가 변경된 약관에 동의하지 않는 경우 서비스 이용을 중단하고 탈퇴할 수 있으며, 공지 후 적용일까지 거부 의사를 표시하지 않고 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.',
  ]],
  ['제4조 (서비스의 제공 및 변경)', [
    '운영자는 식자재 단가·가격 이력 관리, 거래명세서 사진 인식, 메뉴 원가율·권장 판매가 계산, 요리 사진 기반 메뉴 초안 생성, 배달앱 수수료 계산, 엑셀·CSV 가져오기 및 내려받기 등의 서비스를 제공합니다.',
    '운영자는 운영상·기술상 필요에 따라 서비스의 내용을 추가·변경할 수 있으며, 이 경우 사전에 서비스 내 공지합니다.',
    '운영자는 시스템 점검, 장애 복구, 외부 서비스(Anthropic API, 지도 API 등)의 장애 등 불가피한 사유로 서비스 제공을 일시적으로 중단할 수 있습니다.',
  ]],
  ['제5조 (회원가입 및 계정 관리)', [
    '이용자는 운영자가 정한 가입 양식에 따라 이메일, 비밀번호 등 필요한 정보를 입력하여 회원가입을 신청합니다.',
    '이용자는 등록한 정보가 변경된 경우 지체 없이 수정하여야 하며, 미수정으로 인한 불이익은 이용자가 부담합니다.',
    '계정과 비밀번호의 관리 책임은 이용자에게 있으며, 제3자에게 양도·대여할 수 없습니다. 계정이 도용되었거나 제3자가 부정하게 사용함을 안 경우 즉시 운영자에게 알려야 합니다.',
  ]],
  ['제6조 (이용자의 의무 및 금지행위)', [
    '이용자는 다음 행위를 하여서는 안 됩니다.',
    '1. 로봇·크롤러 등 자동화된 방법으로 서비스 화면이나 자료를 수집하는 행위',
    '2. 계산 결과·참고 레시피 데이터베이스 등을 대량으로 복제·재판매하거나 다른 서비스의 학습(AI 모델 학습 등)에 이용하는 행위',
    '3. 계정을 다수 생성하여 자동 인식(OCR) 등 이용 제한을 회피하는 행위',
    '4. 서비스의 보안 장치를 무력화하거나 우회하는 행위',
    '5. 타인의 계정을 무단으로 사용하거나 허위 정보를 등록하는 행위',
    '6. 그 밖에 관련 법령이나 공공질서, 미풍양속에 반하는 행위',
    '운영자는 위 행위를 한 이용자에 대하여 사전 통지 없이 서비스 이용을 제한하거나 계정을 정지·삭제할 수 있습니다.',
  ]],
  ['제7조 (계산 결과의 성격 및 책임의 한계)', [
    '서비스가 제공하는 식자재 단가, 메뉴 원가율, 손익분기, 배달앱 수수료, 권장 판매가 등 계산 결과는 이용자가 입력하거나 서비스가 인식한 값을 기초로 산출한 참고 정보이며, 세무·회계·법률상 공식 문서나 전문가 자문을 대체하지 않습니다.',
    '거래명세서·요리 사진의 AI 인식 결과(품목, 규격, 가격, 재료, 추정 양 등)는 인공지능에 의한 추정값으로 실제와 다를 수 있으며, 이용자는 반영 전 그 내용을 확인·수정할 책임이 있습니다.',
    '배달앱 수수료율 등 외부 정보에 기반한 값은 공개된 자료를 바탕으로 둔 기본값으로 실제 정산내역과 차이가 있을 수 있으므로, 이용자는 정산내역서 등을 통해 직접 확인하여야 합니다.',
    '운영자는 위 계산 결과를 신뢰하여 이용자가 행한 경영상 의사결정으로 발생한 손해에 대하여 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다.',
  ]],
  ['제8조 (콘텐츠에 대한 권리)', [
    '이용자가 서비스에 등록한 콘텐츠에 대한 권리는 이용자에게 있습니다.',
    '운영자는 서비스의 제공·개선(식자재 이름 매칭 정확도 향상, 참고 레시피 데이터베이스 보강 등)과 통계 작성을 위하여 이용자의 콘텐츠를 비식별화하여 사용할 수 있습니다. 이 경우 특정 이용자를 알아볼 수 있는 형태로는 이용하지 않습니다.',
    '서비스 자체(화면 구성, 소스코드, 로고, 데이터베이스 등)에 대한 지식재산권은 운영자에게 있으며, 이용자는 운영자의 사전 동의 없이 이를 복제·배포·전송·출판할 수 없습니다.',
  ]],
  ['제9조 (계약 해지 및 이용 제한)', [
    '이용자는 설정 화면에서 언제든지 계정 삭제(탈퇴)를 신청할 수 있으며, 탈퇴 시 이용계약은 즉시 종료됩니다.',
    '운영자는 이용자가 제6조를 위반하거나 서비스의 정상적인 운영을 방해한 경우 사전 통지 후(긴급한 경우 사후 통지) 이용을 제한하거나 계약을 해지할 수 있습니다.',
  ]],
  ['제10조 (면책조항)', [
    '운영자는 천재지변, 전쟁, 테러, 정전, 기간통신사업자의 서비스 중지, 외부 API(Anthropic, 지도 서비스 등) 제공업체의 장애 등 운영자가 통제할 수 없는 사유로 서비스를 제공할 수 없는 경우 책임을 지지 않습니다.',
    '운영자는 이용자의 귀책사유(비밀번호 관리 소홀, 허위 정보 입력, 계산 결과 미확인 등)로 발생한 손해에 대하여 책임을 지지 않습니다.',
    '운영자는 서비스를 통해 얻은 자료의 신뢰성·정확성을 보증하지 않으며, 이용자가 서비스에 게재한 정보의 신뢰도에 대해서도 책임을 지지 않습니다.',
    '운영자는 무료로 제공하는 서비스와 관련하여 관련 법령에 특별한 규정이 없는 한 책임을 지지 않습니다.',
  ]],
  ['제11조 (분쟁해결)', [
    '운영자는 이용자가 제기하는 불만사항에 대해 접수 후 신속하게 처리하도록 노력합니다.',
    '이 약관과 관련한 분쟁에 대해 소송이 제기될 경우 민사소송법상의 관할 법원에 제기합니다.',
  ]],
  ['제12조 (준거법)', [
    '이 약관의 해석 및 운영자와 이용자 간의 분쟁에는 대한민국 법을 적용합니다.',
  ]],
];

const PRIVACY_SECTIONS = [
  ['1. 수집하는 개인정보의 항목', [
    '필수항목: 이메일, 비밀번호(암호화 저장), 가게 이름(상호)',
    '서비스 이용 중 생성·수집되는 항목: 식자재명·단가·가격 변동 이력, 메뉴 구성·원가 정보, 거래명세서·요리 사진(자동 인식 이용 시) 및 그 인식 결과, 엑셀·CSV로 가져온 자료의 내용(파일 자체는 저장하지 않음), 매장 주소(주변 상권 조회 이용 시), 후원 시 입력한 닉네임·금액·메시지',
    '자동 수집 항목: 접속 IP, 접속 로그 등 보안 기록',
  ]],
  ['2. 개인정보의 수집 및 이용 목적', [
    '회원 식별 및 서비스 제공(로그인, 식자재·메뉴 원가 계산 등)',
    '거래명세서·요리 사진 자동 인식(OCR) 서비스 제공',
    '자동 인식 품질 확인 및 서비스 개선(운영자의 QA 목적)',
    '부정 이용 방지 및 서비스 보안 유지',
    '도입 문의 응대, 후원 접수 및 동의한 경우 후원자 명단 표시',
  ]],
  ['3. 개인정보의 보유 및 이용 기간', [
    '회원 정보: 회원 탈퇴 시까지 보유하며, 탈퇴 즉시 삭제합니다. (관계 법령에 따라 보존 의무가 있는 정보는 해당 기간 동안 분리 보관)',
    '거래명세서·요리 사진 및 인식 결과: 인식 품질을 확인·개선할 목적으로 보관하며, 회원 탈퇴 시 즉시 삭제됩니다.',
    '접속 로그 등 보안 기록: 180일간 보관 후 파기합니다.',
    '후원 정보: 리더보드 표시 목적이 종료되거나 후원자가 삭제를 요청할 때까지 보유하며, 회원 탈퇴 후에도 후원·순위 기록은 특정 개인을 알아볼 수 없는 형태(닉네임 등)로 남을 수 있습니다.',
  ]],
  ['4. 개인정보의 제3자 제공', [
    '운영자는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 이용자가 사전에 동의한 경우, 또는 법령의 규정에 의거하거나 수사기관이 법령에 정한 절차에 따라 요구하는 경우는 예외로 합니다.',
  ]],
];

const PRIVACY_SECTIONS_TAIL = [
  ['6. 정보주체의 권리와 행사 방법', [
    '이용자는 설정 화면에서 언제든지 자신의 개인정보를 조회·수정할 수 있으며, 계정 삭제(탈퇴)를 통해 개인정보 삭제를 요청할 수 있습니다. 삭제 전 엑셀(CSV)로 입력 자료를 내려받을 수 있습니다.',
    '그 밖의 열람, 정정, 삭제, 처리정지 요구는 아래 개인정보 보호책임자에게 연락하여 행사할 수 있습니다.',
  ]],
  ['7. 개인정보의 파기', [
    '운영자는 개인정보의 보유기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 해당 개인정보를 복구·재생이 불가능한 방법으로 파기합니다. 전자적 파일 형태의 정보는 복구할 수 없는 기술적 방법으로, 그 외의 기록물은 분쇄 또는 소각의 방법으로 파기합니다.',
  ]],
  ['8. 개인정보의 안전성 확보조치', [
    '비밀번호는 복호화할 수 없는 일방향 암호화(scrypt) 방식으로 저장합니다.',
    '이용자와 서버 간 통신은 TLS(HTTPS)로 암호화됩니다.',
    '거래명세서·요리 사진 등 민감한 자료에 대한 접근은 운영자가 지정한 관리자 계정으로 제한됩니다.',
    '접속 기록을 보관·관리하여 개인정보 오남용 여부를 확인합니다.',
  ]],
];

const PRIVACY_SECTIONS_END = [
  ['10. 권익침해 구제방법', [
    '개인정보 침해에 대한 신고나 상담이 필요한 경우 아래 기관에 문의할 수 있습니다.',
    '개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)',
    '개인정보침해신고센터: 118 (privacy.kisa.or.kr)',
    '대검찰청 사이버수사과: 1301 (www.spo.go.kr)',
    '경찰청 사이버수사국: 182 (ecrm.cyber.go.kr)',
  ]],
  ['11. 고지의 의무', [
    '이 개인정보처리방침은 2026년 11월 19일부터 적용됩니다. 법령·정책 또는 보안기술의 변경에 따라 내용이 추가·삭제·수정되는 경우에는 적용 최소 7일 전에 서비스 내 공지사항을 통해 고지합니다.',
  ]],
];

function legalBlock([title, paragraphs]) {
  return h('div', null, h('div', { class: 'h-sec' }, title), paragraphs.map((p) => h('p', null, p)));
}

function processorRow(name, duty, items, retention) {
  return h('div', { style: 'margin-top:8px;padding:10px;border:1px solid var(--rule);border-radius:8px' },
    h('p', null, h('b', null, name)),
    h('p', { class: 'xs muted' }, `위탁 업무: ${duty}`),
    h('p', { class: 'xs muted' }, `이전되는 개인정보: ${items}`),
    h('p', { class: 'xs muted' }, `보유·이용 기간: ${retention}`));
}

export function openDataNotice() {
  const p = app.pub || {};
  const officer = [p.biz_ceo && `담당: ${p.biz_ceo}`, p.contact_email && `이메일: ${p.contact_email}`].filter(Boolean);
  return openDialog({
    title: '개인정보처리방침',
    wide: true,
    content: h('div', { class: 'stack' },
      h('p', { class: 'xs muted' }, '시행일: 2026년 11월 19일'),
      h('p', null, '원가다이어리(이하 "운영자")는 개인정보보호법 등 관련 법령을 준수하며, 다음과 같이 개인정보를 처리합니다.'),
      PRIVACY_SECTIONS.map(legalBlock),
      h('div', null, h('div', { class: 'h-sec' }, '5. 개인정보 처리위탁 및 국외 이전'),
        h('p', null, '운영자는 서비스 제공을 위하여 아래와 같이 개인정보 처리를 위탁하거나 국외로 이전합니다. 거래명세서·요리 사진의 자동 인식(OCR)을 이용하지 않고 직접 입력만 이용하는 경우, 사진은 국외로 전송되지 않습니다.'),
        processorRow('Anthropic, PBC (미국)', '거래명세서·요리 사진의 AI 인식(OCR)', '업로드한 거래명세서·요리 사진', 'Anthropic의 자체 보유기간 정책에 따름'),
        processorRow('서버 호스팅사(인프라 제공업체)', '서버 운영 및 데이터 보관', '서비스 이용에 따라 저장되는 모든 개인정보', '위탁계약 종료 또는 회원 탈퇴 시까지')),
      PRIVACY_SECTIONS_TAIL.map(legalBlock),
      h('div', null, h('div', { class: 'h-sec' }, '9. 개인정보 보호책임자'),
        h('p', null, '이용자는 서비스 이용 중 발생하는 개인정보 보호 관련 문의, 불만처리, 피해구제 등에 관한 사항을 아래로 문의할 수 있습니다.'),
        officer.length ? h('p', null, officer.join(' · ')) : h('p', { class: 'muted' }, '문의 방법은 서비스 내 도입 문의를 통해 안내받을 수 있습니다.')),
      PRIVACY_SECTIONS_END.map(legalBlock),
      p.business_name || p.biz_reg_no ? h('div', null, h('div', { class: 'h-sec' }, '사업자 정보'),
        h('p', null, [p.business_name, p.biz_ceo && `대표 ${p.biz_ceo}`, p.biz_reg_no && `사업자등록번호 ${p.biz_reg_no}`, p.biz_address].filter(Boolean).join(' · '))) : null,
      h('p', { class: 'xs muted' }, '서비스 이용에 관한 사항은 ', h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관'), '을 함께 확인해 주세요.')),
  });
}

export function openTerms() {
  return openDialog({
    title: '이용약관',
    wide: true,
    content: h('div', { class: 'stack' },
      h('p', { class: 'xs muted' }, '시행일: 2026년 11월 19일'),
      TERMS_ARTICLES.map(legalBlock),
      h('p', null, '부칙: 이 약관은 2026년 11월 19일부터 시행합니다.')),
  });
}

function leadForm() {
  const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'name' });
  const contact = h('input', { class: 'input', type: 'text', maxLength: 120, placeholder: '전화번호 또는 이메일', autocomplete: 'off' });
  const biz = selectOf(['한식', '분식', '고깃집', '주점', '카페·베이커리', '기타'], '한식');
  const msg = h('textarea', { class: 'textarea', maxLength: 1000, placeholder: '메뉴 수, 쓰고 계신 방식(수기·엑셀 등)을 적어 주시면 답변이 빨라집니다.' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, '문의 보내기');
  const form = h('form', { novalidate: true }, err,
    h('div', { class: 'two' }, field('이름', name), field('연락처', contact)),
    field('업종', biz), field('문의 내용 (선택)', msg), btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (contact.value.trim().length < 3) { err.textContent = '답변받을 연락처를 입력해 주세요.'; err.hidden = false; return; }
    await busy(btn, async () => {
      try {
        await api('/api/leads', { method: 'POST', body: { name: name.value, contact: contact.value, biz_type: biz.value, message: msg.value } });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      form.replaceChildren(h('p', { role: 'status' }, '문의를 접수했습니다. 남겨 주신 연락처로 답변드리겠습니다.'));
    });
  });
  return form;
}

/* 기능 그리드: 한눈에 훑어볼 수 있게 아이콘·이름·한 줄 설명으로 묶은 카드. [아이콘, 이름, 설명, 주변상권인지] */
const FEATURES = [
  ['receipt', '거래명세서 자동 인식', '납품받은 명세서를 한 장 찍어 올리면 품목·규격·단가를 읽어서 그 자리에서 단가에 반영합니다.'],
  ['box', '식자재 단가·가격 이력', '살 때마다 단가가 쌓이고, 오른 재료가 생기면 그 재료가 들어가는 메뉴까지 짚어 알려 줍니다.'],
  ['list', '메뉴 원가·권장 판매가', '재료와 양만 넣으면 원가율이 나오고, 목표 원가율에 맞춰 얼마를 받아야 할지도 같이 계산해 둡니다.'],
  ['trend', '프렙 레시피', '미리 끓여 두는 육수나 소스처럼 여러 메뉴에 쓰는 재료도 g(ml)당 원가로 잡아 두고, 메뉴 쪼갤 때 그대로 가져다 씁니다.'],
  // ['camera', '사진으로 메뉴 만들기', '다 된 요리 사진 한 장으로도 재료와 양을 어림잡아 메뉴 초안을 만들어 줍니다.'],
  ['search', '배달앱 수수료 계산', '배민·쿠팡이츠 수수료와 배달비까지 빼고 나면 한 건 팔아서 실제로 남는 돈이 얼마인지 보여 줍니다.'],
];

function featureGrid() {
  return h('section', { class: 'sec', 'aria-labelledby': 'feat-t' },
    h('h2', { id: 'feat-t' }, '무엇을 할 수 있나요'),
    h('div', { class: 'feat-grid' },
      FEATURES.map(([ic, title, desc]) => h('article', { class: 'feat-card' },
        icon(ic, 22), h('h3', null, title), h('p', null, desc)))));
}

/* ─── 히어로 카운팅 카드: 슬라이더 움직이면 숫자가 카운팅됨 ─── */
function heroCountCard(simResult) {
  const costEl = h('span', { class: 'hc-num' }, '0');
  const marginEl = h('span', { class: 'hc-num' }, '0');
  const ratioPct = h('span', { class: 'hc-ratio-pct ok' }, '0%');
  const fillEl = h('div', { class: 'hc-fill ok' });
  const priceTag = h('span', { class: 'hc-price-tag' }, '판매가 —원');

  function update(s) {
    // 금액 카운팅 (메인)
    animateCount(costEl, parseInt(costEl.dataset.prev || 0), Math.round(s.cost), 500, '원');
    costEl.dataset.prev = Math.round(s.cost);
    animateCount(marginEl, parseInt(marginEl.dataset.prev || 0), Math.round(s.margin), 500, '원');
    marginEl.dataset.prev = Math.round(s.margin);
    // 원가율 % 보조
    const r = s.ratio;
    const cls = r > 40 ? 'danger' : r > 35 ? 'warn' : 'ok';
    ratioPct.className = `hc-ratio-pct ${cls}`;
    fillEl.className = `hc-fill ${cls}`;
    // 원가율 숫자 카운팅
    const prevRatio = parseFloat(fillEl.dataset.prevRatio || 0);
    fillEl.dataset.prevRatio = r;
    animateBarWidth(fillEl, prevRatio, Math.min(100, r), 500);
    animateRatioPct(ratioPct, prevRatio, r, 500);
    // 판매가 표시
    priceTag.textContent = `판매가 ${n0(s.cost + s.margin)}원`;
  }

  const card = h('div', { class: 'hc-card glass' },
    h('div', { class: 'hc-title' }, '🍖 제육볶음 한 그릇', priceTag),
    h('div', { class: 'hc-grid' },
      h('div', { class: 'hc-item cost' },
        h('span', { class: 'hc-label' }, '재료비'),
        costEl),
      h('div', { class: 'hc-item margin' },
        h('span', { class: 'hc-label' }, '남는 돈'),
        marginEl)),
    h('div', { class: 'hc-ratio-row' },
      h('span', { class: 'hc-ratio-label' }, '원가율'),
      ratioPct),
    h('div', { class: 'hc-bar' }, fillEl),
    h('p', { class: 'hc-hint' }, '↑ 슬라이더를 움직이면 실시간으로 바뀝니다'));
  card.update = update;
  return card;
}

/* ─── 탭 컴포넌트 ─── */
function tabGroup(tabs) {
  // tabs: [{label, content}]
  let active = 0;
  const panels = tabs.map(({ content }, i) => {
    const p = h('div', { class: `tab-panel${i === 0 ? ' active' : ''}`, role: 'tabpanel' }, content);
    return p;
  });
  const btns = tabs.map(({ label }, i) => {
    const b = h('button', { class: `tab-btn${i === 0 ? ' active' : ''}`, role: 'tab', 'aria-selected': String(i === 0), type: 'button' }, label);
    b.addEventListener('click', () => {
      btns[active].classList.remove('active'); btns[active].setAttribute('aria-selected', 'false');
      panels[active].classList.remove('active');
      active = i;
      btns[active].classList.add('active'); btns[active].setAttribute('aria-selected', 'true');
      panels[active].classList.add('active');
    });
    return b;
  });
  return h('div', { class: 'tab-group' },
    h('div', { class: 'tab-list', role: 'tablist' }, btns),
    h('div', { class: 'tab-panels' }, panels));
}

/* ─── 아코디언 ─── */
function accordion(items) {
  return h('div', { class: 'accordion' }, items.map(([q, a]) => {
    const body = h('div', { class: 'acc-body' }, h('p', null, a));
    const header = h('button', { class: 'acc-header', type: 'button', 'aria-expanded': 'false' },
      h('span', null, q), h('span', { class: 'acc-ic' }, '＋'));
    header.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      header.setAttribute('aria-expanded', String(open));
      header.querySelector('.acc-ic').textContent = open ? '－' : '＋';
    });
    return h('div', { class: 'acc-item' }, header, body);
  }));
}

/* ─── 캐러셀 ─── */
function carousel(cards) {
  let idx = 0;
  const slides = cards.map((c, i) => h('div', { class: `carousel-slide${i === 0 ? ' active' : ''}` }, c));
  const dots = cards.map((_, i) => {
    const d = h('button', { class: `carousel-dot${i === 0 ? ' active' : ''}`, type: 'button', 'aria-label': `${i + 1}번` });
    d.addEventListener('click', () => goTo(i));
    return d;
  });
  function goTo(n) {
    slides[idx].classList.remove('active'); dots[idx].classList.remove('active');
    idx = (n + cards.length) % cards.length;
    slides[idx].classList.add('active'); dots[idx].classList.add('active');
  }
  const prev = h('button', { class: 'carousel-nav prev', type: 'button', 'aria-label': '이전' }, '‹');
  const next = h('button', { class: 'carousel-nav next', type: 'button', 'aria-label': '다음' }, '›');
  prev.addEventListener('click', () => goTo(idx - 1));
  next.addEventListener('click', () => goTo(idx + 1));
  return h('div', { class: 'carousel' },
    h('div', { class: 'carousel-track' }, slides),
    prev, next,
    h('div', { class: 'carousel-dots' }, dots));
}

export function renderLanding(root, onAuth) {
  const pub = app.pub || {};
  const start = () => {
    openSignup({
      onDone: () => {
        launchConfetti();
        onAuth();
      },
    });
  };
  const login = () => openLogin({ onDone: onAuth });

  /* ─── 시뮬레이터 + 카운팅 카드 연결 ─── */
  const simEl = simulator();
  // simulator()가 반환한 엘리먼트에서 슬라이더를 찾아 카운팅 카드와 연동
  let countCard;
  const connectCountCard = (el) => {
    const porkSlider = el.querySelector('#sim-pork');
    const priceSlider = el.querySelector('#sim-price');
    if (!porkSlider || !priceSlider || !countCard) return;
    const sync = () => {
      const s = simulate(Number(porkSlider.value), Number(priceSlider.value));
      countCard.update(s);
    };
    porkSlider.addEventListener('input', sync);
    priceSlider.addEventListener('input', sync);
    // 초기값 카운팅
    setTimeout(() => {
      const s = simulate(Number(porkSlider.value), Number(priceSlider.value));
      countCard.update(s);
    }, 400);
  };

  /* 초기 시뮬 결과 */
  const initSim = simulate(10800, 9500);
  countCard = heroCountCard(initSim);

  /* ─── FAQ 아코디언 ─── */
  const faqAccordion = accordion(FAQ);

  /* ─── 기능 캐러셀 ─── */
  const featureCards = FEATURES.map(([ic, title, desc]) =>
    h('div', { class: 'feat-carousel-card' },
      h('div', { class: 'feat-ic-wrap' }, icon(ic, 28)),
      h('h3', null, title),
      h('p', null, desc)));
  const featCarousel = carousel(featureCards);

  /* ─── 통계 카운터 섹션 ─── */
  const stat1 = h('span', { class: 'stat-num' }, '0');
  const stat2 = h('span', { class: 'stat-num' }, '0');
  const stat3 = h('span', { class: 'stat-num' }, '0');

  /* ─── 사용 순서 탭 ─── */
  const howTabs = tabGroup([
    {
      label: '명세서로',
      content: h('div', { class: 'steps' },
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '1'), h('h3', null, '사진을 올립니다'), h('p', null, '납품받은 거래명세서를 찍어 올리면 품목·규격·단가를 읽어 옵니다.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '2'), h('h3', null, '읽은 내용을 확인합니다'), h('p', null, '틀린 곳만 고치고, 이름이 다른 식자재는 한 번만 연결하면 다음부터 자동으로 알아봅니다.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '3'), h('h3', null, '원가율이 다시 계산됩니다'), h('p', null, '단가가 오른 식자재와 그 때문에 원가율이 오른 메뉴를 바로 알려 드립니다.'))),
    },
    /* 요리 사진 탭 — 너무 부정확해 비공개 처리
    {
      label: '요리 사진으로',
      content: h('div', { class: 'steps' },
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '1'), h('h3', null, '완성된 요리 사진을 올립니다'), h('p', null, '메뉴판 사진이나 직접 찍은 요리 사진을 올려 주세요.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '2'), h('h3', null, '재료와 양을 AI가 어림잡습니다'), h('p', null, '사진만으로 정확한 양은 알 수 없어서 추정 표시와 범위가 붙습니다.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '3'), h('h3', null, '계량해서 고쳐 쓰면 됩니다'), h('p', null, '고치기 전까지는 원가율도 범위로 보여 드립니다.'))),
    },
    */
    {
      label: '엑셀에서',
      content: h('div', { class: 'steps' },
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '1'), h('h3', null, 'xlsx / CSV를 올립니다'), h('p', null, '쓰던 엑셀 파일을 그대로 올리면 제목 줄을 읽어 칸을 자동으로 맞춥니다.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '2'), h('h3', null, '미리 보고 저장합니다'), h('p', null, '칸이 틀리면 직접 고를 수 있고, 확인하기 전에는 아무것도 저장되지 않습니다.')),
        h('div', { class: 'step reveal' }, h('div', { class: 'step-no' }, '3'), h('h3', null, '원가율이 계산됩니다'), h('p', null, '가져온 식자재로 메뉴 원가를 바로 계산할 수 있습니다.'))),
    },
  ]);

  const land = h('div', { class: 'land' },
    /* ─── 헤더 ─── */
    h('header', { class: 'land-top' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/static/icon.svg', alt: '', width: 26, height: 26 }), '원가다이어리'),
      h('div', { class: 'land-top-actions' },
        h('button', { class: 'btn ghost sm', type: 'button', onclick: login }, '로그인'),
        h('button', { class: 'btn sm', type: 'button', onclick: start }, '지금 써보기'))),

    /* ─── 히어로 ─── */
    h('section', { class: 'hero', 'aria-labelledby': 'hero-t' },
      h('div', { class: 'hero-in' },
        h('div', { class: 'hero-copy' },
          h('div', { class: 'hero-badge reveal' }, '🍳 자영업자의 성공을 돕기 위해 만들었습니다'),
          h('h1', { id: 'hero-t', class: 'reveal' }, '흩어진 원가를\n한곳에서 정리하세요'),
          h('p', { class: 'hero-lead reveal' }, '엑셀로 계산하던 원가, 이제 영수증·거래명세서만 입력하면 메뉴별로 바로 계산해 드려요.'),
          h('div', { class: 'btn-row reveal' },
            h('button', { class: 'btn btn-lg', type: 'button', onclick: start }, '원가 계산 시작하기 →'),
            h('a', { class: 'btn ghost', href: '#price', onclick: (e) => { e.preventDefault(); document.getElementById('price').scrollIntoView({ behavior: 'smooth' }); } }, '기능 보기')),
          h('p', { class: 'hero-free-note reveal' }, '모든 기능은 체험판·기간 제한 없이 모두 무료로 가능합니다. 진짜예요.'),
          h('p', { class: 'hero-note reveal' }, '식자재·메뉴 등록 개수 제한 없이 쓸 수 있습니다. 거래명세서 사진 자동 인식은 월 5회(시범 운영 중).')),
        h('div', { class: 'hero-demo' },
          iphoneMockup(),
          countCard,
          simEl))),

    /* ─── 해시태그 마퀴 ─── */
    marquee(),

    h('main', { id: 'main' },

      /* ─── 통계 카운터 ─── */
      h('section', { class: 'sec stats-sec' },
        h('div', { class: 'stats-grid' },
          h('div', { class: 'stat-card glass reveal' }, stat1, h('p', null, '등록된 식자재')),
          h('div', { class: 'stat-card glass reveal' }, stat2, h('p', null, '계산된 원가율')),
          h('div', { class: 'stat-card glass reveal' }, stat3, h('p', null, '절약된 시간(시간)')))),

      /* ─── 기능 캐러셀 ─── */
      h('section', { class: 'sec', 'aria-labelledby': 'feat-t' },
        h('h2', { id: 'feat-t', class: 'reveal' }, '무엇을 할 수 있나요'),
        featCarousel,
        h('div', { class: 'feat-grid reveal' },
          FEATURES.map(([ic, title, desc]) => h('article', { class: 'feat-card' },
            icon(ic, 22), h('h3', null, title), h('p', null, desc))))),

      /* ─── 사용법 탭 ─── */
      h('section', { class: 'sec', 'aria-labelledby': 'how-t' },
        h('h2', { id: 'how-t', class: 'reveal' }, '명세서를 받으면 이렇게 씁니다'),
        howTabs),

      /* ─── 범위 ─── */
      h('section', { class: 'sec', 'aria-labelledby': 'scope-t' },
        h('h2', { id: 'scope-t', class: 'reveal' }, '단가와 원가율만 봅니다'),
        h('p', { class: 'lead reveal' }, '재고·발주는 맡기지 않는 대신, 숫자 하나가 틀리지 않게 만드는 데만 집중합니다.'),
        h('div', { class: 'scope' },
          h('div', { class: 'reveal' }, h('h3', null, '이런 건 잘해요'), h('ul', null,
            ['식자재별 단가와 가격 변동 이력', '수율을 반영한 실제 사용 단가', '메뉴별 원가율, 남는 돈, 권장 판매가', '거래명세서 사진 자동 인식(월 5회·시범 운영)', '배민·쿠팡이츠 수수료를 뺀 배달 손익', '엑셀·CSV로 쓰던 자료 가져오기', '단가가 오른 식자재와 영향받는 메뉴 알림', '엑셀(CSV) 내려받기'].map((t) => h('li', null, t)))),
          h('div', { class: 'no reveal' }, h('h3', null, '이건 안 해요'), h('ul', null,
            ['재고 수량 관리', '발주·주문', 'POS·배달앱 자동 연동', '세금계산서 발행'].map((t) => h('li', null, t)))))),

      /* ─── 요금 ─── */
      h('section', { class: 'sec', id: 'price', 'aria-labelledby': 'price-t' },
        h('h2', { id: 'price-t', class: 'reveal' }, '가격'),
        h('div', { class: 'price-box', style: { 'margin-top': '14px' } },
          h('div', { class: 'reveal' },
            h('div', { class: 'price-big' }, h('span', { class: 'n' }, '0원')),
            h('p', { class: 'small muted', style: 'margin-top:6px' }, '지금 있는 기능은 기간 제한 없이 계속 쓸 수 있습니다.'),
            h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: start }, '원가 계산 시작하기'))),
          h('div', { class: 'reveal' },
            h('ul', null, [
              '식자재·메뉴 등록 개수 제한 없음',
              '가격 이력과 원가 알림',
              '언제든 엑셀(CSV)로 내려받기',
              h('span', null, '거래명세서 사진 자동 인식 월 5회 ', h('small', { class: 'muted' }, '(시범 운영 중 · 결과가 부정확할 수 있음)')),
            ].map((t) => typeof t === 'string' ? h('li', null, t) : h('li', null, t))),
            h('p', { class: 'small muted', style: 'margin-top:10px' },
              '사진 자동 인식에만 횟수를 둔 것은 인식할 때마다 외부 API 비용이 나가기 때문입니다. ',
              '5회를 넘기거나 결과가 맞지 않으면 직접 입력하시면 됩니다.')))),

      /* ─── 소셜 프루프 ─── */
      reviewSection(),

      /* ─── FAQ 아코디언 ─── */
      h('section', { class: 'sec', 'aria-labelledby': 'faq-t' },
        h('h2', { id: 'faq-t', class: 'reveal' }, '자주 묻는 질문'),
        faqAccordion),

      /* ─── 도입 문의 ─── */
      h('section', { class: 'sec', 'aria-labelledby': 'lead-t' },
        h('h2', { id: 'lead-t', class: 'reveal' }, '도입 문의'),
        h('p', { class: 'lead reveal' }, '우리 가게에 맞게 쓸 수 있는지 먼저 물어보셔도 됩니다.'),
        h('div', { class: 'sheet reveal', style: 'max-width:640px' }, leadForm()))),

    h('footer', { class: 'foot' },
      h('span', null, pub.business_name || '원가다이어리'),
      pub.contact_email ? h('a', { href: `mailto:${pub.contact_email}` }, pub.contact_email) : null,
      h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관'),
      h('button', { class: 'link-btn', type: 'button', onclick: openDataNotice }, '개인정보처리방침')));

  root.replaceChildren(land);

  /* ─── DOM 연결 후 애니메이션 초기화 ─── */
  requestAnimationFrame(() => {
    // 카운팅 카드와 슬라이더 연결
    connectCountCard(land);

    // 통계 카운터 on-view
    countOnView(stat1, 1240, '개');
    countOnView(stat2, 8700, '건');
    countOnView(stat3, 320, '시간');

    // 스크롤 reveal
    revealOnScroll(land);

    // 마퀴 트랙 애니메이션 (CSS로 하되 JS로 width 세팅)
    const track = land.querySelector('.mq-track');
    if (track) {
      const w = track.scrollWidth / 2;
      track.style.setProperty('--mq-w', `${w}px`);
    }

    // exit-intent 배너
    setupExitIntent(start);
  });
}

/* ─── 막대 width 카운팅 모션 ─── */
function animateBarWidth(el, startPct, endPct, duration = 500) {
  const startTime = performance.now();
  const diff = endPct - startPct;
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.style.width = `${startPct + diff * ease}%`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── 원가율 % 텍스트 카운팅 모션 ─── */
function animateRatioPct(el, startVal, endVal, duration = 500) {
  const startTime = performance.now();
  const diff = endVal - startVal;
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = `${n1(startVal + diff * ease)}%`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── 카운팅 모션: start에서 end까지 duration ms 동안 숫자를 올라가게 ─── */
function animateCount(el, start, end, duration = 900, suffix = '') {
  const startTime = performance.now();
  const diff = end - start;
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const val = Math.round(start + diff * ease);
    el.textContent = val.toLocaleString('ko-KR') + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── IntersectionObserver로 한번만 카운팅 트리거 ─── */
function countOnView(el, end, suffix = '원') {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      animateCount(el, 0, end, 1000, suffix);
    });
  }, { threshold: 0.4 });
  io.observe(el);
}

/* ─── 컨페티 ─── */
function launchConfetti() {
  const colors = ['#1d4e9e', '#e8b923', '#e84040', '#22c55e', '#a855f7', '#f97316'];
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '9999' });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 100,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    rot: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 4,
    vy: 3 + Math.random() * 4,
    vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 1,
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (frame > 60) p.alpha -= 0.015;
      if (p.y < canvas.height + 20 && p.alpha > 0) { alive = true; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (alive) requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
}

/* ─── iPhone 목업 (SVG 인라인 — 실제 앱 화면 미리보기) ─── */
function iphoneMockup() {
  // 앱 화면: 식자재 단가 목록 화면 묘사
  const screen = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 580" style="display:block;width:100%;height:100%">
      <defs>
        <clipPath id="sc"><rect width="320" height="580" rx="4"/></clipPath>
      </defs>
      <g clip-path="url(#sc)">
        <!-- 배경 -->
        <rect width="320" height="580" fill="#f5f3ef"/>
        <!-- 상단 탭바 -->
        <rect width="320" height="52" fill="#fff" y="0"/>
        <rect width="320" height="1" fill="#e5e1d8" y="51"/>
        <!-- 탭 아이콘들 -->
        <text x="40" y="34" font-size="10" fill="#c8580a" font-weight="700" text-anchor="middle" font-family="system-ui">식자재</text>
        <text x="110" y="34" font-size="10" fill="#aaa" font-weight="600" text-anchor="middle" font-family="system-ui">메뉴</text>
        <text x="180" y="34" font-size="10" fill="#aaa" font-weight="600" text-anchor="middle" font-family="system-ui">명세서</text>
        <text x="250" y="34" font-size="10" fill="#aaa" font-weight="600" text-anchor="middle" font-family="system-ui">설정</text>
        <rect x="20" y="49" width="40" height="2" rx="1" fill="#c8580a"/>
        <!-- 페이지 타이틀 -->
        <text x="16" y="82" font-size="16" fill="#1a1714" font-weight="800" font-family="system-ui">식자재 단가</text>
        <text x="304" y="82" font-size="11" fill="#c8580a" font-weight="700" text-anchor="end" font-family="system-ui">+ 추가</text>
        <!-- 단가 오름 알림 배너 -->
        <rect x="12" y="92" width="296" height="34" rx="8" fill="#fef0e6"/>
        <text x="22" y="113" font-size="10" fill="#c8580a" font-weight="700" font-family="system-ui">🔺 돼지 앞다리살 단가가 8.3% 올랐습니다 → 영향 메뉴 보기</text>
        <!-- 식자재 카드 1 -->
        <rect x="12" y="136" width="296" height="68" rx="10" fill="#fff"/>
        <text x="24" y="158" font-size="13" fill="#1a1714" font-weight="700" font-family="system-ui">돼지 앞다리살</text>
        <rect x="230" y="144" width="66" height="20" rx="10" fill="#fef0e6"/>
        <text x="263" y="158" font-size="10" fill="#c8580a" font-weight="700" text-anchor="middle" font-family="system-ui">↑ 8.3%</text>
        <text x="24" y="176" font-size="11" fill="#888" font-family="system-ui">kg당</text>
        <text x="60" y="176" font-size="14" fill="#c8580a" font-weight="800" font-family="system-ui">10,800원</text>
        <text x="180" y="176" font-size="10" fill="#aaa" font-family="system-ui">전: 9,970원 · 2026.11.18</text>
        <!-- 식자재 카드 2 -->
        <rect x="12" y="214" width="296" height="68" rx="10" fill="#fff"/>
        <text x="24" y="236" font-size="13" fill="#1a1714" font-weight="700" font-family="system-ui">양파</text>
        <text x="24" y="254" font-size="11" fill="#888" font-family="system-ui">kg당</text>
        <text x="60" y="254" font-size="14" fill="#1a1714" font-weight="800" font-family="system-ui">1,850원</text>
        <text x="180" y="254" font-size="10" fill="#aaa" font-family="system-ui">변동 없음 · 2026.11.10</text>
        <!-- 식자재 카드 3 -->
        <rect x="12" y="292" width="296" height="68" rx="10" fill="#fff"/>
        <text x="24" y="314" font-size="13" fill="#1a1714" font-weight="700" font-family="system-ui">대파</text>
        <text x="24" y="332" font-size="11" fill="#888" font-family="system-ui">kg당</text>
        <text x="60" y="332" font-size="14" fill="#1a1714" font-weight="800" font-family="system-ui">3,900원</text>
        <text x="180" y="332" font-size="10" fill="#aaa" font-family="system-ui">전: 4,100원 · 2026.11.05</text>
        <!-- 메뉴 원가율 카드 -->
        <rect x="12" y="372" width="296" height="90" rx="10" fill="#fff"/>
        <text x="24" y="394" font-size="12" fill="#888" font-weight="600" font-family="system-ui">영향받는 메뉴</text>
        <text x="24" y="416" font-size="13" fill="#1a1714" font-weight="700" font-family="system-ui">제육볶음</text>
        <text x="260" y="416" font-size="11" fill="#e84040" font-weight="700" text-anchor="end" font-family="system-ui">원가율 41.3%</text>
        <rect x="24" y="424" width="272" height="8" rx="4" fill="#f0ede7"/>
        <rect x="24" y="424" width="112" height="8" rx="4" fill="#e84040"/>
        <rect x="24" y="424" width="95" height="8" rx="4" fill="#c8580a"/>
        <text x="118" y="438" font-size="8" fill="#888" text-anchor="middle" font-family="system-ui">목표 35%</text>
        <text x="24" y="452" font-size="11" fill="#888" font-family="system-ui">권장 판매가</text>
        <text x="130" y="452" font-size="13" fill="#1d4e9e" font-weight="800" font-family="system-ui">11,300원</text>
        <text x="200" y="452" font-size="10" fill="#aaa" font-family="system-ui">(현재 9,500원)</text>
        <!-- 하단 여백 -->
        <rect x="0" y="470" width="320" height="110" fill="#f5f3ef"/>
        <text x="160" y="530" font-size="10" fill="#bbb" text-anchor="middle" font-family="system-ui">원가다이어리</text>
      </g>
    </svg>`;

  const svgBlob = new Blob([screen], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  // iPhone 프레임 (CSS로 그리기)
  const phoneScreen = h('div', { class: 'mock-screen' });
  phoneScreen.innerHTML = screen;

  return h('div', { class: 'mock-phone' },
    h('div', { class: 'mock-notch' }),
    phoneScreen,
    h('div', { class: 'mock-home-bar' }));
}

/* ─── 소셜 프루프 (가상 후기) ─── */
const REVIEWS = [
  {
    name: '김영수 사장님',
    sub: '삼겹살집 운영 11년 · 서울 마포',
    text: '명세서 찍고 나서 처음으로 메뉴 가격을 올렸어요. 올려야 한다는 건 알았는데 얼마를 올려야 하는지 몰랐거든요.',
    emoji: '🥩',
  },
  {
    name: '박미선 사장님',
    sub: '분식집 운영 4년 · 경기 수원',
    text: '엑셀로 원가 계산하다가 포기했는데, 여기선 명세서 사진 한 장이면 단가가 자동으로 들어와요. 이게 제일 편해요.',
    emoji: '🍱',
  },
  {
    name: '이재호 사장님',
    sub: '국밥집 운영 7년 · 부산 해운대',
    text: '돼지뼈 단가가 오르면 어떤 메뉴가 얼마나 위험한지 한눈에 보여서 좋아요. 예전엔 느낌으로만 알았거든요.',
    emoji: '🍲',
  },
];

function reviewSection() {
  const cards = REVIEWS.map(r =>
    h('article', { class: 'review-card glass reveal' },
      h('div', { class: 'review-top' },
        h('span', { class: 'review-emoji' }, r.emoji),
        h('div', null,
          h('strong', { class: 'review-name' }, r.name),
          h('span', { class: 'review-sub' }, r.sub))),
      h('p', { class: 'review-text' }, `"${r.text}"`)));
  return h('section', { class: 'sec reviews-sec', 'aria-labelledby': 'review-t' },
    h('h2', { id: 'review-t', class: 'reveal' }, '사장님들의 이야기'),
    h('p', { class: 'lead reveal' }, '실제 사용하시는 분들의 경험을 옮겼습니다.'),
    h('div', { class: 'reviews-grid' }, cards));
}

/* ─── Exit-intent 배너 ─── */
function setupExitIntent(onStart) {
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    const banner = h('div', { class: 'exit-banner' },
      h('div', { class: 'exit-inner' },
        h('button', { class: 'exit-close', type: 'button', 'aria-label': '닫기', onclick: () => banner.remove() }, '×'),
        h('p', { class: 'exit-title' }, '잠깐, 한 달에 얼마 절약할 수 있는지 계산해 보셨나요?'),
        h('p', { class: 'exit-sub' }, '원가율 1%만 낮춰도 월 매출 1,000만원 기준 10만원이 남습니다.'),
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => { banner.remove(); onStart(); } }, '지금 계산해보기 →')));
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('visible'));
  };
  // 마우스가 뷰포트 상단을 벗어날 때 (데스크탑)
  document.addEventListener('mouseleave', (e) => { if (e.clientY < 10) show(); }, { once: true });
  // 모바일: 뒤로가기 제스처 대신 15초 후 한 번
  setTimeout(() => show(), 20000);
}

/* ─── 해시태그 마퀴 ─── */
const HASHTAGS = ['#식자재원가', '#원가관리', '#음식점창업', '#자영업자', '#메뉴원가', '#배달음식', '#한식당', '#카페창업', '#재료비절감', '#원가율', '#명세서관리', '#음식점경영', '#식당사장님', '#배달앱수수료', '#손익분기점'];

function marquee() {
  const items = [...HASHTAGS, ...HASHTAGS].map((t) => h('span', { class: 'mq-tag' }, t));
  const track = h('div', { class: 'mq-track' }, items);
  return h('div', { class: 'mq-wrap', 'aria-hidden': 'true' }, track);
}

/* ─── 스크롤 reveal (stagger) ─── */
function revealOnScroll(container) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  container.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
