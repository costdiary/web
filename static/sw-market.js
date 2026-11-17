/* 도매마켓 서비스워커: 판매자 화면 뼈대(HTML/CSS/JS/아이콘)만 캐시해
   - "홈 화면에 추가"로 설치할 수 있게 하고
   - 네트워크가 끊겨도 마지막으로 본 화면 틀을 띄울 수 있게 한다.
   수요·제안·연결·결제 같은 실제 데이터(/api/...)는 절대 캐시하지 않는다 — 항상 서버의 최신 값만 쓴다.
   원가노트 서비스워커(/sw.js)와는 캐시 이름과 등록 범위가 다르다. */

const CACHE_PREFIX = 'domae-shell-';
const CACHE_VERSION = `${CACHE_PREFIX}v1`;
const SHELL_URL = new URL(self.registration.scope).pathname || '/partner';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 도매마켓의 예전 캐시만 지운다(원가노트 캐시는 건드리지 않는다).
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.open(CACHE_VERSION).then((cache) => cache.match(req).then((hit) => hit || cache.match(SHELL_URL))))
  );
});
