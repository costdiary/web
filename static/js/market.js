/* 도매마켓(사장님 쪽): 첫 접속 안내, 설정, 더 싼 제안/떨이, 연결 요청, 단가제안받기 켜기 */
import {
  h, api, app, bus, field, numInput, selectOf, parseNum, n0, n1, nPrice, openDialog, confirmDialog,
  busy, toast, errMsg, icon, refreshRoute, fill, go,
} from './core.js';
import { emptyBlock, termInput } from './ui.js';

/* ---------------------------------------------------------------- 첫 접속 안내 모달 */

export function openMarketNotice({ settings, onDone } = {}) {
  let st = settings;
  const regionSel = h('select', { class: 'select' });
  const optin = h('input', { type: 'checkbox', checked: true });
  const threshold = numInput({ value: '5' });
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const confirm = h('button', { class: 'btn block', type: 'submit' }, '확인');

  async function load() {
    st = st || (await api('/api/market/settings'));
    fill(regionSel, h('option', { value: '' }, '권역을 선택하세요'), st.regions.map((r) => h('option', { value: r.code }, r.label)));
    regionSel.value = st.region_code || '';
    optin.checked = st.demand_optin !== false;
    threshold.value = String(st.threshold_pct ?? 5);
  }

  const form = h('form', { novalidate: true },
    err,
    h('div', null,
      h('div', { class: 'h-sec' }, '도매업체와 연결하는 서비스입니다'),
      h('p', { class: 'small' }, '내가 쓰는 식자재(품목·원산지·등급)와 월 구매량 구간, 평균 매입 단가(원가율 계산용)를 바탕으로, 더 싼 가격을 제안하는 인증 도매업체를 연결해 드립니다.')),
    h('div', null,
      h('div', { class: 'h-sec' }, '도매업체에게 공개되는 정보')),
    h('ul', { class: 'plain' }, [
      '품목·원산지·등급, 권역(예: 경기 남부), 월 구매량 구간(예: 10~30곳 수요)',
    ].map((t) => h('li', null, t))),
    h('div', null, h('div', { class: 'h-sec' }, '절대 공개되지 않는 정보')),
    h('ul', { class: 'plain' }, [
      '상호·연락처·거래처·정확한 평균 매입 단가·주소 — 연결 요청을 직접 보내기 전까지는 어떤 도매업체도 사장님이 누구인지 알 수 없습니다.',
    ].map((t) => h('li', null, t))),
    h('label', { class: 'sw' }, optin, h('span', { class: 'trk' }), '더 싼 제안 받기 (켜 두면 구매 품목이 익명으로 노출됩니다)'),
    field('내 가게 권역', regionSel, '제안을 보낼 도매업체를 정할 때 씁니다. 꼭 선택해 주세요.'),
    field('알림 기준 (%)', threshold, '현재 평균 매입가보다 이 비율 이상 싼 제안만 알려 드립니다. 1~30% 사이.'),
    confirm);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (!regionSel.value) { err.textContent = '권역을 선택해 주세요.'; err.hidden = false; return; }
    const t = parseNum(threshold.value);
    if (!(t >= 1 && t <= 30)) { err.textContent = '알림 기준은 1에서 30 사이로 넣어 주세요.'; err.hidden = false; return; }
    await busy(confirm, async () => {
      try {
        await api('/api/market/settings', {
          method: 'PUT',
          body: { demand_optin: optin.checked, threshold_pct: t, region_code: regionSel.value, ack_notice: true },
        });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast('도매마켓 설정을 저장했습니다.');
      if (onDone) onDone();
    });
  });

  // X로 닫으면(또는 Esc) ack_notice를 보내지 않으므로 '확인'을 누르기 전까지는 다시 열립니다.
  const dlg = openDialog({ title: '도매마켓 안내', content: form });
  load();
  return dlg;
}

/* ---------------------------------------------------------------- 연결 요청 대화상자 */

