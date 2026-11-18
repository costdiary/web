/* 홈: 평균 원가율, 단가 상승 알림, 원가율이 높은 메뉴, 확인이 필요한 식자재 */
import { h, api, app, n0, n1, nT, nPrice, ago, ymd, busy, refreshRoute, toast, MARKET_ENABLED } from './core.js';
import { marginBar, stamp, chg, num, emptyBlock, sgn } from './ui.js';
import { openIngredientEditor } from './ingredients.js';

const pctNum = (v) => [h('span', { class: 'n' }, n1(v)), '%'];

function impactRow(i, target) {
  return h('a', { class: 'impact', href: `#/menus/${i.menu_id}` },
    h('span', { class: 'impact-name' }, i.name),
    h('span', { class: 'impact-num' }, pctNum(i.ratio_before), ' → ', h('b', null, pctNum(i.ratio_after)), ` (+${i.delta_pp.toFixed(1)}%p)`),
    marginBar({ ratio: i.ratio_after, target, up: i.delta_pp }));
}

const MAX_ALERTS = 4; // 처음에 보여 줄 알림 수. 나머지는 '더 보기'
const MAX_BARS = 3; // 알림 하나에서 막대까지 그려 줄 메뉴 수
const BAR_MIN = 0.5; // 원가율이 이만큼(%p) 이상 오른 메뉴만 막대로 보여 준다
const NOTE_MIN = 0.1; // 그보다 작아도 이만큼 이상이면 이름만 한 줄로, 더 작으면 생략

function impactNote(list, tiny, lead) {
  if (!list.length && !tiny) return null;
  const kids = [];
  if (list.length) {
    kids.push(lead);
    list.slice(0, 4).forEach((i, k) => {
      if (k) kids.push(', ');
      kids.push(h('a', { href: `#/menus/${i.menu_id}` }, i.name), ` +${i.delta_pp.toFixed(1)}%p`);
    });
    if (list.length > 4) kids.push(` 외 ${list.length - 4}개`);
  }
  if (tiny) kids.push(list.length ? ' · ' : '', `변화 ${NOTE_MIN}%p 미만 ${tiny}개는 생략`);
  return h('p', { class: 'xs muted', style: 'margin-top:8px' }, kids);
}

function alertItem(a, target) {
  const bars = a.impacts.filter((i) => i.delta_pp >= BAR_MIN).slice(0, MAX_BARS);
  const barIds = new Set(bars.map((i) => i.menu_id));
  const minor = a.impacts.filter((i) => i.delta_pp >= NOTE_MIN && !barIds.has(i.menu_id));
  const tiny = a.impacts.filter((i) => i.delta_pp < NOTE_MIN).length;
  let body;
  if (!a.impacts.length) body = h('p', { class: 'small muted', style: 'margin-top:4px' }, '이 식자재를 쓰는 메뉴가 아직 없습니다.');
  else if (!bars.length && !minor.length) body = h('p', { class: 'small muted', style: 'margin-top:4px' }, `쓰는 메뉴 ${a.impacts.length}개의 원가율 변화는 ${NOTE_MIN}%p 미만입니다.`);
  else {
    body = [
      bars.length ? h('div', { class: 'impacts' }, bars.map((i) => impactRow(i, target))) : null,
      impactNote(minor, tiny, bars.length ? '그 밖에 ' : '원가율이 오른 메뉴 '),
    ];
  }
  return h('li', { class: 'alert-item' },
    h('div', { class: 'alert-top' },
      h('span', { class: 'name' }, a.name),
      chg(a.change_pct),
      h('span', { class: 'price' }, h('span', { class: 'n' }, nPrice(a.prev_price)), ' → ', h('span', { class: 'n' }, nPrice(a.price)), `원/${a.unit}`),
      h('span', { class: 'when' }, ago(a.changed_at))),
    body);
}

function alertList(alerts, target) {
  const ul = h('ul', { class: 'rows' }, alerts.slice(0, MAX_ALERTS).map((a) => alertItem(a, target)));
  const tail = alerts.slice(MAX_ALERTS);
  if (!tail.length) return ul;
  const more = h('button', { class: 'btn ghost sm', type: 'button', style: 'margin-top:10px' }, `나머지 ${tail.length}개 더 보기`);
  more.addEventListener('click', () => { ul.append(...tail.map((a) => alertItem(a, target))); more.remove(); });
  return h('div', null, ul, more);
}

