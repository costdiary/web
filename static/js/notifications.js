/* 알림 센터: 상단 종(배지), 알림 목록 화면, 알림 설정(분류별 켜고 끄기).
   알림은 서버(app/notifications.py)가 만든다. 원가·단가, 매출·배달, 서비스 안내 세 분류다.
   도매마켓 소식은 여기 넣지 않는다(도매마켓은 다른 서비스라 그쪽 화면에서 본다). */
import { h, api, app, fill, icon, busy, toast, errMsg, go, openDialog } from './core.js';
import { emptyBlock } from './ui.js';

let unread = 0;
let timer = null;

/* ---------- 상단 종 ---------- */

export function bellButton() {
  const a = h('a', { class: 'icon-btn notif-bell', href: '#/notifications', id: 'notif-bell' });
  paintBell(a, app.me?.notifications?.unread || 0);
  return a;
}

function paintBell(a, n) {
  a.setAttribute('aria-label', n ? `알림 (읽지 않은 알림 ${n}개)` : '알림');
  fill(a, icon('bell', 22), n ? h('span', { class: 'badge' }, n > 99 ? '99+' : String(n)) : null);
}

export function setUnread(n) {
  unread = Math.max(0, n | 0);
  if (app.me) app.me.notifications = { ...(app.me.notifications || {}), unread };
  const a = document.getElementById('notif-bell');
  if (a) paintBell(a, unread);
  // 홈 화면에 설치한 앱이면 아이콘에도 숫자를 띄운다(지원하는 기기에서만).
  try {
    if (unread && navigator.setAppBadge) navigator.setAppBadge(unread).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* 지원 안 함 */ }
}

export async function refreshCount() {
  if (!app.me) return;
  try { setUnread((await api('/api/notifications/count')).unread); } catch { /* 다음에 다시 */ }
}

/* 앱을 켜 둔 동안 3분마다, 그리고 다시 화면으로 돌아왔을 때 숫자를 새로 받는다. */
export function startPolling() {
  stopPolling();
  setUnread(app.me?.notifications?.unread || 0);
  timer = setInterval(() => { if (document.visibilityState === 'visible') refreshCount(); }, 180000);
}
export function stopPolling() { if (timer) clearInterval(timer); timer = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && timer) refreshCount(); });

/* ---------- 목록 ---------- */

