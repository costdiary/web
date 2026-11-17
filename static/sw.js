/* 원가노트 서비스워커: 화면(HTML/CSS/JS/아이콘)을 캐시해 두어
   - "홈 화면에 추가"로 설치할 수 있게 하고
   - 네트워크가 끊겨도 마지막으로 본 화면을 띄울 수 있게 한다.
   가격·재고 같은 실제 데이터(/api/...)는 절대 캐시하지 않는다 — 항상 최신 값을 받아야 한다. */

const CACHE_VERSION = 'wongae-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 쓰기 요청은 손대지 않는다
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 손대지 않는다
  if (url.pathname.startsWith('/api/')) return; // 실제 데이터는 항상 네트워크로

  // 화면 뼈대(정적 파일): 네트워크를 먼저 쓰고, 끊겼을 때만 캐시로 대신한다.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
