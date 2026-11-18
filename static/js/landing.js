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
      h('div', { class: 'sim-ratio' },
        h('span', { class: 'nu' }, h('span', { class: 'n' }, n1(s.ratio)), h('span', { class: 'u' }, '%')),
        stamp(statusOf(s.ratio), 'big')),
      marginBar({ ratio: s.ratio, target: TARGET, big: true }),
      h('dl', { class: 'sim-facts' },
        h('div', null, h('dt', null, '재료비'), h('dd', null, num(n0(s.cost), '원'))),
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
  ['명세서·요리 사진은 어디에 저장되나요?', '원가다이어리 서버에는 저장하지 않습니다. 글자나 재료를 읽기 위해 사진을 Anthropic의 Claude API로 보내고, 읽어 낸 품목·규격·가격(요리 사진은 재료와 추정 양)만 내 계정에 남습니다. 자동 인식을 설정하기 전에는 예시 명세서로 화면을 먼저 써볼 수 있습니다.'],
  ['쓰던 앱이나 엑셀 자료를 옮길 수 있나요?', '엑셀(.xlsx)과 CSV 파일을 올리면 제목 줄을 읽어 칸을 자동으로 맞추고, 저장하기 전에 미리 보여 드립니다. 앱마다 내려받는 파일의 모양이 달라서 칸이 틀리면 직접 고를 수 있습니다. 가격이 없는 식자재도 \'단가 없음\'으로 옮겨 두었다가 명세서로 채울 수 있습니다.'],
  ['메뉴별 재료 양(g)을 몰라도 쓸 수 있나요?', '완성된 요리 사진을 올리면 재료와 양을 짐작해 메뉴 초안을 만듭니다. 사진만으로 정확한 양을 알 수는 없어서 모든 숫자에 \'추정\' 표시와 범위가 붙고, 계량해서 고치기 전까지 원가율도 범위로 보여 드립니다.'],
  ['배달의민족·쿠팡이츠 수수료도 반영되나요?', '쓰는 앱을 켜고 구간·요율을 맞추면 메뉴마다 배달 주문 한 건에 남는 돈과 배달용 권장 판매가를 계산합니다. 앱과 연동하는 것이 아니라 공개된 안내를 바탕으로 한 기본값이며, 정산내역서와 다르면 직접 고쳐 쓰세요. 확인하지 못한 요율에는 \'확인 필요\' 표시가 붙습니다.'],
  ['글자를 잘못 읽으면 어떻게 되나요?', '반영하기 전에 모든 줄을 보여드리고, 규격과 가격은 직접 고칠 수 있습니다. 확인하고 누르기 전에는 아무것도 저장되지 않습니다.'],
  ['명세서마다 식자재 이름이 달라요.', '비슷한 이름은 자동으로 연결하고, 못 찾은 이름은 한 번만 골라 주시면 다음부터 기억합니다.'],
  ['수율은 어떻게 계산하나요?', '식자재마다 수율(다듬고 남는 비율)을 넣으면 실제로 쓰는 양 기준으로 계산합니다. 수율이 90%이면 단가를 0.9로 나눈 값을 원가에 씁니다.'],
  ['돈을 내야 하나요?', '원가다이어리는 무료입니다. 나중에 상권분석처럼 더 깊은 기능이 생기면 그것만 따로 유료로 둘 생각이지만, 지금 쓰는 기능들은 계속 무료로 남습니다.'],
  ['그만 쓰고 싶어요.', '설정에서 계정을 삭제하면 입력한 식자재·메뉴·가격 이력이 모두 지워집니다.'],
];

