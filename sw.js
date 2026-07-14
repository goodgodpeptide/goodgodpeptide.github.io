const CACHE_NAME = 'peptide-app-v11';
const STATIC_ASSETS = [
  './',
  './index.html',
  // peptides_v3.json(2.4MB)은 install 시 미리 받지 않고 첫 사용 시점에 캐시 (stale-while-revalidate 아래 참고)
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.matchAll()).then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase / Google API 등 외부 요청은 네트워크 우선 (캐시 X — 인증 응답 캐시 금지)
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // HTML 네비게이션은 networkFirst — 새 배포 즉시 반영, 오프라인 시만 캐시
  // (CACHE_NAME 수동 갱신 의존하던 stale HTML 버그 해소)
  const isNav = e.request.mode === 'navigate'
    || (e.request.method === 'GET' && (e.request.headers.get('accept') || '').includes('text/html'));
  if (isNav) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // peptides_v3.json: stale-while-revalidate (즉시 캐시 응답 + 백그라운드 갱신)
  // — 2.4MB라 네트워크 우선이면 매번 로드 지연됨. 캐시 있으면 즉시 응답 후 백그라운드로 최신화.
  if (url.pathname.endsWith('peptides_v3.json')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, res.clone())).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 나머지 정적 파일: stale-while-revalidate (즉시 캐시 응답 + 백그라운드 갱신)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