function rel(iso) {
  const t = new Date(iso).getTime();
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(t);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일`;
}

function groupOf(iso) {
  const kst = (x) => new Date(x + 9 * 3600e3).toISOString().slice(0, 10);
  const day = kst(new Date(iso).getTime());
  const today = kst(Date.now());
  const yday = kst(Date.now() - 86400e3);
  if (day === today) return '오늘';
  if (day === yday) return '어제';
  if (Date.now() - new Date(iso).getTime() < 7 * 86400e3) return '이번 주';
  return '그 전';
}

const CAT_LABEL = { cost: '원가·단가', sales: '매출·배달', system: '안내' };

function item(n, onOpen) {
  const a = h('a', { class: `notif${n.read ? '' : ' unread'}`, href: n.link || '#/notifications' },
    h('span', { class: `notif-ic ${n.tone || ''} c-${n.category}`.trim(), 'aria-hidden': 'true' }, icon(n.icon, 20)),
    h('span', { class: 'notif-main' },
      h('span', { class: 'notif-meta' }, h('span', null, CAT_LABEL[n.category] || ''), h('span', null, rel(n.created_at))),
      h('span', { class: 'notif-title' }, n.read ? null : h('span', { class: 'sr' }, '읽지 않음. '), n.title),
      n.body ? h('span', { class: 'notif-body' }, n.body) : null),
    n.read ? null : h('span', { class: 'notif-dot', 'aria-hidden': 'true' }));
  a.addEventListener('click', () => onOpen(n, a));
  return a;
}

export async function render(box) {
  let cat = '';
  const list = h('div', { 'aria-live': 'polite' });
  const readAll = h('button', { class: 'btn ghost sm', type: 'button' }, '모두 읽음');
  const chips = h('div', { class: 'seg notif-filter', role: 'group', 'aria-label': '알림 분류' });

  const open = (n, el) => {
    if (n.read) return;
    n.read = true;
    el.classList.remove('unread');
    el.querySelector('.notif-dot')?.remove();
    setUnread(unread - 1);
    api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
  };

  async function load() {
    const d = await api(`/api/notifications${cat ? `?category=${cat}` : ''}`);
    setUnread(d.unread);
    readAll.disabled = !d.unread;
    if (!chips.childElementCount) {
      const opts = [['', '전체'], ...d.categories.map((c) => [c.key, CAT_LABEL[c.key] || c.label])];
      for (const [k, label] of opts) {
        const b = h('button', { class: 'btn sm', type: 'button' }, label);
        b.addEventListener('click', async () => { if (cat === k) return; cat = k; mark(); await busy(b, load); });
        b.dataset.k = k;
        chips.append(b);
      }
    }
    mark();
    if (!d.items.length) {
      fill(list, h('section', { class: 'sheet' }, emptyBlock({
        title: cat ? '이 분류에는 알림이 없어요' : '새 알림이 없어요',
        text: '식자재 단가가 오르거나 내리면, 배달로 팔면 손해인 메뉴가 생기면 여기에 알려 드려요.',
        actions: [h('a', { class: 'btn ghost sm', href: '#/invoice' }, '명세서 올리기')],
      })));
      return;
    }
    const groups = new Map();
    for (const n of d.items) {
      const g = groupOf(n.created_at);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    }
    fill(list, [...groups].map(([g, items]) => h('section', { class: 'notif-group', 'aria-label': g },
      h('h2', { class: 'notif-gh' }, g),
      h('div', { class: 'sheet notif-list' }, items.map((n) => item(n, open))))));
  }
  function mark() {
    for (const b of chips.children) {
      const on = b.dataset.k === cat;
      b.classList.toggle('ghost', !on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  readAll.addEventListener('click', () => busy(readAll, async () => {
    const r = await api('/api/notifications/read', { method: 'POST', body: {} });
    setUnread(r.unread);
    for (const el of list.querySelectorAll('.notif.unread')) { el.classList.remove('unread'); el.querySelector('.notif-dot')?.remove(); }
    readAll.disabled = true;
  }));

  const settingsBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '알림 설정', title: '알림 설정', onclick: () => openPrefs(load) }, icon('sliders', 20));
  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '알림'), h('div', { class: 'btn-row tight' }, readAll, settingsBtn)),
    chips, list);
  await load();
}

/* ---------- 알림 설정 ---------- */

export function prefsForm({ onSaved } = {}) {
  const body = h('div', { class: 'skel' });
  (async () => {
    let d;
    try { d = await api('/api/notifications/prefs'); } catch (e) { body.classList.remove('skel'); fill(body, h('p', { class: 'small muted' }, errMsg(e))); return; }
    body.classList.remove('skel');
    fill(body, h('ul', { class: 'pref-list' }, d.categories.map((c) => {
      const cb = h('input', { type: 'checkbox', checked: d.prefs[c.key] });
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          await api('/api/notifications/prefs', { method: 'PUT', body: { [c.key]: cb.checked } });
          toast(cb.checked ? `${c.label} 알림을 켰습니다.` : `${c.label} 알림을 껐습니다.`);
          refreshCount();
          if (onSaved) onSaved();
        } catch (e) { cb.checked = !cb.checked; toast(errMsg(e), 'err'); }
        cb.disabled = false;
      });
      return h('li', null, h('label', { class: 'sw pref' }, cb, h('span', { class: 'trk' }),
        h('span', null, h('b', null, c.label), h('span', { class: 'hint' }, c.desc))));
    })));
  })();
  return body;
}

export function openPrefs(onSaved) {
  openDialog({
    title: '알림 설정',
    content: h('div', null,
      h('p', { class: 'small muted', style: 'margin-bottom:12px' }, '끈 분류의 알림은 만들지 않고, 이미 온 것도 목록과 숫자에서 뺍니다. 단가 알림 기준(%)은 설정의 계산 기준에서 바꿀 수 있어요.'),
      prefsForm({ onSaved }),
      h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => go('#/settings') }, '설정 열기'))),
  });
}
