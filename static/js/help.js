/* 사용 설명서: 처음 쓰는 사장님, 휴대폰이 익숙하지 않은 어르신 사장님도 따라 할 수 있게
   한 화면에 한 가지 일만, 큰 글씨와 번호 붙은 단계로 설명한다. 단계 안의 버튼 그림(.hp-btn)은
   실제 화면의 버튼 글자와 똑같이 맞춘다(버튼 글자를 바꾸면 여기도 같이 고칠 것).
   맨 위 '글자 크기'는 앱 전체에 적용되고 이 기기(localStorage)에만 저장된다. */
import { h, icon, fill } from './core.js';

/* ---------- 글자 크기 (앱 전체) ---------- */
const TEXT_KEY = 'cd-text-size';
const SIZES = [['md', '보통'], ['lg', '크게'], ['xl', '아주 크게']];

export function textSize() {
  try { return localStorage.getItem(TEXT_KEY) || 'md'; } catch { return 'md'; }
}
export function applyTextSize(v = textSize()) {
  if (v === 'md') delete document.documentElement.dataset.text;
  else document.documentElement.dataset.text = v;
}
function setTextSize(v) {
  try { localStorage.setItem(TEXT_KEY, v); } catch { /* 저장 못 해도 지금 화면에는 적용 */ }
  applyTextSize(v);
}
export function textSizePicker() {
  const wrap = h('div', { class: 'hp-size', role: 'group', 'aria-label': '글자 크기' });
  const paint = () => fill(wrap, SIZES.map(([v, label]) => h('button', {
    type: 'button', class: `hp-size-btn s-${v}`, 'aria-pressed': String(textSize() === v),
    onclick: () => { setTextSize(v); paint(); },
  }, h('span', { class: 'hp-size-a', 'aria-hidden': 'true' }, '가'), label)));
  paint();
  return wrap;
}

/* ---------- 작은 부품 ---------- */
const btn = (label, ic) => h('span', { class: 'hp-btn' }, ic ? icon(ic, 18) : null, label); // 화면 속 버튼 모양
const tab = (label, ic) => h('span', { class: 'hp-tab' }, icon(ic, 18), label); // 아래쪽 메뉴 모양
const steps = (...items) => h('ol', { class: 'hp-steps' }, items.map((it) => h('li', null, h('div', { class: 'hp-step-body' }, it))));
const tip = (...kids) => h('div', { class: 'hp-tip' }, h('b', null, '알아 두면 좋아요'), h('p', null, ...kids));
const go = (href, label) => h('a', { class: 'btn hp-go', href }, label, icon('chevron', 18));