function menuRow(m, target) {
  return h('li', null,
    h('a', { class: 'row', href: `#/menus/${m.id}` },
      h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, m.name, ' '), stamp(m.status),
        h('div', { class: 'row-sub' }, `판매가 ${n0(m.price)}원 · 재료비 ${n0(m.cost)}원`)),
      h('div', { class: 'row-end' }, h('span', { class: 'nu', style: 'font-size:1.375rem' }, h('span', { class: 'n' }, n1(m.cost_ratio)), h('span', { class: 'u' }, '%'))),
      h('div', { class: 'row-wide' }, marginBar({ ratio: m.cost_ratio, target }),
        m.status !== 'good' && m.recommended_price
          ? h('p', { class: 'xs muted', style: 'margin-top:6px' }, `목표 ${nT(target)}%에 맞는 판매가 `, h('b', { class: 'n' }, n0(m.recommended_price)), '원',
            m.price_gap > 0 ? ` (지금보다 +${n0(m.price_gap)}원)` : '')
          : null)));
}

function onboarding() {
  const seed = h('button', { class: 'btn sm', type: 'button', 'aria-label': '예시 데이터로 둘러보기' }, '둘러보기');
  seed.addEventListener('click', () => busy(seed, async () => {
    await api('/api/demo/seed', { method: 'POST' });
    toast('예시 식당의 식자재 14개와 메뉴 5개를 넣었습니다.');
    refreshRoute();
  }));
  return h('section', { class: 'sheet' },
    emptyBlock({
      title: '처음이시군요. 어디서부터 볼까요?',
      text: '식자재 단가와 메뉴 구성이 들어가야 원가율이 계산됩니다. 가장 빠른 방법을 고르세요.',
    }),
    h('ul', { class: 'rows', style: 'margin-top:8px' },
      h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '예시 데이터로 둘러보기'),
          h('div', { class: 'row-sub' }, '가상의 한식당 메뉴 5개, 식자재 14개가 한 번에 들어가요. 마음에 안 들면 그냥 지우면 됩니다.')), seed)),
      h('li', null, h('a', { class: 'row', href: '#/invoice' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '거래명세서 사진으로 시작'),
          h('div', { class: 'row-sub' }, '사진에 찍힌 품목과 단가를 그대로 식자재로 등록해 드려요.')), h('span', { class: 'btn ghost sm' }, '올리기'))),
      h('li', null, h('a', { class: 'row', href: '#/import' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '쓰던 앱·엑셀에서 가져오기'),
          h('div', { class: 'row-sub' }, '쓰던 단가표나 레시피 파일, 그대로 올리면 옮겨 드립니다.')), h('span', { class: 'btn ghost sm' }, '가져오기'))),
      h('li', null, h('a', { class: 'row', href: '#/menus/photo' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '요리 사진으로 메뉴 만들기'),
          h('div', { class: 'row-sub' }, '재료 양을 몰라도 괜찮아요. 사진만 보고 어림잡아 초안을 잡아 드립니다.')), h('span', { class: 'btn ghost sm' }, '사진 올리기'))),
      h('li', null, h('a', { class: 'row', href: '#/ingredients' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, '식자재부터 직접 등록'),
          h('div', { class: 'row-sub' }, '구매 규격과 가격만 넣으면 kg·L·개당 단가는 계산해 드려요.')), h('span', { class: 'btn ghost sm' }, '등록')))));
}

