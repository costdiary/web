/* 운영자(ADMIN_EMAILS)만 보는 화면 — 사이드바에는 안 올리고 주소(#/admin/ocr)로 직접 들어간다.
   권한 자체는 서버(deps.current_admin)가 막으므로, 여긴 화면만 그린다. */
import { h, api, icon, toast, errMsg, segGroup, confirmDialog, openDialog } from './core.js';
import { emptyBlock } from './ui.js';

const KIND_LABEL = { invoice: '거래명세서', recipe: '요리 사진' };
const STATUS_LABEL = { ok: '성공', demo: '데모(API 키 없음)', error: '실패' };
const STATUS_COLOR = { ok: 'var(--blue)', demo: 'var(--ink-2)', error: 'var(--red)' };

function fmt(ts) {
  return (ts || '').slice(0, 16).replace('T', ' ');
}

function statusBadge(status) {
  return h('span', { style: `color:${STATUS_COLOR[status] || 'inherit'};font-weight:700` }, STATUS_LABEL[status] || status);
}

function filterBar(state, onChange) {
  const kindSel = h('select', { class: 'select' },
    h('option', { value: '' }, '전체 종류'),
    h('option', { value: 'invoice' }, '거래명세서'),
    h('option', { value: 'recipe' }, '요리 사진'));
  kindSel.value = state.kind;
  const statusSel = h('select', { class: 'select' },
    h('option', { value: '' }, '전체 상태'),
    h('option', { value: 'ok' }, '성공'),
    h('option', { value: 'demo' }, '데모(API 키 없음)'),
    h('option', { value: 'error' }, '실패'));
  statusSel.value = state.status;
  kindSel.addEventListener('change', () => { state.kind = kindSel.value; onChange(); });
  statusSel.addEventListener('change', () => { state.status = statusSel.value; onChange(); });
  return h('div', { class: 'two' }, kindSel, statusSel);
}

function row(item) {
  return h('li', null, h('a', { class: 'row', href: `#/admin/ocr/${item.id}` },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, `${KIND_LABEL[item.kind] || item.kind} · `, statusBadge(item.status)),
      h('div', { class: 'row-sub' }, [item.store_name || item.email, item.summary].filter(Boolean).join(' · ') || '(요약 없음)')),
    h('div', { class: 'row-end xs muted' }, fmt(item.created_at))));
}

export async function renderOcrLogs(box) {
  box.append(adminNav('#/admin/ocr'), h('div', { class: 'page-h' }, h('h1', null, 'OCR 인식 로그')));
  box.append(h('p', { class: 'hint' },
    '사장님이 올린 거래명세서·요리 사진을 Claude가 어떻게 읽었는지(또는 왜 실패했는지) 확인합니다. ',
    h('b', null, '데모'), ' 상태가 계속 보이면 운영 서버에 ANTHROPIC_API_KEY가 빠져 있다는 뜻입니다.'));

  const state = { kind: '', status: '' };
  const listBox = h('div');
  box.append(h('section', { class: 'sheet' }, filterBar(state, load), listBox));

  async function load() {
    listBox.replaceChildren(h('div', { class: 'skel' }));
    const qs = new URLSearchParams();
    if (state.kind) qs.set('kind', state.kind);
    if (state.status) qs.set('status', state.status);
    let res;
    try { res = await api(`/api/admin/ocr-logs?${qs}`); } catch (e) { toast(errMsg(e), 'err'); return; }
    if (!res.items.length) {
      listBox.replaceChildren(emptyBlock({ title: '로그가 없습니다', text: '조건에 맞는 인식 시도가 아직 없습니다.' }));
      return;
    }
    listBox.replaceChildren(h('ul', { class: 'rows' }, res.items.map(row)));
  }
  load();
}