function openConnect({ title, itemName, origin, grade, onSubmit }) {
  const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const contact = h('input', { class: 'input', type: 'text', maxLength: 60, placeholder: '전화번호 또는 이메일', autocomplete: 'off' });
  const shareStore = h('input', { type: 'checkbox', checked: true });
  const msg = h('textarea', { class: 'textarea', maxLength: 300, placeholder: '예: 다음 주부터 받아보고 싶어요. (선택)' });
  const btn = h('button', { class: 'btn', type: 'submit' }, '연결 요청 보내기');
  const form = h('form', { novalidate: true },
    err,
    h('div', { class: 'banner info', role: 'status' },
      h('div', null, h('b', null, '이 정보가 해당 도매업체에 전달됩니다. '),
        `품목(${itemName}${origin ? ` · ${origin}` : ''}${grade ? ` · ${grade}` : ''}), 입력하신 연락처`, shareStore.checked ? ', 가게 이름' : '', ', 남기신 메시지.')),
    field('연락받을 연락처', contact, '전화번호 또는 이메일을 입력해 주세요.'),
    h('label', { class: 'sw' }, shareStore, h('span', { class: 'trk' }), '가게 이름 함께 전달하기'),
    field('메시지 (선택)', msg),
    btn);
  shareStore.addEventListener('change', () => {
    form.querySelector('.banner div').lastChild.textContent = `품목(${itemName}${origin ? ` · ${origin}` : ''}${grade ? ` · ${grade}` : ''}), 입력하신 연락처${shareStore.checked ? ', 가게 이름' : ''}, 남기신 메시지.`;
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (contact.value.trim().length < 3) { err.textContent = '연락처를 입력해 주세요.'; err.hidden = false; return; }
    await busy(btn, async () => {
      try {
        await onSubmit({ contact: contact.value.trim(), message: msg.value.trim(), share_store_name: shareStore.checked });
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
      dlg.close();
      toast('연결 요청을 보냈습니다.');
    });
  });
  const dlg = openDialog({ title, content: form });
  contact.focus();
  return dlg;
}

/* ---------------------------------------------------------------- #/market: 더 싼 제안 · 떨이 */

function offerCard(o) {
  const saving = o.saving_pct;
  return h('li', null, h('div', { class: 'row', style: 'display:block' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, o.item_name || o.ingredient.name),
      h('span', { class: 'xs muted' }, [o.origin, o.grade].filter(Boolean).join(' · ')),
      h('div', { class: 'row-sub' }, `인증 도매업체 · ${o.seller.region_label}`, o.seller.deals_badge ? h('span', { class: 'tag ok' }, '거래 경험 많음') : null)),
    h('div', { class: 'be-big', style: 'margin-top:8px' },
      h('div', null, h('span', { class: 'small muted' }, '내 평균 매입가'), h('span', { class: 'nu' }, h('span', { class: 'n' }, nPrice(o.my_avg_display)), h('span', { class: 'u' }, `원/${o.unit}`))),
      h('div', null, h('span', { class: 'small muted' }, '제안 단가'), h('span', { class: 'nu' }, h('span', { class: 'n' }, nPrice(o.offer_display)), h('span', { class: 'u' }, `원/${o.unit}`))),
      h('div', null, h('span', { class: 'small muted' }, '절감률'), h('span', { class: 'chg', style: 'color:var(--green)' }, `▼${n1(saving)}%`))),
    o.min_order_note ? h('p', { class: 'xs muted', style: 'margin-top:6px' }, `최소 주문: ${o.min_order_note}`) : null,
    h('div', { class: 'btn-row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        openConnect({
          title: '연결 요청', itemName: o.item_name, origin: o.origin, grade: o.grade,
          onSubmit: (body) => api(`/api/market/offers/${o.id}/connect`, { method: 'POST', body }),
        });
      }) }, '연결 요청'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        await api(`/api/market/offers/${o.id}/dismiss`, { method: 'POST' });
        toast('목록에서 숨겼습니다.');
        refreshRoute();
      }) }, '관심 없음'))));
}