/* ---------- 주제별 내용 ---------- */
const TOPICS = [
  {
    id: 'start', ic: 'home', title: '처음 시작하기', sub: '세 가지만 하면 메뉴 원가가 나와요',
    body: () => [
      h('p', { class: 'hp-lead' }, '원가다이어리는 ', h('b', null, '메뉴 한 그릇에 재료비가 얼마 들고, 얼마가 남는지'), ' 알려 주는 앱이에요. 아래 순서대로 한 번만 해 두면 그다음부터는 자동으로 계산돼요.'),
      steps(
        [h('h3', null, '사 오는 재료를 넣어요'), h('p', null, '양파·돼지고기처럼 사 오는 재료와 산 가격을 적어요. 거래명세서나 영수증 사진을 올리면 한 번에 들어가요.'), h('a', { href: '#/help/invoice' }, '사진으로 넣는 법')],
        [h('h3', null, '메뉴를 만들어요'), h('p', null, '메뉴 이름, 파는 가격, 한 그릇에 들어가는 재료와 양을 적어요.'), h('a', { href: '#/help/menus' }, '메뉴 만드는 법')],
        [h('h3', null, '원가율을 봐요'), h('p', null, '판매가에서 재료비가 몇 %인지 바로 나와요. 재료값이 오르면 원가율도 저절로 다시 계산돼요.')]),
      tip('휴대폰 맨 아래에 있는 ', tab('홈', 'home'), ' ', tab('식자재', 'box'), ' ', tab('명세서', 'camera'), ' ', tab('메뉴', 'list'), ' ', tab('전체', 'grid'), ' 를 눌러 화면을 옮겨요. 이 설명서는 ', tab('전체', 'grid'), ' 안에 있어요.'),
    ],
  },
  {
    id: 'invoice', ic: 'camera', title: '명세서 사진으로 재료 넣기', sub: '거래명세서·영수증을 찍기만 하면 돼요',
    body: () => [
      h('p', { class: 'hp-lead' }, '납품받은 ', h('b', null, '거래명세서나 영수증'), '을 찍어 올리면, 품목과 가격을 읽어서 재료 단가를 바꿔 드려요. 바꾸기 전에 꼭 한 번 보여 드리니 안심하세요.'),
      steps(
        [h('h3', null, '아래 ', tab('명세서', 'camera'), ' 를 눌러요')],
        [h('h3', null, btn('사진 찍기'), ' 또는 ', btn('사진 고르기'), ' 를 눌러요'), h('p', null, '종이를 바닥에 펴 놓고, 글자가 다 보이게 위에서 찍어 주세요. 그림자가 지지 않게 밝은 곳이 좋아요.')],
        [h('h3', null, '읽어 온 품목과 가격을 확인해요'), h('p', null, '사진과 비교해서 규격(예: 15kg)과 가격이 맞는지 봐요. 틀린 칸은 눌러서 고치면 돼요.')],
        [h('h3', null, btn('3개 품목 반영하기'), ' 를 눌러요'), h('p', null, '숫자는 고른 품목 수만큼 바뀌어요. 누르면 재료 단가와 메뉴 원가가 한꺼번에 바뀌어요.')]),
      tip('처음 보는 품목은 ', btn('새 식자재로 추가'), ' 를 누르면 식자재 목록에 새로 들어가요.'),
      go('#/invoice', '명세서 화면 열기'),
    ],
  },
  {
    id: 'ingredients', ic: 'box', title: '재료 직접 넣기', sub: '사진이 없을 때 손으로 적는 법',
    body: () => [
      steps(
        [h('h3', null, '아래 ', tab('식자재', 'box'), ' 를 누르고 ', btn('식자재 추가', 'plus'), ' 를 눌러요')],
        [h('h3', null, '이름과 산 가격을 적어요'), h('p', null, '예: 양파 한 망 ', h('b', null, '15kg'), '을 ', h('b', null, '18,000원'), '에 샀으면 규격에 15kg, 구매 가격에 18,000을 적어요. 1kg에 얼마인지는 앱이 계산해요.')],
        [h('h3', null, '수율은 손질하고 남는 비율이에요'), h('p', null, '껍질·뼈를 버리는 재료만 적으면 돼요. 예: 양파 10kg을 까서 9kg이 남으면 90. 모르면 100 그대로 두세요.')],
        [h('h3', null, btn('저장'), ' 을 눌러요')]),
      tip('거래처, 분류, 원산지처럼 "(선택)"이라고 써 있는 칸은 비워 둬도 괜찮아요.'),
      go('#/ingredients', '식자재 화면 열기'),
    ],
  },
  {
    id: 'menus', ic: 'list', title: '메뉴 원가 보기', sub: '한 그릇에 얼마 남는지 알아봐요',
    body: () => [
      steps(
        [h('h3', null, '아래 ', tab('메뉴', 'list'), ' 를 누르고 ', btn('메뉴 추가', 'plus'), ' 를 눌러요')],
        [h('h3', null, '메뉴 이름과 판매가를 적어요'), h('p', null, '예: 김치찌개, 9,000원')],
        [h('h3', null, '한 그릇에 들어가는 재료를 넣어요'), h('p', null, '재료 이름을 몇 글자만 쳐도 내 식자재 목록에서 찾아 줘요. 양과 단위(g, 개, 국자 등)를 고르세요. 재료가 더 있으면 ', btn('재료 추가', 'plus'), ' 를 눌러요.')],
        [h('h3', null, '위쪽에 원가율이 바로 나와요')]),
      h('div', { class: 'hp-example', 'aria-label': '원가율 예시' },
        h('p', { class: 'hp-ex-title' }, '원가율이 뭐예요?'),
        h('p', null, '판매가 중에서 재료비가 차지하는 몫이에요.'),
        h('div', { class: 'hp-eq' },
          h('span', null, '재료비 ', h('b', { class: 'n' }, '3,000원')), h('span', { class: 'op' }, '÷'),
          h('span', null, '판매가 ', h('b', { class: 'n' }, '9,000원')), h('span', { class: 'op' }, '='),
          h('span', { class: 'res' }, h('b', { class: 'n' }, '33%'))),
        h('p', { class: 'hint' }, '보통 식당은 30~35%를 목표로 잡아요. 목표는 전체 → 설정에서 바꿀 수 있어요.')),
      go('#/menus', '메뉴 화면 열기'),
    ],
  },
  {
    id: 'prep', ic: 'cook', title: '미리 만든 재료 (육수·양념장·반죽)', sub: '김치전 반죽, 국자로 세는 법',
    body: () => [
      h('p', { class: 'hp-lead' }, '육수·양념장·반죽처럼 ', h('b', null, '한 통 미리 만들어 두고 여러 번 덜어 쓰는 것'), '이 있죠. 주방에서는 "프렙"이라고도 불러요. 한 통에 든 재료비를 적어 두면, 한 번 덜어 쓸 때 얼마인지 앱이 나눠 줘요.'),
      h('h2', { class: 'hp-h2' }, '김치전 반죽으로 해 볼게요'),
      steps(
        [h('h3', null, tab('전체', 'grid'), ' → ', btn('미리 만든 재료'), ' → ', btn('미리 만든 재료 추가', 'plus'))],
        [h('h3', null, '이름에 "김치전 반죽"이라고 적어요')],
        [h('h3', null, '다 만들면 얼마나 나오는지 골라요'),
          h('div', { class: 'hp-choice' },
            h('div', null, h('b', null, '몇 장 나오는지 알면'), h('p', null, '"몇 장·몇 개 나오는지 알아요"를 고르고 20장처럼 적어요. 메뉴에는 "김치전 반죽 1장"으로 넣어요.')),
            h('div', null, h('b', null, '잘 모르면'), h('p', null, '"잘 모르면 국자로 셀래요"를 고르고, 한 통에서 몇 국자 나오는지 적어요. 메뉴에는 "2국자"처럼 넣어요.')))],
        [h('h3', null, '한 통 만드는 데 들어간 재료를 넣어요'), h('p', null, '김치 2kg, 부침가루 1kg, 물 1.5L처럼 한 통 기준으로 적어요.')],
        [h('h3', null, btn('저장'), ' 하면 1장당, 1국자당 원가가 나와요')]),

      h('h2', { class: 'hp-h2' }, '한 국자는 몇 ml일까요?'),
      h('p', null, '국자는 가게마다 크기가 달라서 정해진 숫자가 없어요. 식당용 국자는 보통 손잡이에 ', h('b', null, 'oz(온스)'), '로 크기가 적혀 있는데, 1oz가 약 30ml예요.'),
      h('div', { class: 'hp-table-wrap' }, h('table', { class: 'hp-table' },
        h('thead', null, h('tr', null, h('th', null, '국자'), h('th', null, '담기는 양'), h('th', null, '종이컵으로 보면'))),
        h('tbody', null,
          h('tr', null, h('td', null, '작은 국자 (2oz)'), h('td', { class: 'n' }, '약 60ml'), h('td', null, '3분의 1컵')),
          h('tr', null, h('td', null, '보통 국자 (4oz)'), h('td', { class: 'n' }, '약 120ml'), h('td', null, '3분의 2컵')),
          h('tr', null, h('td', null, '큰 국자 (6oz)'), h('td', { class: 'n' }, '약 180ml'), h('td', null, '한 컵 가득')),
          h('tr', null, h('td', null, '아주 큰 국자 (8oz)'), h('td', { class: 'n' }, '약 240ml'), h('td', null, '한 컵 넘게')))),
      ),
      h('div', { class: 'hp-tip hp-measure' }, h('b', null, '우리 가게 국자 재는 법'),
        h('p', null, '국자에 ', h('b', null, '물을 가득'), ' 떠서 종이컵(약 180ml)에 부어 보세요. 반쯤 차면 약 90ml예요. 한 번만 재 두면 계속 써요.')),

      h('h2', { class: 'hp-h2' }, '국물만 뜰 때와 건더기가 있을 때'),
      h('div', { class: 'hp-two' },
        h('div', { class: 'hp-card' }, h('b', null, '맑은 국물·육수·물'), h('p', null, '국자 크기만큼 그대로 담겨요. 그래서 ', h('b', null, '통 눈금(L) ÷ 국자 크기'), '로 계산해도 거의 맞아요.'), h('p', { class: 'hint' }, '예: 육수 6L ÷ 120ml = 50국자')),
        h('div', { class: 'hp-card' }, h('b', null, '건더기 있는 것·반죽·양념장'), h('p', null, '같은 국자라도 소복이 올라오거나 빈틈이 생겨서 ', h('b', null, '뜰 때마다 양이 달라요.'), ' 이럴 때는 한 통을 실제로 덜어 쓰면서 ', h('b', null, '몇 국자 나오는지 세는 것'), '이 가장 정확해요.'), h('p', { class: 'hint' }, '처음 한 번만 세어 두면 돼요'))),

      h('h2', { class: 'hp-h2' }, '숟가락·컵은 정해진 크기가 있어요'),
      h('div', { class: 'hp-table-wrap' }, h('table', { class: 'hp-table' },
        h('tbody', null,
          h('tr', null, h('td', null, '1큰술 (계량스푼 큰 것)'), h('td', { class: 'n' }, '15ml')),
          h('tr', null, h('td', null, '1작은술 (계량스푼 작은 것)'), h('td', { class: 'n' }, '5ml')),
          h('tr', null, h('td', null, '계량컵 1컵'), h('td', { class: 'n' }, '200ml')),
          h('tr', null, h('td', null, '종이컵 1컵'), h('td', { class: 'n' }, '약 180ml'))))),
      h('p', { class: 'hp-src' }, '근거: 식당용 국자·계량 숟가락 크기는 미국 네브래스카주 교육부 급식 안내서(Basics At A Glance, 국자 1·2·4·6·8oz = 1/8·1/4·1/2·3/4·1컵)와 식당용 조리도구 제조사 카탈로그(Carlisle Perfect Portions)를 따랐어요. 1oz = 29.6ml로 계산해 반올림했어요. 큰술·작은술·컵은 한국 요리책에서 쓰는 계량 기준이에요. 집에서 쓰는 국자는 이보다 작은 경우가 많으니 꼭 한 번 재 보세요.'),
      go('#/preps', '미리 만든 재료 열기'),
    ],
  },
  {
    id: 'sales', ic: 'trend', title: '매출 적기', sub: '하루 매출을 넣고 목표와 비교해요',
    body: () => [
      steps(
        [h('h3', null, tab('전체', 'grid'), ' → ', btn('내 매출'), ' 을 눌러요')],
        [h('h3', null, '날짜를 고르고 그날 매출을 적어요'), h('p', null, '포스기나 카드 단말기에 찍힌 하루 합계를 그대로 적으면 돼요.')],
        [h('h3', null, btn('저장'), ' 을 눌러요'), h('p', null, '달력에 날마다 목표를 넘었는지 색으로 보여 드려요.')]),
      tip('어떤 메뉴가 몇 개 팔렸는지도 넣으면, 매출에서 재료비를 뺀 실제로 남은 돈까지 보여 드려요. 안 넣어도 괜찮아요.'),
      go('#/sales', '내 매출 열기'),
    ],
  },
  {
    id: 'stuck', ic: 'chat', title: '막히거나 궁금할 때', sub: '글자 크기, 물어볼 곳',
    body: () => [
      h('h2', { class: 'hp-h2' }, '글자가 작아서 안 보이면'),
      h('p', null, '이 설명서 맨 위의 글자 크기에서 ', h('b', null, '크게'), ' 또는 ', h('b', null, '아주 크게'), '를 누르세요. 앱의 모든 화면 글자가 커져요.'),
      textSizePicker(),
      h('h2', { class: 'hp-h2' }, '잘못 넣었을 때'),
      h('p', null, '식자재·메뉴는 언제든 다시 눌러서 고치고 ', btn('저장'), ' 하면 돼요. 지운 것은 되돌릴 수 없으니 지울 때만 조심하세요.'),
      h('h2', { class: 'hp-h2' }, '그래도 모르겠으면'),
      h('p', null, '불편한 점이나 있었으면 하는 기능을 적어 보내 주세요. 운영자가 직접 읽어요.'),
      go('#/feedback', '개선사항 요청 보내기'),
    ],
  },
];