export async function renderOcrLog(box, id) {
  box.append(h('div', { class: 'page-h' },
    h('a', { class: 'btn ghost sm', href: '#/admin/ocr' }, icon('back', 18), '목록'),
    h('h1', null, '인식 로그 상세')));
  const body = h('div');
  box.append(h('section', { class: 'sheet' }, body));

  let log;
  try {
    log = await api(`/api/admin/ocr-logs/${id}`);
  } catch (e) {
    toast(errMsg(e), 'err');
    body.replaceChildren(emptyBlock({ title: '불러오지 못했습니다', text: errMsg(e) }));
    return;
  }

  body.append(
    h('dl', { class: 'ledger' },
      h('div', null, h('dt', null, '사용자'), h('dd', null, log.store_name || log.email || '(알 수 없음)')),
      h('div', null, h('dt', null, '종류'), h('dd', null, KIND_LABEL[log.kind] || log.kind)),
      h('div', null, h('dt', null, '상태'), h('dd', null, statusBadge(log.status))),
      h('div', null, h('dt', null, '시각'), h('dd', null, fmt(log.created_at)))));

  if (log.error_text) body.append(h('p', { class: 'hint' }, `오류: ${log.error_text}`));

  body.append(log.image_data_url
    ? h('img', { src: log.image_data_url, alt: '업로드한 사진', style: 'max-width:100%;border-radius:8px;margin:14px 0;display:block' })
    : h('p', { class: 'muted' }, '이 로그에는 사진이 저장되어 있지 않습니다.'));

  if (log.result) {
    body.append(h('pre', {
      style: 'white-space:pre-wrap;word-break:break-all;background:#f7f8fa;border-radius:8px;padding:12px;font-size:0.8125rem;overflow:auto',
    }, JSON.stringify(log.result, null, 2)));
  }
}

/* ---------------------------------------------------------------- 운영 현황: 가입자·방문자 수(#/admin/stats) */

const METHOD_LABEL = { email: '이메일', kakao: '카카오', naver: '네이버', google: '구글' };
const nf = new Intl.NumberFormat('ko-KR');
const md = (day) => `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;

function tile(label, value, unit, sub) {
  return h('div', { class: 'ad-tile' },
    h('p', { class: 'kpi-label' }, label),
    h('p', { class: 'ad-num' }, nf.format(value), h('span', { class: 'u' }, unit)),
    sub ? h('p', { class: 'ad-sub' }, sub) : null);
}

/* 한 가지 숫자만 보여 주는 날짜별 막대(한 축, 한 색). 막대에 손을 올리면 그날 숫자가 뜬다. */
function dayBars(title, series, key, unit) {
  const max = Math.max(1, ...series.map((d) => d[key]));
  const tip = h('div', { class: 'ad-tip', hidden: true });
  const bars = series.map((d, i) => {
    const pct = (d[key] / max) * 100;
    const label = `${md(d.day)} · ${nf.format(d[key])}${unit}`;
    const col = h('div', { class: 'ad-col', tabindex: '0', 'aria-label': label },
      h('span', { class: 'ad-bar', style: `height:${d[key] ? Math.max(pct, 2) : 0}%` }));
    const show = () => { tip.textContent = label; tip.hidden = false; tip.style.left = `${Math.min(90, Math.max(10, ((i + 0.5) / series.length) * 100))}%`; };
    col.addEventListener('mouseenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('mouseleave', () => { tip.hidden = true; });
    col.addEventListener('blur', () => { tip.hidden = true; });
    return col;
  });
  const total = series.reduce((s, d) => s + d[key], 0);
  return h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, title), h('span', { class: 'sub' }, `${series.length}일 합계 ${nf.format(total)}${unit} · 가장 많은 날 ${nf.format(max === 1 && !total ? 0 : max)}${unit}`)),
    h('div', { class: 'ad-chart' }, tip, h('div', { class: 'ad-cols' }, bars)),
    h('div', { class: 'ad-axis' }, h('span', null, md(series[0].day)), h('span', null, '오늘')));
}

export async function renderStats(box) {
  box.append(adminNav('#/admin/stats'), h('div', { class: 'page-h' }, h('h1', null, '운영 현황')));
  let period = 30;
  const body = h('div', { class: 'stack' });
  const seg = segGroup('기간', [[7, '7일'], [30, '30일'], [90, '90일']], period, (d) => { period = d; load(); });
  box.append(h('div', { class: 'sheet-tools', style: 'margin:0 0 14px' }, seg), body);

  async function load() {
    body.replaceChildren(h('div', { class: 'skel' }));
    let s;
    try { s = await api(`/api/admin/stats?days=${period}`); } catch (e) {
      body.replaceChildren(emptyBlock({ title: '불러오지 못했습니다', text: errMsg(e) }));
      return;
    }
    const { signups: sg, visits: v } = s;
    const methods = Object.entries(sg.by_method).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${METHOD_LABEL[k] || k} ${n}`).join(' · ');
    const conv = v.period ? `방문자 100명 중 ${(sg.period / v.period * 100).toFixed(1)}명 가입` : '';
    body.replaceChildren(
      h('section', { class: 'sheet' },
        h('div', { class: 'ad-tiles' },
          tile('전체 가입자', sg.total, '명', `오늘 +${sg.today} · 7일 +${sg.week}`),
          tile(`최근 ${s.days}일 가입`, sg.period, '명', methods || '아직 없음'),
          tile('오늘 방문자', v.today, '명', `화면 열림 ${nf.format(v.today_views)}회`),
          tile(`최근 ${s.days}일 방문자`, v.period, '명', [`7일 ${nf.format(v.week)}명`, conv].filter(Boolean).join(' · '))),
        h('p', { class: 'hint', style: 'margin-top:12px' },
          v.tracking_since
            ? `방문자는 ${v.tracking_since.replace(/-/g, '.')}부터 세고 있어요. 그 전 날짜는 0으로 보입니다. `
            : '방문자 세기는 이 버전을 올린 뒤부터 시작돼요. 아직 기록이 없습니다. ',
          '같은 날 같은 사람은 한 명으로 세고, 검색엔진·AI 로봇은 빼요. 쿠키나 외부 분석 도구는 쓰지 않아요.')),
      funnelBlock(s),
      dayBars('날짜별 방문자', s.series, 'visitors', '명'),
      dayBars('날짜별 가입', s.series, 'signups', '명'),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '어디서 왔나요'), h('span', { class: 'sub' }, `최근 ${s.days}일 방문자 기준`)),
        s.sources.length
          ? h('ul', { class: 'rows' }, s.sources.map((r) => h('li', null, h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, r.source || '직접 방문(주소 입력·즐겨찾기·앱)')),
            h('div', { class: 'row-end' }, `${nf.format(r.visitors)}명`)))))
          : h('p', { class: 'muted' }, '아직 기록이 없어요.'),
        h('p', { class: 'hint', style: 'margin-top:10px' }, '홍보 글에 링크를 걸 때 주소 끝에 ?utm_source=instagram 처럼 붙이면 여기서 따로 셀 수 있어요.')),
    );
  }
  load();
}


