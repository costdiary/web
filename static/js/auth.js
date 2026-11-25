/* 가입·로그인 대화상자 */
import { h, api, app, field, openDialog, busy, errMsg, toast } from './core.js';
import { openDataNotice, openTerms } from './legal.js';
import { identityBox } from './identity.js';

const SOCIAL_LABEL = { kakao: '카카오로 계속하기', naver: '네이버로 계속하기', google: '구글로 계속하기' };

function errorBox() {
  const box = h('div', { class: 'form-err', role: 'alert', hidden: true });
  box.show = (msg) => { box.textContent = msg; box.hidden = false; };
  box.clear = () => { box.hidden = true; };
  return box;
}

/* 키를 넣어 둔 제공자만 버튼으로 보여준다(app.pub.oauth_providers, /api/public). 눌러도 fetch가
   아니라 그냥 그 주소로 이동한다 — 서버가 카카오·네이버·구글 로그인 화면으로 다시 보낸다. */
function socialButtons() {
  const provs = app.pub?.oauth_providers || {};
  const on = Object.keys(SOCIAL_LABEL).filter((p) => provs[p]);
  if (!on.length) return null;
  return h('div', { class: 'social-row' },
    on.map((p) => h('a', { class: `btn block ghost social-${p}`, href: `/api/auth/oauth/${p}` }, SOCIAL_LABEL[p])),
    h('p', { class: 'hint', style: 'text-align:center;margin:12px 0' }, '또는 이메일로'));
}

export function openForgotPassword() {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', required: true });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '재설정 링크 받기');
  const done = h('p', { class: 'hint', hidden: true }, '입력하신 이메일로 재설정 안내를 보냈어요. 안 보이면 스팸함도 한 번 확인해 주세요.');
  const form = h('form', { novalidate: true }, err, field('가입한 이메일', email), submit, done);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (!email.value.trim()) { err.show('이메일을 입력해 주세요.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/auth/password/forgot', { method: 'POST', body: { email: email.value } });
      } catch (e) { err.show(errMsg(e)); return; }
      email.closest('.field').hidden = true;
      submit.hidden = true;
      done.hidden = false;
    });
  });
  return openDialog({ title: '비밀번호 찾기', content: form });
}

export function openResetPassword(token) {
  const err = errorBox();
  const pw = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '비밀번호 바꾸기');
  const form = h('form', { novalidate: true }, err, field('새 비밀번호', pw, '8자 이상. 영문·숫자·기호를 섞으면 더 안전합니다.'), submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (pw.value.length < 8) { err.show('비밀번호는 8자 이상으로 정해 주세요.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/auth/password/reset', { method: 'POST', body: { token, new_password: pw.value } });
      } catch (e) { err.show(errMsg(e)); return; }
      dlg.close();
      toast('비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.');
      openLogin({});
    });
  });
  const dlg = openDialog({ title: '새 비밀번호 설정', content: form });
  return dlg;
}

/* verified: 모바일에서 본인인증 창이 페이지를 이동시켰다 돌아온 경우, 이미 끝난 인증 결과(identity.js).
   prefill: 그때 적어 두었던 이메일·가게 이름(비밀번호는 저장하지 않으므로 다시 입력). */
export function openSignup({ onDone, verified = null, prefill = {} } = {}) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'owner@example.com', value: prefill.email || '' });
  const pw = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
  const store = h('input', { class: 'input', type: 'text', name: 'store', autocomplete: 'organization', maxLength: 60, placeholder: '예: 한우리식당', value: prefill.store || '' });
  // 본인인증을 켠 운영(app.pub.identity_enabled)에서는 가입 전에 휴대폰 인증을 먼저 받는다.
  let ivResult = verified;
  const ivField = app.pub?.identity_enabled
    ? h('div', { class: 'field' }, h('label', null, '본인인증'), identityBox({
      purpose: 'signup', initial: verified,
      context: () => ({ email: email.value, store: store.value }),
      onVerified: (r) => { ivResult = r; err.clear(); },
      onError: (m) => err.show(m),
    }))
    : null;
  const code = app.pub?.signup_code_required
    ? h('input', { class: 'input', type: 'text', name: 'code', autocomplete: 'off', required: true })
    : null;
  const submit = h('button', { class: 'btn block', type: 'submit' }, '가입하고 무료로 시작');
  const form = h('form', { novalidate: true },
    err,
    ivField,
    field('이메일', email),
    field('비밀번호', pw, '8자 이상. 영문·숫자·기호를 섞으면 더 안전합니다.'),
    field('가게 이름 (선택)', store),
    code ? field('가입 코드', code, '안내받은 초대 코드를 입력해 주세요.') : null,
    submit,
    h('p', { class: 'hint', style: 'margin-top:12px' }, '카드 등록은 필요 없습니다. 가입하면 ', h('button', { class: 'link-btn small', type: 'button', onclick: openDataNotice }, '개인정보처리방침'), '과 ', h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관'), '에 동의한 것으로 봅니다.'),
    h('p', { style: 'margin-top:12px;font-size:.9375rem' }, '이미 계정이 있으세요? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => { dlg.close(); openLogin({ onDone }); } }, '로그인')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.clear();
    if (!email.value.trim() || pw.value.length < 8) {
      err.show(!email.value.trim() ? '이메일을 입력해 주세요.' : '비밀번호는 8자 이상으로 정해 주세요.');
      return;
    }
    if (ivField && !ivResult) { err.show('휴대폰 본인인증을 먼저 해 주세요.'); return; }
    await busy(submit, async () => {
      try {
        await api('/api/auth/signup', { method: 'POST', body: { email: email.value, password: pw.value, store_name: store.value, code: code ? code.value : '', identity_verification_id: ivResult ? ivResult.verification_id : '' } });
      } catch (e) { err.show(errMsg(e)); return; }
      dlg.close();
      if (onDone) await onDone();
    });
  });
  const dlg = openDialog({ title: '무료로 시작', content: h('div', null, socialButtons(), form) });
  (verified ? pw : email).focus();
  return dlg;
}

export function openLogin({ onDone } = {}) {
  const err = errorBox();
  const email = h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', required: true });
  const pw = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn block', type: 'submit' }, '로그인');
  const form = h('form', { novalidate: true },
    err,
    field('이메일', email),
    field('비밀번호', pw),
    submit,
    h('p', { style: 'margin-top:10px;font-size:.9375rem' },
      h('button', { class: 'link-btn small', type: 'button', onclick: () => { dlg.close(); openForgotPassword(); } }, '비밀번호를 잊으셨나요?')),
    h('p', { style: 'margin-top:10px;font-size:.9375rem' }, '처음이세요? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => { dlg.close(); openSignup({ onDone }); } }, '무료로 시작')));
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
  const dlg = openDialog({ title: '로그인', content: h('div', null, socialButtons(), form) });
  email.focus();
  return dlg;
}
