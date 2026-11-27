/* 도매마켓: 로그인 전 소개(서비스 가치·블라인드 원칙·가입 절차) + 가입·로그인 대화상자 */
import { h, api, field, openDialog, busy, errMsg, icon } from '../core.js';
import { brandMark, pic } from './kit.js';

function errorBox() {
  const box = h('div', { class: 'form-err', role: 'alert', hidden: true });
  box.show = (msg) => { box.textContent = msg; box.hidden = false; };
  box.clear = () => { box.hidden = true; };
  return box;
}

export function openWsSignup({ onDone } = {}) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'biz@example.com' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
  const name = h('input', { class: 'input', type: 'text', maxLength: 40, autocomplete: 'name', placeholder: '담당자 이름' });
  const phone = h('input', { class: 'input', type: 'tel', maxLength: 30, autocomplete: 'tel', placeholder: '010-0000-0000' });
  const agree = h('input', { type: 'checkbox' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '가입하고 인증 시작');
  const form = h('form', { novalidate: true },
    err,
    field('이메일', email),
    field('비밀번호', pw, '8자 이상'),
    field('담당자 이름', name),
    field('연락처', phone),
    h('label', { class: 'radio', style: 'margin-bottom:14px' }, agree, h('span', null, '사업자 인증 전까지는 수요·연결 기능을 쓸 수 없다는 점에 동의합니다.')),
    submit,
    h('p', { style: 'margin-top:12px;font-size:.9375rem' }, '이미 계정이 있으세요? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => { dlg.close(); openWsLogin({ onDone }); } }, '로그인')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (!email.value.trim() || pw.value.length < 8) { err.show('이메일과 비밀번호(8자 이상)를 입력해 주세요.'); return; }
    if (!name.value.trim()) { err.show('담당자 이름을 입력해 주세요.'); return; }
    if (!agree.checked) { err.show('약관에 동의해야 가입할 수 있습니다.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/ws/auth/signup', { method: 'POST', body: { email: email.value, password: pw.value, contact_name: name.value, phone: phone.value, agree_terms: true } });
      } catch (e) { err.show(errMsg(e)); return; }
      dlg.close();
      if (onDone) await onDone();
    });
  });
  const dlg = openDialog({ title: '도매마켓 판매자 가입', content: form });
  email.focus();
  return dlg;
}

export function openWsLogin({ onDone } = {}) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '로그인');
  const form = h('form', { novalidate: true },
    err, field('이메일', email), field('비밀번호', pw), submit,
    h('p', { style: 'margin-top:14px;font-size:.9375rem' }, '처음이세요? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => { dlg.close(); openWsSignup({ onDone }); } }, '가입하기')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (!email.value.trim() || !pw.value) { err.show('이메일과 비밀번호를 입력해 주세요.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/ws/auth/login', { method: 'POST', body: { email: email.value, password: pw.value } });
      } catch (e) { err.show(errMsg(e)); return; }
      dlg.close();
      if (onDone) await onDone();
    });
  });
  const dlg = openDialog({ title: '도매마켓 로그인', content: form });
  email.focus();
  return dlg;
}

/* 식당 사장님 로그인 — 원가다이어리 계정(이메일·비밀번호)을 그대로 쓴다. */
export function openOwnerLogin({ onDone } = {}) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '사장님으로 로그인');
  const form = h('form', { novalidate: true },
    h('p', { class: 'small', style: 'margin-bottom:12px' }, '원가다이어리 계정으로 로그인하면, 내 식자재에 들어온 단가 제안과 우리 동네 떨이를 볼 수 있어요.'),
    err, field('원가다이어리 이메일', email), field('비밀번호', pw), submit,
    h('p', { class: 'small muted', style: 'margin-top:12px' }, '카카오·네이버·구글로 가입하셨다면 원가다이어리에 로그인한 뒤 ',
      h('b', null, '설정 > 도매마켓 연결'), '에서 들어오세요.'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (!email.value.trim() || !pw.value) { err.show('이메일과 비밀번호를 입력해 주세요.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: pw.value } });
      } catch (e) { err.show(errMsg(e)); return; }
      dlg.close();
      if (onDone) await onDone();
    });
  });
  const dlg = openDialog({ title: '식당 사장님 로그인', content: form });
  email.focus();
  return dlg;
}

