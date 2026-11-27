/* 설정: 계산 기준, 이용 현황, 내려받기, 로그아웃·계정 삭제 */
import { h, api, app, bus, field, numInput, parseNum, n1, n3, ymd, openDialog, busy, toast, errMsg, refreshMe, icon, fill } from './core.js';
import { num } from './ui.js';
import { openDataNotice, openTerms } from './legal.js';
import { openCookieSettings } from './analytics.js';
import { MARKET_ENABLED } from './core.js';
import { prefsForm } from './notifications.js';
import { identityBox } from './identity.js';
import { emailCodeBox } from './auth.js';

/* 이 기능 전에 이메일로 가입한 계정: 설정에서 자기 주소로 번호를 받아 확인한다. */
function emailVerifyCell(me) {
  const v = me.email_verify || {};
  if (!v.has_email) return null;
  if (v.verified) return h('span', { class: 'email-ok' }, '확인됨');
  if (!v.available) return h('span', { class: 'small muted' }, '이메일 확인 전');
  const err = h('p', { class: 'form-err', role: 'alert', hidden: true });
  const box = emailCodeBox({
    send: () => api('/api/me/email-code', { method: 'POST' }),
    sendLabel: '이메일 인증하기',
    onError: (m) => { err.textContent = m; err.hidden = !m; },
  });
  const ok = h('button', { class: 'btn sm', type: 'button' }, '확인');
  ok.addEventListener('click', () => busy(ok, async () => {
    err.hidden = true;
    if (box.value().length !== 6) { err.textContent = '메일로 받은 인증번호 6자리를 넣어 주세요.'; err.hidden = false; return; }
    try {
      app.me = await api('/api/me/email-verify', { method: 'POST', body: { code: box.value() } });
    } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
    bus.dispatchEvent(new Event('me-changed'));
    wrap.replaceChildren(h('span', { class: 'email-ok' }, '확인됨'));
    toast('이메일을 확인했습니다.');
  }));
  box.codeRow.append(h('div', null, ok));
  const wrap = h('div', { class: 'email-verify' },
    h('p', { class: 'small muted', style: 'margin:0 0 6px' }, '아직 이 이메일이 본인 것인지 확인하지 않았어요.'),
    box.sendBtn, box.codeRow, err);
  return wrap;
}

function planText(p) {
  if (p.state === 'paid') return `이용 중 · ${ymd(p.ends_at)}까지`;
  return '무료';
}

function openDelete() {
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn danger', type: 'submit' }, '계정과 모든 데이터 삭제');
  const form = h('form', { novalidate: true },
    h('p', { style: 'margin-bottom:12px' }, '식자재, 메뉴, 가격 이력, 명세서 기록이 모두 지워지고 되돌릴 수 없습니다. 필요하면 먼저 엑셀(CSV)로 내려받으세요.'),
    err, field('비밀번호 확인', pw), btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (!pw.value) { err.textContent = '비밀번호를 입력해 주세요.'; err.hidden = false; return; }
    await busy(btn, async () => {
      try { await api('/api/me/delete', { method: 'POST', body: { password: pw.value } }); } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      bus.dispatchEvent(new Event('logged-out'));
      toast('계정을 삭제했습니다.');
    });
  });
  const dlg = openDialog({ title: '계정 삭제', content: form });
  pw.focus();
}

function openPassword() {
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn', type: 'submit' }, '비밀번호 바꾸기');
  const form = h('form', { novalidate: true },
    err, field('현재 비밀번호', cur), field('새 비밀번호', next, '8자 이상. 바꾸면 다른 기기의 로그인은 해제됩니다.'), btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (!cur.value) { err.textContent = '현재 비밀번호를 입력해 주세요.'; err.hidden = false; return; }
    if (next.value.length < 8) { err.textContent = '새 비밀번호는 8자 이상으로 정해 주세요.'; err.hidden = false; return; }
    await busy(btn, async () => {
      try { await api('/api/me/password', { method: 'POST', body: { current_password: cur.value, new_password: next.value } }); } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast('비밀번호를 바꿨습니다.');
    });
  });
  const dlg = openDialog({ title: '비밀번호 변경', content: form });
  cur.focus();
}

