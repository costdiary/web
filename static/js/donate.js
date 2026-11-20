/* 후원하기 — 서버(.env의 TOSS_SECRET_KEY)에 토스페이먼츠 키가 없으면 payments.py의
   MockProvider로 동작해서(외부로 나가는 요청 없음) 버튼을 누르면 테스트로 바로 승인됩니다.
   키가 있으면 아래 토스 결제위젯이 뜹니다 — 카카오페이·토스페이는 별도 코드 없이, 토스
   가맹점 어드민의 "간편결제" 메뉴에서 켜 두면 이 위젯 안에 결제수단으로 자동으로 나타납니다
   (2026-11 기준 토스 공식 안내: tosspayments.com/services).

   결제위젯 SDK(js.tosspayments.com/v2/standard, TossPayments(clientKey) 전역 함수)는 실제
   운영 키로 테스트해 보지 못했습니다 — widgets()/setAmount()/renderPaymentMethods()/
   renderAgreement()/requestPayment()의 파라미터 이름은 docs.tosspayments.com에서 이 코드를
   작성하며 직접 대조했지만, <script> 주소 하나만은 그 문서 페이지에 값이 비어 있어 확인하지
   못한 채 적어 둔 것입니다. 실제 키를 받으면 https://docs.tosspayments.com/sdk/v2/js/environment
   로 주소를 한 번 더 대조하고, 결제창이 실제로 뜨는지 꼭 눈으로 확인해 주세요. */
import { h, api, app, icon, busy, toast, errMsg, refreshRoute, n0, openDialog } from './core.js';
import { num, emptyBlock } from './ui.js';

const PRESETS = [3000, 5000, 10000, 30000];

// 토스 결제창에서 흔히 돌아오는 실패 코드 → 한글 안내문(2026-11, docs.tosspayments.com/reference/error-codes
// 에서 직접 대조한 값입니다. 전체 목록은 아니라서, 여기 없는 코드는 서버가 준 message를 그대로
// 보여주고, 그것도 없으면 "알 수 없는 오류"로 안내합니다 — 코드를 그대로 노출하지 않습니다).
const TOSS_FAIL_MESSAGES = {
  PAY_PROCESS_CANCELED: '결제를 취소하셨습니다.',
  PAY_PROCESS_ABORTED: '결제가 진행되지 않았습니다.',
  REJECT_CARD_COMPANY: '카드사에서 결제를 거절했습니다. 카드사에 문의해 주세요.',
  INVALID_CARD_EXPIRATION: '카드 유효기간을 다시 확인해 주세요.',
  INVALID_STOPPED_CARD: '정지된 카드입니다. 다른 카드를 사용해 주세요.',
  INVALID_CARD_LOST_OR_STOLEN: '분실 또는 도난 신고된 카드입니다. 다른 카드를 사용해 주세요.',
  INVALID_CARD_NUMBER: '카드 번호를 다시 확인해 주세요.',
  EXCEED_MAX_ONE_DAY_WITHDRAW_AMOUNT: '하루 결제(출금) 한도를 넘었습니다.',
};

let tossSdkPromise = null;
function loadTossSdk() {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  if (!tossSdkPromise) {
    tossSdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard'; // 확인 못한 주소 — 위 주석 참고
      s.onload = () => (window.TossPayments ? resolve(window.TossPayments) : reject(new Error('결제 모듈을 불러오지 못했습니다.')));
      s.onerror = () => reject(new Error('결제 모듈을 불러오지 못했습니다.'));
      document.head.append(s);
    });
  }
  return tossSdkPromise;
}

/* 결제위젯은 결제창(카드·카카오페이·토스페이 등)을 띄운 뒤 successUrl/failUrl로 페이지 전체를
   이동시킨다. 이 SPA는 해시 라우팅이라 성공·실패 주소도 "#/donate?..." 형태로 돌려받고,
   main.js의 #/donate 라우트가 뒤에 붙는 쿼리스트링도 받아 주게 바꿔 뒀다. */
