/* 안내 글 /guide/cost-calculator 의 원가계산기. 가입 없이 브라우저 안에서만 계산하고 아무것도 서버로 보내지 않는다.
   첫 화면의 숫자는 HTML에 미리 적어 두었다(자바스크립트를 실행하지 않는 검색엔진도 읽도록). */
(() => {
  const form = document.getElementById('calc');
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const rows = $('rows');
  const num = (el) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : 0; };
  const won = (v) => `${Math.round(v).toLocaleString('ko-KR')}원`;

  function rowCost(tr) {
    const [, price, qty, yld, use] = tr.querySelectorAll('input');
    const q = num(qty), y = num(yld) || 100;
    if (q <= 0) return 0;
    return (num(price) / q) * num(use) / (Math.min(Math.max(y, 1), 100) / 100);
  }

  function update() {
    let cost = 0;
    for (const tr of rows.querySelectorAll('tr.ing')) {
      const c = rowCost(tr);
      cost += c;
      tr.querySelector('.cost').textContent = won(c);
    }
    const price = num($('price'));
    const vat = $('vat').checked ? 1.1 : 1;
    const base = price / vat; // 원가율·남는 돈은 공급가 기준(부가세 포함일 때)
    const target = num($('target')) / 100;
    const rate = base > 0 ? (cost / base) * 100 : 0;
    const margin = base - cost;

    $('rCost').textContent = won(cost);
    $('rRate').textContent = base > 0 ? `${rate.toFixed(1)}%` : '-';
    $('rRateBox').classList.toggle('warn', target > 0 && rate > target * 100);
    $('rMargin').textContent = won(margin);
    $('rSuggest').textContent = target > 0 ? won((cost / target) * vat) : '-';

    const f = (num($('dFee')) + num($('dPay'))) / 100;
    const ship = num($('dShip'));
    $('rDel').textContent = won(base - price * f - ship - cost);
    const k = 1 / vat - f;
    $('rDelPrice').textContent = k > 0 ? won((margin + ship + cost) / k) : '-';
  }

  function addRow() {
    const tr = rows.querySelector('tr.ing').cloneNode(true);
    const ins = tr.querySelectorAll('input');
    ins[0].value = ''; ins[1].value = ''; ins[2].value = ''; ins[3].value = '100'; ins[4].value = '';
    rows.appendChild(tr);
    ins[0].focus();
    update();
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  $('add').addEventListener('click', addRow);
  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('.x');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (rows.querySelectorAll('tr.ing').length > 1) tr.remove();
    else tr.querySelectorAll('input').forEach((el, i) => { el.value = i === 3 ? '100' : ''; });
    update();
  });
  update();
})();