function dealCard(d) {
  return h('li', null, h('div', { class: 'row', style: 'display:block' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, d.title),
      h('span', { class: 'xs muted' }, [d.item_name, d.origin, d.grade].filter(Boolean).join(' · ')),
      h('div', { class: 'row-sub' }, d.seller.biz_name)),
    d.body ? h('p', { class: 'small', style: 'margin-top:6px' }, d.body) : null,
    h('div', { style: 'margin-top:8px' }, h('span', { class: 'nu' }, h('span', { class: 'n' }, nPrice(d.price_display)), h('span', { class: 'u' }, `원/${d.unit}`)),
      d.stock_note ? h('span', { class: 'xs muted' }, ` · ${d.stock_note}`) : null),
    h('div', { class: 'btn-row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => openConnect({
        title: '연결 문의', itemName: d.item_name, origin: d.origin, grade: d.grade,
        onSubmit: (body) => api(`/api/market/deals/${d.ad_id}/inquire`, { method: 'POST', body }),
      }) }, '연결 요청'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        await api(`/api/market/deals/${d.ad_id}/dismiss`, { method: 'POST' });
        toast('목록에서 숨겼습니다.');
        refreshRoute();
      }) }, '관심 없음'))));
}

export async function render(box) {
  box.append(h('div', { class: 'page-h' }, h('h1', null, '도매마켓'),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openMarketNotice({ onDone: refreshRoute }) }, '안내 다시 보기')));
  box.append(h('p', { class: 'small muted', style: 'margin-top:-4px' },
    '우리 식당이 쓰는 품목을 등록해 두면 같은 품목을 쓰는 다른 사장님들과 익명으로 묶여 수요가 잡히고, 평균 매입가보다 싼 ',
    h('a', { href: '#/market/offers' }, '단가 제안'), '이 오기 시작합니다.'));

  const body = h('div', { style: 'margin-top:4px' });
  async function paint() {
    fill(body, h('div', { class: 'skel' }));
    const { deals } = await api('/api/market/deals');
    fill(body, deals.length
      ? h('ul', { class: 'rows' }, deals.map(dealCard))
      : h('section', { class: 'sheet' }, emptyBlock({ title: '지금 올라온 떨이가 없습니다', text: '도매업체가 재고 떨이를 올리면 내 권역·품목에 맞을 때 여기에 보여 드립니다.' })));
  }
  box.append(body);
  await paint();
}

/* ---------------------------------------------------------------- #/market/offers: 단가제안받기 */

const WHY_LABEL = { unmapped: '원산지 필요', optout: '노출 꺼짐', no_region: '권역 미설정', stale: '최근 가격 필요' };

/* 식자재 한 줄: 토글로 단가제안받기 켜고 끄기 + '상세'로 펼쳐서 원산지·등급·부위 수정.
   원산지 입력란은 '상세' 안에 하나만 둔다 — 토글을 켤 때 원산지가 없으면 별도 선택란을 또
   보여주지 않고(예전엔 둘이 따로 있어서 서로 안 맞는 값을 보여줄 수 있었다), 바로 '상세'를
   펼쳐서 거기서 입력·저장하게 한다. 브랜드 민감 품목은 토글을 비활성화하고 사유만 보여준다. */
