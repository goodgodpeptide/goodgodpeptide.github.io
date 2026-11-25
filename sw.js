// 공개 정적 자산만 캐시한다. 인증/API/개인 데이터는 저장하지 않는다.
const CACHE_NAME = 'peptide-app-v39';
const STATIC_ASSETS = [
  './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './kakao_qr.png', './login_bg.png.jpg', './display_preferences.js', './display_preferences.css',
  './sync_guard.js', './recovery_guard.js', './offline_sync.js', './offline_app.js', './offline_notice.js', './offline_notice.css',
  './clinical_graph_scale.js', './clinical_graph_patch.js', './dual_exposure_sim.js',
  './schedule_comparison_model.js', './schedule_comparison_ui.js', './model_input_review.js',
  './inline_weight_entry.js', './recon_inventory_guard.js', './peptides_v3.json',
  './saju/saju_engine.obf.js', './saju/toitjeong.obf.js', './saju/saju_ui.obf.js', './saju/saju.css',
  './vendor/firebase-10.12.0/firebase-app.js', './vendor/firebase-10.12.0/firebase-auth.js',
  './vendor/firebase-10.12.0/firebase-firestore.js', './vendor/qrcode-1.0.0.min.js', './vendor/jsQR-1.4.0.min.js'
];
const assetURLs = new Set(STATIC_ASSETS.map(path => new URL(path, self.registration.scope).href));
function publicAssetKey(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return null;
  url.search = ''; url.hash = '';
  return assetURLs.has(url.href) ? url.href : null;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 모든 자산을 먼저 받는다. 하나라도 실패하면 기존 캐시/활성 SW를 유지한다.
    const responses = await Promise.all(STATIC_ASSETS.map(async path => {
      const response = await fetch(new Request(new URL(path, self.registration.scope), {cache:'reload'}));
      if (!response.ok || response.type === 'opaque') throw new Error('Precache failed: ' + path);
      return response;
    }));
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(STATIC_ASSETS.map((path, index) => cache.put(new URL(path, self.registration.scope).href, responses[index])));
    } catch (error) { await caches.delete(CACHE_NAME); throw error; }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith('peptide-app-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // API/Auth 및 외부 요청은 브라우저 네트워크 처리에 맡기며 캐시 조회도 하지 않는다.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const navigation = request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname);
  if (navigation) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE_NAME)).match(new URL('index.html', scope).href);
      if (cached) return cached;
      const response = await fetch(request);
      if (!response.ok) throw new Error('Navigation failed: ' + response.status);
      return response;
    })());
    return;
  }
  const key = publicAssetKey(request);
  if (!key) return;
  // 버전 쿼리는 같은 설치 버전의 정규 자산으로 처리한다. 활성 버전 내 파일 혼합을 막는다.
  event.respondWith((async () => (await (await caches.open(CACHE_NAME)).match(key)) || fetch(request))());
});

// UI는 ready만 보지 않고 이 응답으로 전체 선캐시 상태를 확인한다.
self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_CACHE_STATUS' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const missing = [];
    for (const asset of STATIC_ASSETS) {
      if (!await cache.match(new URL(asset, self.registration.scope).href)) missing.push(asset);
    }
    event.ports[0].postMessage({type:'OFFLINE_CACHE_STATUS', version:CACHE_NAME,
      ready:missing.length === 0, total:STATIC_ASSETS.length, missing});
  })());
});