const FAQ = [
  ['식당이 지금 얼마에 사고 있는지 볼 수 있나요?', '아니요. 현재 거래가는 어떤 화면에서도 공개하지 않습니다. 보이는 것은 품목·원산지·등급·권역·월 구매량 구간·구매처 수 구간뿐입니다. 그래서 “얼마보다 조금만 싸게”가 아니라, 내가 실제로 공급할 수 있는 가격을 제안하게 됩니다.'],
  ['내 제안가를 다른 도매업체가 볼 수 있나요?', '볼 수 없습니다. 제안은 조건이 맞는 식당 사장님 화면에만 조용히 전달되고, 다른 판매자에게는 내 제안의 존재조차 보이지 않습니다.'],
  ['내 제안이 누구에게 보였는지 알 수 있나요?', '알려 드리지 않습니다. 사장님이 먼저 “연결 요청”을 보냈을 때에만 서로의 연락처가 열립니다. 요청이 오면 72시간 안에 수락하거나 거절하면 됩니다.'],
  ['비용이 드나요?', '가입, 수요 열람, 제안 등록에는 요금이 없습니다. 남는 재고를 빠르게 알리는 “떨이 광고”만 하루 단위 요금으로 선택해서 쓸 수 있습니다. 식당과의 거래 대금은 도매마켓을 거치지 않고 직접 주고받습니다.'],
  ['가격은 언제든 바꿀 수 있나요?', '가격은 7일에 한 번만 바꿀 수 있고, 제안을 철회하면 같은 조건으로는 7일 동안 다시 제안할 수 없습니다. 가격을 조금씩 바꿔 가며 상대 단가를 떠보는 일을 막기 위한 규칙입니다.'],
  ['누구나 가입할 수 있나요?', '사업자등록증으로 인증한 식자재 도매·유통 사업자만 수요를 보고 제안할 수 있습니다. 등록증 사진을 올리면 국세청 진위확인을 거쳐 보통 바로 승인됩니다.'],
];

function sampleCard() {
  const row = (name, spec, meta) => h('li', null,
    h('div', null, h('b', null, name), h('span', { class: 'xs muted' }, ` · ${spec}`), h('div', { class: 'row-sub' }, meta)),
    h('span', { class: 'dm-mask' }, h('span', { 'aria-hidden': 'true' }, '●●●●●'), h('span', { class: 'sr' }, '현재 거래가 비공개')));
  return h('figure', { class: 'sheet dm-sample' },
    h('figcaption', null, h('span', { class: 'tag est' }, '예시 화면'), ' 판매자에게 보이는 수요'),
    h('ul', { class: 'dm-sample-rows' },
      row('양파', '국산 · 상', '경기 남부 · 월 300~500kg · 구매처 5~9곳'),
      row('삼겹살', '국산 · 1등급', '서울 강남권 · 월 100~300kg · 구매처 3~4곳'),
      row('대파', '국산 · 상', '인천·부천권 · 월 50~100kg · 구매처 10곳 이상')),
    h('p', { class: 'dm-sample-foot' }, h('span', { 'aria-hidden': 'true' }, '●●●●● '), '현재 거래가는 판매자에게도, 저희 화면에도 표시되지 않습니다.'));
}