function ingredientRow(it, origins) {
  const brandSensitive = it.why_hidden === 'brand_sensitive';
  const subParts = [it.category, it.origin, it.grade, it.cut].filter(Boolean).join(' · ');
  const statusTag = it.exposed ? h('span', { class: 'tag ok' }, '제안받는 중')
    : brandSensitive ? h('span', { class: 'tag warn' }, '제품마다 맛이 달라 제외')
      : it.mapped ? (WHY_LABEL[it.why_hidden] ? h('span', { class: 'tag warn' }, WHY_LABEL[it.why_hidden]) : null)
        : null;

  const toggle = h('input', { type: 'checkbox', checked: !!it.mapped, disabled: brandSensitive, 'aria-label': `${it.name} 단가 제안받기` });

  /* 상세: 원산지·등급·부위를 펼쳐서 수정. 저장 시 지금 토글 상태(enabled)를 그대로 함께 보낸다.
     꺼진 상태로 저장해도(enabled:false) 원산지·등급·부위 값은 그대로 남는다 — 백엔드가
     노출 여부와 식자재 정보를 분리해서 다룬다. */
  const detailOriginSel = selectOf([['', '원산지 선택'], ...origins.map((o) => [o.code, o.label])], it.origin || '');
  const gradeInput = termInput({ kind: 'grade', category: () => it.category, maxLength: 10, value: it.grade || '', placeholder: '예: 1++, Prime (선택)' });
  const cutInput = termInput({ kind: 'cut', category: () => it.category, maxLength: 40, value: it.cut || '', placeholder: '예: 등심, 삼겹살, 안심 (선택)' });
  const detailErr = h('div', { class: 'form-err', role: 'alert', hidden: true });
  const detailSave = h('button', { class: 'btn sm', type: 'button' }, '저장');
  const details = h('details', { class: 'more', style: 'margin-top:8px' },
    h('summary', null, '상세'),
    detailErr,
    h('div', { class: 'two keep' }, field('원산지', detailOriginSel), field('등급 (선택)', gradeInput, '목록에 없으면 직접 입력해도 됩니다.')),
    field('부위 (선택)', cutInput, '정육류에 주로 씁니다.'),
    h('div', { class: 'btn-row', style: 'margin-top:4px' }, detailSave));

  detailSave.addEventListener('click', () => busy(detailSave, async () => {
    detailErr.hidden = true;
    const enabled = toggle.checked;
    if (enabled && !detailOriginSel.value) { detailErr.textContent = '원산지를 입력해 주세요.'; detailErr.hidden = false; return; }
    try {
      await api(`/api/market/ingredients/${it.ingredient_id}`, {
        method: 'PUT',
        body: { enabled, origin: detailOriginSel.value || undefined, grade: gradeInput.control.value.trim(), cut: cutInput.control.value.trim() },
      });
    } catch (e) { detailErr.textContent = errMsg(e); detailErr.hidden = false; return; }
    toast('저장했습니다.');
    refreshRoute();
  }));

  toggle.addEventListener('change', async (e) => {
    if (e.currentTarget.checked) {
      if (!it.origin) {
        /* 원산지가 아직 없으면 바로 저장할 수 없다 — 토글은 켠 채로 두고(의도를 그대로 유지)
           '상세'를 펼쳐서 원산지를 받는다(별도 선택란을 또 띄우지 않음, 상세의 원산지
           선택란 하나로 통일). 거기서 '저장'을 누르면 이 토글이 켜진 상태 그대로 반영된다. */
        details.open = true;
        detailOriginSel.focus();
        return;
      }
      await busy(toggle, async () => {
        try {
          await api(`/api/market/ingredients/${it.ingredient_id}`, { method: 'PUT', body: { enabled: true } });
        } catch (e2) { toggle.checked = false; toast(errMsg(e2), 'err'); return; }
        toast('단가 제안받기를 켰습니다.');
        refreshRoute();
      });
    } else {
      await busy(toggle, async () => {
        await api(`/api/market/ingredients/${it.ingredient_id}`, { method: 'PUT', body: { enabled: false } });
        toast('단가 제안받기를 껐습니다.');
        refreshRoute();
      });
    }
  });

  return h('li', null, h('div', { style: 'padding:10px 0' },
    h('div', { style: 'display:flex;align-items:flex-start;gap:10px;min-width:0' },
      h('label', { class: 'sw', style: 'flex:none' }, toggle, h('span', { class: 'trk' })),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'row-title' }, it.name, statusTag),
        h('div', { class: 'row-sub' }, subParts || '아직 원산지를 입력하지 않았습니다.'),
        brandSensitive ? h('p', { class: 'xs muted', style: 'margin-top:2px' }, '제품마다 맛이 달라 단가 제안 대상에서 뺐어요.') : null,
        it.mapped && it.why_hidden === 'stale' ? h('p', { class: 'xs muted', style: 'margin-top:2px' }, '최근 90일 안에 직접 입력했거나 명세서로 반영한 가격이 있어야 제안을 받습니다. (예시 데이터·샘플 명세서는 제외)') : null)),
    details));
}

