/* 운영자(ADMIN_EMAILS)만 보는 화면 — 사이드바에는 안 올리고 주소(#/admin/ocr)로 직접 들어간다.
   권한 자체는 서버(deps.current_admin)가 막으므로, 여긴 화면만 그린다. */
import { h, api, icon, toast, errMsg, segGroup } from './core.js';
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
  box.append(h('div', { class: 'page-h' }, h('h1', null, 'OCR 인식 로그')));
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
  box.append(h('div', { class: 'page-h' }, h('h1', null, '운영 현황')));
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