/* 도매마켓 연결: 도매마켓은 원가다이어리와 다른 서비스다. 여기에는 "내 구매 기록을 도매마켓에 익명으로
   쓰게 할지"라는 동의 상태와 끄는 스위치, 도매마켓으로 가는 링크만 둔다. 켜기·품목 고르기·받은 제안은
   도매마켓(원가다이어리 계정으로 로그인)에서 한다. */
function marketSection() {
  const body = h('div', { class: 'skel' });
  const section = h('section', { class: 'sheet' }, h('div', { class: 'sheet-h' }, h('h2', null, '도매마켓 연결')), body);
  const marketUrl = (app.pub && app.pub.market_url) || '/partner';

  async function paint() {
    let st;
    try { st = await api('/api/market/settings'); } catch (e) { body.classList.remove('skel'); fill(body, h('p', { class: 'small muted' }, errMsg(e))); return; }
    body.classList.remove('skel');
    const on = st.demand_optin && !st.notice_required;
    const off = h('button', { class: 'btn ghost sm', type: 'button' }, '연결 끊기');
    off.addEventListener('click', () => busy(off, async () => {
      try { await api('/api/market/settings', { method: 'PUT', body: { demand_optin: false } }); } catch (e) { toast(errMsg(e), 'err'); return; }
      toast('도매마켓 연결을 끊었습니다. 구매 기록이 더 이상 쓰이지 않습니다.');
      paint();
    }));
    fill(body,
      h('p', { class: 'small' }, '도매마켓은 원가다이어리와 다른 서비스예요. 연결하면 내가 고른 식자재의 품목·원산지·등급과 월 구매량 구간만 익명으로 도매마켓에 쓰여, 지금보다 싼 단가 제안을 받을 수 있어요. 가게 이름·매입가·거래처는 도매업체에게 보이지 않아요.'),
      h('p', { class: 'small', style: 'margin-top:10px' }, h('b', null, on ? `연결됨 · 식자재 ${st.summary.exposed_items}개 제공 중` : '연결 안 됨')),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('a', { class: 'btn sm', href: marketUrl, target: '_blank', rel: 'noopener' }, on ? '도매마켓에서 제안 보기' : '도매마켓에서 연결하기'),
        on ? off : null));
  }
  paint();
  return section;
}

