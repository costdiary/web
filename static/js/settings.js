/* 설정: 계산 기준, 이용 현황, 내려받기, 로그아웃·계정 삭제 */
import { h, api, app, bus, field, numInput, parseNum, n1, n3, ymd, openDialog, busy, toast, errMsg, refreshMe, icon, fill } from './core.js';
import { num } from './ui.js';
import { openDataNotice, openTerms } from './legal.js';
import { openMarketNotice } from './market.js';
import { MARKET_ENABLED } from './core.js';

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

function marketSection() {
  const body = h('div', { class: 'skel' });
  const section = h('section', { class: 'sheet' }, h('div', { class: 'sheet-h' }, h('h2', null, '도매마켓')), body);

  async function paint() {
    let st;
    try { st = await api('/api/market/settings'); } catch (e) { body.classList.remove('skel'); fill(body, h('p', { class: 'small muted' }, errMsg(e))); return; }
    body.classList.remove('skel');
    const optin = h('input', { type: 'checkbox', checked: st.demand_optin });
    const threshold = numInput({ value: n1(st.threshold_pct) });
    const regionSel = h('select', { class: 'select' }, h('option', { value: '' }, '권역 선택'), st.regions.map((r) => h('option', { value: r.code }, r.label)));
    regionSel.value = st.region_code || '';
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn sm', type: 'submit' }, '저장');
    const form = h('form', { novalidate: true },
      err,
      h('label', { class: 'sw' }, optin, h('span', { class: 'trk' }), '더 싼 제안 받기'),
      h('div', { class: 'two', style: 'margin-top:10px' },
        field('알림 기준 (%)', threshold, '평균 매입가보다 이 비율 이상 싼 제안만 알려 드립니다.'),
        field('내 가게 권역', regionSel)),
      save);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const t = parseNum(threshold.value);
      if (!(t >= 1 && t <= 30)) { err.textContent = '알림 기준은 1에서 30 사이로 넣어 주세요.'; err.hidden = false; return; }
      if (optin.checked && !regionSel.value) { err.textContent = '권역을 선택해 주세요.'; err.hidden = false; return; }
      await busy(save, async () => {
        try {
          await api('/api/market/settings', { method: 'PUT', body: { demand_optin: optin.checked, threshold_pct: t, region_code: regionSel.value || null } });
        } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
        toast('저장했습니다.');
      });
    });
    fill(body, form,
      h('p', { class: 'small', style: 'margin-top:12px' }, h('a', { href: '#/market/offers', style: 'display:inline-block;padding:4px 0' }, `지금 노출 중인 품목 ${st.summary.exposed_items}개`)),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openMarketNotice({ settings: st, onDone: paint }) }, '안내 다시 보기'),
        h('a', { class: 'btn ghost sm', href: '#/market' }, '도매마켓 열기')));
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
      h('dt', null, '계정'), h('dd', null, me.email),
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
      field('가격 알림 기준 (%)', alertPct, '식자재 단가가 이 비율 이상 오르면 홈에 알려 드립니다.')),
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
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '매출·수수료·인건비')),
      h('p', { class: 'small muted' }, '배달앱 수수료, 손익분기, 직원 급여, 내 매출, 주변 상권은 왼쪽 "매출관리"로 옮겼습니다.'),
      h('div', { class: 'btn-row', style: 'margin-top:10px' }, h('a', { class: 'btn ghost sm', href: '#/revenue' }, icon('trend', 18), '매출관리 바로가기'))),
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
      h('p', { style: 'margin-top:12px' }, h('button', { class: 'link-btn small', type: 'button', onclick: openDataNotice }, '개인정보처리방침'), ' · ', h('button', { class: 'link-btn small', type: 'button', onclick: openTerms }, '이용약관')))));
}
