/* 개선사항 요청: "이런 기능이 있으면 좋겠다", "여기가 불편하다"를 운영자에게 보내는 양식.
   예전 '도입 문의'를 대신한다. 랜딩(로그인 전)과 앱의 #/feedback(로그인 후)이 같은 양식을 쓴다.
   보낸 내용은 운영자 화면(#/admin/feedback)에서만 보인다. 로그인했으면 서버가 계정을 함께 붙인다. */
import { h, api, field, busy, errMsg, selectOf, app } from './core.js';

export const CATEGORIES = [
  ['idea', '이런 기능이 있으면 좋겠어요'],
  ['inconvenience', '쓰기 불편한 점이 있어요'],
  ['bug', '오류가 있어요'],
  ['other', '기타'],
];

/* opts.btnClass: 랜딩은 'lp-btn is-primary', 앱은 'btn'. opts.page: 어느 화면에서 보냈는지(운영자 참고용). */
export function feedbackForm({ btnClass = 'btn', formClass = '', page = '' } = {}) {
  const loggedIn = Boolean(app.me);
  const cat = selectOf(CATEGORIES, 'idea', { name: 'category' });
  const msg = h('textarea', { class: 'textarea', name: 'message', maxLength: 2000, rows: 5,
    placeholder: '예: 메뉴 원가를 엑셀로도 뽑고 싶어요 / 명세서 사진을 올리면 날짜가 틀리게 들어가요' });
  const contact = h('input', { class: 'input', type: 'text', name: 'contact', maxLength: 120, autocomplete: 'off', spellcheck: false,
    placeholder: loggedIn ? '비워 두면 가입한 이메일로 연락드려요' : '예: 010-1234-5678 또는 me@example.com' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const btn = h('button', { class: btnClass, type: 'submit' }, '요청 보내기');
  const form = h('form', { class: formClass, novalidate: true }, err,
    field('어떤 요청인가요?', cat),
    field('내용', msg),
    field('연락처 (선택)', contact, loggedIn ? null : '답변을 받고 싶으시면 남겨 주세요. 없어도 보낼 수 있어요.'),
    btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (msg.value.trim().length < 5) { err.textContent = '내용을 5자 이상 적어 주세요.'; err.hidden = false; msg.focus(); return; }
    await busy(btn, async () => {
      try {
        await api('/api/feedback', { method: 'POST', body: { category: cat.value, message: msg.value, contact: contact.value, page } });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      form.replaceChildren(h('p', { role: 'status', class: 'fb-done' },
        '요청을 잘 받았어요. 하나씩 읽어 보고 반영할게요. 고맙습니다!'));
    });
  });
  return form;
}

/* 앱 안의 #/feedback 화면 */
export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '개선사항 요청')));
  box.append(h('section', { class: 'sheet' },
    h('p', { class: 'hint', style: 'margin:0 0 14px' },
      '있었으면 하는 기능, 쓰다가 불편했던 점, 이상하게 보이는 화면을 알려 주세요. 보내 주신 내용은 운영자가 직접 읽고 다음 업데이트에 반영해요.'),
    feedbackForm({ btnClass: 'btn', page: 'app' })));
}