export async function render(box) {
  await refreshMe();
  const me = app.me;
  const p = me.plan;
  const u = me.usage;

  box.append(h('div', { class: 'page-h' }, h('h1', null, '설정')));

  /* 이용 현황 */
  const planBox = h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '이용 현황')),
    h('dl', { class: 'kv' },
      h('dt', null, '계정'), h('dd', null, me.email, emailVerifyCell(me)),
      ...(me.identity?.enabled ? [h('dt', null, '본인인증'), h('dd', null, identityBox({
        purpose: 'account',
        initial: me.identity.verified ? { name: me.identity.name, phone: me.identity.phone } : null,
        onVerified: async () => { await refreshMe(); toast('본인인증을 마쳤습니다.'); },
        onError: (m) => toast(m, 'err'),
      }))] : []),
      h('dt', null, '상태'), h('dd', null, h('b', null, planText(p))),
      h('dt', null, '자동 인식'), h('dd', null, u.ocr_enabled
        ? [`(명세서·요리 사진 합계) 이번 달 ${u.ocr_used} / ${u.ocr_limit}회`, h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.min(100, (u.ocr_used / Math.max(1, u.ocr_limit)) * 100)}%` } }))]
        : '꺼짐 · 사진을 올리면 예시 결과가 나옵니다')));
  if (p.contact_email) {
    planBox.append(h('p', { class: 'small', style: 'margin-top:12px' }, '문의: ', h('a', { href: `mailto:${p.contact_email}` }, p.contact_email)));
  }

  /* 계산 기준 */
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const store = h('input', { class: 'input', type: 'text', maxLength: 60, value: me.store_name ?? '', autocomplete: 'organization' });
  const target = numInput({ value: n3(me.settings.target_cost_ratio) });
  const alertPct = numInput({ value: n3(me.settings.alert_pct) });
  const vatIncl = h('input', { type: 'radio', name: 'vat', value: 'incl', checked: me.settings.vat_mode === 'incl' });
  const vatExcl = h('input', { type: 'radio', name: 'vat', value: 'excl', checked: me.settings.vat_mode === 'excl' });
  const save = h('button', { class: 'btn', type: 'submit' }, '저장');
  const form = h('form', { novalidate: true },
    err,
    field('가게 이름', store),
    h('div', { class: 'two' },
      field('목표 원가율 (%)', target, '이 값을 넘으면 메뉴에 주의·위험 도장이 찍힙니다. 가게 사정에 맞게 정하세요.'),
      field('가격 알림 기준 (%)', alertPct, '식자재 단가가 이 비율 이상 오르거나 내리면 홈과 알림에서 알려 드립니다.')),
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, '판매가에 부가세가 포함되어 있나요?'),
      h('div', { class: 'radios', role: 'radiogroup' },
        h('label', { class: 'radio' }, vatIncl, h('span', null, h('b', null, '포함'), h('div', { class: 'hint' }, '메뉴판 가격 그대로 원가율을 계산합니다.'))),
        h('label', { class: 'radio' }, vatExcl, h('span', null, h('b', null, '별도'), h('div', { class: 'hint' }, '판매가를 1.1로 나눈 공급가 기준으로 원가율을 계산합니다.'))))),
    save);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const t = parseNum(target.value);
    const a = parseNum(alertPct.value);
    if (!(t >= 5 && t <= 95)) { err.textContent = '목표 원가율은 5에서 95 사이로 넣어 주세요.'; err.hidden = false; return; }
    if (!(a >= 0.5 && a <= 100)) { err.textContent = '가격 알림 기준은 0.5에서 100 사이로 넣어 주세요.'; err.hidden = false; return; }
    await busy(save, async () => {
      try {
        app.me = await api('/api/me/settings', { method: 'PATCH', body: { store_name: store.value.trim(), target_cost_ratio: t, alert_pct: a, vat_mode: vatExcl.checked ? 'excl' : 'incl' } });
        bus.dispatchEvent(new Event('me-changed'));
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      toast('저장했습니다. 메뉴 원가율이 새 기준으로 계산됩니다.');
    });
  });

  box.append(h('div', { class: 'stack' },
    planBox,
    h('section', { class: 'sheet' }, h('div', { class: 'sheet-h' }, h('h2', null, '계산 기준')), form),
    MARKET_ENABLED ? marketSection() : null,
    h('section', { class: 'sheet', id: 'notif-prefs' },
      h('div', { class: 'sheet-h' }, h('h2', null, '알림'), h('a', { class: 'small', href: '#/notifications' }, '알림 보기')),
      h('p', { class: 'small muted', style: 'margin-bottom:10px' }, '받고 싶은 알림만 켜 두세요. 꺼 둔 분류는 알림을 만들지 않고 종 숫자에서도 빠집니다.'),
      prefsForm()),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '내 데이터')),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn ghost sm', href: '/api/export/ingredients.csv', download: '' }, icon('download', 18), '식자재 CSV'),
        h('a', { class: 'btn ghost sm', href: '/api/export/menus.csv', download: '' }, icon('download', 18), '메뉴 CSV'),
        h('a', { class: 'btn ghost sm', href: '/api/export/recipes.csv', download: '' }, icon('download', 18), '레시피 CSV'),
        h('a', { class: 'btn ghost sm', href: '#/import' }, '다른 앱·엑셀에서 가져오기')),
      h('p', { class: 'hint', style: 'margin-top:10px' }, '엑셀에서 바로 열립니다. 언제든 다시 내려받을 수 있습니다.')),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '계정')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: openPassword }, '비밀번호 변경'),
        h('button', { class: 'btn ghost', type: 'button', onclick: async (ev) => busy(ev.currentTarget, async () => { await api('/api/auth/logout', { method: 'POST' }); bus.dispatchEvent(new Event('logged-out')); }) }, '로그아웃'),
        h('button', { class: 'btn ghost', type: 'button', title: '다른 기기를 포함해 모든 곳에서 로그아웃합니다. 로그인을 도난당한 것 같을 때 쓰세요.', onclick: async (ev) => busy(ev.currentTarget, async () => { await api('/api/auth/logout-all', { method: 'POST' }); bus.dispatchEvent(new Event('logged-out')); }) }, '모든 기기에서 로그아웃'),
        h('button', { class: 'btn danger', type: 'button', onclick: openDelete }, '계정 삭제')),
      h('p', { style: 'margin-top:12px' }, h('button', { class: 'link-btn small', type: 'button', onclick: openDataNotice }, '개인정보처리방침'), ' · ', h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관'), ' · ', h('button', { class: 'link-btn small', type: 'button', onclick: openCookieSettings }, '쿠키 설정')))));
}
