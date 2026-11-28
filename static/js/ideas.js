/* 메뉴 추천: 가게가 이미 사 오는 식자재와 지금 메뉴들의 레시피를 기본 레시피와 맞춰 보고, 새로 살 재료가
   없거나 1~2개뿐인 메뉴를 "어느 메뉴 재료에 어느 메뉴의 무엇을 더하면 되는지"와 함께 보여 준다.
   예: 제육볶음 + 콩나물국의 콩나물 → 콩나물불고기. 서버 계산: app/menu_map.py suggest(), GET /api/menu-ideas
   '이 메뉴 만들어 보기'는 새 메뉴 화면에 이름·재료·양·판매가를 미리 채워 연다(menus.js openDraft). */
import { h, api, app, icon, n0, n3, nT } from './core.js';
import { emptyBlock } from './ui.js';
import { menuTabs } from './menutabs.js';
import { openDraft } from './menus.js';

const UNIT = { g: 'g', ml: 'ml', ea: '개' };
/* 받침에 따라 을/를 */
const eul = (w) => {
  const c = String(w).charCodeAt(String(w).length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 ? '을' : '를';
};
const josaMan = (list) => `${list.join(', ')}만`;

function badge(x) {
  if (!x.missing.length) return h('span', { class: 'id-badge ready' }, icon('check', 14), '새로 살 재료 없음');
  return h('span', { class: 'id-badge buy' }, `${josaMan(x.missing)} 사면 돼요`);
}

/* 제육볶음 + 콩나물국의 콩나물 (+ 사 올 것) → 새 메뉴 */
function recipeMath(x) {
  const parts = [];
  if (x.base) {
    parts.push(h('span', { class: 'id-term base' },
      h('span', { class: 'id-term-k xs' }, '바탕'),
      h('a', { href: `#/menus/${x.base.id}`, class: 'id-term-name' }, x.base.name)));
  }
  for (const a of x.adds) {
    parts.push(h('span', { class: 'id-op', 'aria-hidden': 'true' }, '+'));
    parts.push(h('span', { class: 'id-term' },
      h('span', { class: 'id-term-k xs' }, a.id ? a.name : '식자재에 있는'),
      h('span', { class: 'id-term-name' }, a.ingredients.join(', '))));
  }
  if (x.missing.length) {
    parts.push(h('span', { class: 'id-op', 'aria-hidden': 'true' }, '+'));
    parts.push(h('span', { class: 'id-term buy' },
      h('span', { class: 'id-term-k xs' }, '새로 사기'),
      h('span', { class: 'id-term-name' }, x.missing.join(', '))));
  }
  parts.push(h('span', { class: 'id-op eq', 'aria-hidden': 'true' }, '='));
  parts.push(h('span', { class: 'id-term out' }, h('span', { class: 'id-term-name' }, x.name)));
  return h('div', { class: 'id-math', role: 'img', 'aria-label': mathSentence(x) }, parts);
}

function mathSentence(x) {
  const bits = [];
  if (x.base) bits.push(`${x.base.name} 재료에`);
  const adds = x.adds.filter((a) => a.id).map((a) => `${a.name}의 ${a.ingredients.join(', ')}`);
  const free = x.adds.filter((a) => !a.id).flatMap((a) => a.ingredients);
  if (adds.length) bits.push(`${adds.join(', ')}${eul(adds[adds.length - 1])} 더하고`);
  if (free.length) bits.push(`식자재에 있는 ${free.join(', ')}${eul(free[free.length - 1])} 쓰고`);
  if (x.missing.length) bits.push(`${x.missing.join(', ')}만 사면`);
  return `${bits.join(' ')} ${x.name}${eul(x.name)} 만들 수 있어요.`;
}

function qtyOf(ln) {
  if (ln.qty == null) return '';
  return `${n3(ln.qty)}${ln.unit}`;
}

function ingChips(x) {
  const mains = x.lines.filter((l) => !l.basic);
  const basics = x.lines.filter((l) => l.basic);
  return h('div', { class: 'id-ings' },
    h('ul', { class: 'id-chips', 'aria-label': '재료' }, mains.map((l) => h('li', {
      class: `id-chip${l.have ? '' : ' need'}${l.core ? ' core' : ''}`,
      title: l.have ? `${l.ingredient}${l.from_menu ? ` · ${l.from_menu.name}에 쓰는 재료` : ''}` : '아직 식자재에 없어요',
    },
    l.core ? h('i', { class: 'id-core-dot', 'aria-label': '핵심 식자재' }) : null,
    h('span', null, l.have && l.ingredient !== l.name ? l.ingredient : l.name),
    h('span', { class: 'id-q' }, qtyOf(l)),
    !l.have ? h('span', { class: 'id-need xs' }, '사야 함') : null))),
    basics.length ? h('p', { class: 'xs muted id-basic' }, `기본 양념: ${basics.map((l) => l.name).join(', ')}`) : null);
}

function card(x, target) {
  const isNew = x.src !== 'basic';
  const go = () => openDraft({
    name: x.name, category: x.category, price: x.price,
    note: '메뉴 추천에서 가져온 보통 1인분 어림값이에요. 실제로 재 보고 고쳐 주세요.',
    lines: x.lines.filter((l) => l.have).map((l) => ({ name: l.ingredient, qty: l.base_qty, unit: UNIT[l.kind] })),
    missing: x.missing,
    from: x.name,
  });
  return h('article', { class: `id-card${x.missing.length ? '' : ' is-ready'}` },
    h('header', { class: 'id-h' },
      h('div', { class: 'id-meta' }, h('span', { class: 'id-cat xs' }, x.category || '메뉴'), badge(x),
        isNew ? h('span', { class: 'tag' }, x.src === 'public' ? '공공 레시피' : '자주 파는 메뉴') : null),
      h('h3', { class: 'id-name' }, x.name),
      x.pitch ? h('p', { class: 'id-pitch small' }, x.pitch) : null),
    recipeMath(x),
    ingChips(x),
    h('footer', { class: 'id-f' },
      h('dl', { class: 'id-nums' },
        h('div', null, h('dt', null, '1인분 재료비'), h('dd', null, h('span', { class: 'n' }, `약 ${n0(x.cost)}`), '원')),
        x.price ? h('div', null, h('dt', null, `목표 ${nT(target)}%면 판매가`), h('dd', null, h('span', { class: 'n' }, n0(x.price)), '원')) : null),
      h('button', { class: 'btn sm', type: 'button', disabled: !app.me.plan.writable, onclick: go }, '이 메뉴 만들어 보기')),
    x.cost_approx || x.cost_unknown.length
      ? h('p', { class: 'xs muted id-note' }, x.cost_approx ? '아직 안 사는 재료나 단가가 없는 재료는 시세를 어림해 넣었어요.' : '', x.cost_unknown.length ? ` ${x.cost_unknown.join(', ')} 값은 빠져 있어요.` : '')
      : null);
}

export async function render(box) {
  const { items, summary: sum } = await api('/api/menu-ideas');
  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '메뉴 추천', h('span', { class: 'sub' }, '있는 재료로 만드는 새 메뉴'))),
    menuTabs('#/menus/ideas'));

  if (!items.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: sum.menu_count ? '아직 추천할 메뉴를 못 찾았어요' : '메뉴와 식자재를 먼저 넣어 주세요',
      text: sum.menu_count
        ? '지금 식자재로는 새로 살 재료가 3개 이상 필요한 메뉴만 있어요. 식자재와 메뉴가 늘어나면 다시 찾아 드릴게요.'
        : '가게에서 쓰는 식자재와 메뉴 레시피를 바탕으로, 조금만 섞으면 만들 수 있는 새 메뉴를 찾아 드려요.',
      actions: [h('a', { class: 'btn', href: sum.menu_count ? '#/ingredients' : '#/menus/new' }, sum.menu_count ? '식자재 보기' : '메뉴 추가하기')],
    })));
    return;
  }

  const ready = items.filter((x) => !x.missing.length);
  const almost = items.filter((x) => x.missing.length);
  const lead = h('section', { class: 'id-lead' },
    h('div', { class: 'id-lead-ic', 'aria-hidden': 'true' }, icon('spark', 26)),
    h('div', null,
      h('p', { class: 'id-lead-t' },
        ready.length ? ['새로 살 재료 없이 만들 수 있는 메뉴 ', h('b', { class: 'n' }, String(ready.length)), '개'] : null,
        ready.length && almost.length ? ', ' : null,
        almost.length ? ['1~2개만 더 사면 되는 메뉴 ', h('b', { class: 'n' }, String(almost.length)), '개'] : null,
        '를 찾았어요.'),
      h('p', { class: 'xs muted' }, `식자재 ${sum.ingredient_count}개와 메뉴 ${sum.menu_count}개의 레시피를 기본 레시피 ${sum.checked}개와 맞춰 봤어요. 재료비·판매가는 보통 1인분 어림값이에요.`),
      h('p', { class: 'xs muted id-legend' }, h('i', { class: 'id-core-dot' }), ' 표시는 ', h('a', { href: '#/menus/map' }, '핵심 식자재'), '예요. 핵심 식자재를 더 쓰는 메뉴는 한 번에 많이 사서 단가를 낮추기 좋아요.')));

  let filter = 'all';
  const list = h('div', { class: 'id-grid' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '보기' });
  const paint = () => {
    const show = filter === 'ready' ? ready : filter === 'almost' ? almost : items;
    list.replaceChildren(...show.map((x) => card(x, sum.target)));
    chips.replaceChildren(...[['all', `전체 ${items.length}`], ['ready', `바로 만들 수 있어요 ${ready.length}`], ['almost', `조금만 더 사면 ${almost.length}`]]
      .filter(([k]) => k === 'all' || (k === 'ready' ? ready.length : almost.length))
      .map(([k, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; paint(); } }, label)));
  };
  paint();
  box.append(lead, chips, list,
    h('p', { class: 'xs muted id-foot' }, '추천은 가게 데이터만으로 계산해요(밖으로 보내지 않아요). ', h('a', { href: '#/menus/map' }, '재료 연결표'), `에서 어떤 재료가 많이 쓰이는지도 볼 수 있어요.`));
}

