/* 직원 급여(인건비): 아르바이트 직원의 시급·주 근무시간으로 주휴수당까지 더한 한 달 인건비를 계산합니다.
   합계는 손익분기 계산의 고정비에 자동으로 더해집니다. 계산식과 법 출처는 app/labor.py 주석에 있습니다. */
import { h, api, app, field, numInput, parseNum, selectOf, n0, n1, n3, nT, busy, toast, errMsg, fill, icon, confirmDialog, openDialog } from './core.js';
import { laborMonth, WEEKS_PER_MONTH } from './calc.js';
import { num, stmt } from './ui.js';

const DISCLAIMER = '이 계산은 참고용이며 법률 상담이 아닙니다. 주휴수당은 그 주에 정한 근무일을 모두 나왔다고 가정해 계산했습니다. '
  + '실제 지급액·4대보험·가산수당은 가게 사정에 따라 달라지므로 고용노동부 고객상담센터(국번 없이 1350)나 공인노무사에게 꼭 확인하세요.';

/* 직원 한 명의 계산 내역: 왜 이 금액인지 보이도록 기본급·주휴수당·야간수당을 나눠 보여 줍니다. */
function payStmt(wage, hours, pay, fivePlus) {
  const weeks = n3(WEEKS_PER_MONTH); // 4.3 으로 줄이면 곱셈이 안 맞아 보이므로 4.345 까지
  const rows = [
    [`기본급 (${n0(wage)}원 × 주 ${nT(hours)}시간 × ${weeks}주)`, `${n0(pay.base)}원`],
    pay.eligible
      ? [`주휴수당 (주 ${nT(pay.holiday_hours_week)}시간분 × ${weeks}주)`, `${n0(pay.holiday)}원`]
      : ['주휴수당 (주 15시간 미만이라 없음)', '0원', 'minus'],
  ];
  if (fivePlus && pay.night_hours_week > 0) {
    rows.push([`야간수당 (주 ${nT(pay.night_hours_week)}시간 × 50% × ${weeks}주)`, `${n0(pay.night)}원`]);
  } else if (pay.night_hours_week > 0) {
    rows.push(['야간수당 (상시 5명 미만이라 계산에 넣지 않음)', '0원', 'minus']);
  }
  rows.push(['한 달 합계', `${n0(pay.total)}원`, 'total']);
  return stmt(rows, '한 달 급여 계산 내역');
}

/* 추가·수정에 같이 쓰는 입력 칸. onChange 로 미리 계산을 다시 그립니다. */
function staffForm(s, minWage, canWrite, fivePlus) {
  const name = h('input', { class: 'input', type: 'text', maxLength: 30, value: s?.name ?? '', placeholder: '예: 김민지', autocomplete: 'off', disabled: !canWrite });
  const wage = numInput({ value: n0(s?.hourly_wage ?? minWage), placeholder: n0(minWage), disabled: !canWrite });
  const hours = numInput({ value: s ? String(s.weekly_hours) : '', placeholder: '예: 20', disabled: !canWrite });
  const days = selectOf([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), `주 ${d}일`]), String(s?.work_days ?? 5), { disabled: !canWrite });
  const night = numInput({ value: s?.night_hours ? String(s.night_hours) : '0', placeholder: '0', disabled: !canWrite });
  const active = h('input', { type: 'checkbox', checked: s ? s.active : true, disabled: !canWrite });
  const preview = h('div', { class: 'staff-preview', 'aria-live': 'polite' });
  function paintPreview() {
    const w = parseNum(wage.value);
    const hr = parseNum(hours.value);
    const nh = parseNum(night.value) || 0;
    if (!(w > 0) || !(hr > 0)) { fill(preview, h('p', { class: 'hint' }, '시급과 주 근무시간을 넣으면 한 달 급여를 미리 계산해 보여 줍니다.')); return; }
    const pay = laborMonth(w, hr, nh, fivePlus);
    fill(preview,
      payStmt(w, hr, pay, fivePlus),
      w < minWage ? h('p', { class: 'note-warn', role: 'status' }, `시급이 올해 최저임금 ${n0(minWage)}원보다 낮습니다. 최저임금보다 적게 주면 법 위반이 될 수 있습니다.`) : null,
      pay.over_40 ? h('p', { class: 'note-warn' }, '주 40시간을 넘는 부분의 연장근로 가산수당(상시 5명 이상 가게는 1.5배)은 이 계산에 들어 있지 않습니다.') : null,
      !fivePlus && nh > 0 ? h('p', { class: 'note-warn' }, '상시 5명 미만 가게는 야간수당 의무가 없어 이 시간은 계산에 넣지 않았습니다.') : null);
  }
  wage.addEventListener('input', paintPreview);
  hours.addEventListener('input', paintPreview);
  night.addEventListener('input', paintPreview);
  paintPreview();
  const el = h('div', null,
    field('이름', name),
    h('div', { class: 'two' },
      field('시급 (원)', wage, `올해 최저임금 ${n0(minWage)}원`),
      field('주 근무시간', hours, '쉬는 시간을 뺀, 한 주에 일하기로 한 시간')),
    h('div', { class: 'two' },
      field('주 근무일', days, '주휴수당은 이 날을 모두 나와야 받습니다'),
      field('야간근무 시간 합계 (주)', night, '밤 10시~아침 6시 사이에 일한 시간의 한 주 합계')),
    h('label', { class: 'check' }, active, h('span', null, '지금 일하는 중 (끄면 인건비 합계에서 빠집니다)')),
    preview);
  const value = () => ({
    name: name.value.trim(), hourly_wage: parseNum(wage.value), weekly_hours: parseNum(hours.value),
    work_days: Number(days.value), night_hours: parseNum(night.value) || 0, active: active.checked,
  });
  function validate(v) {
    if (!v.name) return '이름을 넣어 주세요.';
    if (!(v.hourly_wage > 0) || v.hourly_wage > 200000) return '시급은 1원에서 200,000원 사이로 넣어 주세요.';
    if (!(v.weekly_hours > 0) || v.weekly_hours > 80) return '주 근무시간은 0보다 크고 80시간 이하로 넣어 주세요.';
    if (v.night_hours < 0 || v.night_hours > 80) return '야간근무 시간은 0에서 80시간 사이로 넣어 주세요.';
    if (v.night_hours > v.weekly_hours) return '야간근무 시간은 주 근무시간을 넘을 수 없습니다.';
    return '';
  }
  return {
    el, name, value, validate,
    reset: () => { name.value = ''; hours.value = ''; wage.value = n0(minWage); night.value = '0'; active.checked = true; days.value = '5'; paintPreview(); },
  };
}

