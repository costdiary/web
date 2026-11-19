/* 후원하기 — 결제사가 아직 정해지지 않아 지금은 화면/DB 흐름만 완성해 둔 상태입니다.
   실제로는 payments.py의 MockProvider로 동작해서(외부로 나가는 요청 없음), 버튼을 누르면
   테스트로 바로 승인됩니다. 나중에 PG 계약이 끝나면 서버 쪽(payments.get_provider())만
   바꾸면 되고, 이 화면은 그대로 쓸 수 있습니다. */
import { h, api, app, icon, busy, toast, errMsg, refreshRoute, n0 } from './core.js';
import { num, emptyBlock } from './ui.js';

const PRESETS = [3000, 5000, 10000, 30000];

function amountPicker(initial) {
  let value = initial;
  const btns = PRESETS.map((v) => {
    const b = h('button', { class: 'btn ghost sm', type: 'button' }, `${n0(v)}원`);
    return b;
  });
  const custom = h('input', { class: 'input num', type: 'text', inputmode: 'numeric', placeholder: '직접 입력', 'aria-label': '후원 금액 직접 입력' });
  const mark = () => {
    btns.forEach((b, i) => b.classList.toggle('on', PRESETS[i] === value && !custom.value));
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

function rankRow(rank, item, showAmount) {
  return h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, h('span', { class: 'xs muted' }, `${rank}. `), item.nickname),
      item.count > 1 ? h('div', { class: 'row-sub' }, `${item.count}번 후원`) : null),
    showAmount ? h('div', { class: 'row-end' }, num(n0(item.amount), '원')) : null));
}

async function loadLeaderboard(box, period) {
  box.replaceChildren(h('div', { class: 'skel' }));
  let res;
  try { res = await api(`/api/donations/leaderboard?period=${period}`); } catch (e) { toast(errMsg(e), 'err'); return; }
  if (!res.items.length) {
    box.replaceChildren(emptyBlock({ title: '아직 순위가 없습니다', text: period === 'day' ? '오늘의 첫 후원을 기다리고 있습니다.' : '이번 달의 첫 후원을 기다리고 있습니다.' }));
    return;
  }
  box.replaceChildren(h('ul', { class: 'rows' }, res.items.map((it, i) => rankRow(i + 1, it, res.amount_public))));
}

export async function render(box) {
  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '후원하기')),
    h('section', { class: 'sheet' },
      h('p', null, '원가다이어리는 ', h('b', null, '지금 쓰는 기능 전부 계속 무료'), '입니다. 후원 여부로 기능이 달라지는 건 전혀 없고, 다만 OCR 같은 여러 유료 API 비용과 홈페이지 서버 유지관리 비용에 보태 쓰려고 합니다.'),
      h('p', null, '일정 금액 이상 후원해 주시는 분들 중 ', h('b', null, '이번 달 후원 1위'), '에게는 무료 컨설팅을 드립니다.'),
      h('p', { class: 'hint' }, '결제사를 아직 정하지 않아, 지금 누르는 후원은 실제 결제 없이 테스트로 처리됩니다.')));

  const nickname = h('input', { class: 'input', type: 'text', maxLength: 30, placeholder: '닉네임', value: app.me.store_name || '' });
  const amt = amountPicker(PRESETS[1]);
  const message = h('input', { class: 'input', type: 'text', maxLength: 200, placeholder: '응원 메시지(선택)' });
  const submit = h('button', { class: 'btn primary', type: 'button' }, icon('heart', 18), '후원하기');

  submit.addEventListener('click', () => busy(submit, async () => {
    const amount = amt.getValue();
    const name = nickname.value.trim();
    if (!name) { toast('닉네임을 입력해 주세요.', 'err'); return; }
    if (!amount || amount < 1000) { toast('1,000원 이상으로 입력해 주세요.', 'err'); return; }
    let created;
    try {
      created = await api('/api/donations', { method: 'POST', body: { nickname: name, amount, message: message.value.trim() } });
    } catch (e) { toast(errMsg(e), 'err'); return; }
    try {
      // 실제 결제 연동 전까지는, 결제위젯이 돌려줄 paymentKey 자리에 테스트 값을 넣어 바로 승인한다.
      await api('/api/donations/confirm', { method: 'POST', body: { order_id: created.order_id, payment_key: `test-${created.order_id}` } });
    } catch (e) { toast(errMsg(e), 'err'); return; }
    toast('후원해 주셔서 감사합니다!');
    message.value = '';
    refreshRoute();
  }));

  box.append(h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '후원하기')),
    h('div', { class: 'field' }, h('label', null, '닉네임'), nickname),
    h('div', { class: 'field' }, h('label', null, '금액'), amt),
    h('div', { class: 'field' }, h('label', null, '메시지'), message),
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
