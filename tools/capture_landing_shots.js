/* 랜딩 히어로의 휴대폰 앱 화면 4장(static/landing/step*.webp)을 다시 찍는 스크립트.
   앱 화면 디자인이 바뀌면 이걸로 다시 찍는다.

   1) 자동 인식을 끈 채(ANTHROPIC_API_KEY 비움) 빈 데이터 폴더로 서버를 띄운다. 예시 명세서가 나온다.
        DATA_DIR=/tmp/shots-data PORT=8765 API_BLOCK_UA=0 ANTHROPIC_API_KEY= python run.py
   2) node tools/capture_landing_shots.js [출력 폴더]   (Playwright 필요)
   3) 출력된 PNG(780×1560)를 webp(quality 80)로 바꿔 static/landing/에 넣고, landing.js의 ?v= 숫자를 올린다.
   예시 가게('맛있는 한식당')로 가입 → 예시 데이터 → 명세서 올리기 → 확인 → 반영 → 메뉴 순서로 찍는다. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = process.argv[2] || 'landing-shots';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'ko-KR' });
  const p = await ctx.newPage();
  await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style'); s.textContent = '#__insp-btn{display:none!important}'; document.head.append(s);
  }));
  const pause = (ms = 900) => p.waitForTimeout(ms);
  await p.goto(BASE + '/'); await pause();
  await p.evaluate(async () => {
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const r = await post('/api/auth/signup', { email: `shots${Date.now()}@example.com`, password: 'password1234', store_name: '맛있는 한식당', code: '' });
    if (!r.ok) throw new Error(`가입 실패 ${r.status}: ${await r.text()}`);
    await post('/api/demo/seed', {});
  });
  await p.goto(BASE + '/#/invoice'); await p.reload(); await pause(1200);
  // 자동 인식이 꺼진 서버에서만 나오는 안내 문구는 소개용 화면에서 감춘다.
  await p.evaluate(() => { const e = [...document.querySelectorAll('p.small.muted')].find((x) => x.textContent.includes('자동 인식이 꺼져')); if (e) e.hidden = true; });
  await p.screenshot({ path: path.join(OUT, 'step1-upload.png') });

  // 아무 사진이나 올리면 예시 명세서 결과가 나온다(1×1 흰 JPEG).
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: '앨범에서 고르기' }).click()]);
  await chooser.setFiles({ name: 'statement.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await p.waitForSelector('.inv-line', { timeout: 15000 }); await pause();
  await p.evaluate(() => {
    const h2 = [...document.querySelectorAll('.sheet-h h2')].find((e) => e.textContent === '품목');
    scrollTo(0, h2.closest('.sheet').getBoundingClientRect().top + scrollY - 62);
  });
  await pause(500);
  await p.screenshot({ path: path.join(OUT, 'step2-review.png') });

  await p.getByRole('button', { name: /품목 반영하기/ }).click();
  await p.waitForSelector('text=반영했습니다'); await pause();
  await p.screenshot({ path: path.join(OUT, 'step3-apply.png') });

  await p.goto(BASE + '/#/menus'); await pause(1200);
  await p.screenshot({ path: path.join(OUT, 'step4-menus.png') });
  await browser.close();
  console.log('saved to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
