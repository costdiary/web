/* 화면에서 바로 계산해 보여 주는 식. 서버(app/costing.py)와 같은 식이어야 하며,
   어긋나면 tests/test_calc_parity.py 가 실패해서 알려 줍니다. 이 파일은 다른 모듈을 불러오지 않습니다. */

export const roundUp = (x, step = 100) => Math.ceil(x / step - 1e-9) * step;

/* 파이썬 round()처럼 .5는 짝수 쪽으로 (서버가 돌려주는 정수와 맞추기 위함) */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/* 소수 한 자리. toFixed는 이진수 값 그대로 반올림해서 파이썬 round(x, 1)과 같습니다. */
export const round1 = (x) => Number(x.toFixed(1));

/* 서버의 f"{x:g}" 와 같은 표시: 7.8 → '7.8', 2 → '2' */
export const fmtPct = (x) => String(Number(Number(x).toPrecision(6)));

export const effUnitCost = (unitPrice, yieldPct) => {
  const y = (yieldPct || 100) / 100;
  return y > 0 ? unitPrice / y : unitPrice;
};

export const basisPrice = (price, vatMode) => (vatMode === 'excl' ? price / 1.1 : price);

/* 양호 / 주의(목표+5%p 이내) / 위험 */
export function statusFor(ratio, target) {
  if (ratio == null) return 'unknown';
  if (ratio <= target + 1e-9) return 'good';
  if (ratio <= target + 5) return 'warn';
  return 'bad';
}

/* 메뉴 한 개의 원가. parts: [{ unitPrice(null이면 단가 없음), yieldPct, qty(기본 단위), est, low, high }] */
export function menuTotals(parts, other, price, vatMode, target) {
  let sum = 0;
  let lo = 0;
  let hi = 0;
  let estN = 0;
  let missing = 0;
  for (const p of parts) {
    if (p.est) estN += 1;
    if (p.unitPrice == null) { missing += 1; continue; }
    const u = effUnitCost(p.unitPrice, p.yieldPct);
    sum += p.qty * u;
    lo += (p.est && p.low != null ? p.low : p.qty) * u;
    hi += (p.est && p.high != null ? p.high : p.qty) * u;
  }
  const cost = sum + other;
  const basis = price > 0 ? basisPrice(price, vatMode) : 0;
  const ratio = basis > 0 ? (cost / basis) * 100 : null;
  const recommended = cost > 0 && target > 0 ? roundUp((cost / (target / 100)) * (vatMode === 'excl' ? 1.1 : 1)) : null;
  const out = {
    cost, basis, ratio, margin: basis > 0 ? basis - cost : null, status: statusFor(ratio, target), recommended,
    estimatedCount: estN, missing, costLow: null, costHigh: null, ratioLow: null, ratioHigh: null,
  };
  if (estN) {
    out.costLow = lo + other;
    out.costHigh = hi + other;
    if (basis > 0) {
      out.ratioLow = (out.costLow / basis) * 100;
      out.ratioHigh = (out.costHigh / basis) * 100;
    }
  }
  return out;
}

/* 서버가 주는 채널 항목(/api/channels)을 계산 함수가 받는 평평한 모양으로 */
export const flatChannel = (c) => ({
  key: c.key, short: c.short, label: c.label, kind: c.kind,
  fee_pct: c.state.fee_pct, pay_pct: c.state.pay_pct, delivery_fee: c.state.delivery_fee,
  coupon_cost: c.state.coupon_cost, pack_cost: c.state.pack_cost, vat_extra: c.state.vat_extra,
});

/* 배달앱 한 곳에서 팔 때의 한 건 손익.
   cost = 재료비 + 기타 원가, sale = 그 앱에서 받는 판매가.
   수수료·배달비는 앱이 '부가세 별도'로 안내하므로 vat_extra 이면 10%를 더해 비용으로 잡습니다.
   받는 돈 = 매출(부가세 반영) − 중개이용료 − 결제수수료 − 배달비 − 사장님 부담 쿠폰
   배달 원가율 = (재료비 + 포장비) ÷ 받는 돈 */