async function handleTossReturn() {
  const q = location.hash.indexOf('?');
  if (q === -1) return;
  const params = new URLSearchParams(location.hash.slice(q + 1));
  history.replaceState(null, '', `${location.pathname}${location.search}#/donate`); // 새로고침해도 다시 처리되지 않게 주소를 정리
  const pendingRaw = sessionStorage.getItem('wongae_donate_pending');
  sessionStorage.removeItem('wongae_donate_pending');
  const failCode = params.get('code');
  if (failCode) {
    const friendly = TOSS_FAIL_MESSAGES[failCode] || params.get('message') || '알 수 없는 오류가 났습니다.';
    toast(`결제가 완료되지 않았습니다: ${friendly}`, 'err');
    return;
  }
  const paymentKey = params.get('paymentKey');
  const orderId = params.get('orderId');
  if (!paymentKey || !orderId) return;
  const amountParam = params.get('amount');
  const pending = pendingRaw ? JSON.parse(pendingRaw) : null;
  // successUrl이 돌려준 금액이 우리가 요청한 금액과 같은지 반드시 확인한다(토스 공식 가이드).
  if (pending && amountParam && Number(amountParam) !== pending.amount) {
    toast('결제 금액이 요청한 금액과 다릅니다. 결제가 적용되지 않았습니다.', 'err');
    return;
  }
  try {
    await api('/api/donations/confirm', { method: 'POST', body: { order_id: orderId, payment_key: paymentKey } });
    toast('후원해 주셔서 감사합니다!');
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function openTossCheckout(created, amount) {
  const methodBox = h('div', { id: 'toss-payment-method' });
  const agreeBox = h('div', { id: 'toss-agreement' });
  const status = h('p', { class: 'hint' }, '결제 수단을 불러오는 중입니다…');
  const payBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, '결제하기');
  // 결제 수단을 못 불러왔을 때(네트워크 일시 오류 등) 모달을 닫지 않고 바로 다시 시도할 수 있게.
  const retryBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true }, '다시 시도');

  openDialog({ title: '후원 결제', content: h('div', { class: 'field' }, status, methodBox, agreeBox, h('div', { class: 'btn-row', style: 'margin-top:10px' }, payBtn, retryBtn)) });

  let widgets;
  async function loadWidgets() {
    status.textContent = '결제 수단을 불러오는 중입니다…';
    retryBtn.hidden = true;
    try {
      const TossPayments = await loadTossSdk();
      const tossPayments = TossPayments(created.client_key);
      // 비회원(저장된 카드 없는 1회성) 결제이므로 토스 문서가 안내하는 그대로 ANONYMOUS를 쓴다.
      widgets = tossPayments.widgets({ customerKey: 'ANONYMOUS' });
      await widgets.setAmount({ currency: 'KRW', value: amount });
      await Promise.all([
        widgets.renderPaymentMethods({ selector: '#toss-payment-method', variantKey: 'DEFAULT' }),
        widgets.renderAgreement({ selector: '#toss-agreement', variantKey: 'AGREEMENT' }),
      ]);
      status.remove();
      payBtn.disabled = false;
    } catch (e) {
      status.textContent = '결제 수단을 불러오지 못했습니다: ' + errMsg(e);
      retryBtn.hidden = false;
    }
  }
  retryBtn.addEventListener('click', () => busy(retryBtn, loadWidgets));
  await loadWidgets();

  payBtn.addEventListener('click', () => busy(payBtn, async () => {
    sessionStorage.setItem('wongae_donate_pending', JSON.stringify({ order_id: created.order_id, amount }));
    const returnUrl = `${location.origin}${location.pathname}#/donate`;
    try {
      await widgets.requestPayment({ orderId: created.order_id, orderName: '원가다이어리 후원', successUrl: returnUrl, failUrl: returnUrl });
    } catch (e) {
      sessionStorage.removeItem('wongae_donate_pending');
      toast('결제가 취소되었거나 실패했습니다: ' + errMsg(e), 'err');
    }
  }));
}

function amountPicker(initial) {
  let value = initial;
  const btns = PRESETS.map((v) => {
    const b = h('button', { class: 'btn ghost sm', type: 'button', 'aria-pressed': 'false' }, `${n0(v)}원`);
    return b;
  });
  const custom = h('input', { class: 'input num', type: 'text', inputmode: 'numeric', placeholder: '직접 입력', 'aria-label': '후원 금액 직접 입력' });
  const mark = () => {
    btns.forEach((b, i) => {
      const on = PRESETS[i] === value && !custom.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); // 스크린리더도 선택된 금액을 알 수 있게
    });
  };
  btns.forEach((b, i) => b.addEventListener('click', () => { value = PRESETS[i]; custom.value = ''; mark(); }));
  custom.addEventListener('input', () => {
    const v = parseInt(custom.value.replace(/[^\d]/g, ''), 10);
    value = Number.isFinite(v) && v > 0 ? v : 0;
    mark();
  });
  mark();
  const wrap = h('div', { class: 'donate-amt' }, h('div', { class: 'btn-row' }, btns), custom);
  wrap.getValue = () => value;
  return wrap;
}

function rankRow(rank, item) {
  return h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, h('span', { class: 'xs muted' }, `${rank}. `), item.nickname),
      item.count > 1 ? h('div', { class: 'row-sub' }, `${item.count}번 후원`) : null),
    item.amount != null ? h('div', { class: 'row-end' }, num(n0(item.amount), '원')) : null));
}

