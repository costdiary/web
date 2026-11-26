/* 배달앱 수수료 설정: 쓰는 앱을 켜고, 우리 가게 구간과 요율을 맞춥니다.
   여기서 켠 앱은 메뉴 화면의 '배달앱에서 팔면' 계산과 홈 화면의 적자 메뉴 알림에 쓰입니다. */
import { h, api, app, field, numInput, selectOf, parseNum, n0, n3, nT, busy, toast, errMsg, fill, icon } from './core.js';
import { channelResult } from './calc.js';
import { stmt, num } from './ui.js';

const LIMITS = {
  fee_pct: ['중개이용료', 0, 40],
  pay_pct: ['결제수수료', 0, 15],
  delivery_fee: ['사장님 부담 배달비', 0, 20000],
  coupon_cost: ['쿠폰·할인 부담', 0, 100000],
  pack_cost: ['포장·용기비', 0, 100000],
};

const asOfKo = (s) => String(s || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1년 $2월 $3일');
const range = (r) => `${n0(r[0])}~${n0(r[1])}원`;

function channelCard(entry, ctx) {
  const { canWrite, target, vat } = ctx;
  const st0 = entry.state;
  let saved = st0; // 마지막으로 저장된 값
  let dirty = false;
  const tierOf = (k) => entry.tiers.find((t) => t.key === k) || null;

  /* ----- 켜고 끄기 (누르면 바로 저장) ----- */
  const on = h('input', { type: 'checkbox', role: 'switch', checked: st0.enabled, disabled: !canWrite, 'aria-label': `${entry.label} 사용` });
  const onText = h('span', null, st0.enabled ? '사용 중' : '사용 안 함');
  const sw = h('label', { class: 'sw' }, on, h('span', { class: 'trk', 'aria-hidden': 'true' }), onText);

  /* ----- 입력칸 ----- */
  const tierSel = entry.tiers.length
    ? selectOf([...entry.tiers.map((t) => [t.key, t.label]), ['custom', '직접 입력']], st0.tier || entry.default_tier)
    : null;
  const tierHint = h('p', { class: 'hint' });
  const labelIn = entry.key === 'custom' ? h('input', { class: 'input', type: 'text', maxLength: 20, autocomplete: 'off', value: st0.label, placeholder: '예: 요기요' }) : null;
  const feeIn = numInput({ value: nT(st0.fee_pct) });
  const payIn = numInput({ value: nT(st0.pay_pct) });
  const delivIn = entry.has_delivery_fee ? numInput({ value: n3(st0.delivery_fee) }) : null;
  const couponIn = numInput({ value: n3(st0.coupon_cost) });
  const packIn = numInput({ value: n3(st0.pack_cost) });
  const vatIn = h('input', { type: 'checkbox', checked: st0.vat_extra });
  const checkedIn = h('input', { class: 'input', type: 'date', value: st0.checked_on || '', max: new Date().toISOString().slice(0, 10) });
  const delivHint = h('p', { class: 'hint', hidden: !entry.has_delivery_fee || !!tierSel });
  if (!tierSel) {
    delivHint.textContent = entry.key === 'custom'
      ? '정산내역서의 배달비 중 가게가 부담하는 금액'
      : '직접 배달하거나 대행사에 내는 비용. 배달비를 받지 않으면 0';
  }
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const demo = h('div', { class: 'chan-demo', 'aria-live': 'polite' });
  const dirtyNote = h('span', { class: 'xs muted', 'aria-live': 'polite' });
  const saveBtn = h('button', { class: 'btn', type: 'submit', disabled: !canWrite }, '저장');

  if (!canWrite) for (const el of [tierSel, labelIn, feeIn, payIn, delivIn, couponIn, packIn, vatIn, checkedIn]) if (el) el.disabled = true;

  function read() {
    const one = (el, key, optional) => {
      const [name, lo, hi] = LIMITS[key];
      if (el.value.trim() === '' && optional) return 0;
      const v = parseNum(el.value);
      if (!Number.isFinite(v)) throw new Error(`${name}을(를) 숫자로 입력해 주세요.${optional ? '' : ' 없으면 0을 넣으세요.'}`);
      if (v < lo || v > hi) throw new Error(`${name}은(는) ${n3(lo)}~${n3(hi)} 사이로 입력해 주세요.`);
      return v;
    };
    return {
      enabled: on.checked,
      tier: tierSel ? tierSel.value : '',
      label: labelIn ? labelIn.value.trim() : '',
      fee_pct: one(feeIn, 'fee_pct', false),
      pay_pct: one(payIn, 'pay_pct', false),
      delivery_fee: delivIn ? one(delivIn, 'delivery_fee', true) : 0,
      coupon_cost: one(couponIn, 'coupon_cost', true),
      pack_cost: one(packIn, 'pack_cost', true),
      vat_extra: vatIn.checked,
      checked_on: checkedIn.value || null,
    };
  }

  function paintTier() {
    if (!tierSel) return;
    const t = tierOf(tierSel.value);
    fill(tierHint, t
      ? `이 구간: 중개이용료 ${nT(t.fee_pct)}%, 배달비는 지역에 따라 ${range(t.delivery_range)}(기본값은 위쪽 금액)`
      : '정산내역서에 나온 요율과 배달비를 아래에 직접 넣으세요.');
  }

  function paintDemo() {
    let v;
    try { v = read(); } catch {
      fill(demo, h('p', { class: 'hint' }, '숫자를 모두 채우면 1만 원짜리 주문의 계산 예시가 나옵니다.'));
      return;
    }
    const r = channelResult(0, 10000, { key: entry.key, short: entry.short, label: entry.label, kind: entry.kind, ...v }, target, vat);
    const rows = [['주문 금액', num('10,000', '원')]];
    if (vat === 'excl') rows.push(['부가세 10% 제외', num(`−${n0(10000 - 10000 / 1.1)}`, '원'), 'minus']);
    for (const it of r.fee_items) rows.push([it.label, num(`−${n0(it.amount)}`, '원'), 'minus']);
    rows.push(['사장님이 받는 돈', num(n0(r.net), '원'), 'total']);
    fill(demo,
      h('h3', { class: 'chan-demo-h' }, '예시: 1만 원짜리 주문 한 건'),
      stmt(rows, '1만 원 주문 계산 예시'),
      h('p', { class: 'hint' }, v.vat_extra ? '수수료와 배달비에는 부가세 10%가 더해져 있습니다. 재료비와 포장비는 아직 빼지 않은 금액입니다.' : '재료비와 포장비는 아직 빼지 않은 금액입니다.'));
  }

  function markDirty() {
    dirty = true;
    dirtyNote.textContent = '저장하지 않은 변경이 있습니다';
    paintDemo();
  }

  /* 구간을 고르면 그 구간의 요율·배달비를 채웁니다. 직접 고치면 '직접 입력'으로 바꿉니다. */
  if (tierSel) {
    tierSel.addEventListener('change', () => {
      const t = tierOf(tierSel.value);
      if (t) {
        feeIn.value = nT(t.fee_pct);
        if (delivIn) delivIn.value = n3(t.delivery_fee);
      }
      paintTier();
    });
    const syncCustom = () => {
      const t = tierOf(tierSel.value);
      if (!t) return;
      const fee = parseNum(feeIn.value);
      const dv = delivIn ? parseNum(delivIn.value) : t.delivery_fee;
      if (fee !== t.fee_pct || dv !== t.delivery_fee) { tierSel.value = 'custom'; paintTier(); }
    };
    feeIn.addEventListener('input', syncCustom);
    if (delivIn) delivIn.addEventListener('input', syncCustom);
  }

  const body = h('form', { class: 'chan-body', novalidate: true, hidden: !st0.enabled, onsubmit: onSubmit },
    err,
    entry.fee_verified ? null
      : h('p', { class: 'chan-warn' }, h('b', null, '요율 확인 필요. '), '공식 안내 페이지에서 확인하지 못해 넣은 값이라, 정산내역서와 한 번 맞춰 보세요.'),
    labelIn ? field('앱 이름', labelIn) : null,
    tierSel ? h('div', { class: 'field' }, h('label', { for: (tierSel.id = `tier-${entry.key}`) }, '우리 가게 매출 구간'), tierSel, tierHint) : null,
    h('div', { class: 'two' },
      field('중개이용료 (%)', feeIn, '주문 금액에서 앱이 떼는 비율'),
      field('결제수수료 (%)', payIn, entry.pay_verified ? '카드 결제 등에 붙는 비율' : '임시값입니다. 정산내역서의 결제 수수료율로 고쳐 주세요.')),
    h('div', { class: 'two' },
      delivIn ? h('div', null, field('사장님 부담 배달비 (원/건)', delivIn), delivHint) : null,
      field('쿠폰·할인 부담 (원/건)', couponIn, '가게가 부담하는 쿠폰·할인의 건당 평균. 없으면 0')),
    h('div', { class: 'two' },
      field('포장·용기비 (원/건)', packIn, '배달 주문에만 드는 용기·봉투 비용. 재료비에 더해 계산합니다.'),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, '부가세'),
        h('label', { class: 'chk' }, vatIn, h('span', null, '수수료·배달비는 부가세 별도 금액입니다 (10% 더해 계산)')))),
    field('정산내역서와 비교해 확인한 날', checkedIn, entry.stale ? '요율 기준일이 90일 넘게 지났습니다. 최근 정산내역서와 비교한 뒤 날짜를 갱신해 주세요.' : '선택 입력. 확인한 날을 적어 두면 오래된 요율을 알려 드립니다.'),
    demo,
    h('details', { class: 'more chan-src' },
      h('summary', null, '근거와 주의할 점'),
      h('p', { class: 'xs muted' }, `기준일 ${asOfKo(entry.as_of)}`),
      h('ul', { class: 'plain' }, entry.notes.map((t) => h('li', null, t))),
      entry.sources.length
        ? h('ul', { class: 'plain src' }, entry.sources.map((s) => h('li', null,
          s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label) : h('span', null, s.label))))
        : null),
    h('div', { class: 'btn-row chan-actions' }, saveBtn,
      h('button', { class: 'btn ghost', type: 'button', disabled: !canWrite, onclick: resetDefaults }, '기본값으로'),
      dirtyNote),
    !canWrite ? h('p', { class: 'hint' }, '지금은 수정할 수 없습니다.') : null);

  body.addEventListener('input', markDirty);
  body.addEventListener('change', markDirty);

  function resetDefaults() {
    const d = entry.defaults;
    const t = tierOf(entry.default_tier);
    if (tierSel) tierSel.value = entry.default_tier;
    feeIn.value = nT(t ? t.fee_pct : d.fee_pct);
    payIn.value = nT(d.pay_pct);
    if (delivIn) delivIn.value = n3(t ? t.delivery_fee : d.delivery_fee);
    couponIn.value = n3(d.coupon_cost);
    packIn.value = n3(d.pack_cost);
    vatIn.checked = d.vat_extra;
    paintTier();
    markDirty();
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    err.hidden = true;
    let payload;
    try { payload = read(); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
    await busy(saveBtn, async () => {
      try {
        const res = await api(`/api/channels/${entry.key}`, { method: 'PUT', body: payload });
        saved = res.item.state;
        dirty = false;
        dirtyNote.textContent = '';
        toast('저장했습니다.');
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    });
  }

  on.addEventListener('change', async () => {
    const want = on.checked;
    on.disabled = true;
    try {
      const res = await api(`/api/channels/${entry.key}`, { method: 'PUT', body: { ...saved, enabled: want } });
      saved = res.item.state;
      onText.textContent = want ? '사용 중' : '사용 안 함';
      body.hidden = !want;
      el.classList.toggle('on', want);
      toast(want ? `${entry.short} 수수료를 켰습니다. 구간과 요율을 확인해 주세요.` : `${entry.short} 수수료를 껐습니다.`);
    } catch (e) {
      on.checked = !want;
      toast(errMsg(e), 'err');
    } finally {
      on.disabled = !canWrite;
      on.focus();
    }
  });

  const el = h('section', { class: `sheet chan${st0.enabled ? ' on' : ''}`, 'aria-label': entry.label },
    h('div', { class: 'chan-h' },
      h('div', { class: 'chan-t' },
        h('h2', null, entry.label),
        entry.fee_verified
          ? h('span', { class: 'tag ok' }, '요율 공식 확인')
          : h('span', { class: 'tag warn' }, '요율 확인 필요')),
      sw),
    body);
  paintTier();
  paintDemo();
  return el;
}

export async function render(box) {
  const { items, as_of: asOf } = await api('/api/channels');
  const ctx = {
    canWrite: app.me.plan.writable,
    target: app.me.settings.target_cost_ratio,
    vat: app.me.settings.vat_mode,
  };
  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm back-more', href: '#/more' }, icon('back', 18), '전체 메뉴'),
      h('h1', { style: 'font-size:1.125rem' }, '배달앱 수수료')),
    h('div', { class: 'banner info', role: 'note' }, h('div', null,
      h('b', null, `요율 기준일 ${asOfKo(asOf)}. `),
      '배달앱과 직접 연동하는 건 아니고, 아래 값은 공개된 안내 기준의 기본값이에요. 정산내역서와 다르면 직접 고쳐 쓰시면 됩니다. ',
      '쓰는 앱을 켜 두면 배달 주문 한 건에 실제로 남는 돈을 메뉴마다 계산해 드립니다.')),
    items.some((it) => it.stale && it.state.enabled)
      ? h('div', { class: 'banner warn', role: 'status' }, h('div', null, h('b', null, '요율 확인한 지 90일이 지났어요. '), '배달앱은 요율을 수시로 바꾸니, 최근 정산내역서와 한 번 맞춰 보고 \'확인한 날\'을 갱신해 주세요.'))
      : '', // box.append(null)은 화면에 'null' 글자를 찍는다
    ...items.map((it) => channelCard({ ...it, as_of: asOf }, ctx)),
    h('details', { class: 'sheet more how' },
      h('summary', null, '계산 방식'),
      h('ul', { class: 'plain' },
        h('li', null, '받는 돈 = 판매가 − 중개이용료 − 결제수수료 − 사장님 부담 배달비 − 쿠폰·할인 부담'),
        h('li', null, '앱이 부가세 별도로 안내하는 수수료·배달비에는 10%를 더해 계산합니다. 단, 공급가 기준(부가세 제외)으로 원가를 보는 가게는 수수료의 부가세를 돌려받으므로 더하지 않고, 쿠폰은 1.1로 나눠 계산합니다.'),
        h('li', null, '수수료는 쿠폰·할인 전 판매가 기준으로 계산합니다. 실제 정산이 할인 후 금액 기준이면 이 계산이 비용을 조금 크게 잡습니다.'),
        h('li', null, '배달 원가율 = (재료비 + 포장·용기비) ÷ 받는 돈. 매장 원가율과 같은 목표 기준으로 양호·주의·위험을 표시합니다.'),
        h('li', null, '메뉴에 배달앱 판매가를 따로 넣으면 그 가격으로, 넣지 않으면 매장 판매가로 계산합니다.'))));
}