export function channelResult(cost, sale, ch, target, vatMode) {
  const vatExtra = ch.vat_extra === undefined ? true : !!ch.vat_extra;
  const k = vatMode === 'excl' ? 1.0 / 1.1 : 1.0;
  // 공급가 기준이면 수수료·배달비의 부가세는 매입세액으로 돌려받으므로 비용에서 뺀다. 쿠폰은 /1.1.
  const vatf = vatExtra && vatMode !== 'excl' ? 1.1 : 1.0;
  const feePct = Number(ch.fee_pct);
  const payPct = Number(ch.pay_pct);
  const feeAmt = (sale * feePct) / 100.0 * vatf;
  const payAmt = (sale * payPct) / 100.0 * vatf;
  const delivAmt = Number(ch.delivery_fee) * vatf;
  const coupon = Number(ch.coupon_cost) * k;
  const charges = feeAmt + payAmt + delivAmt + coupon;
  const totalCost = cost + Number(ch.pack_cost);

  const revenue = sale > 0 ? sale * k : null;
  const net = revenue !== null ? revenue - charges : null;
  const profit = net !== null ? net - totalCost : null;
  const ratio = net !== null && net > 0 ? (totalCost / net) * 100.0 : null;
  let status;
  if (sale <= 0) status = 'unknown';
  else if (ratio === null) status = 'bad'; // 받는 돈이 0 이하
  else status = statusFor(ratio, target);

  const a = ((feePct + payPct) / 100.0) * vatf;
  let recommended = null;
  if (totalCost > 0 && target > 0 && k - a > 1e-9) {
    recommended = roundUp((totalCost / (target / 100.0) + delivAmt + coupon) / (k - a));
  }

  const items = [];
  if (feeAmt) items.push({ label: `중개이용료 ${fmtPct(feePct)}%`, amount: roundHalfEven(feeAmt) });
  if (payAmt) items.push({ label: `결제수수료 ${fmtPct(payPct)}%`, amount: roundHalfEven(payAmt) });
  if (delivAmt) items.push({ label: '사장님 부담 배달비', amount: roundHalfEven(delivAmt) });
  if (coupon) items.push({ label: '쿠폰·할인 부담', amount: roundHalfEven(coupon) });
  return {
    key: ch.key,
    short: ch.short,
    label: ch.label,
    kind: ch.kind,
    sale_price: sale,
    charges: roundHalfEven(charges),
    fee_items: items,
    vat_extra: vatExtra,
    net: net !== null ? roundHalfEven(net) : null,
    cost: roundHalfEven(totalCost),
    profit: profit !== null ? roundHalfEven(profit) : null,
    net_ratio: ratio !== null ? round1(ratio) : null,
    status,
    recommended_price: recommended,
    price_gap: recommended !== null && sale > 0 ? recommended - sale : null,
    // 서버에는 없는 값: 반올림 전 원가율(막대·도장에 씁니다)
    ratio_raw: ratio,
    revenue,
  };
}

/* 손익분기·목표 매출 (서버 costing.breakeven 과 같은 식) */
export function breakeven(fixed, targetProfit, deliveryShare, cmStore, cmDelivery, avgPrice, openDays, payFeePct = 0) {
  const none = { cm: null, breakeven_sales: null, target_sales: null, daily_breakeven: null, daily_target: null, orders_breakeven: null, orders_target: null };
  if (cmStore == null) return none;
  const d = Math.min(Math.max(deliveryShare, 0), 100) / 100;
  const store = cmStore - payFeePct / 100;
  const deliv = cmDelivery == null ? store : cmDelivery;
  const cm = (1 - d) * store + d * deliv;
  if (cm <= 1e-9) return { ...none, cm };
  const be = fixed / cm;
  const tg = (fixed + targetProfit) / cm;
  const days = Math.max(1, Math.trunc(openDays));
  return {
    cm,
    breakeven_sales: roundHalfEven(be), target_sales: roundHalfEven(tg),
    daily_breakeven: roundHalfEven(be / days), daily_target: roundHalfEven(tg / days),
    orders_breakeven: avgPrice ? Math.ceil(be / avgPrice - 1e-9) : null,
    orders_target: avgPrice ? Math.ceil(tg / avgPrice - 1e-9) : null,
  };
}

/* 직원 한 명의 한 달 급여 (서버 app/labor.py monthly_pay 와 같은 식. 법 출처·갱신 방법은 그 파일 주석 참고)
   기본급 = 시급 x 주 시간 x (365/12/7)주, 주휴수당 = 주 15시간 이상이면 min(주 시간, 40)/40 x 8시간 x 시급 x (365/12/7)주 */
export const WEEKS_PER_MONTH = 365 / 12 / 7;
export function laborMonth(hourlyWage, weeklyHours, nightHours = 0, fivePlus = false) {
  const wage = Math.max(0, Number(hourlyWage) || 0);
  const hours = Math.max(0, Number(weeklyHours) || 0);
  const night = Math.min(Math.max(0, Number(nightHours) || 0), hours);
  const eligible = hours >= 15 - 1e-9;
  const holidayHours = eligible ? (Math.min(hours, 40) / 40) * 8 : 0;
  const base = roundHalfEven(wage * hours * WEEKS_PER_MONTH);
  const holiday = roundHalfEven(wage * holidayHours * WEEKS_PER_MONTH);
  const nightPay = fivePlus ? roundHalfEven(wage * night * 0.5 * WEEKS_PER_MONTH) : 0;
  return {
    base, holiday, night: nightPay, total: base + holiday + nightPay, eligible,
    holiday_hours_week: Math.round(holidayHours * 100) / 100, over_40: hours > 40 + 1e-9,
    night_hours_week: Math.round(night * 100) / 100, night_applied: fivePlus && night > 0,
  };
}