/* 운영자 화면 위쪽의 묶음 이동 */
const ADMIN_TABS = [['#/admin/stats', '운영 현황'], ['#/admin/users', '사장님 계정'], ['#/admin/db', 'DB 보기'], ['#/admin/ocr', 'OCR 로그']];
function adminNav(cur) {
  return h('nav', { class: 'seg ad-nav', 'aria-label': '운영자 화면' }, ADMIN_TABS.map(([href, label]) =>
    h('a', { class: `btn sm${href === cur ? '' : ' ghost'}`, href, 'aria-current': href === cur ? 'page' : null }, label)));
}

/* 가입 → 실제 사용 퍼널(실제 계정 기준). 막대 길이는 가입자 대비, 오른쪽 %는 바로 위 단계 대비.
   방문자는 가입자보다 수십 배 많아 같은 막대에 두면 아래 단계가 안 보이므로 위에 한 줄로만 적는다. */
function funnelBlock(s) {
  const all = s.funnel || [];
  const visitors = all.find((x) => x.key === 'visitors')?.count || 0;
  const steps = all.filter((x) => x.key !== 'visitors');
  const top = Math.max(1, steps[0]?.count || 0);
  return h('section', { class: 'sheet' },
    h('div', { class: 'sheet-h' }, h('h2', null, '가입 후 실제로 쓰는지'), h('span', { class: 'sub' }, `최근 ${s.days}일 가입한 계정 기준`)),
    h('p', { class: 'ad-sub', style: 'margin-bottom:10px' }, visitors
      ? `방문자 ${nf.format(visitors)}명 중 ${nf.format(steps[0]?.count || 0)}명 가입 (${((steps[0]?.count || 0) / visitors * 100).toFixed(1)}%)`
      : '방문자 기록이 쌓이면 가입률도 여기 보여요.'),
    h('ol', { class: 'ad-funnel' }, steps.map((st, i) => {
      const prev = i ? steps[i - 1].count : null;
      const rate = prev ? `${Math.round((st.count / prev) * 100)}%` : '';
      return h('li', null,
        h('div', { class: 'ad-f-top' }, h('span', null, st.label), h('b', null, `${nf.format(st.count)}명`), h('span', { class: 'ad-f-rate' }, rate)),
        h('div', { class: 'ad-f-track' }, h('span', { class: 'ad-f-bar', style: `width:${st.count ? Math.max((st.count / top) * 100, 1.5) : 0}%` })));
    })),
    h('p', { class: 'hint', style: 'margin-top:10px' }, '오른쪽 %는 바로 윗단계에서 몇 %가 넘어왔는지예요. 예시 데이터로 시작한 계정도 식자재·메뉴가 있는 것으로 잡혀요.'));
}

/* ---------------------------------------------------------------- 사장님 계정 */

const PROVIDER = { kakao: '카카오', naver: '네이버', google: '구글' };