export async function renderOffers(box) {
  box.append(h('div', { class: 'page-h' },
    h('a', { class: 'btn ghost sm', href: '#/market' }, icon('back', 18), '도매마켓'),
    h('h1', { style: 'font-size:1.125rem' }, '단가제안받기')));
  box.append(h('p', { class: 'small muted', style: 'margin-top:-4px' },
    '쓰는 식자재의 원산지·등급이 같은 다른 사장님들과 익명으로 묶여, 내 평균 매입가보다 싼 제안이 오면 여기에 뜹니다.'));

  const checklistBody = h('div', { style: 'margin-top:4px' });
  let originsCache = [];
  async function paintChecklist() {
    fill(checklistBody, h('div', { class: 'skel' }));
    const [{ items }, catalog] = await Promise.all([api('/api/market/ingredients'), api('/api/market/catalog')]);
    originsCache = catalog.origins;
    if (!items.length) {
      fill(checklistBody, h('section', { class: 'sheet' }, emptyBlock({ title: '등록한 식자재가 없습니다', actions: [h('a', { class: 'btn ghost sm', href: '#/ingredients' }, '식자재로 이동')] })));
      return;
    }
    const onCount = items.filter((it) => it.exposed).length;
    const list = h('ul', { class: 'rows mk-check-rows' }, items.map((it) => ingredientRow(it, originsCache)));
    fill(checklistBody,
      h('p', { class: 'small muted', style: 'margin-bottom:8px' }, onCount
        ? `${onCount}개 식자재가 단가 제안을 받고 있습니다.`
        : '식자재마다 단가 제안받기를 켜 두면, 같은 원산지·등급을 쓰는 다른 사장님들과 익명으로 묶여 수요가 잡힙니다.'),
      list);
  }

  const offersBody = h('div', { style: 'margin-top:4px' });
  async function paintOffers() {
    fill(offersBody, h('div', { class: 'skel' }));
    const { offers } = await api('/api/market/offers');
    fill(offersBody, offers.length
      ? h('ul', { class: 'rows mk-offer-rows' }, offers.map(offerCard))
      : h('section', { class: 'sheet' }, emptyBlock({ title: '아직 들어온 제안이 없습니다', text: '아래에서 식자재의 단가 제안받기를 켜 두면, 평균 매입가보다 싼 제안이 오는 대로 여기에 보여 드립니다.' })));
  }

  box.append(
    h('div', { class: 'h-sec' }, '단가 제안받기 켜기'),
    checklistBody,
    h('div', { class: 'h-sec' }, '받은 제안'),
    offersBody);
  await Promise.all([paintChecklist(), paintOffers()]);
}

/* ---------------------------------------------------------------- #/market/connections */

function connRow(c) {
  const statusLabel = { requested: '응답 대기', accepted: '수락됨', declined: '거절됨', expired: '기간 만료', closed: '종료' }[c.status] || c.status;
  return h('li', null, h('div', { class: 'row', style: 'display:block' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, c.item_name), h('span', { class: 'tag' }, statusLabel)),
    c.seller ? h('div', { class: 'row-sub' }, c.seller.biz_name || '도매업체', c.seller.phone ? ` · ${c.seller.phone}` : '') : null,
    c.seller?.intro ? h('p', { class: 'small', style: 'margin-top:4px' }, c.seller.intro) : null,
    c.status === 'accepted' && c.my_outcome == null
      ? h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          await api(`/api/market/connections/${c.id}/outcome`, { method: 'POST', body: { outcome: 'done' } });
          toast('기록했습니다.'); refreshRoute();
        }) }, '거래했어요'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          await api(`/api/market/connections/${c.id}/outcome`, { method: 'POST', body: { outcome: 'failed' } });
          toast('기록했습니다.'); refreshRoute();
        }) }, '안 했어요'))
      : c.my_outcome ? h('p', { class: 'xs muted', style: 'margin-top:6px' }, c.my_outcome === 'done' ? '거래 완료로 기록함' : '거래하지 않음으로 기록함') : null));
}

export async function renderConnections(box) {
  const { connections } = await api('/api/market/connections');
  box.append(
    h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm', href: '#/market' }, icon('back', 18), '도매마켓'), h('h1', { style: 'font-size:1.125rem' }, '연결 요청')),
    connections.length
      ? h('section', { class: 'sheet' }, h('ul', { class: 'rows' }, connections.map(connRow)))
      : h('section', { class: 'sheet' }, emptyBlock({ title: '보낸 연결 요청이 없습니다', text: '더 싼 제안이나 떨이에서 연결 요청을 보내면 여기에서 상태를 볼 수 있습니다.' })));
}

