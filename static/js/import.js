/* 다른 앱·엑셀에서 가져오기: 파일 올리기 → 칸 맞추기 → 미리보기 → 저장.
   올린 파일은 서버에 저장하지 않습니다. 미리보기에서 사장님이 확인한 내용만 저장합니다. */
import { h, api, app, field, selectOf, n0, n3, nPrice, busy, toast, errMsg, icon, fill } from './core.js';
import { chg, emptyBlock } from './ui.js';

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 100;
const KIND_LABEL = { ingredients: '식자재 단가 목록', menus: '메뉴·레시피' };
const ACTION_TAG = {
  create: ['새로 등록', 'ok'], update: ['바뀜', 'warn'], same: ['변동 없음', ''], skip: ['건너뜀', ''], error: ['읽지 못함', 'bad'],
};

export async function render(box) {
  const canWrite = app.me.plan.writable;
  const stage = h('div');
  box.append(
    h('div', { class: 'page-h' },
      h('a', { class: 'btn ghost sm', href: '#/settings' }, icon('back', 18), '설정'),
      h('h1', { style: 'font-size:1.125rem' }, '다른 앱·엑셀에서 가져오기')),
    stage);

  const S = { file: null, parsed: null, si: 0, kind: 'ingredients', headerRow: 1, mapping: {}, onConflict: 'update' };

  /* ---------------- 1. 파일 고르기 ---------------- */
  function showStart() {
    const pick = h('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt', hidden: true });
    pick.addEventListener('change', () => { const f = pick.files[0]; pick.value = ''; if (f) readFile(f); });
    const zone = h('div', { class: 'drop' },
      icon('download', 40),
      h('p', null, '쓰던 앱이나 엑셀에서 내려받은 파일(.xlsx, .csv)을 올리세요. 제목 줄을 읽어 칸을 자동으로 맞추고, 옮기기 전에 미리 보여 드립니다.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' },
        h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => pick.click() }, icon('image', 20), '파일 고르기'), pick));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f && canWrite) readFile(f);
    });
    fill(stage,
      h('section', { class: 'sheet' },
        zone,
        !canWrite ? h('p', { class: 'hint', style: 'margin-top:8px' }, '체험 기간이 끝나 지금은 가져올 수 없습니다.') : null,
        h('ul', { class: 'plain tips' },
          h('li', null, '식자재 목록과 메뉴(레시피) 표를 모두 가져올 수 있습니다. 둘 다 있으면 식자재를 먼저, 메뉴를 그다음에 가져오세요. 메뉴의 재료 이름이 식자재와 같으면 저절로 이어집니다.'),
          h('li', null, '.xlsx와 .csv 파일을 읽습니다. 구형 엑셀(.xls)이라면 .xlsx로 다시 저장해서 올려 주세요. 용량은 5MB까지이고, 올린 파일은 서버에 저장하지 않습니다.'),
          h('li', null, '앱마다 내려받는 파일의 모양이 달라서, 제목 줄을 보고 칸을 짐작합니다. 틀리면 다음 화면에서 직접 바꿀 수 있습니다.'),
          h('li', null, '가격이 없는 식자재도 가져올 수 있습니다. \'단가 없음\'으로 등록되고, 거래명세서를 올리면 채워집니다.'))),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '파일이 없다면')),
        h('p', { class: 'small muted' }, '빈 엑셀 양식을 내려받아 식자재와 메뉴를 적어 올릴 수 있습니다. (예시) 줄은 지우지 않고 올려도 무시합니다.'),
        h('div', { class: 'btn-row', style: 'margin-top:10px' },
          h('a', { class: 'btn ghost', href: '/api/import/template.xlsx', download: '' }, icon('download', 20), '엑셀 양식 내려받기'),
          h('a', { class: 'btn ghost', href: '#/ingredients' }, '식자재 직접 등록'),
          h('a', { class: 'btn ghost', href: '#/menus/photo' }, '요리 사진으로 메뉴 만들기'))));
  }

  /* ---------------- 2. 읽는 중 ---------------- */
  async function readFile(f, sheet = '', headerRow = 0) {
    if (f.size > MAX_BYTES) { toast('파일이 너무 큽니다(5MB 이하). 필요한 시트만 따로 저장해 올려 주세요.', 'err'); return; }
    fill(stage, h('section', { class: 'sheet' }, h('div', { class: 'reading', role: 'status' },
      h('p', null, `'${f.name}' 파일을 읽는 중입니다.`), h('div', { class: 'progress' }))));
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('sheet', sheet);
      form.append('header_row', String(headerRow));
      const res = await api('/api/import/parse', { method: 'POST', form });
      S.file = f;
      S.parsed = res;
      if (sheet) {
        S.si = Math.max(0, res.sheets.findIndex((s) => s.name === sheet));
      } else {
        const i = res.sheets.findIndex((s) => s.kind && s.row_count > 0);
        S.si = i >= 0 ? i : 0;
      }
      pickSheet(S.si);
      showMap();
    } catch (e) {
      fill(stage, h('section', { class: 'sheet' }, emptyBlock({
        title: '파일을 읽지 못했습니다', text: errMsg(e),
        actions: [h('button', { class: 'btn', type: 'button', onclick: showStart }, '다른 파일 고르기')],
      })));
    }
  }

  function pickSheet(i) {
    S.si = i;
    const sh = S.parsed.sheets[i];
    S.kind = sh.kind || S.kind || 'ingredients';
    S.headerRow = sh.header_row;
    S.mapping = { ...(sh.mappings[S.kind] || {}) };
  }

  /* ---------------- 3. 칸 맞추기 ---------------- */
  function showMap() {
    const sh = S.parsed.sheets[S.si];
    const fields = S.parsed.fields[S.kind];
    const need = fields.find((f) => f.required);
    const colLabel = (c) => `${c.title}${c.samples.length ? ` · 예: ${c.samples.slice(0, 2).join(', ')}` : ''}`;
    const summary = h('dl', { class: 'kv imp-sum', 'aria-label': '맞춘 칸' });
    const status = h('p', { class: 'small', 'aria-live': 'polite' });
    const previewBtn = h('button', { class: 'btn', type: 'button', disabled: !canWrite });

    const paintSummary = () => {
      const rows = fields.filter((f) => S.mapping[f.key] != null).map((f) => {
        const c = sh.columns[S.mapping[f.key]];
        return [h('dt', null, f.label), h('dd', null, c ? c.title : '')];
      });
      fill(summary, rows.length ? rows : h('dd', null, '맞춘 칸이 없습니다.'));
      const ok = S.mapping[need.key] != null;
      previewBtn.disabled = !ok || !canWrite;
      previewBtn.textContent = '미리보기';
      fill(status, ok ? `${sh.row_count}줄을 읽었습니다. 미리보기에서 옮기기 전에 확인할 수 있습니다.` : h('span', { style: 'color:var(--red);font-weight:700' }, `'${need.label}' 칸을 골라 주세요.`));
    };

    const mapBox = h('div', { class: 'imp-fields' }, fields.map((f) => {
      const sel = selectOf([['', '(사용 안 함)'], ...sh.columns.map((c) => [String(c.index), colLabel(c)])], S.mapping[f.key] != null ? String(S.mapping[f.key]) : '');
      sel.addEventListener('change', () => {
        if (sel.value === '') delete S.mapping[f.key]; else S.mapping[f.key] = Number(sel.value);
        paintSummary();
      });
      return field(f.required ? `${f.label} (필수)` : f.label, sel, f.hint || null);
    }));

    const header = h('input', { class: 'input num', type: 'text', inputmode: 'numeric', value: String(S.headerRow), 'aria-label': '제목 줄 번호' });
    const reread = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
      const n = Number(header.value);
      if (!Number.isInteger(n) || n < 1) { toast('제목 줄은 1 이상의 숫자로 적어 주세요.', 'err'); return; }
      readFile(S.file, sh.name, n);
    } }, '다시 읽기');

    const sheetChips = S.parsed.sheets.length > 1
      ? h('div', { class: 'chips', role: 'group', 'aria-label': '시트 고르기' }, S.parsed.sheets.map((s, i) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(i === S.si), onclick: () => { pickSheet(i); showMap(); } },
          `${s.name} (${s.row_count}줄${s.kind ? ` · ${s.kind === 'menus' ? '메뉴' : '식자재'}로 보임` : ''})`)))
      : null;

    const kindBox = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': '가져올 종류' }, Object.entries(KIND_LABEL).map(([k, label]) => {
      const inp = h('input', { type: 'radio', name: 'imp-kind', value: k, checked: S.kind === k });
      inp.addEventListener('change', () => { S.kind = k; S.mapping = { ...(sh.mappings[k] || {}) }; showMap(); });
      return h('label', { class: 'radio' }, inp, h('div', null, h('b', null, label),
        h('div', { class: 'xs muted' }, k === 'ingredients' ? '식자재 이름, 규격, 구매 가격(또는 kg당 단가)이 있는 표' : '메뉴 이름, 판매가, 재료와 사용량이 있는 표')));
    }));

    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, S.parsed.filename || '올린 파일'),
          h('button', { class: 'link-btn', type: 'button', onclick: showStart }, '다른 파일 고르기')),
        sheetChips,
        h('p', { class: 'small muted', style: 'margin-top:6px' }, `시트 '${sh.name}' · ${sh.row_count}줄${sh.truncated ? ' (앞의 3,000줄만 읽습니다)' : ''}`)),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '무엇을 가져올까요?')),
        kindBox),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '칸 맞추기'), h('span', { class: 'sub' }, '자동으로 맞췄습니다')),
        summary,
        h('div', { style: 'margin-top:8px' }, status),
        h('details', { class: 'more', open: S.mapping[need.key] == null },
          h('summary', null, '칸을 직접 고르기'),
          mapBox,
          h('div', { class: 'imp-header' },
            h('label', { class: 'lbl', for: (header.id = 'imp-hr') }, '제목 줄 번호'), header, reread,
            h('p', { class: 'hint' }, '표의 제목(식자재, 가격 …)이 적힌 줄이 맨 위가 아니면 그 줄 번호를 적고 다시 읽으세요.')))),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, previewBtn,
        h('button', { class: 'btn ghost', type: 'button', onclick: showStart }, '취소')));

    previewBtn.addEventListener('click', () => busy(previewBtn, runPreview));
    paintSummary();
  }

  /* ---------------- 4. 미리보기 ---------------- */
  async function runPreview() {
    const sh = S.parsed.sheets[S.si];
    const form = new FormData();
    form.append('file', S.file);
    form.append('sheet', sh.name);
    form.append('kind', S.kind);
    form.append('mapping', JSON.stringify(S.mapping));
    form.append('header_row', String(S.headerRow));
    const res = await api('/api/import/preview', { method: 'POST', form });
    showPreview(res);
  }

  function showPreview(res) {
    const isIng = res.kind === 'ingredients';
    const recs = res.records;
    for (const r of recs) r._on = r.ok && !r.recent_conflict;
    let filter = 'all';
    let shown = PAGE;
    const list = h('ul', { class: 'rows' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '보기 거르기' });
    const more = h('div', { style: 'margin-top:10px' });
    const submit = h('button', { class: 'btn', type: 'button' });

    const problem = (r) => !r.ok || (r.warn && r.warn.length) || (!isIng && r.lines.some((l) => l.suggest));
    const FILTERS = [
      ['all', '전체', () => true],
      ['create', '새로 등록', (r) => r.ok && r.action === 'create'],
      ['update', '바뀌는 것', (r) => r.ok && r.action === 'update'],
      ['problem', '확인 필요', problem],
    ];
    const selected = () => recs.filter((r) => r.ok && r._on);
    function refreshSubmit() {
      const n = selected().length;
      submit.textContent = n ? `${n}개 가져오기` : '가져올 항목을 고르세요';
      submit.disabled = n === 0 || !canWrite;
    }

    function paint() {
      const pass = FILTERS.find((f) => f[0] === filter)[2];
      const rows = recs.filter(pass);
      list.replaceChildren(...rows.slice(0, shown).map((r) => (isIng ? ingRow(r) : menuRow(r))));
      chips.replaceChildren(...FILTERS.map(([k, label, fn]) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; shown = PAGE; paint(); } }, `${label} ${recs.filter(fn).length}`)));
      fill(more, rows.length > shown ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { shown += PAGE; paint(); } }, `더 보기 (${rows.length - shown}개 남음)`) : null,
        !rows.length ? h('p', { class: 'small muted' }, '해당하는 항목이 없습니다.') : null);
      refreshSubmit();
    }

    function ingRow(r) {
      const [tagText, tagCls] = ACTION_TAG[r.ok ? r.action : (r.dup ? 'skip' : 'error')];
      const chk = h('input', { type: 'checkbox', checked: r._on, disabled: !r.ok, 'aria-label': `${r.name || `${r.row}행`} 가져오기` });
      chk.addEventListener('change', () => { r._on = chk.checked; li.classList.toggle('off', !r._on); refreshSubmit(); });
      const spec = r.pack_price != null ? `${n3(r.pack_size)}${r.pack_unit} ${n0(r.pack_price)}원 → ${nPrice(r.display_price)}원/${r.display_unit}` : (r.display_unit ? '가격 없음 → 단가 없음으로 등록' : '');
      let was = null;
      if (r.ok && r.existing && r.existing.display_price != null && r.display_price != null && r.existing.display_unit === r.display_unit) {
        const pct = (r.display_price / r.existing.display_price - 1) * 100;
        was = h('div', { class: 'xs muted' }, `지금 ${nPrice(r.existing.display_price)}원/${r.existing.display_unit} → `, Math.abs(pct) >= 0.05 ? chg(pct) : '변동 없음',
          r.existing.used ? ` · 메뉴 ${r.existing.used}개에서 사용 중` : '');
      } else if (r.ok && r.existing && r.existing.display_price == null) {
        was = h('div', { class: 'xs muted' }, '지금은 단가가 없는 식자재입니다.');
      }
      const li = h('li', { class: `imp-rec${r._on ? '' : ' off'}` }, chk,
        h('div', { class: 'imp-main' },
          h('div', null, h('b', null, r.name || '(이름 없음)'), h('span', { class: `tag ${tagCls}`.trim() }, tagText), h('span', { class: 'xs muted imp-row' }, ` ${r.row}행`)),
          spec ? h('div', { class: 'small' }, spec) : null,
          was,
          r.supplier || r.category ? h('div', { class: 'xs muted' }, [r.supplier, r.category].filter(Boolean).join(' · ')) : null,
          r.error ? h('div', { class: 'imp-err' }, r.error) : null,
          ...(r.warn || []).map((w) => h('div', { class: 'imp-warn' }, w))));
      return li;
    }

    function menuRow(r) {
      const [tagText, tagCls] = ACTION_TAG[r.ok ? r.action : 'error'];
      const chk = h('input', { type: 'checkbox', checked: r._on, disabled: !r.ok, 'aria-label': `${r.name || `${r.row}행`} 가져오기` });
      chk.addEventListener('change', () => { r._on = chk.checked; li.classList.toggle('off', !r._on); refreshSubmit(); });
      const money = [r.price != null ? `판매가 ${n0(r.price)}원` : null, r.delivery_price != null ? `배달앱 ${n0(r.delivery_price)}원` : null, r.other_cost ? `기타 원가 ${n0(r.other_cost)}원` : null].filter(Boolean).join(' · ');
      const linesBox = h('div');
      const paintLines = () => {
        fill(linesBox, r.lines.map((ln) => {
          const tail = [];
          if (ln.error) tail.push(h('span', { class: 'imp-err' }, ln.error));
          else if (ln.ingredient_id && ln.match) tail.push(h('span', { class: 'tag ok' }, `연결: ${ln.match.name}`));
          else if (ln.suggest) {
            tail.push(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
              ln.ingredient_id = ln.suggest.id;
              ln.match = ln.suggest;
              ln.suggest = null;
              ln.new = false;
              paintLines();
            } }, `'${ln.suggest.name}'(으)로 연결`), h('span', { class: 'xs muted' }, '비슷한 이름이 있어요'));
          } else tail.push(h('span', { class: 'tag' }, '새 식자재 · 단가 없음'));
          return h('div', { class: 'imp-line' }, h('span', null, `${ln.name} `, ln.qty ? h('b', { class: 'n' }, n3(ln.qty)) : '', ln.unit || ''), ...tail);
        }));
      };
      paintLines();
      const needOpen = r.lines.some((l) => l.suggest || l.error);
      const li = h('li', { class: `imp-rec${r._on ? '' : ' off'}` }, chk,
        h('div', { class: 'imp-main' },
          h('div', null, h('b', null, r.name || '(이름 없음)'), h('span', { class: `tag ${tagCls}`.trim() }, tagText),
            r.ok && r.action === 'update' ? h('span', { class: 'xs muted' }, ' 같은 이름의 메뉴가 있습니다') : null, h('span', { class: 'xs muted imp-row' }, ` ${r.row}행`)),
          money ? h('div', { class: 'small' }, money) : null,
          r.error ? h('div', { class: 'imp-err' }, r.error) : null,
          ...(r.warn || []).map((w) => h('div', { class: 'imp-warn' }, w)),
          r.lines.length ? h('details', { class: 'more imp-lines', open: needOpen }, h('summary', null, `재료 ${r.lines.length}줄 ${needOpen ? '(확인 필요)' : '보기'}`), linesBox) : null));
      return li;
    }

    const st = res.stats;
    const statBits = isIng
      ? [['새로 등록', st.create], ['바뀜', st.update], ['변동 없음', st.same], ['건너뜀(중복)', st.skip], ['읽지 못함', st.error], ['단가 없음', st.unpriced]]
      : [['새로 등록', st.create], ['덮어쓰기', st.update], ['읽지 못함', st.error], ['재료 줄', st.lines], ['식자재와 연결', st.linked], ['비슷한 이름 제안', st.suggest], ['새 식자재', st.new]];

    const policy = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': '이미 있는 항목 처리' }, [
      ['update', `이미 있는 ${isIng ? '식자재' : '메뉴'}는 파일 내용으로 바꾸기`, isIng ? '가격이 바뀐 식자재를 쓰는 메뉴는 원가가 다시 계산됩니다.' : '파일에 재료가 있으면 기존 레시피를 파일 내용으로 바꿉니다. 재료가 없는 파일이면 기존 레시피는 그대로 둡니다.'],
      ['skip', `이미 있는 ${isIng ? '식자재' : '메뉴'}는 건너뛰기`, '기존 값을 그대로 둡니다.'],
    ].map(([k, label, sub]) => {
      const inp = h('input', { type: 'radio', name: 'imp-policy', value: k, checked: S.onConflict === k });
      inp.addEventListener('change', () => { S.onConflict = k; });
      return h('label', { class: 'radio' }, inp, h('div', null, h('b', null, label), h('div', { class: 'xs muted' }, sub)));
    }));

    submit.addEventListener('click', () => busy(submit, async () => {
      const chosen = selected();
      const out = await send(res.kind, chosen);
      showDone(out);
    }));

    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, `${KIND_LABEL[res.kind]} 미리보기`), h('span', { class: 'sub' }, `${recs.length}줄 읽음`)),
        res.truncated ? h('div', { class: 'banner info', role: 'note' }, h('div', null, '줄이 많아 앞의 3,000줄만 읽었습니다. 나머지는 파일을 나눠 다시 올려 주세요.')) : null,
        h('div', { class: 'imp-stats' }, statBits.filter(([, v]) => v).map(([k, v]) => h('span', { class: 'imp-stat' }, k, ' ', h('b', { class: 'n' }, n0(v))))),
        chips, list, more),
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '가져오는 방법')),
        policy,
        h('p', { class: 'hint', style: 'margin-top:8px' }, '한 번에 저장하며, 읽지 못한 줄은 건너뜁니다. 가져온 뒤에도 식자재·메뉴 화면에서 고칠 수 있습니다.')),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, submit,
        h('button', { class: 'btn ghost', type: 'button', onclick: showMap }, '칸 다시 맞추기')));
    paint();
    window.scrollTo(0, 0);
  }

  /* ---------------- 5. 저장 ---------------- */
  const runId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  const keyOf = (body) => { // 같은 내용을 다시 보내면 같은 키, 내용이 달라지면 다른 키
    const t = JSON.stringify(body);
    let x = 0;
    for (let i = 0; i < t.length; i += 1) x = (Math.imul(31, x) + t.charCodeAt(i)) | 0;
    return `${runId}-${t.length}-${x}`;
  };
  async function send(kind, chosen) {
    if (kind === 'ingredients') {
      const keys = ['name', 'supplier', 'category', 'pack_unit', 'pack_size', 'pack_price', 'yield_pct'];
      const body = { kind, on_conflict: S.onConflict, ingredients: chosen.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))) };
      return api('/api/import/commit', { method: 'POST', body, key: keyOf(body) });
    }
    const menus = chosen.map((r) => ({
      name: r.name, price: r.price, delivery_price: r.delivery_price, category: r.category, other_cost: r.other_cost,
      lines: r.lines.map((ln) => ({ name: ln.name, ingredient_id: ln.ingredient_id, qty: ln.qty, unit: ln.unit })),
    }));
    // 한 번에 보내 서버가 한 덩어리로 저장합니다(중간에 실패하면 아무것도 저장되지 않습니다).
    const body = { kind, on_conflict: S.onConflict, menus };
    return api('/api/import/commit', { method: 'POST', body, key: keyOf(body) });
  }

  function showDone(res) {
    const isIng = res.kind === 'ingredients';
    const otherKind = isIng ? 'menus' : 'ingredients';
    const otherSheet = S.parsed.sheets.findIndex((s) => s.kind === otherKind && s.row_count > 0);
    const lines = isIng
      ? [`새로 등록 ${res.created}개`, `바뀐 것 ${res.updated}개`, `변동 없음 ${res.unchanged}개`, res.skipped ? `건너뜀 ${res.skipped}개` : null]
      : [`새로 등록 ${res.created}개`, `덮어쓴 것 ${res.updated}개`, res.skipped ? `건너뜀 ${res.skipped}개` : null];
    fill(stage,
      h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '가져왔습니다')),
        h('p', null, `${KIND_LABEL[res.kind]} — ${lines.filter(Boolean).join(' · ')}`),
        isIng && res.affected_menus ? h('p', { style: 'margin-top:4px' }, `단가가 바뀐 식자재를 쓰는 메뉴 ${res.affected_menus}개의 원가를 다시 계산했습니다.`) : null,
        !isIng && res.created_ingredients ? h('p', { style: 'margin-top:4px' }, `메뉴에 쓰인 새 식자재 ${res.created_ingredients}개를 단가 없이 등록했습니다.`) : null,
        !isIng && res.missing_price ? h('p', { style: 'margin-top:4px' }, `판매가가 없는 메뉴 ${res.missing_price}개는 메뉴 화면에서 판매가를 넣어 주세요.`) : null,
        res.unpriced_total
          ? h('div', { class: 'note-warn' }, h('b', null, `단가가 없는 식자재 ${res.unpriced_total}개. `),
            '이 식자재는 아직 메뉴 원가에 들어가지 않습니다. 거래명세서를 올리면 이름이 같은 식자재의 단가가 채워집니다.')
          : null,
        res.failed.length
          ? h('div', { style: 'margin-top:12px' }, h('h3', { class: 'h-sec' }, `가져오지 못한 항목 ${res.failed.length}개`),
            h('ul', { class: 'plain' }, res.failed.slice(0, 30).map((f) => h('li', null, h('b', null, f.name), ` — ${f.reason}`))),
            res.failed.length > 30 ? h('p', { class: 'xs muted' }, `…외 ${res.failed.length - 30}개`) : null)
          : null,
        h('div', { class: 'btn-row', style: 'margin-top:16px' },
          isIng ? h('a', { class: 'btn', href: '#/ingredients' }, '식자재 보기') : h('a', { class: 'btn', href: '#/menus' }, '메뉴 보기'),
          otherSheet >= 0 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { pickSheet(otherSheet); showMap(); } },
            isIng ? '같은 파일에서 메뉴도 가져오기' : '같은 파일에서 식자재도 가져오기') : null,
          res.unpriced_total ? h('a', { class: 'btn ghost', href: '#/invoice' }, '거래명세서로 단가 채우기') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: showStart }, '다른 파일 가져오기'))));
    window.scrollTo(0, 0);
  }

  showStart();
}