export async function renderUsers(box) {
  box.append(adminNav('#/admin/users'), h('div', { class: 'page-h' }, h('h1', null, '사장님 계정')));
  const q = h('input', { class: 'input', type: 'search', placeholder: '이메일이나 가게 이름으로 찾기', 'aria-label': '계정 찾기' });
  const info = h('p', { class: 'hint' });
  const list = h('div');
  const more = h('button', { class: 'btn ghost sm', type: 'button', hidden: true }, '더 보기');
  box.append(h('section', { class: 'sheet' }, q, info, list, more));
  let offset = 0;
  let timer;
  async function load(reset) {
    if (reset) { offset = 0; list.replaceChildren(h('div', { class: 'skel' })); }
    let res;
    try { res = await api(`/api/admin/users?${new URLSearchParams({ q: q.value, offset, limit: 50 })}`); } catch (e) { toast(errMsg(e), 'err'); return; }
    if (reset) list.replaceChildren();
    info.textContent = `${nf.format(res.total)}명`;
    if (!res.total) { list.replaceChildren(emptyBlock({ title: '찾는 계정이 없어요', text: '이메일이나 가게 이름의 일부만 넣어도 찾아요.' })); more.hidden = true; return; }
    list.append(h('ul', { class: 'rows' }, res.items.map((u) => h('li', null, h('a', { class: 'row', href: `#/admin/users/${u.id}` },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, u.store_name || '(가게 이름 없음)', h('span', { class: 'xs muted' }, ` · ${u.email}`)),
        h('div', { class: 'row-sub' }, [`가입 ${fmt(u.created_at).slice(0, 10)}`, PROVIDER[u.provider] || '이메일', `식자재 ${u.ingredients}`, `메뉴 ${u.menus}`, `명세서 ${u.invoices}`,
          u.last_login ? `최근 로그인 ${fmt(u.last_login).slice(0, 10)}` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'row-end' }, icon('chevron', 18)))))));
    offset += res.items.length;
    more.hidden = offset >= res.total;
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(true), 250); });
  more.addEventListener('click', () => load(false));
  load(true);
}

const COUNT_LABEL = { ingredients: '식자재', menus: '메뉴', invoices: '명세서', preps: '프렙', daily_sales: '매출 입력일', staff: '직원', ocr_logs: '사진 인식', donations: '후원' };

export async function renderUser(box, id) {
  box.append(adminNav('#/admin/users'), h('div', { class: 'page-h' },
    h('a', { class: 'btn ghost sm', href: '#/admin/users' }, icon('back', 18), '목록'), h('h1', null, '계정 상세')));
  const body = h('div', { class: 'stack' });
  box.append(body);
  let u;
  try { u = await api(`/api/admin/users/${id}`); } catch (e) { body.replaceChildren(emptyBlock({ title: '불러오지 못했습니다', text: errMsg(e) })); return; }

  async function tempPw() {
    if (!await confirmDialog({ title: '임시 비밀번호 발급', message: `${u.email} 계정의 비밀번호를 임시 비밀번호로 바꾸고, 모든 기기에서 로그아웃시킵니다. 본인 확인을 한 뒤에만 하세요.`, confirmText: '발급', danger: true })) return;
    try {
      const r = await api(`/api/admin/users/${id}/temp-password`, { method: 'POST' });
      openDialog({ title: '임시 비밀번호', content: h('div', { class: 'stack' },
        h('p', null, `${r.email}`), h('p', { class: 'ad-num', style: 'user-select:all;font-size:1.5rem' }, r.temp_password),
        h('p', { class: 'hint' }, '사장님께 전달하고, 로그인한 뒤 설정에서 바꾸도록 안내해 주세요. 이 창을 닫으면 다시 볼 수 없어요.')) });
    } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function logoutAll() {
    if (!await confirmDialog({ title: '모든 기기에서 로그아웃', message: '이 계정의 로그인을 모두 끊습니다. 계정을 도난당한 것 같을 때 씁니다.', confirmText: '로그아웃시키기' })) return;
    try { const r = await api(`/api/admin/users/${id}/logout-all`, { method: 'POST' }); toast(`로그인 ${r.ended}개를 끊었어요.`); } catch (e) { toast(errMsg(e), 'err'); }
  }

  body.append(
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, u.store_name || '(가게 이름 없음)'), h('span', { class: 'sub' }, u.email)),
      h('dl', { class: 'ledger' },
        h('div', null, h('dt', null, '가입'), h('dd', null, fmt(u.created_at))),
        h('div', null, h('dt', null, '가입 방법'), h('dd', null, u.providers.map((p) => PROVIDER[p] || p).join(', ') || '이메일')),
        h('div', null, h('dt', null, '마지막 로그인'), h('dd', null, fmt(u.last_login) || '로그아웃 상태'))),
      h('p', { class: 'hint', style: 'margin-top:12px' }, u.identity_verified_at ? `본인인증 ${fmt(u.identity_verified_at)}` : '본인인증 안 함',
        ` · 지금 로그인된 기기 ${u.active_sessions}개`)),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '쓴 만큼')),
      h('div', { class: 'ad-tiles ad-tiles-sm' }, Object.entries(u.counts).map(([k, n]) => tile(COUNT_LABEL[k] || k, n, '')))),
    h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '관리')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: tempPw }, '임시 비밀번호 발급'),
        h('button', { class: 'btn ghost', type: 'button', onclick: logoutAll }, '모든 기기에서 로그아웃')),
      h('p', { class: 'hint', style: 'margin-top:10px' }, '계정 삭제는 사장님이 설정 화면에서 직접 하도록 두었어요(되돌릴 수 없어서).')),
    u.recent_events.length ? h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '최근 보안 기록')),
      h('ul', { class: 'rows' }, u.recent_events.map((e) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, e.event), h('div', { class: 'row-sub' }, e.detail || '')),
        h('div', { class: 'row-end xs muted' }, fmt(e.at))))))) : null);
}