export async function render(box) {
  const d = await api('/api/dashboard');
  const s = d.summary;
  box.append(h('div', { class: 'page-h' }, h('h1', null, '오늘의 원가')));
  if (!s.menu_count && !s.ingredient_count) {
    box.append(onboarding());
    return;
  }

  const kpi = h('section', { class: 'sheet', 'aria-label': '이번 달 요약' });
  if (s.avg_cost_ratio == null) {
    kpi.append(emptyBlock({
      title: '메뉴를 등록하면 원가율이 계산됩니다',
      text: `식자재 ${s.ingredient_count}개가 등록되어 있습니다. 메뉴에 재료와 양을 넣어 보세요.`,
      actions: [h('a', { class: 'btn', href: '#/menus/new' }, '메뉴 만들기')],
    }));
  } else {
    const st = s.avg_cost_ratio <= s.target ? 'good' : s.avg_cost_ratio <= s.target + 5 ? 'warn' : 'bad';
    const hasSales = (s.sales_total || 0) > 0;
    const estCost = s.sales_ingredient_cost != null ? s.sales_ingredient_cost : (hasSales ? s.sales_total * s.avg_cost_ratio / 100 : null);
    const costLabel = s.sales_ingredient_cost != null ? '재료비' : '재료비(추정)';
    const ratioNow = s.sales_ingredient_cost != null ? (s.sales_ingredient_cost / s.sales_total) * 100 : s.avg_cost_ratio;
    kpi.append(
      h('p', { class: 'kpi-label' }, hasSales ? '이번 달 매출' : '메뉴 평균 원가율'));
    if (hasSales) {
      kpi.append(
        h('div', { class: 'money-row' },
          h('div', { class: 'money-item' },
            h('dt', null, '판매금액'),
            h('dd', null, h('span', { class: 'n' }, n0(s.sales_total)), h('span', { class: 'u' }, '원'))),
          h('div', { class: 'money-item' },
            h('dt', null, costLabel),
            h('dd', null, h('span', { class: 'n' }, n0(estCost)), h('span', { class: 'u' }, '원')))),
        h('p', { class: 'ratio-line' }, '원가율 ', h('span', { class: 'n' }, n1(ratioNow)), '%', stamp(st)));
    } else {
      kpi.append(
        h('p', { class: 'ratio-line' }, '원가율 ', h('span', { class: 'n' }, n1(s.avg_cost_ratio)), '%', stamp(st)),
        h('p', { class: 'kpi-sub', style: 'margin-top:0' }, h('a', { href: '#/sales' }, '이번 달 매출을 입력'), '하면 판매금액·재료비가 여기 먼저 보여요.'));
    }
    kpi.append(
      marginBar({ ratio: ratioNow, target: s.target, big: true, labels: true }),
      h('p', { class: 'kpi-sub' }, s.over_target
        ? `목표 ${nT(s.target)}%를 넘는 메뉴가 ${s.menu_count}개 중 ${s.over_target}개입니다.`
        : `메뉴 ${s.menu_count}개가 모두 목표 ${nT(s.target)}% 안에 있습니다.`),
      h('dl', { class: 'ledger' },
        h('div', null, h('dt', null, '식자재'), h('dd', null, num(n0(s.ingredient_count), '개'))),
        h('div', null, h('dt', null, '최근 30일 오른 식자재'), h('dd', null, num(n0(s.rising_count), '개'))),
        h('div', null, h('dt', null, '단가 확인이 필요한 식자재'), h('dd', null, num(n0(s.stale_count), '개')))));
  }
  box.append(kpi);

  const notes = [];
  if (d.unpriced_count) notes.push(h('p', null, h('b', null, `단가가 없는 식자재 ${d.unpriced_count}개. `), '이 재료는 메뉴 원가에 아직 들어가지 않습니다. ', h('a', { href: '#/invoice' }, '거래명세서를 올리거나'), ' ', h('a', { href: '#/ingredients' }, '직접 단가를 넣어'), ' 주세요.'));
  if (d.estimated_menu_count) notes.push(h('p', null, h('b', null, `사진으로 추정한 양이 들어 있는 메뉴 ${d.estimated_menu_count}개. `), '실제로 재 보고 고치면 원가율이 정확해집니다. ', h('a', { href: '#/menus' }, '메뉴에서 확인하기')));
  if (notes.length) box.append(h('div', { class: 'note-warn', role: 'status', style: 'margin:12px 0' }, notes));
  if (MARKET_ENABLED && (app.me.market.unread_offers || 0) + (app.me.market.unread_deals || 0) > 0) {
    const n = app.me.market.unread_offers + app.me.market.unread_deals;
    box.append(h('a', { class: 'sheet', href: '#/market', style: 'display:block;margin:12px 0;text-decoration:none' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, '도매마켓에 새 소식이 있어요'),
        h('div', { class: 'row-sub' }, `더 싼 제안·떨이 알림 ${n}건`))));
  }
  if (s.menu_count && !d.delivery.configured) {
    box.append(h('div', { class: 'banner info', style: 'margin:12px 0' }, h('div', null, h('b', null, '배달앱에서 팔고 계신가요? '),
      '배민·쿠팡이츠 수수료를 켜 두면 메뉴마다 배달 주문 한 건에 실제로 남는 돈을 계산합니다. ', h('a', { href: '#/delivery' }, '수수료 설정하기'))));
  }

  const left = h('div', { class: 'stack' });
  const right = h('div', { class: 'stack' });

  const alerts = h('section', { class: 'sheet', 'aria-labelledby': 'al-t' },
    h('div', { class: 'sheet-h' }, h('h2', { id: 'al-t' }, '단가가 오른 식자재'), h('span', { class: 'sub' }, `${nT(app.me.settings.alert_pct)}% 이상, 최근 30일`)));
  if (d.alerts.length) alerts.append(alertList(d.alerts, s.target));
  else alerts.append(emptyBlock({
    title: '오른 식자재가 없습니다',
    text: '거래명세서를 올리면 이전 단가와 비교해 이곳에 알려 드립니다.',
    actions: [h('a', { class: 'btn ghost sm', href: '#/invoice' }, '명세서 올리기')],
  }));
  left.append(alerts);

  if (d.delivery.loss_count) {
    right.append(h('section', { class: 'sheet', 'aria-labelledby': 'dl-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'dl-t' }, '배달앱에서 팔면 적자인 메뉴'), h('a', { class: 'small', href: '#/delivery' }, '수수료 설정')),
      h('ul', { class: 'rows' }, d.delivery.loss.map((x) => h('li', null, h('a', { class: 'row', href: `#/menus/${x.menu_id}` },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, x.name), h('span', { class: 'tag bad' }, x.channel),
          h('div', { class: 'row-sub' }, x.recommended_price ? `목표에 맞는 배달 판매가 ${n0(x.recommended_price)}원` : '판매가를 올리거나 재료비를 줄여야 합니다')),
        h('div', { class: 'row-end' }, h('span', { class: 'nu', style: 'color:var(--red)' }, h('span', { class: 'n' }, sgn(x.profit)), h('span', { class: 'u' }, '원/건'))))))),
      d.delivery.loss_count > d.delivery.loss.length ? h('p', { class: 'xs muted', style: 'margin-top:8px' }, `그 밖에 ${d.delivery.loss_count - d.delivery.loss.length}건`) : null));
  }
  if (d.worst_menus.length) {
    right.append(h('section', { class: 'sheet', 'aria-labelledby': 'wm-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'wm-t' }, '원가율이 높은 메뉴'), h('a', { class: 'small', href: '#/menus' }, '전체 보기')),
      h('ul', { class: 'rows' }, d.worst_menus.slice(0, 4).map((m) => menuRow(m, s.target)))));
  }
  if (d.stale.length) {
    right.append(h('section', { class: 'sheet', 'aria-labelledby': 'st-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'st-t' }, '단가를 확인할 때가 됐어요'), h('span', { class: 'sub' }, '45일 넘게 그대로')),
      h('ul', { class: 'rows' }, d.stale.map((i) => {
        const b = h('button', { class: 'btn ghost sm', type: 'button' }, '단가 확인');
        b.addEventListener('click', () => openIngredientEditor(i.id, refreshRoute));
        return h('li', null, h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, i.name), h('div', { class: 'row-sub' }, `${ago(i.checked_at)} 확인`)), b));
      }))));
  }
  if (d.recent_invoices.length) {
    right.append(h('section', { class: 'sheet', 'aria-labelledby': 'iv-t' },
      h('div', { class: 'sheet-h' }, h('h2', { id: 'iv-t' }, '최근 반영한 명세서')),
      h('ul', { class: 'rows' }, d.recent_invoices.map((v) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, v.supplier || '거래처 미입력'),
          h('div', { class: 'row-sub' }, `${ymd(v.invoice_date || v.created_at)} · ${v.line_count}개 품목`)),
        v.total ? num(n0(v.total), '원') : null))))));
  }
  box.append(h('div', { class: 'cols', style: 'margin-top:16px' }, left, right));
}
