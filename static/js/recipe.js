/* 사진으로 메뉴 만들기: 완성된 요리 사진 → 재료·양 추정 → 사장님 확인 → 메뉴 초안.
   사진만으로는 정확한 양을 알 수 없으므로, 모든 숫자에 '추정' 표시와 범위를 붙이고 사장님이 고치기 쉽게 보여 줍니다. */
import {
  h, api, app, field, numInput, comboSelect, parseNum, n0, n1, n3, busy, toast, errMsg, icon, refreshMe, fill, openDialog,
} from './core.js';
import { emptyBlock } from './ui.js';
import { menuTotals } from './calc.js';

const MAX_BYTES = 12 * 1024 * 1024;
const CONF = { high: ['확실', ''], medium: ['보통', ''], low: ['자신 없음', 'warn'] };

export async function render(box) {
  const ingRes = await api('/api/ingredients');
  const ings = ingRes.items;
  const ingById = new Map(ings.map((i) => [i.id, i]));
  const canWrite = app.me.plan.writable;
  const { target_cost_ratio: target, vat_mode: vat } = app.me.settings;
  const stage = h('div');
  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/menus' }, icon('back', 18), '메뉴 목록'),
      h('h1', { style: 'font-size:1.125rem' }, '사진으로 메뉴 만들기')),
    stage);

  /* ---------------- 1. 사진 고르기 ---------------- */
  function showPick() {
    const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const album = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const hint = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', placeholder: '예: 제육볶음 정식' });
    for (const inp of [camera, album]) {
      inp.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) handleFile(f, hint.value.trim()); });
    }
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const u = app.me.usage;
    const usageLine = u.ocr_enabled
      ? h('div', null,
        h('p', { class: 'small muted' }, `이번 달 사진 인식 ${u.ocr_used} / ${u.ocr_limit}회 사용 (거래명세서 인식과 같은 횟수를 씁니다)`),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.min(100, (u.ocr_used / Math.max(1, u.ocr_limit)) * 100)}%` } })))
      : h('p', { class: 'small muted' }, '사진 자동 인식이 꺼져 있습니다. 사진을 올리면 예시 레시피가 나오고 횟수는 차감되지 않습니다.');

    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'drop' },
          icon('camera', 40),
          h('p', null, '완성된 요리를 위에서 찍어 올리세요. 어떤 재료가 얼마나 들어갔을지 짐작해서 메뉴 초안을 만들어 드립니다. 몇 g씩 들어가는지 몰라도 괜찮습니다.'),
          h('div', { class: 'field', style: 'width:min(360px,100%);text-align:left;margin:0' },
            h('label', { for: 'dish-hint' }, '메뉴 이름 (선택)'), (hint.id = 'dish-hint', hint),
            h('p', { class: 'hint' }, '이름을 알려 주면 더 잘 짐작합니다.')),
          h('div', { class: 'btn-row', style: 'justify-content:center' },
            touch ? h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => camera.click() }, icon('camera', 20), '사진 찍기') : null,
            h('button', { class: touch ? 'btn ghost' : 'btn', type: 'button', disabled: !canWrite, onclick: () => album.click() }, icon('image', 20), touch ? '앨범에서 고르기' : '사진 고르기'),
            camera, album)),
        h('ul', { class: 'plain tips' },
          h('li', null, '한 사람이 먹는 한 그릇(1인분)이 보이게 찍어 주세요.'),
          h('li', null, '그릇 전체가 나오게, 밝은 곳에서 위쪽에서 찍으면 가장 잘 맞습니다.'),
          h('li', null, '국물·소스 속 재료나 양념은 보이지 않아서, 보통 들어가는 양으로 짐작합니다.')),
        h('div', { style: 'margin-top:12px' }, usageLine),
        !canWrite ? h('p', { class: 'hint', style: 'margin-top:8px' }, '지금은 올릴 수 없습니다.') : null,
        h('p', { class: 'hint', style: 'margin-top:10px' }, '사진 없이 만들려면 ', h('a', { href: '#/menus/new' }, '직접 입력'), '하거나 ', h('a', { href: '#/import' }, '엑셀·다른 앱에서 가져오세요'), '.')));
  }

  /* ---------------- 2. 읽는 중 ---------------- */
  async function handleFile(file, hintText) {
    if (file.size > MAX_BYTES) { toast('사진 용량이 너무 큽니다(12MB 이하).', 'err'); return; }
    const url = URL.createObjectURL(file);
    fill(stage, h('section', { class: 'sheet' }, h('div', { class: 'reading', role: 'status' },
      h('img', { class: 'thumb', src: url, alt: '올린 요리 사진', style: 'cursor:default' }),
      h('p', null, '요리 사진을 보고 재료와 양을 짐작하는 중입니다. 잠시만 기다려 주세요.'),
      h('div', { class: 'progress' }))));
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', hintText);
      const est = await api('/api/recipe/estimate', { method: 'POST', form });
      refreshMe().catch(() => {});
      showReview(est, url, hintText);
    } catch (e) {
      URL.revokeObjectURL(url);
      fill(stage, h('section', { class: 'sheet' }, emptyBlock({
        title: '재료를 짐작하지 못했습니다', text: errMsg(e),
        actions: [h('button', { class: 'btn', type: 'button', onclick: showPick }, '다시 올리기'), h('a', { class: 'btn ghost', href: '#/menus/new' }, '직접 입력하기')],
      })));
    }
  }

  /* ---------------- 3. 확인·수정 ---------------- */
  function showReview(est, url, hintText) {
    const cards = est.lines.map(lineCard);
    const name = h('input', { class: 'input', type: 'text', maxLength: 60, autocomplete: 'off', value: (est.dish_name || hintText || '').slice(0, 60) });
    const price = numInput({ placeholder: '예: 9,500' });
    const category = h('input', { class: 'input', type: 'text', maxLength: 30, autocomplete: 'off', placeholder: '예: 볶음, 찌개' });
    const submit = h('button', { class: 'btn', type: 'button' });
    const totals = h('p', { class: 'small', 'aria-live': 'polite' });

    const refresh = () => {
      const on = cards.filter((c) => c.on());
      submit.textContent = on.length ? `재료 ${on.length}개로 메뉴 초안 만들기` : '넣을 재료를 고르세요';
      submit.disabled = on.length === 0 || !canWrite;
      const parts = on.map((c) => c.part());
      const t = menuTotals(parts, 0, parseNum(price.value), vat, target);
      const priced = parts.length - t.missing;
      const bits = [];
      if (!parts.length) bits.push('넣을 재료를 고르면 원가를 계산합니다.');
      else if (priced === 0) bits.push('단가를 아는 재료가 아직 없어 재료비는 계산하지 못합니다. 메뉴를 만든 뒤 거래명세서를 올리면 단가가 채워집니다.');
      else {
        bits.push(`단가를 아는 재료 ${priced}개만 더하면 재료비는 약 ${n0(t.cost)}원`);
        if (t.costLow != null && Math.round(t.costLow) !== Math.round(t.costHigh)) bits[0] += ` (${n0(t.costLow)}~${n0(t.costHigh)}원)`;
        bits[0] += '입니다.';
        if (t.missing) bits.push(`단가가 없는 재료 ${t.missing}개는 아직 빠져 있어서 실제 재료비는 더 높습니다.`);
        if (t.ratio != null) {
          bits.push(`판매가 ${n0(parseNum(price.value))}원이면 원가율은 약 ${n1(t.ratio)}%${t.ratioLow != null ? ` (${n1(t.ratioLow)}~${n1(t.ratioHigh)}%)` : ''}${t.missing ? ' 이상' : ''}입니다.`);
        } else bits.push('판매가를 넣으면 원가율도 보여 드립니다.');
      }
      totals.textContent = bits.join(' ');
    };
    for (const c of cards) c.onChange = refresh;
    price.addEventListener('input', refresh);
    refresh();

    const saveKey = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    submit.addEventListener('click', () => busy(submit, async () => {
      if (!name.value.trim()) { name.focus(); toast('메뉴 이름을 입력해 주세요.', 'err'); return; }
      const lines = [];
      for (const c of cards) {
        if (!c.on()) continue;
        const bad = c.problem();
        if (bad) { c.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast(bad, 'err'); return; }
        lines.push(c.payload());
      }
      const res = await api('/api/recipe/confirm', {
        method: 'POST', key: saveKey,
        body: { name: name.value.trim(), price: parseNum(price.value) || 0, category: category.value.trim(), lines },
      });
      URL.revokeObjectURL(url);
      showDone(res);
    }));

    const visible = cards.filter((c) => c.line.visible);
    const hidden = cards.filter((c) => !c.line.visible);
    fill(stage,
      est.demo ? h('div', { class: 'banner info', role: 'status' }, h('div', null, h('b', null, '예시 결과입니다. '), '자동 인식이 아직 설정되지 않아 올린 사진 대신 예시 레시피를 보여 드립니다. 만들면 실제로 저장됩니다.')) : null,
      est.reference && est.reference.used
        ? h('div', { class: 'banner info', role: 'note' }, h('div', null, h('b', null, '공공 레시피를 참고했습니다. '), `비슷한 요리(${est.reference.names.slice(0, 2).join(', ')})의 실제 레시피로 양을 맞췄습니다.`))
        : null,
      h('div', { class: 'banner info', role: 'note' }, h('div', null, h('b', null, '사진으로 짐작한 양입니다. '),
        '정확한 레시피가 아니라 출발점입니다. 틀린 곳만 고치고 나머지는 그대로 두세요. 나중에 저울로 재 보고 고치면 됩니다. 모든 숫자에는 범위가 함께 붙습니다.')),
      h('section', { class: 'sheet' },
        h('div', { class: 'review-top' },
          h('img', { class: 'thumb', src: url, alt: '올린 요리 사진(크게 보려면 누르세요)', tabindex: 0, role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
            onclick: () => openDialog({ title: '올린 사진', wide: true, content: h('img', { class: 'zoom', src: url, alt: '올린 요리 사진' }) }) }),
          h('div', { style: 'flex:1;min-width:0' },
            h('p', { class: 'small' }, `재료 ${est.lines.length}개를 짐작했습니다.`),
            est.serving_note ? h('p', { class: 'xs muted', style: 'margin-top:4px' }, `기준: ${est.serving_note}`) : null)),
        h('div', { class: 'two keep', style: 'margin-top:12px' },
          field('메뉴 이름', name),
          field('판매가 (원)', price, '나중에 넣어도 됩니다.')),
        field('분류 (선택)', category)),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '재료와 양'), h('span', { class: 'sub' }, '1인분 기준 · 추정')),
        visible.length ? [h('h3', { class: 'h-sec' }, '사진에서 보이는 재료'), visible.map((c) => c.el)] : null,
        hidden.length ? [h('h3', { class: 'h-sec' }, '보이지 않지만 보통 들어가는 재료 (양념·육수·기름 등)'), hidden.map((c) => c.el)] : null,
        h('div', { class: 'preview', style: 'margin-top:14px' }, totals)),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, submit,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { URL.revokeObjectURL(url); showPick(); } }, '다른 사진 올리기')));
    window.scrollTo(0, 0);
  }

  function lineCard(line) {
    const sameKind = ings.filter((i) => i.kind === line.kind);
    const matched = line.match ? ingById.get(line.match.id) : null;
    const chk = h('input', { type: 'checkbox', checked: true, 'aria-label': `${line.name} 넣기` });
    const link = comboSelect(
      [['new', '새 식자재로 추가'], ...sameKind.map((i) => [String(i.id), i.unit_price == null ? `${i.name} (단가 없음)` : i.name])],
      matched ? String(matched.id) : 'new', { placeholder: '식자재 이름으로 찾기', 'aria-label': '연결할 식자재' });
    const newName = h('input', { class: 'input', type: 'text', maxLength: 60, value: line.name.slice(0, 60), 'aria-label': '새 식자재 이름' });
    const qty = numInput({ value: n3(line.qty), 'aria-label': `${line.name} 사용량(${line.unit})` });
    const rangeText = h('span', { class: 'xs muted' });
    const costText = h('div', { class: 'delta', 'aria-live': 'polite' });
    const newRow = h('div', { class: 'inv-new' },
      h('label', { class: 'lbl xs', style: 'display:block;margin-bottom:3px' }, '새 식자재 이름'), newName,
      h('p', { class: 'hint', style: 'margin-top:4px' }, '이미 등록한 식자재라면 위에서 골라 주세요. 한 번 연결하면 다음부터 기억합니다. 새로 만들면 단가 없이 등록되고, 거래명세서를 올리면 단가가 채워집니다.'));
    const [confLabel, confCls] = CONF[line.confidence] || CONF.medium;

    const card = {
      line,
      el: null,
      onChange: () => {},
      on: () => chk.checked,
      target: () => (link.value === 'new' ? null : ingById.get(Number(link.value))),
      value: () => parseNum(qty.value),
      edited: () => Math.abs((parseNum(qty.value) || 0) - line.qty) > 1e-9,
      range() {
        const q = card.value();
        if (card.edited() || !(q > 0)) return [null, null];
        return [q * (line.qty_low / line.qty), q * (line.qty_high / line.qty)];
      },
      part() {
        const ing = card.target();
        const q = card.value() || 0;
        const [lo, hi] = card.range();
        return { unitPrice: ing ? ing.unit_price : null, yieldPct: ing ? ing.yield_pct : 100, qty: q, est: !card.edited(), low: lo, high: hi };
      },
      problem() {
        const ing = card.target();
        if (!ing && !newName.value.trim()) return `'${line.name}': 새 식자재 이름을 입력해 주세요.`;
        if (!(card.value() > 0)) return `'${line.name}': 사용량을 입력해 주세요. 넣지 않을 재료는 체크를 풀어 주세요.`;
        return '';
      },
      payload() {
        const ing = card.target();
        const q = card.value();
        const [lo, hi] = card.range();
        const est = !card.edited();
        return {
          apply: true, ingredient_id: ing ? ing.id : null, name: ing ? ing.name : newName.value.trim(), alias: line.name,
          qty: q, unit: line.unit, estimated: est, qty_low: est ? lo : null, qty_high: est ? hi : null,
        };
      },
    };

    const paint = () => {
      card.el.classList.toggle('off', !chk.checked);
      newRow.hidden = link.value !== 'new';
      const q = card.value();
      const [lo, hi] = card.range();
      fill(rangeText, card.edited() || !(q > 0) ? (q > 0 ? '직접 고친 양 (추정 표시 없음)' : '') : `범위 ${n3(lo)}~${n3(hi)}${line.unit}`);
      const ing = card.target();
      fill(costText);
      if (!(q > 0)) { costText.append('사용량을 입력해 주세요.'); return; }
      if (!ing) { costText.append('새로 등록합니다. 단가가 없어 이 재료는 아직 원가에 들어가지 않습니다.'); return; }
      if (ing.unit_price == null) { costText.append(`'${ing.name}'은(는) 단가가 없어 아직 원가에 들어가지 않습니다.`); return; }
      const unitCost = ing.unit_price / ((ing.yield_pct || 100) / 100);
      const c = q * unitCost;
      costText.append('예상 재료비 ', h('b', { class: 'n' }, n0(c)), '원');
      if (lo != null && Math.round(lo * unitCost) !== Math.round(hi * unitCost)) costText.append(` (${n0(lo * unitCost)}~${n0(hi * unitCost)}원)`);
    };
    const changed = () => { paint(); card.onChange(); };
    for (const el of [chk, link]) el.addEventListener('change', changed);
    qty.addEventListener('input', changed);

    card.el = h('div', { class: 'inv-line' },
      h('div', { class: 'inv-head' }, chk,
        h('div', { class: 't' }, h('b', null, line.name),
          h('span', { class: `tag ${confCls}`.trim(), title: '이 재료와 양을 얼마나 믿을 수 있는지' }, `신뢰도 ${confLabel}`),
          line.note ? h('div', { class: 'xs muted' }, line.note) : null)),
      h('div', { class: 'inv-body est-body' },
        h('label', null, `사용량 (${line.unit})`, qty),
        h('div', { class: 'est-range' }, h('span', { class: 'tag est' }, '추정'), rangeText),
        h('label', { class: 'full' }, '연결할 식자재', link)),
      newRow, costText);
    paint();
    return card;
  }

  /* ---------------- 4. 결과 ---------------- */
  function showDone(res) {
    const m = res.item;
    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '메뉴 초안을 만들었습니다')),
        h('p', null, `'${m.name}' 메뉴에 재료 ${m.item_count}개를 넣었습니다.${res.created_ingredients ? ` 새 식자재 ${res.created_ingredients}개도 함께 등록했습니다.` : ''}`),
        res.unpriced
          ? h('div', { class: 'note-warn' }, h('b', null, `단가가 없는 재료 ${res.unpriced}개. `),
            '이 재료는 아직 원가에 들어가지 않아 지금의 원가율은 실제보다 낮게 나옵니다. 거래명세서를 올리면 이름이 같은 재료의 단가가 자동으로 채워집니다.')
          : null,
        m.cost_ratio != null
          ? h('p', { style: 'margin-top:10px' }, '지금 계산된 원가율은 ', h('b', { class: 'n' }, n1(m.cost_ratio)), '%',
            m.ratio_low != null ? ` (추정 범위 ${n1(m.ratio_low)}~${n1(m.ratio_high)}%)` : '', '입니다.')
          : h('p', { class: 'small muted', style: 'margin-top:10px' }, '판매가를 넣으면 원가율이 계산됩니다.'),
        h('p', { class: 'small muted', style: 'margin-top:10px' }, '메뉴 화면에서 재료마다 \'이 양으로 확정\'을 누르거나 양을 고치면 추정 표시가 사라집니다.'),
        h('div', { class: 'btn-row', style: 'margin-top:16px' },
          h('a', { class: 'btn', href: `#/menus/${m.id}` }, '메뉴 열어서 확인하기'),
          res.unpriced ? h('a', { class: 'btn ghost', href: '#/invoice' }, '거래명세서로 단가 채우기') : null,
          res.unpriced ? h('a', { class: 'btn ghost', href: '#/ingredients' }, '단가 직접 입력') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: showPick }, '다른 요리 사진 올리기'))));
    window.scrollTo(0, 0);
  }

  showPick();
}