/* ---------------------------------------------------------------- DB 보기(읽기 전용) */

export async function renderTables(box) {
  box.append(adminNav('#/admin/db'), h('div', { class: 'page-h' }, h('h1', null, 'DB 보기')));
  box.append(h('p', { class: 'hint' }, '서버 데이터베이스의 표를 그대로 봅니다. 읽기만 돼요. 비밀번호·토큰 같은 칸은 가려서 보여 줘요.'));
  const list = h('div', null, h('div', { class: 'skel' }));
  box.append(h('section', { class: 'sheet' }, list));
  let res;
  try { res = await api('/api/admin/tables'); } catch (e) { list.replaceChildren(emptyBlock({ title: '불러오지 못했습니다', text: errMsg(e) })); return; }
  list.replaceChildren(h('ul', { class: 'rows' }, res.items.map((t) => h('li', null, h('a', { class: 'row', href: `#/admin/db/${encodeURIComponent(t.name)}` },
    h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, t.name)),
    h('div', { class: 'row-end' }, `${nf.format(t.rows)}줄`, icon('chevron', 18)))))));
}

export async function renderTable(box, name) {
  box.append(adminNav('#/admin/db'), h('div', { class: 'page-h' },
    h('a', { class: 'btn ghost sm', href: '#/admin/db' }, icon('back', 18), '표 목록'), h('h1', null, name)));
  const q = h('input', { class: 'input', type: 'search', placeholder: '이 표에서 찾기', 'aria-label': '찾기' });
  const info = h('p', { class: 'hint' });
  const wrap = h('div', { class: 'ad-tbl-wrap' });
  const prev = h('button', { class: 'btn ghost sm', type: 'button' }, '이전');
  const next = h('button', { class: 'btn ghost sm', type: 'button' }, '다음');
  box.append(h('section', { class: 'sheet' }, q, info, wrap, h('div', { class: 'btn-row', style: 'margin-top:10px' }, prev, next)));
  const LIMIT = 50;
  let offset = 0;
  let timer;
  async function load() {
    let r;
    try { r = await api(`/api/admin/tables/${encodeURIComponent(name)}?${new URLSearchParams({ q: q.value, offset, limit: LIMIT })}`); } catch (e) {
      wrap.replaceChildren(emptyBlock({ title: '불러오지 못했습니다', text: errMsg(e) })); return;
    }
    info.textContent = r.total ? `${nf.format(r.total)}줄 중 ${nf.format(offset + 1)}–${nf.format(offset + r.rows.length)} (최근 것부터)` : '없음';
    wrap.replaceChildren(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, r.columns.map((c) => h('th', null, c)))),
      h('tbody', null, r.rows.map((row) => h('tr', null, row.map((v) => h('td', { title: v == null ? '' : String(v) }, v == null ? h('span', { class: 'muted' }, '—') : String(v))))))));
    prev.disabled = offset === 0;
    next.disabled = offset + r.rows.length >= r.total;
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; load(); }, 250); });
  prev.addEventListener('click', () => { offset = Math.max(0, offset - LIMIT); load(); });
  next.addEventListener('click', () => { offset += LIMIT; load(); });
  load();
}