export function renderIntro(root, onAuth) {
  const start = () => openWsSignup({ onDone: onAuth });
  const login = () => openWsLogin({ onDone: onAuth });
  const ownerLogin = () => openOwnerLogin({ onDone: onAuth });
  const step = (no, title, text) => h('div', { class: 'step' }, h('div', { class: 'step-no', 'aria-hidden': 'true' }, no), h('h3', null, title), h('p', null, text));
  const why = (ic, title, text) => h('div', { class: 'dm-why-card' }, h('span', { class: 'dm-why-ic' }, ic), h('h3', null, title), h('p', null, text));
  root.replaceChildren(h('div', { class: 'land dm-land' },
    h('header', { class: 'land-top' },
      brandMark('', { href: null, sub: true }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', type: 'button', onclick: ownerLogin }, '식당 사장님'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: login }, '로그인'),
        h('button', { class: 'btn sm dm-top-cta', type: 'button', onclick: start }, '무료 가입'))),
    h('main', { id: 'main' },
      h('section', { class: 'hero', 'aria-labelledby': 'hero-t' },
        h('div', { class: 'hero-in' },
          h('div', null,
            h('p', { class: 'dm-kicker' }, '식자재 도매업체 전용 · 블라인드 단가 제안'),
            h('h1', { id: 'hero-t' }, '식당이 실제로 사는 품목에, ', h('em', null, '가격 눈치싸움 없이'), ' 제안하세요'),
            h('p', { class: 'hero-lead' }, '도매마켓은 식당 사장님들의 실제 구매 기록에서 나온 익명 수요를 보여 드립니다. 품목·원산지·등급·권역·월 구매량을 보고 공급할 수 있는 단가를 제안하면, 조건이 맞는 사장님이 먼저 연결을 요청합니다.'),
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn', type: 'button', onclick: start }, '도매업체로 가입하기'),
              h('button', { class: 'btn ghost', type: 'button', onclick: login }, '이미 계정이 있어요')),
            h('p', { class: 'hero-note' }, '가입·수요 열람·제안 등록은 무료입니다. 사업자 인증을 마친 판매자만 이용할 수 있습니다.'),
            h('p', { class: 'hero-note' }, '식당 사장님이세요? ',
              h('button', { class: 'link-btn', type: 'button', onclick: ownerLogin }, '원가다이어리 계정으로 로그인'),
              '하면 내게 온 단가 제안을 볼 수 있어요.')),
          sampleCard())),

      h('section', { class: 'sec', 'aria-labelledby': 'how-t' },
        h('h2', { id: 'how-t' }, '세 단계로 새 거래처를 만납니다'),
        h('p', { class: 'lead' }, '영업 전화도, 전단지도 필요 없습니다. 살 사람이 있는 품목에만 제안하면 됩니다.'),
        h('div', { class: 'steps' },
          step('1', '익명 수요 보기', '내 배송 권역에서 어떤 품목이 한 달에 얼마나 팔리는지 구간으로 확인합니다. 여러 식당의 수요가 모였을 때만 공개됩니다.'),
          step('2', '블라인드로 제안', '규격과 가격, 최소 주문만 넣으면 끝입니다. 내 제안가는 다른 판매자에게 보이지 않고, 식당의 현재 거래가도 보이지 않습니다.'),
          step('3', '연결 요청 받기', '제안이 마음에 든 사장님이 연결을 요청하면 72시간 안에 수락하세요. 수락하면 연락처가 열리고, 거래는 두 분이 직접 합니다.'))),

      h('section', { class: 'sec', 'aria-labelledby': 'why-t' },
        h('h2', { id: 'why-t' }, '블라인드라서 판매자에게 유리합니다'),
        h('p', { class: 'lead' }, '가격이 전부 공개되는 비교 사이트에서는 결국 서로 깎기만 합니다. 도매마켓은 그 반대로 설계했습니다.'),
        h('div', { class: 'dm-why' },
          why(pic('eyeoff', 24), '내 단가가 새지 않습니다', '제안가는 조건이 맞는 식당에만 전달됩니다. 경쟁 업체가 내 가격표를 들여다보고 10원 낮추는 일이 없습니다.'),
          why(pic('shield', 24), '깎기 경쟁이 없습니다', '상대의 현재 거래가도, 다른 제안가도 보이지 않습니다. 원가와 물류를 따져 지킬 수 있는 가격만 내면 됩니다.'),
          why(icon('box', 24), '실수요에만 제안합니다', '수요는 식당의 실제 구매 명세서에서 집계됩니다. 살 생각이 없는 견적 요청에 시간을 쓰지 않습니다.'),
          why(pic('tag', 24), '남는 재고는 떨이 광고로', '물량이 남거나 유통기한이 임박하면 가격을 공개하는 떨이 광고로 내 권역 식당에 바로 알릴 수 있습니다.'))),

      h('section', { class: 'sec', 'aria-labelledby': 'see-t' },
        h('h2', { id: 'see-t' }, '보이는 것과 보이지 않는 것'),
        h('div', { class: 'scope' },
          h('div', null, h('h3', null, '판매자에게 보이는 것'),
            h('ul', null,
              h('li', null, '품목 · 원산지 · 등급'),
              h('li', null, '배송 권역 (시·군보다 넓은 단위)'),
              h('li', null, '월 구매량 구간과 구매처 수 구간'),
              h('li', null, '연결을 요청한 사장님의 연락처 (요청이 왔을 때만)'))),
          h('div', { class: 'no' }, h('h3', null, '누구에게도 보이지 않는 것'),
            h('ul', null,
              h('li', null, '식당의 현재 거래 단가와 거래처'),
              h('li', null, '연결 전 식당의 이름과 위치'),
              h('li', null, '다른 판매자의 제안가'),
              h('li', null, '내 제안이 누구에게 전달됐는지'))))),

      h('section', { class: 'sec', 'aria-labelledby': 'join-t' },
        h('h2', { id: 'join-t' }, '가입은 1분, 승인은 보통 즉시'),
        h('div', { class: 'price-box' },
          h('div', null,
            h('div', { class: 'price-big' }, h('span', { class: 'n' }, '0'), h('span', { class: 'u' }, '원 · 가입과 제안')),
            h('p', { class: 'small muted', style: 'margin-top:8px' }, '유료는 선택해서 쓰는 떨이 광고(하루 단위)뿐입니다.'),
            h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'button', onclick: start }, '지금 가입하기'))),
          h('ol', { class: 'dm-join' },
            h('li', null, '이메일·비밀번호로 가입'),
            h('li', null, '사업자등록증 사진을 올리고 4개 항목을 확인'),
            h('li', null, '국세청 진위확인을 거쳐 즉시 승인 또는 보완 안내'),
            h('li', null, '배송 권역을 고르고 수요를 보며 제안 시작')))),

      h('section', { class: 'sec faq', 'aria-labelledby': 'faq-t' },
        h('h2', { id: 'faq-t' }, '자주 묻는 질문'),
        FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a))))),
    h('footer', { class: 'foot' },
      h('span', null, '도매마켓 — 식자재 판매자 센터'),
      h('span', null, '식당 사장님이신가요? ', h('button', { class: 'link-btn', type: 'button', onclick: ownerLogin }, '사장님 로그인')))));
}
