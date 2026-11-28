/* 재료 연결표: 어떤 식자재가 어떤 메뉴에 들어가는지 선으로 잇고(ERD처럼), 많이 쓰이고 재료비 비중이 큰
   '핵심 식자재'를 눈에 띄게 보여 준다. 프렙(육수·양념장)에 들어간 원재료는 그 프렙을 쓰는 메뉴까지 이어
   점선으로 그린다. 재료나 메뉴를 누르면 연결된 것만 남고, 아래(휴대폰)·옆(PC) 칸에 자세한 내용이 나온다.
   서버 계산: app/menu_map.py build_map(), GET /api/menu-map */
import { h, api, icon, n0, n1, n3, fill } from './core.js';
import { emptyBlock, num } from './ui.js';
import { menuTabs } from './menutabs.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const TIER = {
  core: ['핵심', '여러 메뉴에 들어가고 재료비 비중도 커서, 값이 오르면 가게 전체 원가가 흔들리는 재료'],
  often: ['여러 메뉴', '메뉴 두 개 이상에 들어가는 재료'],
  some: ['한 메뉴', '메뉴 한 개에만 들어가는 재료'],
  unused: ['안 씀', '식자재에는 있지만 어느 메뉴에도 안 들어가는 재료'],
};
const UNIT = { g: 'g', ml: 'ml', ea: '개' };

function qtyText(kind, q) {
  if (q == null) return '';
  if (kind === 'ea') return `${n3(Math.round(q * 100) / 100)}개`;
  if (q >= 1000) return `${n1(q / 1000)}${kind === 'g' ? 'kg' : 'L'}`;
  return `${n3(Math.round(q * 10) / 10)}${UNIT[kind]}`;
}

