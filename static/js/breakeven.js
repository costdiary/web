/* 손익분기·목표 매출: 월 고정비를 넣으면 '한 달에 얼마를 팔아야 남는지'를 계산합니다.
   메뉴 원가와 켜 둔 배달앱 수수료는 앱에 있는 값을 그대로 씁니다. */
import { h, api, app, field, numInput, parseNum, n0, n1, busy, toast, errMsg, fill, icon } from './core.js';
import { breakeven } from './calc.js';
import { num } from './ui.js';

export async function render(box) {
  const data = await api('/api/breakeven');
  const canWrite = app.me.plan.writable;
  const { stats } = data;
  const p = data.profile;
  const labor = data.labor || { total: 0, active_count: 0, base_total: 0, holiday_total: 0 };
  const rows = [];
  const list = h('div', { class: 'be-rows' });
  const share = numInput({ value: String(p.delivery_share || 0), 'aria-label': '배달 매출 비중(%)', disabled: !canWrite });
  const days = numInput({ value: String(p.open_days), 'aria-label': '한 달 영업일', disabled: !canWrite });
  const goal = numInput({ value: p.target_profit ? n0(p.target_profit) : '', placeholder: '0', 'aria-label': '한 달 목표 이익', disabled: !canWrite });
  const fee = numInput({ value: String(p.payment_fee_pct || 0), 'aria-label': '카드 결제수수료(%)', disabled: !canWrite });
  const out = h('div', { 'aria-live': 'polite' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });

  function addRow(label = '', amount = '') {
    const l = h('input', { class: 'input', type: 'text', maxLength: 30, value: label, placeholder: '항목 (예: 월세)', 'aria-label': '고정비 항목', disabled: !canWrite });
    const a = numInput({ value: amount === '' ? '' : n0(amount), placeholder: '0', 'aria-label': `${label || '고정비'} 금액(원)`, disabled: !canWrite });
    const del = h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': '이 항목 지우기', disabled: !canWrite, onclick: () => {
      rows.splice(rows.findIndex((r) => r.el === el), 1);
      el.remove();
      paint();
      paintQuick();
    } }, icon('trash', 18));
    const el = h('div', { class: 'be-row' }, l, a, del);
    rows.push({ el, l, a });
    list.append(el);
    l.addEventListener('input', paint);
    a.addEventListener('input', paint);
    return el;
  }

  const manualTotal = () => rows.reduce((s, r) => s + (parseNum(r.a.value) || 0), 0);
  /* 고정비 합계 = 직접 넣은 항목 + 직원 급여 화면에서 계산한 인건비(주휴수당 포함) */
  const fixedTotal = () => manualTotal() + labor.total;
  const dupWarn = h('p', { class: 'note-warn', role: 'status', hidden: true },
    '직원 급여 화면의 인건비가 이미 여기에 더해지고 있어요. 아래 항목 중 같은 돈을 가리키는 게 있다면 지워 주세요, 안 그러면 두 번 잡힙니다.');
  const checkDup = () => {
    dupWarn.hidden = !(labor.total > 0 && rows.some((r) => /인건비|급여|알바/.test(r.l.value) && (parseNum(r.a.value) || 0) > 0));
  };
  /* 자주 쓰는 항목을 한 번에 추가하는 버튼(이미 있는 항목은 숨김) */
  const quick = h('div', { class: 'chips be-quick', role: 'group', 'aria-label': '자주 쓰는 고정비 항목 추가' });
  const paintQuick = () => {
    const have = new Set(rows.map((r) => r.l.value.trim()));
    fill(quick, data.presets.filter((x) => !have.has(x)).map((x) => h('button', { class: 'chip', type: 'button', disabled: !canWrite, onclick: () => {
      addRow(x).querySelectorAll('input')[1].focus();
      paintQuick();
    } }, `+ ${x}`)));
  };

  function paint() {
    const res = breakeven(fixedTotal(), parseNum(goal.value) || 0, parseNum(share.value) || 0, stats.cm_store, stats.cm_delivery,
      stats.avg_price, parseNum(days.value) || 26, parseNum(fee.value) || 0);
    const total = fixedTotal();
    checkDup();
    if (stats.cm_store == null) {
      fill(out, h('div', { class: 'banner info', role: 'status' }, h('div', null, h('b', null, '메뉴 원가가 아직 없어요. '),
        '판매가와 재료가 둘 다 들어간 메뉴가 있어야 계산해 드릴 수 있습니다. ', h('a', { href: '#/menus' }, '메뉴 보기'))));
      return;
    }
    if (res.breakeven_sales == null) {
      fill(out, h('div', { class: 'banner', role: 'status' }, h('div', null, h('b', null, '지금 가격과 원가로는 팔수록 손해예요. '),
        '한 개 팔 때 남는 돈이 0 이하라 손익분기 매출 자체를 계산할 수 없습니다. 판매가를 올리거나 원가를 먼저 낮춰 보세요.')));
      return;
    }
    fill(out,
      h('section', { class: 'sheet' },
        h('h2', null, '한 달에 이만큼 팔아야 합니다'),
        h('div', { class: 'be-big' },
          h('div', null, h('span', { class: 'small muted' }, '손익분기 매출 (본전)'), num(n0(res.breakeven_sales), '원')),
          (parseNum(goal.value) || 0) > 0 ? h('div', null, h('span', { class: 'small muted' }, `목표 이익 ${n0(parseNum(goal.value))}원을 남기려면`), num(n0(res.target_sales), '원')) : null),
        h('p', { class: 'small' }, `하루 ${n0(res.daily_breakeven)}원`, res.orders_breakeven ? ` · 한 달 약 ${n0(res.orders_breakeven)}건(평균 판매가 ${n0(stats.avg_price)}원 기준)` : '',
          (parseNum(goal.value) || 0) > 0 ? ` / 목표 하루 ${n0(res.daily_target)}원` : ''),
        h('p', { class: 'xs muted' }, `고정비 합계 ${n0(total)}원`, labor.total ? ` (직접 넣은 고정비 ${n0(manualTotal())}원 + 직원 급여 ${n0(labor.total)}원)` : '', ` ÷ 매출 1원당 남는 돈 ${n1(res.cm * 100)}%`)),
      h('details', { class: 'more' }, h('summary', null, '이 숫자는 어떻게 계산했나요?'),
        h('ul', { class: 'plain' },
          h('li', null, `매장 판매: 판매가 1원당 재료비 등을 빼고 남는 돈 ${n1(stats.cm_store * 100)}%`),
          stats.cm_delivery != null ? h('li', null, `배달 판매: 수수료·배달비를 뺀 뒤 남는 돈 ${n1(stats.cm_delivery * 100)}% (켜 둔 배달앱 평균)`) : h('li', null, '배달앱 수수료를 켜 두지 않아 배달도 매장과 같은 값으로 봤습니다.'),
          h('li', null, '모든 메뉴가 같은 비율로 팔린다고 가정합니다. 실제 판매 비중이 다르면 결과도 달라집니다.'),
          stats.menu_skipped ? h('li', null, `단가가 없는 메뉴 ${stats.menu_skipped}개는 원가가 빠져 있어 계산에서 뺐습니다.`) : null,
          labor.total ? h('li', null, `직원 급여 ${n0(labor.total)}원 = 기본급 ${n0(labor.base_total)}원 + 주휴수당 ${n0(labor.holiday_total)}원 (일하는 직원 ${labor.active_count}명). 가산수당·사업주 4대보험료는 들어 있지 않습니다.`) : null,
          h('li', null, '월세·공과금 같은 고정비는 직접 넣은 값이며, 세금·감가상각은 반영하지 않았습니다.'))));
  }

  async function save() {
    err.hidden = true;
    const fixed = rows.map((r) => ({ label: r.l.value.trim(), amount: parseNum(r.a.value) || 0 })).filter((f) => f.label);
    try {
      await api('/api/breakeven', { method: 'PUT', body: {
        fixed, delivery_share: parseNum(share.value) || 0, open_days: Math.round(parseNum(days.value) || 26),
        target_profit: parseNum(goal.value) || 0, payment_fee_pct: parseNum(fee.value) || 0 } });
      toast('저장했습니다.');
    } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
  }

  const initial = p.fixed.length ? p.fixed : data.presets.map((label) => ({ label, amount: '' }));
  for (const f of initial) addRow(f.label, f.amount);
  paintQuick();
  for (const el of [share, days, goal, fee]) el.addEventListener('input', paint);
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => busy(saveBtn, save) }, '저장');

  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm back-more', href: '#/more' }, icon('back', 18), '전체 메뉴'),
      h('h1', { style: 'font-size:1.125rem' }, '손익분기·목표 매출')),
    h('section', { class: 'sheet' },
      h('h2', null, '한 달 고정비'),
      h('p', { class: 'hint' }, '매출과 상관없이 매달 나가는 돈이에요. 월세·전기세·수도세·인터넷비·기타 잡비 등으로 나눠 넣으시면 되고, 인건비는 아래 직원 급여 쪽 계산값이 자동으로 더해집니다.'),
      err, list,
      h('div', { class: 'be-labor', style: 'margin-top:8px' },
        h('div', null, h('div', { class: 'small' }, h('b', null, '직원 급여 (주휴수당 포함)')),
          h('div', { class: 'xs muted' }, labor.active_count ? `일하는 직원 ${labor.active_count}명 · 자동 계산` : '직원을 등록하면 여기에 자동으로 더해집니다')),
        h('div', { style: 'text-align:right' }, h('div', null, h('span', { class: 'n' }, n0(labor.total)), '원'),
          h('a', { class: 'small', href: '#/labor' }, labor.active_count ? '직원 급여 보기' : '직원 급여 계산하기'))),
      dupWarn,
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn ghost sm', type: 'button', disabled: !canWrite, onclick: () => { addRow().querySelector('input').focus(); } }, icon('plus', 18), '항목 추가')),
      quick,
      h('div', { class: 'two', style: 'margin-top:12px' },
        field('한 달 목표 이익 (원)', goal, '비워 두면 본전 기준만 보여 줍니다.'),
        field('한 달 영업일', days)),
      h('div', { class: 'two' },
        field('배달 매출 비중 (%)', share, '전체 매출 중 배달앱 비율'),
        field('카드 결제수수료 (%)', fee, '매장 결제에 붙는 비율. 모르면 0')),
      h('div', { class: 'btn-row' }, saveBtn)),
    out);
  paint();
}