export async function render(box, topicId) {
  const t = TOPICS.find((x) => x.id === topicId);
  if (t) {
    const i = TOPICS.indexOf(t);
    const next = TOPICS[i + 1];
    box.append(h('div', { class: 'hp' },
      h('div', { class: 'page-h' },
        h('a', { class: 'btn ghost sm', href: '#/help' }, icon('back', 18), '설명서 처음')),
      h('header', { class: 'hp-head' },
        h('span', { class: 'hp-ic', 'aria-hidden': 'true' }, icon(t.ic, 26)),
        h('div', null, h('h1', null, t.title), h('p', { class: 'hp-sub' }, t.sub))),
      h('article', { class: 'sheet hp-body' }, t.body()),
      next ? h('a', { class: 'hp-next', href: `#/help/${next.id}` }, h('span', { class: 'hint' }, '다음'), h('b', null, next.title), icon('chevron', 20)) : null));
    return;
  }
  box.append(h('div', { class: 'hp' },
    h('div', { class: 'page-h' }, h('h1', null, '사용 설명서')),
    h('section', { class: 'sheet hp-sizebox' },
      h('p', { class: 'hp-size-t' }, '글자 크기'),
      textSizePicker()),
    h('p', { class: 'hp-lead', style: 'margin:18px 2px 10px' }, '궁금한 것을 눌러 보세요. 한 화면에 하나씩 차근차근 알려 드려요.'),
    h('ul', { class: 'hp-list' }, TOPICS.map((x, i) => h('li', null,
      h('a', { class: 'hp-item', href: `#/help/${x.id}` },
        h('span', { class: 'hp-num n', 'aria-hidden': 'true' }, i + 1),
        h('span', { class: 'hp-item-t' }, h('b', null, x.title), h('span', null, x.sub)),
        icon('chevron', 20)))))));
}