export function openDataNotice() {
  return openDialog({
    title: '데이터 이용 안내',
    content: h('div', { class: 'stack' },
      h('p', null, '원가다이어리는 서비스를 제공하는 데 필요한 정보만 저장합니다.'),
      h('div', null, h('div', { class: 'h-sec' }, '저장하는 것'),
        h('p', null, '이메일, 가게 이름, 암호화한 비밀번호, 직접 입력하거나 명세서·요리 사진·가져온 파일에서 읽어 낸 식자재·메뉴·가격 기록. 가져오기로 올린 엑셀·CSV 파일 자체는 저장하지 않습니다.')),
      h('div', null, h('div', { class: 'h-sec' }, '거래명세서·요리 사진'),
        h('p', null, '원가다이어리 서버에는 저장하지 않습니다. 자동 인식을 쓸 때 사진은 글자와 재료를 읽기 위해 Anthropic의 Claude API로 전송됩니다. 전송된 사진의 보관 기준은 Anthropic의 API 정책을 따릅니다.')),
      h('div', null, h('div', { class: 'h-sec' }, '그 밖에 정보가 나가는 곳'),
        h('p', null, '주소로 가게 위치를 찾을 때는 입력한 주소가 네이버 지도(네이버클라우드) 서버로 전달됩니다. 주변 상권 정보는 공공데이터(소상공인시장진흥공단, 서울 열린데이터광장)에서 가져오며 이용자 정보를 보내지 않습니다.')),
      h('div', null, h('div', { class: 'h-sec' }, '삭제'),
        h('p', null, '설정 화면의 계정 삭제를 누르면 입력한 모든 데이터가 서버에서 지워집니다. 엑셀(CSV)로 먼저 내려받을 수 있습니다.')),
      h('p', { class: 'xs muted' }, '자세한 내용은 ', h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관·개인정보처리방침'), '에 있습니다.')),
  });
}

export function openTerms() {
  const p = app.pub || {};
  return openDialog({
    title: '이용약관·개인정보처리방침 (요약)',
    content: h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, '전체 내용은 서비스 운영자에게 문의해 받아 보실 수 있습니다. 아래는 핵심 내용의 요약입니다.'),
      h('div', null, h('div', { class: 'h-sec' }, '이용 제한'),
        h('p', null, '로봇·크롤러 등 자동화된 방법으로 화면이나 자료를 수집하는 행위, 계산 결과·참고 레시피를 대량으로 복제·재판매하거나 다른 서비스 학습에 쓰는 행위, 계정 여러 개를 만들어 이용 제한(자동 인식 횟수 등)을 피하는 행위, 보안 장치를 우회하는 행위는 금지되며 확인되면 계정을 제한할 수 있습니다.')),
      h('div', null, h('div', { class: 'h-sec' }, '계산 결과는 참고용'),
        h('p', null, '원가·손익분기·AI 추정값은 입력값에 따른 참고 정보이며, 배달앱 수수료율은 변동되므로 화면에 표시된 날짜 기준으로 직접 확인해야 합니다.')),
      h('div', null, h('div', { class: 'h-sec' }, '개인정보 보관'),
        h('p', null, '이메일·상호명·입력 자료·접속 보안 기록(180일)을 저장합니다. 탈퇴 시 계정과 입력 자료는 즉시 삭제됩니다.')),
      p.business_name || p.biz_reg_no ? h('div', null, h('div', { class: 'h-sec' }, '사업자 정보'),
        h('p', null, [p.business_name, p.biz_ceo && `대표 ${p.biz_ceo}`, p.biz_reg_no && `사업자등록번호 ${p.biz_reg_no}`, p.biz_address].filter(Boolean).join(' · '))) : null),
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
  ['camera', '사진으로 메뉴 만들기', '다 된 요리 사진 한 장으로도 재료와 양을 어림잡아 메뉴 초안을 만들어 줍니다.'],
  ['search', '배달앱 수수료 계산', '배민·쿠팡이츠 수수료와 배달비까지 빼고 나면 한 건 팔아서 실제로 남는 돈이 얼마인지 보여 줍니다.'],
];

function featureGrid() {
  return h('section', { class: 'sec', 'aria-labelledby': 'feat-t' },
    h('h2', { id: 'feat-t' }, '무엇을 할 수 있나요'),
    h('div', { class: 'feat-grid' },
      FEATURES.map(([ic, title, desc]) => h('article', { class: 'feat-card' },
        icon(ic, 22), h('h3', null, title), h('p', null, desc)))));
}

export function renderLanding(root, onAuth) {
  const pub = app.pub || {};
  const start = () => openSignup({ onDone: onAuth });
  const login = () => openLogin({ onDone: onAuth });

  const faq = h('div', { class: 'faq' }, FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a))));

  root.replaceChildren(h('div', { class: 'land' },
    h('header', { class: 'land-top' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/static/icon.svg', alt: '', width: 26, height: 26 }), '원가다이어리'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: login }, '로그인')),

    h('section', { class: 'hero', 'aria-labelledby': 'hero-t' },
      h('div', { class: 'hero-in' },
        h('div', null,
          h('h1', { id: 'hero-t' }, '재료값 오르면, 어떤 메뉴를 얼마에 팔아야 남는지 바로 알려 드립니다'),
          h('p', { class: 'hero-lead' }, '명세서 사진 한 장만 올리면 식자재 단가가 바뀌고, 메뉴마다 원가율과 올려야 할 판매가가 다시 계산됩니다. 쓰던 엑셀도 그대로 가져올 수 있고, 사진만 있는 메뉴는 양을 어림잡아 채워 줍니다.'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', type: 'button', onclick: start }, '무료로 시작하기'),
            h('a', { class: 'btn ghost', href: '#price', onclick: (e) => { e.preventDefault(); document.getElementById('price').scrollIntoView({ behavior: 'smooth' }); } }, '제공 범위 보기')),
          h('p', { class: 'hero-note' }, '카드 등록 없이 바로 시작할 수 있고, 지금 있는 기능은 모두 무료입니다.')),
        simulator())),

    h('main', { id: 'main' },
      featureGrid(),

      h('section', { class: 'sec', 'aria-labelledby': 'how-t' },
        h('h2', { id: 'how-t' }, '명세서를 받으면 이렇게 씁니다'),
        h('div', { class: 'steps' },
          h('div', { class: 'step' }, h('div', { class: 'step-no' }, '1'), h('h3', null, '사진을 올립니다'), h('p', null, '납품받은 거래명세서를 찍어 올리면 품목, 규격, 단가를 읽어 옵니다.')),
          h('div', { class: 'step' }, h('div', { class: 'step-no' }, '2'), h('h3', null, '읽은 내용을 확인합니다'), h('p', null, '틀린 곳만 고치고, 이름이 다른 식자재는 한 번만 연결해 두면 다음부터 자동으로 알아봅니다.')),
          h('div', { class: 'step' }, h('div', { class: 'step-no' }, '3'), h('h3', null, '원가율이 다시 계산됩니다'), h('p', null, '단가가 오른 식자재와 그 때문에 원가율이 오른 메뉴를 바로 알려 드립니다.')))),

      h('section', { class: 'sec', 'aria-labelledby': 'scope-t' },
        h('h2', { id: 'scope-t' }, '단가와 원가율만 봅니다'),
        h('p', { class: 'lead' }, '재고 수량이나 발주까지 맡기지 않는 대신, 숫자 하나가 틀리지 않게 만드는 데 집중합니다.'),
        h('div', { class: 'scope' },
          h('div', null, h('h3', null, '합니다'), h('ul', null,
            ['식자재별 단가와 가격 변동 이력', '수율을 반영한 실제 사용 단가', '메뉴별 원가율, 남는 돈, 권장 판매가', '요리 사진으로 재료·양 추정(추정 표시와 범위)', '배민·쿠팡이츠 수수료를 뺀 배달 손익', '엑셀·CSV로 쓰던 자료 가져오기', '단가가 오른 식자재와 영향받는 메뉴 알림', '엑셀(CSV) 내려받기'].map((t) => h('li', null, t)))),
          h('div', { class: 'no' }, h('h3', null, '하지 않습니다'), h('ul', null,
            ['재고 수량 관리', '발주·주문', 'POS·배달앱 자동 연동', '세금계산서 발행'].map((t) => h('li', null, t)))))),

      h('section', { class: 'sec', id: 'price', 'aria-labelledby': 'price-t' },
        h('h2', { id: 'price-t' }, '요금'),
        h('div', { class: 'price-box', style: { 'margin-top': '14px' } },
          h('div', null,
            h('div', { class: 'price-big' }, h('span', { class: 'n' }, '무료')),
            h('p', { class: 'small muted', style: 'margin-top:6px' }, '카드 등록 없이, 계속 무료로 씁니다.'),
            h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: start }, '무료로 시작하기'))),
          h('ul', null, [
            '식자재·메뉴 개수 제한 없음',
            '명세서·요리 사진 자동 인식 월 10회',
            '가격 이력과 원가 알림',
            '언제든 엑셀(CSV)로 내려받기',
            '상권분석처럼 더 깊이 들어가는 기능은 나중에 따로 추가될 수도 있습니다.',
          ].map((t) => h('li', null, t))))),

      h('section', { class: 'sec', 'aria-labelledby': 'faq-t' }, h('h2', { id: 'faq-t' }, '자주 묻는 질문'), faq),

      h('section', { class: 'sec', 'aria-labelledby': 'lead-t' },
        h('h2', { id: 'lead-t' }, '도입 문의'),
        h('p', { class: 'lead' }, '우리 가게에 맞게 쓸 수 있는지 먼저 물어보셔도 됩니다.'),
        h('div', { class: 'sheet', style: 'max-width:640px' }, leadForm()))),

    h('footer', { class: 'foot' },
      h('span', null, pub.business_name || '원가다이어리'),
      pub.contact_email ? h('a', { href: `mailto:${pub.contact_email}` }, pub.contact_email) : null,
      h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관·개인정보처리방침'),
      h('button', { class: 'link-btn', type: 'button', onclick: openDataNotice }, '데이터 이용 안내'))));
}
