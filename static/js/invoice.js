/* 거래명세서: 사진 올리기 → 읽은 내용 확인 → 단가 반영 */
import {
  h, api, app, numInput, selectOf, parseNum, n0, n3, nPrice, openDialog, busy, toast, errMsg, UNIT, UI_UNITS, ALL_UNITS,
  DISPLAY, KIND_HINT, icon, refreshMe, ymd, refreshRoute, fill, MARKET_ENABLED,
} from './core.js';
import { chg, num, emptyBlock } from './ui.js';

const MAX_BYTES = 12 * 1024 * 1024;

export async function render(box) {
  const [ingRes, invRes] = await Promise.all([api('/api/ingredients'), api('/api/invoices')]);
  const ings = ingRes.items;
  const ingById = new Map(ings.map((i) => [i.id, i]));
  const canWrite = app.me.plan.writable;
  const stage = h('div');
  box.append(h('div', { class: 'page-h' }, h('h1', null, '거래명세서')), stage);

  /* ---------------- 1. 사진 고르기 ---------------- */
  function showPick() {
    const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const album = h('input', { type: 'file', accept: 'image/*', hidden: true });
    for (const inp of [camera, album]) {
      inp.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) handleFile(f); });
    }
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const u = app.me.usage;
    const usageLine = u.ocr_enabled
      ? h('div', null, h('p', { class: 'small muted' }, `이번 달 자동 인식 ${u.ocr_used} / ${u.ocr_limit}회 사용 (요리 사진 인식과 같은 횟수를 씁니다)`),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.min(100, (u.ocr_used / Math.max(1, u.ocr_limit)) * 100)}%` } })))
      : h('p', { class: 'small muted' }, '지금은 예시 명세서로 체험하는 중입니다. 사진을 올리면 예시 결과가 나오고 횟수는 차감되지 않습니다.');

    fill(stage, 
      h('section', { class: 'sheet' },
        h('div', { class: 'drop' },
          icon('receipt', 40),
          h('p', null, '납품받은 거래명세서를 사진으로 올리면 품목·규격·단가를 읽어 옵니다. 읽은 내용을 확인한 다음에 반영됩니다.'),
          h('div', { class: 'btn-row', style: 'justify-content:center' },
            touch ? h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => camera.click() }, icon('camera', 20), '사진 찍기') : null,
            h('button', { class: touch ? 'btn ghost' : 'btn', type: 'button', disabled: !canWrite, onclick: () => album.click() }, icon('image', 20), touch ? '앨범에서 고르기' : '사진 고르기'),
            camera, album)),
        h('div', { style: 'margin-top:12px' }, usageLine),
        !canWrite ? h('p', { class: 'hint', style: 'margin-top:8px' }, '체험 기간이 끝나 지금은 올릴 수 없습니다.') : null),
      invRes.items.length
        ? h('section', { class: 'sheet', style: 'margin-top:16px' },
          h('div', { class: 'sheet-h' }, h('h2', null, '반영한 명세서')),
          h('ul', { class: 'rows' }, invRes.items.map((v) => h('li', null, h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, v.supplier || '거래처 미입력'),
              h('div', { class: 'row-sub' }, `${ymd(v.invoice_date || v.created_at)} · ${v.line_count}개 품목`)),
            v.total ? num(n0(v.total), '원') : null)))))
        : null);
  }

  /* ---------------- 2. 읽는 중 ---------------- */
  async function handleFile(file) {
    if (file.size > MAX_BYTES) { toast('사진 용량이 너무 큽니다(12MB 이하).', 'err'); return; }
    const url = URL.createObjectURL(file);
    fill(stage, h('section', { class: 'sheet' }, h('div', { class: 'reading', role: 'status' },
      h('img', { class: 'thumb', src: url, alt: '올린 거래명세서', style: 'cursor:default' }),
      h('p', null, '명세서를 읽는 중입니다. 잠시만 기다려 주세요.'),
      h('div', { class: 'progress' }))));
    try {
      const form = new FormData();
      form.append('file', file);
      const parsed = await api('/api/invoices/parse', { method: 'POST', form });
      refreshMe().catch(() => {});
      showReview(parsed, url);
    } catch (e) {
      URL.revokeObjectURL(url);
      fill(stage, h('section', { class: 'sheet' }, emptyBlock({
        title: '읽지 못했습니다', text: errMsg(e),
        actions: [h('button', { class: 'btn', type: 'button', onclick: showPick }, '다시 올리기')],
      })));
    }
  }

  /* ---------------- 3. 확인·수정 ---------------- */
  function showReview(parsed, url) {
    const cards = parsed.lines.map(lineCard);
    const submit = h('button', { class: 'btn', type: 'button' });
    const supplier = h('input', { class: 'input', type: 'text', maxLength: 60, value: parsed.supplier ?? '', 'aria-label': '거래처' });
    const date = h('input', { class: 'input', type: 'date', value: parsed.invoice_date ?? '', 'aria-label': '명세서 날짜' });
    const linked = parsed.lines.filter((l) => l.match).length;

    const refreshCount = () => {
      const n = cards.filter((c) => c.on()).length;
      submit.textContent = n ? `${n}개 품목 반영하기` : '반영할 품목을 고르세요';
      submit.disabled = n === 0 || !canWrite;
    };
    for (const c of cards) c.onChange = refreshCount;
    refreshCount();

    submit.addEventListener('click', () => busy(submit, async () => {
      const lines = [];
      for (const c of cards) {
        if (!c.on()) continue;
        const bad = c.problem();
        if (bad) { c.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast(bad, 'err'); return; }
        lines.push(c.payload());
      }
      const res = await api('/api/invoices/confirm', {
        method: 'POST',
        body: { supplier: supplier.value.trim(), invoice_date: date.value || null, total: parsed.total, lines },
      });
      URL.revokeObjectURL(url);
      refreshMe().catch(() => {});
      showDone(res);
    }));

    fill(stage, 
      parsed.demo ? h('div', { class: 'banner info', role: 'status' }, h('div', null, h('b', null, '예시 명세서입니다. '), '자동 인식이 아직 설정되지 않아 올린 사진 대신 예시 결과를 보여 드립니다. 반영하면 실제로 저장됩니다.')) : null,
      h('section', { class: 'sheet' },
        h('div', { class: 'review-top' },
          h('img', { class: 'thumb', src: url, alt: '올린 거래명세서(크게 보려면 누르세요)', tabindex: 0, role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
            onclick: () => openDialog({ title: '올린 사진', wide: true, content: h('img', { class: 'zoom', src: url, alt: '올린 거래명세서' }) }) }),
          h('div', { style: 'flex:1;min-width:0' },
            h('p', { class: 'small' }, `${parsed.lines.length}개 품목을 읽었습니다. ${linked}개는 기존 식자재와 연결했고, 나머지는 새 식자재로 등록합니다.`),
            h('p', { class: 'xs muted', style: 'margin-top:4px' }, '사진과 비교해서 규격과 가격이 맞는지 확인하세요.'))),
        h('div', { class: 'two', style: 'margin-top:12px' },
          h('div', { class: 'field' }, h('label', { class: 'lbl' }, '거래처'), supplier),
          h('div', { class: 'field' }, h('label', { class: 'lbl' }, '날짜'), date))),
      h('section', { class: 'sheet', style: 'margin-top:16px' },
        h('div', { class: 'sheet-h' }, h('h2', null, '품목')),
        parsed.lines.length ? cards.map((c) => c.el) : h('p', { class: 'small muted' }, '읽은 품목이 없습니다. 사진이 흐리거나 명세서가 아닐 수 있습니다.')),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, submit,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { URL.revokeObjectURL(url); showPick(); } }, '다른 사진 올리기')));
  }

  function lineCard(line) {
    const matched = line.match ? ingById.get(line.match.id) : null;
    const complete = line.pack_size > 0 && line.pack_unit && line.pack_price > 0;
    const chk = h('input', { type: 'checkbox', checked: complete, 'aria-label': `${line.name} 반영` });
    const link = selectOf([['new', '새 식자재로 추가'], ...ings.map((i) => [String(i.id), i.name])], matched ? String(matched.id) : 'new', { 'aria-label': '연결할 식자재' });
    const newName = h('input', { class: 'input', type: 'text', maxLength: 60, value: line.name.slice(0, 60), 'aria-label': '새 식자재 이름' });
    const size = numInput({ value: line.pack_size ? n3(line.pack_size) : '', 'aria-label': '구매 수량' });
    const unit = selectOf(ALL_UNITS, line.pack_unit ?? 'kg', { 'aria-label': '단위' });
    const price = numInput({ value: line.pack_price ? n3(line.pack_price) : '', 'aria-label': '구매 가격' });
    const origin = h('input', { class: 'input', type: 'text', maxLength: 10, autocomplete: 'off', value: line.origin ?? '', 'aria-label': '원산지' });
    const grade = h('input', { class: 'input', type: 'text', maxLength: 10, autocomplete: 'off', value: line.grade ?? '', 'aria-label': '등급' });
    const cut = h('input', { class: 'input', type: 'text', maxLength: 40, autocomplete: 'off', value: line.cut ?? '', 'aria-label': '부위' });
    const delta = h('div', { class: 'delta', 'aria-live': 'polite' });
    const newRow = h('div', { class: 'inv-new' },
      h('label', { class: 'lbl xs', style: 'display:block;margin-bottom:3px' }, '새 식자재 이름'), newName,
      h('p', { class: 'hint', style: 'margin-top:4px' }, '이미 등록한 식자재라면 위에서 골라 주세요. 한 번 연결하면 다음부터 기억합니다.'));
    const hasAuto = !!(line.origin || line.grade || line.cut);
    const moreDetails = h('details', { class: 'more', style: 'margin-top:6px;padding-left:32px' },
      h('summary', null, hasAuto ? '원산지·등급·부위 (자동 인식됨, 확인/수정)' : '원산지·등급·부위 입력 (선택)'),
      h('div', { class: 'two keep', style: 'margin-top:8px' },
        h('label', { style: 'display:grid;gap:3px;font-size:0.75rem;font-weight:700;color:var(--ink-2)' }, '원산지', origin),
        h('label', { style: 'display:grid;gap:3px;font-size:0.75rem;font-weight:700;color:var(--ink-2)' }, '등급', grade)),
      h('label', { style: 'display:grid;gap:3px;font-size:0.75rem;font-weight:700;color:var(--ink-2);margin-top:8px' }, '부위', cut));
    if (hasAuto) moreDetails.open = true;

    const card = {
      el: null,
      onChange: () => {},
      on: () => chk.checked,
      target: () => (link.value === 'new' ? null : ingById.get(Number(link.value))),
      problem() {
        const s = parseNum(size.value);
        const p = parseNum(price.value);
        const ing = card.target();
        if (!ing && !newName.value.trim()) return `'${line.name}': 새 식자재 이름을 입력해 주세요.`;
        if (!(s > 0)) return `'${line.name}': 구매 수량을 입력해 주세요.`;
        if (!(p > 0)) return `'${line.name}': 구매 가격을 입력해 주세요.`;
        if (ing && UNIT[unit.value].kind !== ing.kind) return `'${line.name}': '${ing.name}'은(는) ${KIND_HINT[ing.kind]} 단위로 입력해야 합니다.`;
        return '';
      },
      payload() {
        const ing = card.target();
        return {
          apply: true, ingredient_id: ing ? ing.id : null, name: ing ? ing.name : newName.value.trim(), alias: line.name,
          pack_size: parseNum(size.value), pack_unit: unit.value, pack_price: parseNum(price.value),
          origin: origin.value.trim(), grade: grade.value.trim(), cut: cut.value.trim(),
        };
      },
    };

    const paint = () => {
      const on = chk.checked;
      card.el.classList.toggle('off', !on);
      newRow.hidden = link.value !== 'new';
      const s = parseNum(size.value);
      const p = parseNum(price.value);
      const ing = card.target();
      fill(delta);
      if (!(s > 0 && p > 0)) { delta.append('규격과 가격을 채워 주세요.'); return; }
      const u = UNIT[unit.value];
      const per = p / (s * u.f);
      const [du, df] = DISPLAY[u.kind];
      if (!ing) { delta.append('새로 등록합니다. 단가 ', h('b', { class: 'n' }, nPrice(per * df)), `원/${du}`); return; }
      if (u.kind !== ing.kind) { delta.append(h('span', { style: 'color:var(--red);font-weight:700' }, `${ing.name}은(는) ${KIND_HINT[ing.kind]} 단위로 입력해야 합니다.`)); return; }
      const pct = ing.unit_price ? (per / ing.unit_price - 1) * 100 : null;
      delta.append('현재 ', h('b', { class: 'n' }, nPrice(ing.display_price)), ' → ', h('b', { class: 'n' }, nPrice(per * df)), `원/${du} `, pct != null && Math.abs(pct) >= 0.05 ? chg(pct) : h('span', { class: 'xs muted' }, '변동 없음'));
    };
    const changed = () => { paint(); card.onChange(); };
    for (const el of [chk, link, unit]) el.addEventListener('change', changed);
    for (const el of [size, price, newName]) el.addEventListener('input', changed);

    card.el = h('div', { class: 'inv-line' },
      h('div', { class: 'inv-head' }, chk,
        h('div', { class: 't' }, h('b', null, line.name), line.spec_text ? h('span', { class: 'xs muted' }, ` · 명세서 규격 ${line.spec_text}`) : null,
          line.qty ? h('span', { class: 'xs muted' }, ` · ${n3(line.qty)}개 납품`) : null)),
      h('div', { class: 'inv-body' },
        h('label', { class: 'full' }, '연결할 식자재', link),
        h('label', null, '구매 수량', size),
        h('label', null, '단위', unit),
        h('label', { class: 'full' }, '구매 가격(원)', price)),
      newRow, delta, moreDetails);
    paint();
    return card;
  }

  /* ---------------- 4. 결과 ---------------- */
  function showDone(res) {
    const changed = res.updated.filter((u) => u.changed && !u.created);
    const created = res.updated.filter((u) => u.created);
    const offerLink = h('span');
    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '반영했습니다')),
        h('p', null, `${res.updated.length}개 품목 중 가격이 바뀐 것 ${changed.length}개, 새로 등록한 것 ${created.length}개입니다.`),
        res.affected_menus
          ? h('p', { style: 'margin-top:4px' }, `메뉴 ${res.affected_menus}개의 원가를 다시 계산했습니다.`)
          : null,
        h('ul', { class: 'rows', style: 'margin-top:10px' }, res.updated.map((u) => h('li', { class: 'done-row' },
          h('div', null, h('b', null, u.name), u.created ? h('span', { class: 'tag' }, '새로 등록') : null,
            u.prev_display_price != null && u.changed ? h('div', { class: 'was' }, `${nPrice(u.prev_display_price)}원/${u.unit}`) : null),
          h('div', { class: 'row-end' }, num(nPrice(u.display_price), `원/${u.unit}`), u.changed && !u.created ? chg(u.change_pct) : (u.created ? null : h('span', { class: 'xs muted' }, '변동 없음')))))),
        offerLink,
        h('div', { class: 'btn-row', style: 'margin-top:16px' },
          h('a', { class: 'btn', href: '#/' }, '원가 알림 보기'),
          h('a', { class: 'btn ghost', href: '#/menus' }, '메뉴 원가율 보기'),
          h('button', { class: 'btn ghost', type: 'button', onclick: refreshRoute }, '다른 명세서 올리기'))));
    window.scrollTo(0, 0);
    // 명세서를 반영하면서 평균 매입가가 갱신되어, 더 싼 도매 제안이 새로 떴을 수 있습니다.
    if (MARKET_ENABLED) api('/api/market/offers').then(({ unread }) => {
      if (unread > 0) fill(offerLink, h('p', { class: 'note-warn', role: 'status', style: 'margin-top:12px' },
        h('a', { href: '#/market/offers' }, `더 싼 제안 ${unread}건 보기`)));
    }).catch(() => {});
  }

  showPick();
}
