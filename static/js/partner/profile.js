/* #/profile: 담당자 연락처·소개·배송 가능 권역 */
import { h, api, app, field, busy, toast, errMsg, bus } from '../core.js';
import { REGIONS, pic } from './kit.js';


export async function render(box) {
  const ws = app.me;
  box.append(h('div', { class: 'page-h' }, h('h1', null, '내 정보')));
  const wasEmpty = !ws.regions.length;

  const name = h('input', { class: 'input', type: 'text', maxLength: 40, value: ws.contact_name || '' });
  const phone = h('input', { class: 'input', type: 'tel', maxLength: 30, value: ws.phone || '' });
  const intro = h('textarea', { class: 'textarea', maxLength: 200, value: ws.intro || '' });
  const checks = REGIONS.map(([code, label]) => {
    const c = h('input', { type: 'checkbox', value: code, checked: ws.regions.includes(code) });
    return h('label', { class: 'radio' }, c, h('span', null, label));
  });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const save = h('button', { class: 'btn', type: 'submit' }, '저장');
  const form = h('form', { novalidate: true },
    err,
    h('dl', { class: 'kv' },
      h('dt', null, '이메일'), h('dd', null, ws.email),
      h('dt', null, '상호'), h('dd', null, ws.biz_name || '(인증 전)'),
      h('dt', null, '사업자번호'), h('dd', null, ws.biz_no_masked || '(인증 전)')),
    field('담당자 이름', name),
    field('연락처', phone),
    field('소개 (선택)', intro, '수요 목록에는 보이지 않고, 사장님이 연결을 수락한 뒤에만 보입니다.'),
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, '배송 가능 권역 (1개 이상)'), h('div', { class: 'radios' }, checks)),
    save);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const regions = checks.filter((l) => l.firstChild.checked).map((l) => l.firstChild.value);
    if (!regions.length) { err.textContent = '배송 가능 권역을 1개 이상 선택해 주세요.'; err.hidden = false; return; }
    await busy(save, async () => {
      try {
        app.me = await api('/api/ws/profile', { method: 'PUT', body: { contact_name: name.value.trim(), phone: phone.value.trim(), intro: intro.value.trim(), regions } });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      toast('저장했습니다.');
      bus.dispatchEvent(new Event('me-changed'));
      if (wasEmpty && verified) toast('이제 고른 권역의 수요가 보입니다.');
    });
  });

  const verified = ws.status === 'verified';
  box.append(
    verified ? null : h('div', { class: 'banner warn', role: 'status' }, h('div', null, h('b', null, '사업자 인증이 필요합니다. '), '인증을 마치면 수요 보기·제안·떨이 광고가 열립니다. ', h('a', { href: '#/verify' }, '인증하러 가기'))),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '판매자 정보'), h('span', { class: 'sub' }, '연락처와 소개는 연결을 수락한 사장님에게만 보입니다')),
      form),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '더 보기')),
      h('ul', { class: 'rows dm-links' },
        verified ? h('li', null, h('a', { class: 'row', href: '#/billing' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, '결제 내역'), h('span', { class: 'row-sub', style: 'display:block' }, '떨이 광고비 결제·입금 확인 상태')), pic('arrow', 18))) : null,
        h('li', null, h('a', { class: 'row', href: '#/guide' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, '이용 안내'), h('span', { class: 'row-sub', style: 'display:block' }, '블라인드 제안 규칙, 연결 요청, 자주 묻는 질문')), pic('arrow', 18))))),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '계정')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: async (ev) => busy(ev.currentTarget, async () => {
          await api('/api/ws/auth/logout', { method: 'POST' });
          bus.dispatchEvent(new Event('ws-logged-out'));
        }) }, '로그아웃'))));
}
