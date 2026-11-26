/* 안내 글(/guide/...) 페이지용 GA4. 이 페이지에는 앱 화면용 스타일이 없어서 동의 창은 띄우지 않고,
   첫 화면에서 이미 "통계"를 허용한 사람만 이 페이지 방문을 보낸다(같은 사이트라 선택이 공유됨).
   허용 전의 방문은 서버의 운영 현황(방문자 수)에만 잡힌다. */
import { app } from './core.js';
import { initAnalytics, page } from './analytics.js';

(async () => {
  try {
    const res = await fetch('/api/public', { credentials: 'same-origin' });
    app.pub = res.ok ? await res.json() : {};
  } catch { return; }
  initAnalytics(app.pub, { banner: false });
  page(location.pathname, document.title);
})();
