/* 휴대폰 본인인증 — 서버 쪽 흐름은 app/identity.py 맨 위 설명 참고.

   포트원 키가 없으면(app.pub.identity_real === false) 이름·휴대폰·생년월일을 직접 적는 "테스트 인증"
   창을 띄우고, 키가 있으면 포트원 브라우저 SDK(cdn.portone.io/v2/browser-sdk.js)의
   PortOne.requestIdentityVerification()으로 실제 휴대폰 인증 창을 띄운다. 모바일에서는 인증 창이
   페이지를 통째로 이동시켰다가 redirectUrl(/?iv_return=1)로 돌아오므로, 하던 일을 sessionStorage에
   적어 두고 돌아온 뒤 consumeIdentityReturn()이 마무리한다.
   SDK 주소·파라미터 이름은 2026-11 포트원 공개 문서 기준이며 실제 키로는 아직 띄워 보지 못했다. */
import { h, api, app, field, openDialog, busy, errMsg, icon } from './core.js';

const PENDING_KEY = 'wongae_iv_pending';
const SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js';

let sdkPromise = null;
function loadPortOne() {
  if (window.PortOne) return Promise.resolve(window.PortOne);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = () => (window.PortOne ? resolve(window.PortOne) : reject(new Error('본인인증 모듈을 불러오지 못했습니다.')));
      s.onerror = () => { sdkPromise = null; reject(new Error('본인인증 모듈을 불러오지 못했습니다.')); };
      document.head.append(s);
    });
  }
  return sdkPromise;
}

/* 키가 없을 때의 테스트 인증 창. 실제 서비스에서는 이 창 대신 통신사 휴대폰 인증 창이 뜬다. */
function mockDialog(verificationId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const name = h('input', { class: 'input', type: 'text', maxLength: 30, autocomplete: 'name', placeholder: '홍길동' });
    const phone = h('input', { class: 'input', type: 'tel', inputmode: 'numeric', maxLength: 13, autocomplete: 'tel', placeholder: '01012345678' });
    const birth = h('input', { class: 'input', type: 'date', min: '1900-01-01', max: new Date().toISOString().slice(0, 10) });
    const submit = h('button', { class: 'btn block', type: 'submit' }, '인증하기');
    const form = h('form', { novalidate: true },
      h('p', { class: 'hint iv-test-note' }, '아직 본인인증 업체와 연결 전이라 테스트로 처리됩니다. 실제 서비스에서는 이 자리에 통신사 휴대폰 인증 창이 뜹니다.'),
      err, field('이름', name), field('휴대폰 번호', phone), field('생년월일', birth), submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      await busy(submit, async () => {
        try {
          const res = await api('/api/identity/complete', { method: 'POST', body: { verification_id: verificationId, mock: { name: name.value, phone: phone.value, birth_date: birth.value } } });
          settled = true;
          dlg.close();
          resolve({ verification_id: verificationId, ...res });
        } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
      });
    });
    const dlg = openDialog({ title: '휴대폰 본인인증', content: form, onClose: () => { if (!settled) reject(new Error('본인인증을 취소했습니다.')); } });
    name.focus();
  });
}

/* 본인인증을 한 번 진행하고 { verification_id, name, phone }을 돌려준다. 취소·실패면 Error를 던진다.
   context는 모바일 리다이렉트로 페이지가 새로 열렸을 때 하던 일을 되살리는 데 쓴다. */
export async function verifyIdentity(purpose, context = {}) {
  const started = await api('/api/identity/start', { method: 'POST', body: { purpose } });
  if (started.provider !== 'portone') return mockDialog(started.verification_id);

  const PortOne = await loadPortOne();
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ purpose, verification_id: started.verification_id, context })); } catch { /* 사생활 보호 모드 등 */ }
  const res = await PortOne.requestIdentityVerification({
    storeId: started.store_id,
    identityVerificationId: started.verification_id,
    channelKey: started.channel_key,
    redirectUrl: `${location.origin}/?iv_return=1`,
  });
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* 무시 */ }
  if (!res || res.code !== undefined) throw new Error(res?.message || '본인인증을 마치지 못했습니다.');
  const done = await api('/api/identity/complete', { method: 'POST', body: { verification_id: started.verification_id } });
  return { verification_id: started.verification_id, ...done };
}

/* 모바일에서 인증 창이 /?iv_return=1&identityVerificationId=...(&code=...)로 돌려보냈을 때 부른다.
   돌아온 경우가 아니면 null, 맞으면 { purpose, context, result?, error? }. */
export async function consumeIdentityReturn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('iv_return')) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); sessionStorage.removeItem(PENDING_KEY); } catch { /* 무시 */ }
  const vid = params.get('identityVerificationId') || pending?.verification_id;
  if (!pending || !vid) return null;
  if (params.get('code')) return { ...pending, error: params.get('message') || '본인인증을 마치지 못했습니다.' };
  try {
    const done = await api('/api/identity/complete', { method: 'POST', body: { verification_id: vid } });
    return { ...pending, result: { verification_id: vid, ...done } };
  } catch (e) { return { ...pending, error: errMsg(e) }; }
}

/* 인증 상태 한 줄(가입 화면·설정·후원 화면 공용). */
export function verifiedBadge(name, phone) {
  return h('div', { class: 'iv-ok' }, icon('check', 18), h('span', null, h('b', null, `${name}님`), phone ? ` · ${phone}` : '', ' 본인인증 완료'));
}

/* api()의 오류(ApiError)는 서버 문구를, 그 밖의 Error(취소 등)는 그 메시지를 보여준다. */
export function ivErrMsg(e) {
  return e && e.detail ? errMsg(e) : (e?.message || errMsg(e));
}

/* 화면에 넣는 인증 칸: 버튼을 누르면 인증하고, 끝나면 완료 표시로 바뀐다. onVerified(result) 호출. */
export function identityBox({ purpose, context, initial, onVerified, onError }) {
  const box = h('div', { class: 'iv-box' });
  const showDone = (r) => box.replaceChildren(verifiedBadge(r.name, r.phone));
  if (initial) { showDone(initial); return box; }
  const btn = h('button', { class: 'btn ghost block', type: 'button' }, icon('check', 18), '휴대폰 본인인증');
  btn.addEventListener('click', () => busy(btn, async () => {
    try {
      const r = await verifyIdentity(purpose, typeof context === 'function' ? context() : context);
      showDone(r);
      if (onVerified) await onVerified(r);
    } catch (e) { if (onError) onError(ivErrMsg(e)); }
  }));
  box.append(btn, h('p', { class: 'hint' }, '한 분당 계정 하나만 만들 수 있어요. 인증한 이름·번호는 중복 가입 방지와 후원 확인에만 쓰고, 다른 사장님께는 보이지 않아요.'));
  return box;
}
