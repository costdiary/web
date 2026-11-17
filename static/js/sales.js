/* 내 가게 매출: 파일로 올리거나 하루씩 입력하고, 이번 달 목표와 비교합니다. */
import { h, api, app, field, numInput, parseNum, selectOf, n0, busy, toast, errMsg, fill, icon, confirmDialog } from './core.js';
import { num, emptyBlock } from './ui.js';

const thisMonth = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const shift = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };

export async function render(box) {
  const canWrite = app.me.plan.writable;
  let month = thisMonth();
  const body = h('div', { class: 'stack', 'aria-live': 'polite' });

  async function load(m) {
    month = m;
    const s = await api(`/api/sales?month=${m}`);
    paint(s);
  }

  function progress(label, value, goal) {
    const pct = Math.max(0, Math.min(100, goal ? (value / goal) * 100 : 0));
    return h('div', { class: 'prog' },
      h('div', { class: 'small' }, `${label} ${n0(goal)}원 중 `, h('b', null, `${n0(value)}원`), ` (${Math.round(pct)}%)`),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': label }, h('span', { style: `width:${pct}%` })));
  }

  function paint(s) {
    const date = h('input', { class: 'input', type: 'date', value: s.month === thisMonth() ? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) : `${s.month}-01`, disabled: !canWrite });
    const ch = selectOf(Object.entries(s.labels), 'store', { disabled: !canWrite, 'aria-label': '채널' });
    const amt = numInput({ placeholder: '0', disabled: !canWrite, 'aria-label': '매출(원)' });
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const addBtn = h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => busy(addBtn, async () => {
      err.hidden = true;
      try {
        const r = await api('/api/sales/day', { method: 'PUT', body: { day: date.value, channel: ch.value, amount: parseNum(amt.value) || 0 } });
        amt.value = '';
        toast('저장했습니다.');
        month = r.month;
        paint(r);
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    }) }, '저장');

    const pick = h('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt', hidden: true });
    pick.addEventListener('change', async () => {
      const f = pick.files[0]; pick.value = '';
      if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      try {
        const r = await api('/api/sales/import', { method: 'POST', form: fd });
        toast(`${r.saved}건을 저장했습니다.${r.skipped ? ` (읽지 못한 줄 ${r.skipped}개)` : ''}`);
        await load(r.month);
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    });

    const goal = s.target_sales || s.breakeven_sales;
    fill(body,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' },
          h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': '지난 달', onclick: () => load(shift(s.month, -1)) }, '‹'),
          h('h2', null, `${s.month.replace('-', '년 ')}월 매출`),
          h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': '다음 달', onclick: () => load(shift(s.month, 1)) }, '›')),
        s.entered_days ? h('div', null,
          h('div', { class: 'be-big' }, h('div', null, h('span', { class: 'small muted' }, `입력한 ${s.entered_days}일 합계`), num(n0(s.total), '원'))),
          s.breakeven_sales ? progress('본전 매출', s.total, s.breakeven_sales) : null,
          s.target_sales && s.target_sales !== s.breakeven_sales ? progress('목표 매출', s.total, s.target_sales) : null,
          !goal ? h('p', { class: 'small muted' }, '손익분기·목표 매출을 계산해 두면 여기서 비교해 보여 줍니다. ', h('a', { href: '#/breakeven' }, '계산하러 가기')) : null,
          s.pace_total ? h('p', { class: 'small' }, `지금까지 평균으로 월말까지 가면 약 ${n0(s.pace_total)}원입니다. 단순 계산이라 요일·행사에 따라 달라집니다.`) : null,
          h('ul', { class: 'plain' }, s.by_channel.map((c) => h('li', null, `${c.label} ${n0(c.amount)}원`)))) :
          emptyBlock({ title: '이 달에 입력한 매출이 없습니다', text: '아래에서 하루씩 입력하거나, 날짜·채널·매출이 있는 엑셀/CSV 파일을 올려 주세요.' })),
      h('section', { class: 'sheet' },
        h('h2', null, '하루 매출 입력'),
        err,
        h('div', { class: 'two' }, field('날짜', date), field('채널', ch)),
        field('매출 (원)', amt, '같은 날짜·채널에 다시 입력하면 덮어씁니다.'),
        h('div', { class: 'btn-row' }, addBtn)),
      h('section', { class: 'sheet' },
        h('h2', null, '파일로 올리기'),
        h('p', { class: 'small muted' }, '첫 줄에 날짜, 채널(선택), 매출, 건수(선택) 같은 제목이 있는 엑셀(.xlsx)·CSV를 올립니다. 같은 날짜·채널은 덮어쓰므로 같은 파일을 다시 올려도 두 배가 되지 않습니다. 배달앱·포스 API 연결은 아직 없고, 각 서비스에서 내려받은 정산 파일로 대신할 수 있습니다.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', type: 'button', disabled: !canWrite, onclick: () => pick.click() }, icon('upload', 18), '파일 선택'), pick)),
      s.days.length ? h('section', { class: 'sheet' },
        h('h2', null, '날짜별'),
        h('ul', { class: 'plain' }, [...s.days].reverse().map((d) => h('li', { class: 'day-row' },
          h('span', null, `${d.day.slice(5)} · ${n0(d.amount)}원`, h('span', { class: 'xs muted' }, ` (${Object.entries(d.channels).map(([k, v]) => `${s.labels[k] || k} ${n0(v)}`).join(', ')})`)),
          canWrite ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${d.day} 매출 지우기`, onclick: async (ev) => {
            const btn = ev.currentTarget; // await confirmDialog 뒤에는 ev.currentTarget 이 null 이 되므로 미리 잡아 둡니다
            const ok = await confirmDialog({ title: '매출 지우기', message: `${d.day} 매출(${n0(d.amount)}원)을 지웁니다. 되돌릴 수 없습니다.`, confirmText: '지우기', danger: true });
            if (!ok) return;
            await busy(btn, async () => {
              for (const k of Object.keys(d.channels)) await api(`/api/sales/day?day=${d.day}&channel=${k}`, { method: 'DELETE' });
              await load(s.month);
            });
          } }, icon('trash', 18)) : null)))) : null);
  }

  box.append(
    h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: '#/revenue' }, icon('back', 18), '매출관리'), h('h1', { style: 'font-size:1.125rem' }, '내 매출')),
    body);
  await load(month);
}