export async function render(box) {
  const data = await api('/api/menu-map');
  const { ingredients: ings, menus, summary: sum } = data;
  box.append(
    h('div', { class: 'page-h' }, h('h1', null, '재료 연결표', h('span', { class: 'sub' }, `식자재 ${sum.ingredient_count}개 · 메뉴 ${sum.menu_count}개`))),
    menuTabs('#/menus/map'));

  const used = ings.filter((i) => i.menu_count > 0);
  if (!used.length) {
    box.append(h('section', { class: 'sheet' }, emptyBlock({
      title: menus.length ? '메뉴에 재료가 아직 없어요' : '아직 메뉴가 없어요',
      text: '메뉴마다 들어가는 재료와 양을 넣으면, 어떤 재료가 몇 개 메뉴에 쓰이는지 한눈에 이어서 보여 드려요.',
      actions: [h('a', { class: 'btn', href: menus.length ? '#/menus' : '#/menus/new' }, menus.length ? '메뉴에 재료 넣기' : '메뉴 추가하기')],
    })));
    return;
  }

  const byId = new Map(ings.map((i) => [i.id, i]));
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const core = ings.filter((i) => i.tier === 'core').sort((a, b) => b.score - a.score);
  const maxCount = Math.max(...used.map((i) => i.menu_count));

  /* ---------- 핵심 식자재 카드 ---------- */
  let select = () => {};
  const coreSec = core.length ? h('section', { class: 'sheet mm-core', 'aria-label': '핵심 식자재' },
    h('div', { class: 'sheet-h' }, h('h2', null, '핵심 식자재'), h('span', { class: 'sub' }, sum.by_sales ? '최근 30일 판매량 기준' : '메뉴 1인분 기준')),
    h('p', { class: 'small muted mm-lead' }, '여러 메뉴에 들어가고 재료비 비중도 큰 재료예요. 이 재료 값이 오르면 가게 전체 원가가 같이 올라가니, 단가를 자주 확인하고 거래처와 먼저 협상하세요.'),
    h('ol', { class: 'mm-cards' }, core.map((i, k) => h('li', null,
      h('button', { class: 'mm-card', type: 'button', onclick: () => select('ing', i.id, true) },
        h('span', { class: 'mm-rank n' }, String(k + 1)),
        h('span', { class: 'mm-card-name' }, i.name),
        h('span', { class: 'mm-card-stats' },
          h('span', null, h('b', { class: 'n' }, String(i.menu_count)), `/${sum.linked_menus} 메뉴`),
          h('span', null, '재료비의 ', h('b', { class: 'n' }, n1(i.share)), '%')),
        h('span', { class: 'mm-meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.min(100, i.share * 2.5)}%` } })),
        h('span', { class: 'mm-card-foot xs' },
          i.monthly_cost != null ? ['한 달 ', h('b', { class: 'n' }, n0(i.monthly_cost)), '원어치'] : null,
          i.bump10_pts != null ? h('span', null, '10% 오르면 원가율 ', h('b', { class: 'n' }, `+${n1(i.bump10_pts)}`), '%p') : null)))))) : null;

  /* ---------- 연결도 ---------- */
  const lane = h('div', { class: 'mm-lane' });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'mm-svg');
  svg.setAttribute('aria-hidden', 'true');
  lane.append(svg);

  const ingNodes = new Map();
  const menuNodes = new Map();
  const ingCol = h('ul', { class: 'mm-col mm-ings', 'aria-label': '식자재' }, used.map((i) => {
    const b = h('button', {
      class: `mm-node ing t-${i.tier}`, type: 'button', 'data-id': i.id,
      'aria-label': `${i.name}, 메뉴 ${i.menu_count}개에 들어감${i.tier === 'core' ? ', 핵심 식자재' : ''}`,
      onclick: () => select('ing', i.id),
    },
    h('span', { class: 'mm-fill', style: { width: `${(i.menu_count / maxCount) * 100}%` }, 'aria-hidden': 'true' }),
    h('span', { class: 'mm-name' }, i.name),
    h('span', { class: 'mm-count n' }, String(i.menu_count)));
    ingNodes.set(i.id, b);
    return h('li', null, b);
  }));
  const linkedMenus = menus.filter((m) => m.ingredients.length);
  const menuCol = h('ul', { class: 'mm-col mm-menus', 'aria-label': '메뉴' }, linkedMenus.map((m) => {
    const b = h('button', {
      class: 'mm-node menu', type: 'button', 'data-id': m.id, onclick: () => select('menu', m.id),
      'aria-label': `${m.name}, 재료 ${m.ingredients.length}개`,
    },
    h('span', { class: 'mm-name' }, m.name),
    h('span', { class: 'mm-msub' }, `재료 ${m.ingredients.length}`, m.preps.length ? h('span', { class: 'mm-prep-dot', title: `프렙: ${m.preps.join(', ')}` }, '프렙') : null));
    menuNodes.set(m.id, b);
    return h('li', null, b);
  }));

  // 선 데이터: 재료 → 메뉴(프렙을 거치면 via)
  const links = [];
  for (const i of used) for (const x of i.menus) links.push({ ing: i.id, menu: x.id, share: x.share, via: !x.direct, tier: i.tier });
  const paths = [];

  const graph = h('div', { class: 'mm-graph' },
    h('div', { class: 'mm-colh' }, h('span', null, '식자재'), h('span', null, '들어가는 메뉴 수')),
    h('div', { class: 'mm-colh right' }, h('span', null, '메뉴')),
    ingCol, lane, menuCol);

  function draw() {
    const lb = lane.getBoundingClientRect();
    if (!lb.width || !lb.height) return;
    svg.setAttribute('viewBox', `0 0 ${lb.width} ${lb.height}`);
    svg.setAttribute('width', lb.width);
    svg.setAttribute('height', lb.height);
    svg.replaceChildren();
    paths.length = 0;
    // 핵심 재료 선이 위로 오도록: 흐린 선 먼저
    const order = [...links].sort((a, b) => (a.tier === 'core') - (b.tier === 'core'));
    for (const l of order) {
      const a = ingNodes.get(l.ing)?.getBoundingClientRect();
      const b = menuNodes.get(l.menu)?.getBoundingClientRect();
      if (!a || !b) continue;
      const y1 = a.top + a.height / 2 - lb.top;
      const y2 = b.top + b.height / 2 - lb.top;
      const x1 = 0;
      const x2 = lb.width;
      const c = lb.width * 0.5;
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`);
      const w = 1 + Math.min(2.2, (l.share || 0) / 18);
      p.setAttribute('class', `mm-link t-${l.tier}${l.via ? ' via' : ''}`);
      p.style.setProperty('--w', `${w}px`);
      p.dataset.ing = l.ing;
      p.dataset.menu = l.menu;
      svg.append(p);
      paths.push(p);
    }
    paint();
  }

  /* ---------- 선택과 자세히 ---------- */
  let sel = null; // { type: 'ing'|'menu', id }
  const panel = h('aside', { class: 'mm-panel', 'aria-live': 'polite' });
  function paint() {
    const on = !!sel;
    graph.classList.toggle('has-sel', on);
    const litIngs = new Set();
    const litMenus = new Set();
    if (sel?.type === 'ing') {
      litIngs.add(sel.id);
      for (const x of byId.get(sel.id).menus) litMenus.add(x.id);
    } else if (sel?.type === 'menu') {
      litMenus.add(sel.id);
      for (const iid of menuById.get(sel.id).ingredients) litIngs.add(iid);
    }
    for (const [id, el] of ingNodes) { el.classList.toggle('lit', litIngs.has(id)); el.setAttribute('aria-pressed', String(sel?.type === 'ing' && sel.id === id)); }
    for (const [id, el] of menuNodes) { el.classList.toggle('lit', litMenus.has(id)); el.setAttribute('aria-pressed', String(sel?.type === 'menu' && sel.id === id)); }
    for (const p of paths) {
      const hit = on && ((sel.type === 'ing' && Number(p.dataset.ing) === sel.id) || (sel.type === 'menu' && Number(p.dataset.menu) === sel.id));
      p.classList.toggle('lit', hit);
      if (hit) p.parentNode.append(p); // 맨 위로
    }
  }

  function ingDetail(i) {
    const t = TIER[i.tier];
    return [
      h('div', { class: 'mm-ph' },
        h('div', null,
          h('span', { class: `mm-tier t-${i.tier}` }, t[0]),
          h('h3', null, i.name)),
        h('button', { class: 'icon-btn mm-close', type: 'button', 'aria-label': '닫기', onclick: () => select(null) }, icon('x', 20))),
      h('p', { class: 'xs muted' }, t[1]),
      h('dl', { class: 'mm-facts' },
        h('div', null, h('dt', null, '들어가는 메뉴'), h('dd', null, num(String(i.menu_count), `/${sum.linked_menus}개`))),
        h('div', null, h('dt', null, '재료비 비중'), h('dd', null, num(n1(i.share), '%'))),
        i.monthly_cost != null ? h('div', null, h('dt', null, '한 달에 쓰는 양'), h('dd', null, h('span', { class: 'n' }, qtyText(i.kind, i.monthly_qty)), h('span', { class: 'xs muted' }, ` · ${n0(i.monthly_cost)}원`))) : null),
      i.bump10_pts != null ? h('p', { class: 'mm-impact small' }, icon('trend', 16), h('span', null, '이 재료 값이 10% 오르면 이 메뉴들 원가율이 평균 ', h('b', { class: 'n' }, `+${n1(i.bump10_pts)}%p`), ' 올라요.')) : null,
      h('ul', { class: 'mm-uses' }, i.menus.map((x) => h('li', null,
        h('a', { href: `#/menus/${x.id}` }, x.name),
        h('span', { class: 'mm-use-q' }, qtyText(i.kind, x.qty),
          x.cost != null ? h('span', { class: 'muted' }, ` · ${n0(x.cost)}원`) : null),
        x.share != null ? h('span', { class: 'mm-use-bar', title: `이 메뉴 재료비의 ${n1(x.share)}%` }, h('i', { style: { width: `${Math.min(100, x.share)}%` } }), h('b', { class: 'n' }, `${Math.round(x.share)}%`)) : null,
        x.via.length ? h('span', { class: 'mm-via xs' }, `${x.via.join(', ')}에${x.direct ? '도' : ''} 들어가서`) : null))),
      !i.priced ? h('p', { class: 'xs', style: 'color:var(--red);margin-top:8px' }, '단가가 없어 재료비 비중이 0으로 나와요.') : null,
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('a', { class: 'btn ghost sm', href: '#/ingredients' }, '식자재에서 단가 보기')),
    ];
  }

  function menuDetail(m) {
    const items = m.ingredients.map((iid) => {
      const i = byId.get(iid);
      const x = i?.menus.find((y) => y.id === m.id);
      return i && x ? { i, x } : null;
    }).filter(Boolean).sort((a, b) => (b.x.cost || 0) - (a.x.cost || 0));
    return [
      h('div', { class: 'mm-ph' },
        h('div', null, h('span', { class: 'mm-tier menu' }, m.category || '메뉴'), h('h3', null, m.name)),
        h('button', { class: 'icon-btn mm-close', type: 'button', 'aria-label': '닫기', onclick: () => select(null) }, icon('x', 20))),
      h('dl', { class: 'mm-facts' },
        h('div', null, h('dt', null, '재료'), h('dd', null, num(String(items.length), '개'))),
        h('div', null, h('dt', null, '재료비'), h('dd', null, num(n0(m.cost), '원'))),
        m.ratio != null ? h('div', null, h('dt', null, '원가율'), h('dd', null, num(n1(m.ratio), '%'))) : null),
      h('ul', { class: 'mm-uses' }, items.map(({ i, x }) => h('li', null,
        h('button', { class: 'link-btn', type: 'button', onclick: () => select('ing', i.id) }, i.name,
          i.tier === 'core' ? h('span', { class: 'mm-tier t-core sm' }, '핵심') : null),
        h('span', { class: 'mm-use-q' }, qtyText(i.kind, x.qty), x.cost != null ? h('span', { class: 'muted' }, ` · ${n0(x.cost)}원`) : null),
        x.share != null ? h('span', { class: 'mm-use-bar' }, h('i', { style: { width: `${Math.min(100, x.share)}%` } }), h('b', { class: 'n' }, `${Math.round(x.share)}%`)) : null,
        x.via.length ? h('span', { class: 'mm-via xs' }, `${x.via.join(', ')}에${x.direct ? '도' : ''} 들어가서`) : null))),
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('a', { class: 'btn ghost sm', href: `#/menus/${m.id}` }, '메뉴 열기')),
    ];
  }

  function paintPanel() {
    if (!sel) {
      fill(panel, h('div', { class: 'mm-hint' },
        h('p', { class: 'small' }, h('b', null, '재료나 메뉴를 눌러 보세요.')),
        h('p', { class: 'xs muted' }, '선이 많이 모이는 재료일수록 여러 메뉴에 들어가요. 점선은 육수·양념장 같은 프렙에 들어가서 메뉴로 이어지는 재료예요.')));
      panel.classList.remove('open');
      return;
    }
    fill(panel, sel.type === 'ing' ? ingDetail(byId.get(sel.id)) : menuDetail(menuById.get(sel.id)));
    panel.classList.add('open');
  }

  select = (type, id, scroll = false) => {
    sel = type && !(sel && sel.type === type && sel.id === id) ? { type, id } : null;
    paint();
    paintPanel();
    const node = sel ? (type === 'ing' ? ingNodes : menuNodes).get(id) : null;
    if (node && scroll) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (node && window.innerWidth < 900) {
      // 휴대폰: 아래에서 올라오는 칸에 가리지 않게, 누른 칸을 화면 위쪽으로 올린다
      const top = node.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.32) window.scrollBy({ top: top - window.innerHeight * 0.2, behavior: 'smooth' });
    }
  };

  /* ---------- 표로 보기 ---------- */
  function matrix() {
    const cols = linkedMenus;
    return h('div', { class: 'mm-matrix-wrap' }, h('table', { class: 'mm-matrix' },
      h('thead', null, h('tr', null,
        h('th', { class: 'mm-mx-corner', scope: 'col' }, '식자재 \\ 메뉴'),
        cols.map((m) => h('th', { scope: 'col', class: 'mm-mx-menu' }, h('span', null, m.name))),
        h('th', { scope: 'col', class: 'mm-mx-n' }, '메뉴 수'))),
      h('tbody', null, used.map((i) => {
        const at = new Map(i.menus.map((x) => [x.id, x]));
        return h('tr', { class: `t-${i.tier}` },
          h('th', { scope: 'row' }, i.tier === 'core' ? h('span', { class: 'mm-tier t-core sm' }, '핵심') : null, i.name),
          cols.map((m) => {
            const x = at.get(m.id);
            if (!x) return h('td', null);
            const d = 8 + Math.min(14, (x.share || 0) / 4);
            return h('td', { title: `${m.name}: ${qtyText(i.kind, x.qty)}${x.cost != null ? ` · ${n0(x.cost)}원` : ''}${x.via.length ? ` (${x.via.join(', ')}에 들어가서)` : ''}` },
              h('i', { class: `mm-dot${x.direct ? '' : ' via'}`, style: { width: `${d}px`, height: `${d}px` } }));
          }),
          h('td', { class: 'mm-mx-n' }, h('b', { class: 'n' }, String(i.menu_count))));
      }))));
  }

  const view = h('div', { class: 'mm-view' });
  let mode = 'graph';
  const modeBtns = [['graph', '연결도'], ['table', '표로 보기']].map(([k, label]) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === mode), onclick: () => { mode = k; paintView(); } }, label));
  const legend = h('ul', { class: 'mm-legend xs', 'aria-label': '표시 방법' },
    h('li', null, h('i', { class: 'lg core' }), '핵심 식자재'),
    h('li', null, h('i', { class: 'lg often' }), '여러 메뉴'),
    h('li', null, h('i', { class: 'lg some' }), '한 메뉴'),
    h('li', null, h('i', { class: 'lg via' }), '프렙을 거쳐서'));
  const grid = h('div', { class: 'mm-wrap' }, h('div', { class: 'mm-main' }, graph), panel);
  let ro = null;
  function paintView() {
    modeBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(['graph', 'table'][k] === mode)));
    if (mode === 'graph') {
      fill(view, grid);
      if (!ro) {
        ro = new ResizeObserver(() => requestAnimationFrame(draw));
        ro.observe(graph);
      }
      requestAnimationFrame(draw);
    } else fill(view, matrix());
  }
  paintPanel();
  paintView();

  const unused = ings.filter((i) => i.tier === 'unused');
  box.append(
    coreSec,
    h('section', { class: 'sheet mm-sec', 'aria-label': '연결도' },
      h('div', { class: 'sheet-h mm-toolbar' }, h('h2', null, '어떤 재료가 어디에 들어가나'), h('div', { class: 'chips', role: 'group', 'aria-label': '보기' }, modeBtns)),
      legend,
      view,
      unused.length ? h('p', { class: 'xs muted mm-unused' }, `메뉴에 안 쓰는 식자재 ${unused.length}개: `, unused.map((i) => i.name).join(', '), ' · 안 쓰면 식자재에서 지워도 돼요.') : null),
    h('a', { class: 'mm-next', href: '#/menus/ideas' },
      h('span', { class: 'mm-next-ic', 'aria-hidden': 'true' }, icon('spark', 22)),
      h('span', null, h('b', null, '이 재료들로 만들 수 있는 새 메뉴 보기'), h('span', { class: 'xs muted' }, `지금 메뉴 ${sum.menu_count}개의 재료를 조금만 섞으면 되는 메뉴를 찾아 드려요.`)),
      icon('chevron', 18)));

  // 화면을 떠나면 크기 감시를 멈춘다
  const stop = () => { ro?.disconnect(); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);
}

