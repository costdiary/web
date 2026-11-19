/* 운영자(ADMIN_EMAILS)만 보는 화면 — 사이드바에는 안 올리고 주소(#/admin/ocr)로 직접 들어간다.
   권한 자체는 서버(deps.current_admin)가 막으므로, 여긴 화면만 그린다. */
import { h, api, icon, toast, errMsg } from './core.js';
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