async function loadLeaderboard(box, period) {
  box.replaceChildren(h('div', { class: 'skel' }));
  let res;
  try { res = await api(`/api/donations/leaderboard?period=${period}`); } catch (e) { toast(errMsg(e), 'err'); return; }
  if (!res.items.length) {
    box.replaceChildren(emptyBlock({ title: '아직 순위가 없습니다', text: period === 'day' ? '오늘의 첫 후원을 기다리고 있습니다.' : '이번 달의 첫 후원을 기다리고 있습니다.' }));
    return;
  }
  box.replaceChildren(h('ul', { class: 'rows' }, res.items.map((it, i) => rankRow(i + 1, it))));
}

export async function render(box) {
  await handleTossReturn();

  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '후원하기')),
    h('section', { class: 'sheet' },
      h('p', null, '원가다이어리는 ', h('b', null, '지금 쓰는 기능 전부 계속 무료'), '입니다. 후원 여부로 기능이 달라지는 건 전혀 없고, 다만 OCR 같은 여러 유료 API 비용과 홈페이지 서버 유지관리 비용에 보태 쓰려고 합니다.'),
      h('p', null, '일정 금액 이상 후원해 주시는 분들 중 ', h('b', null, '이번 달 후원 1위'), '에게는 무료 컨설팅을 드립니다.'),
      app.pub.donation_real_pg ? null : h('p', { class: 'hint' }, '결제사를 아직 정하지 않아, 지금 누르는 후원은 실제 결제 없이 테스트로 처리됩니다.')));

  const nickname = h('input', { class: 'input', type: 'text', maxLength: 30, placeholder: '닉네임', value: app.me.store_name || '' });
  const amt = amountPicker(PRESETS[1]);
  const message = h('input', { class: 'input', type: 'text', maxLength: 200, placeholder: '응원 메시지(선택)' });
  // 기본은 비공개 — 닉네임·금액을 전체 사용자에게 보여줄지는 후원자가 직접 켜서 고르게 한다.
  const amountPublic = h('input', { type: 'checkbox' });
  const submit = h('button', { class: 'btn primary', type: 'button' }, icon('heart', 18), '후원하기');

  submit.addEventListener('click', () => busy(submit, async () => {
    const amount = amt.getValue();
    const name = nickname.value.trim();
    if (!name) { toast('닉네임을 입력해 주세요.', 'err'); return; }
    if (!amount || amount < 1000) { toast('1,000원 이상으로 입력해 주세요.', 'err'); return; }
    let created;
    try {
      created = await api('/api/donations', { method: 'POST', body: { nickname: name, amount, message: message.value.trim(), amount_public: amountPublic.checked } });
    } catch (e) { toast(errMsg(e), 'err'); return; }

    if (created.provider !== 'toss') {
      // 결제사 키가 아직 없을 때(mock): paymentKey 자리에 테스트 값을 넣어 바로 승인한다.
      try {
        await api('/api/donations/confirm', { method: 'POST', body: { order_id: created.order_id, payment_key: `test-${created.order_id}` } });
      } catch (e) { toast(errMsg(e), 'err'); return; }
      toast('후원해 주셔서 감사합니다!');
      message.value = '';
      refreshRoute();
      return;
    }

    // 실제 결제사: 토스 결제위젯을 띄운다(카카오페이·토스페이는 위젯 안에서 결제수단으로 나타남).
    await openTossCheckout(created, amount);
  }));

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '후원하기')),
    h('div', { class: 'field' }, h('label', null, '닉네임'), nickname),
    h('div', { class: 'field' }, h('label', null, '금액'), amt),
    h('div', { class: 'field' }, h('label', null, '메시지'), message),
    h('label', { class: 'chk' }, amountPublic, '후원 금액을 순위에 공개할게요'),
    h('p', { class: 'hint' }, '켜면 순위에 닉네임과 함께 금액이 보입니다. 끄면(기본) 순위·닉네임만 보이고 금액은 나만 볼 수 있습니다.'),
    h('div', { class: 'btn-row', style: 'margin-top:10px' }, submit)));

  const boardBox = h('div', null);
  const dayBtn = h('button', { class: 'btn ghost sm on', type: 'button' }, '오늘');
  const monthBtn = h('button', { class: 'btn ghost sm', type: 'button' }, '이번 달');
  dayBtn.addEventListener('click', () => { dayBtn.classList.add('on'); monthBtn.classList.remove('on'); loadLeaderboard(boardBox, 'day'); });
  monthBtn.addEventListener('click', () => { monthBtn.classList.add('on'); dayBtn.classList.remove('on'); loadLeaderboard(boardBox, 'month'); });

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '후원 순위'), h('div', { class: 'btn-row' }, dayBtn, monthBtn)),
    boardBox));

  loadLeaderboard(boardBox, 'day');
}