export async function render(box) {
  const canWrite = app.me.plan.writable;
  let data = await api('/api/labor');
  const body = h('div', { class: 'stack' });

  const fivePlus = h('input', { type: 'checkbox', checked: data.five_plus, disabled: !canWrite });
  fivePlus.addEventListener('change', async () => {
    await busy(fivePlus, async () => {
      try { data = await api('/api/labor/settings', { method: 'PUT', body: { five_plus: fivePlus.checked } }); }
      catch (e) { fivePlus.checked = !fivePlus.checked; toast(errMsg(e)); return; }
      toast(fivePlus.checked ? '상시 5명 이상으로 설정했습니다. 야간수당이 계산에 더해집니다.' : '상시 5명 미만으로 설정했습니다.');
      buildAddForm();
      paint();
    });
  });

  function openEdit(s) {
    const f = staffForm(s, data.min_wage, canWrite, data.five_plus);
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, '저장');
    const form = h('form', { novalidate: true }, err, f.el, h('div', { class: 'btn-row', style: 'margin-top:12px' }, save));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = f.value();
      const bad = f.validate(v);
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      await busy(save, async () => {
        try { data = await api(`/api/labor/staff/${s.id}`, { method: 'PUT', body: v }); } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
        dlg.close();
        toast('저장했습니다.');
        paint();
      });
    });
    const dlg = openDialog({ title: `${s.name} 급여 수정`, content: form });
  }

  async function remove(s, btn) {
    const ok = await confirmDialog({ title: '직원 지우기', message: `${s.name} 님의 급여 정보를 지웁니다. 되돌릴 수 없습니다. 잠깐 쉬는 경우라면 '수정'에서 '지금 일하는 중'을 끄세요.`, confirmText: '지우기', danger: true });
    if (!ok) return;
    await busy(btn, async () => {
      data = await api(`/api/labor/staff/${s.id}`, { method: 'DELETE' });
      toast('지웠습니다.');
      paint();
    });
  }

  function staffCard(s) {
    const del = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${s.name} 지우기`, disabled: !canWrite, onclick: (ev) => remove(s, ev.currentTarget) }, icon('trash', 18));
    return h('li', { class: `staff${s.active ? '' : ' off'}` },
      h('div', { class: 'staff-h' },
        h('h3', null, s.name,
          s.active ? null : h('span', { class: 'tag' }, '쉬는 중'),
          s.pay.eligible ? h('span', { class: 'tag ok' }, '주휴수당 대상') : h('span', { class: 'tag' }, '주휴수당 없음'),
          s.below_min ? h('span', { class: 'tag bad' }, '최저임금 미달') : null),
        h('div', { class: 'staff-act' },
          h('button', { class: 'btn ghost sm', type: 'button', disabled: !canWrite, onclick: () => openEdit(s) }, '수정'), del)),
      h('p', { class: 'small muted' }, `시급 ${n0(s.hourly_wage)}원 · 주 ${nT(s.weekly_hours)}시간 · 주 ${s.work_days}일`),
      payStmt(s.hourly_wage, s.weekly_hours, s.pay, data.five_plus),
      s.pay.over_40 ? h('p', { class: 'xs muted' }, '주 40시간 넘는 부분의 연장근로 가산수당은 빠져 있습니다.') : null);
  }

  let add, addForm;
  function buildAddForm() {
    add = staffForm(null, data.min_wage, canWrite, data.five_plus);
    const addErr = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const addBtn = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, icon('plus', 18), '직원 추가');
    addForm = h('form', { novalidate: true }, addErr, add.el, h('div', { class: 'btn-row', style: 'margin-top:12px' }, addBtn));
    addForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      addErr.hidden = true;
      const v = add.value();
      const bad = add.validate(v);
      if (bad) { addErr.textContent = bad; addErr.hidden = false; return; }
      await busy(addBtn, async () => {
        try { data = await api('/api/labor/staff', { method: 'POST', body: v }); } catch (e) { addErr.textContent = errMsg(e); addErr.hidden = false; return; }
        add.reset();
        toast(`${v.name} 님을 추가했습니다.`);
        paint();
      });
    });
  }
  buildAddForm();

  function paint() {
    const active = data.staff.filter((s) => s.active).length;
    const totalRows = [
      ['기본급 합계', `${n0(data.base_total)}원`],
      ['주휴수당 합계', `${n0(data.holiday_total)}원`],
    ];
    if (data.five_plus) totalRows.push(['야간수당 합계', `${n0(data.night_total)}원`]);
    totalRows.push(['인건비 합계', `${n0(data.total)}원`, 'total']);
    fill(body,
      h('section', { class: 'sheet' },
        h('h2', null, '사업장 설정'),
        h('label', { class: 'check' }, fivePlus, h('span', null, '상시 5명 이상 사업장 (연장·야간·휴일근로 가산수당 대상)')),
        h('p', { class: 'small muted' }, '이 체크를 켜면 아래 직원별 야간근무 시간에 50% 가산수당이 더해집니다. 연장·휴일 가산수당은 시간대 입력이 없어 이 계산에 넣지 않습니다.')),
      h('section', { class: 'sheet', 'aria-live': 'polite' },
        h('h2', null, '한 달 인건비'),
        data.staff.length ? [
          h('div', { class: 'be-big' }, h('div', { class: 'labor-total' }, h('span', { class: 'small muted' }, `일하는 직원 ${active}명 합계`), num(n0(data.total), '원'))),
          stmt(totalRows, '한 달 인건비 합계'),
          h('p', { class: 'small', style: 'margin-top:10px' }, '이 금액은 손익분기 계산의 고정비에 자동으로 더해집니다. ', h('a', { href: '#/breakeven' }, '손익분기 매출 보기')),
        ] : h('p', { class: 'small muted' }, '아직 등록한 직원이 없습니다. 아래에서 아르바이트 직원의 시급과 주 근무시간을 넣어 주세요.')),
      data.staff.length ? h('section', { class: 'sheet' }, h('h2', null, '직원별 급여'), h('ul', { class: 'staff-list' }, data.staff.map(staffCard))) : null,
      h('section', { class: 'sheet' }, h('h2', null, '직원 추가'), addForm),
      h('section', { class: 'sheet' },
        h('h2', null, '계산 기준'),
        h('ul', { class: 'plain' },
          h('li', null, `최저임금: ${data.min_wage_year}년 시간당 ${n0(data.min_wage)}원`, data.min_wage_next ? ` (${data.min_wage_year + 1}년부터 ${n0(data.min_wage_next)}원)` : '', '.'),
          h('li', null, '주휴수당: 한 주에 15시간 이상 일하고 그 주에 정한 날을 모두 나오면 받습니다. 하루치 = 주 근무시간 ÷ 40 × 8시간(최대 8시간) × 시급.'),
          h('li', null, `한 달은 ${n3(WEEKS_PER_MONTH)}주(365일 ÷ 12달 ÷ 7일)로 계산합니다.`),
          data.five_plus
            ? h('li', null, '야간근로(밤 10시~아침 6시) 가산수당(50%)을 계산에 더했습니다. 연장·휴일근로 가산수당은 시간대 구분 입력이 없어 이 계산에는 넣지 않았습니다.')
            : h('li', null, '연장·야간(밤 10시~아침 6시)·휴일근로 가산수당(50%)은 상시 5명 이상 가게에만 해당하며, 이 계산에는 넣지 않았습니다.'),
          h('li', null, '4대보험: 한 달 60시간(주 15시간) 미만으로 일하는 직원은 국민연금·건강보험·고용보험이 대부분 빠지지만 예외가 있고, 산재보험은 모든 직원이 대상입니다. 사업주 부담 보험료는 이 합계에 들어 있지 않습니다.'))));
  }

  box.append(
    h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: '#/revenue' }, icon('back', 18), '매출관리'), h('h1', { style: 'font-size:1.125rem' }, '직원 급여')),
    h('div', { class: 'banner warn legal-note', role: 'note' }, h('div', null, h('b', null, '법률 상담이 아닙니다. '), DISCLAIMER)),
    body);
  paint();
}
