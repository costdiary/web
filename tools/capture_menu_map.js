/* 재료 연결표·메뉴 추천 예시 화면을 찍는 스크립트(tests/fixtures/meat_store.json 가게).
   1) DATA_DIR=/tmp/mm-data PORT=8765 API_BLOCK_UA=0 ANTHROPIC_API_KEY= python run.py
   2) node tools/capture_menu_map.js [출력 폴더] */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = process.argv[2] || 'menu-map-shots';
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'meat_store.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

async function seed(p) {
  await p.evaluate(async (D) => {
    const call = async (method, u, b) => {
      const r = await fetch(u, { method, headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
      if (!r.ok) throw new Error(`${u} ${r.status} ${await r.text()}`);
      return r.json();
    };
    await call('POST', '/api/auth/signup', { email: `mm${Date.now()}@example.com`, password: 'password1234', store_name: D.store_name, code: '' });
    const ids = {}; const kinds = {};
    for (const [name, size, unit, price, cat] of D.ingredients) {
      const r = await call('POST', '/api/ingredients', { name, pack_size: size, pack_unit: unit, pack_price: price, category: cat });
      ids[name] = r.item.id; kinds[name] = r.item.kind;
    }
    for (const [name, kind, yq, yu, items] of D.preps) {
      await call('POST', '/api/preps', { name, unit_kind: kind, yield_qty: yq, yield_unit: yu, items: items.map(([n, q]) => ({ ingredient_id: ids[n], qty: q, unit: { g: 'g', ml: 'ml', ea: '개' }[kinds[n]] })) });
    }
    const all = (await call('GET', '/api/ingredients')).items;
    const ing = Object.fromEntries(all.map((i) => [i.name, i.id]));
    for (const [name, price, cat, items, sold] of D.menus) {
      const r = await call('POST', '/api/menus', { name, price, category: cat, items: items.map(([n, q, u]) => ({ ingredient_id: ing[n], qty: q, unit: u })) });
      const parts = [0.4, 0.35, 0.25];
      for (let k = 0; k < 3; k++) {
        const d = new Date(Date.now() - (3 + k * 7) * 86400000).toISOString().slice(0, 10);
        await call('PUT', '/api/sales/items', { day: d, menu_id: r.item.id, qty: Math.round(sold * parts[k]) });
      }
    }
  }, DATA);
}

(async () => {
  const browser = await chromium.launch();
  const shot = async (opts, fn) => {
    const ctx = await browser.newContext({ locale: 'ko-KR', deviceScaleFactor: 2, ...opts });
    const p = await ctx.newPage();
    await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style'); s.textContent = '#__insp-btn{display:none!important}'; document.head.append(s);
    }));
    await p.goto(BASE + '/');
    await seed(p);
    await fn(p);
    await ctx.close();
  };
  const wait = (p, ms = 700) => p.waitForTimeout(ms);
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const desk = { viewport: { width: 1440, height: 1000 } };

  await shot({ ...mobile, colorScheme: 'light' }, async (p) => {
    await p.goto(BASE + '/#/menus/map'); await p.reload(); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, '01-map-mobile.png'), fullPage: true });
    await p.locator('.mm-node.ing', { hasText: '돼지 앞다리살' }).click(); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, '02-map-mobile-selected.png') });
    await p.goto(BASE + '/#/menus/ideas'); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, '03-ideas-mobile.png'), fullPage: true });
    await p.locator('.id-card', { hasText: '콩나물불고기' }).getByRole('button', { name: '이 메뉴 만들어 보기' }).click(); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, '07-draft-mobile.png') });
  });
  await shot({ ...desk, colorScheme: 'light' }, async (p) => {
    await p.goto(BASE + '/#/menus/map'); await p.reload(); await wait(p, 1200);
    await p.locator('.mm-node.ing', { hasText: '대파' }).click(); await wait(p, 500);
    await p.screenshot({ path: path.join(OUT, '04-map-desktop.png'), fullPage: true });
    await p.getByRole('button', { name: '표로 보기' }).click(); await wait(p, 500);
    await p.locator('.mm-sec').screenshot({ path: path.join(OUT, '05-table-desktop.png') });
    await p.goto(BASE + '/#/menus/ideas'); await wait(p, 1200);
    await p.screenshot({ path: path.join(OUT, '06-ideas-desktop.png'), fullPage: true });
  });
  await shot({ ...mobile, colorScheme: 'dark' }, async (p) => {
    await p.goto(BASE + '/#/menus/map'); await p.reload(); await wait(p, 1200);
    await p.locator('.mm-node.menu', { hasText: '제육볶음' }).click(); await wait(p, 500);
    await p.screenshot({ path: path.join(OUT, '08-map-mobile-dark.png') });
  });
  await browser.close();
})();
