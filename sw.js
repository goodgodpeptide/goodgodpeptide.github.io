// 공개 정적 자산만 캐시한다. 인증/API/개인 데이터는 저장하지 않는다.
const RELEASE_VERSION = 'peptide-app-v42';
const CACHE_NAME = 'peptide-app-v42-039477ac515c';
const STATIC_ASSETS = [
  './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './kakao_qr.png', './login_bg.png.jpg', './display_preferences.js', './display_preferences.css',
  './sync_guard.js', './recovery_guard.js', './offline_sync.js', './offline_app.js', './app_backend_client.js', './offline_notice.js', './offline_notice.css',
  './clinical_graph_scale.js', './clinical_graph_patch.js', './dual_exposure_sim.js',
  './schedule_comparison_model.js', './schedule_comparison_ui.js', './model_input_review.js',
  './inline_weight_entry.js', './recon_inventory_guard.js', './peptides_v3.json',
  './saju/saju_engine.obf.js', './saju/toitjeong.obf.js', './saju/saju_ui.obf.js', './saju/saju.css',
  './vendor/firebase-10.12.0/firebase-app.js', './vendor/firebase-10.12.0/firebase-auth.js',
  './vendor/firebase-10.12.0/firebase-firestore.js', './vendor/qrcode-1.0.0.min.js', './vendor/jsQR-1.4.0.min.js'
];
// scripts/build_offline_manifest.mjs가 배포할 실제 파일 내용으로 갱신한다.
const ASSET_HASHES = /* BUILD_HASHES_START */ {
  "./index.html": {
    "sha256": "819a7df395fc77f664a1159b75ed0b6af0bdfded05c9f6e4a79c0507accbcf74",
    "bytes": 918186
  },
  "./manifest.json": {
    "sha256": "340544bed3d9708834e7e2d339a564851233ad5bd9467e5863f216569337a1d2",
    "bytes": 804
  },
  "./icon-192.png": {
    "sha256": "2b97d4e3054c800c2e05a5aa78cf6ac80404e87afb6c6002ebb2ceb7734581ce",
    "bytes": 36988
  },
  "./icon-512.png": {
    "sha256": "af3a6ddcc96e722e504ea273832df46f830d74c252ef11307cc013d6f69c30c3",
    "bytes": 139170
  },
  "./kakao_qr.png": {
    "sha256": "4b68448a1de545e04fb92f8ef95b81454195010a0c74d57b99c6db49f504e4ca",
    "bytes": 37420
  },
  "./login_bg.png.jpg": {
    "sha256": "b7bf640cb4f624ee022a8ad5d1ec8f7dfe3f9d9ea4f143ea61db838ccce94571",
    "bytes": 122200
  },
  "./display_preferences.js": {
    "sha256": "c53c34bf316ae161c769eb009cb90435a7c00761f2019b1bcd20c1a3d84a29b1",
    "bytes": 8918
  },
  "./display_preferences.css": {
    "sha256": "98cd19a281f7b8d05fb6f2e0de7c40cf01a503788a4e812d3925990925d357c6",
    "bytes": 4266
  },
  "./sync_guard.js": {
    "sha256": "fd42a034e2355aa71fe4f41c8d03f364cbcf44e5a71ef43b529aec9fa70e72ba",
    "bytes": 2409
  },
  "./recovery_guard.js": {
    "sha256": "5fcfd4eb5e8c7a777819d5050d8e1f561322332dbcb0ceecc108d4aba32c2140",
    "bytes": 6032
  },
  "./offline_sync.js": {
    "sha256": "d2a734f4c320bcbbc89a0677671791eabcb63d22f397fa2a533a276569c82a6e",
    "bytes": 13053
  },
  "./offline_app.js": {
    "sha256": "eb90e950fef962c69acb64fd3c3f33c6dbec25d8b03548a6e3576a50938da821",
    "bytes": 10407
  },
  "./app_backend_client.js": {
    "sha256": "6d74642e04f4160f735eb1e84d93a078804acaeed56df109d02f4cc571bc2f62",
    "bytes": 1418
  },
  "./offline_notice.js": {
    "sha256": "c355280f359527db2f1483abeb6d7f46353010bf4644804235256777b3562a73",
    "bytes": 4501
  },
  "./offline_notice.css": {
    "sha256": "272087c968fe361123a52f1d6eaa8cfd86c3223c123b200cffaa7b2b9ff957a9",
    "bytes": 1462
  },
  "./clinical_graph_scale.js": {
    "sha256": "9392b54c19c6af8364407f4f78f2e594abdc8ecf84af7991b6eca8e08bccd6ec",
    "bytes": 10590
  },
  "./clinical_graph_patch.js": {
    "sha256": "2dc5316bf83deec30f1f76d691fd23943a17500c6c9cb106877981cf24ddcfa3",
    "bytes": 4297
  },
  "./dual_exposure_sim.js": {
    "sha256": "405722c7e6fe2fdcae61bd60b75ba3eb98ac43dba86a00f1003468d758e3afc3",
    "bytes": 18881
  },
  "./schedule_comparison_model.js": {
    "sha256": "bee5bb969e4f11fd3c922f8f86406ad7b8f93135a4b1bdbbcdbc767392ba761a",
    "bytes": 7980
  },
  "./schedule_comparison_ui.js": {
    "sha256": "fcf191f569534337faeaddcf69d00c1d9b58df6eedbe7925131a02015f09282f",
    "bytes": 28695
  },
  "./model_input_review.js": {
    "sha256": "df876257cb59f79825db5ee68955e47f223e8def8fb909ddc01b7c2ac97123a5",
    "bytes": 8619
  },
  "./inline_weight_entry.js": {
    "sha256": "e6bcd9b012aa99c19e903d5e97ba0db0533f2dcd9c779f36daa06d0d06e0fdf7",
    "bytes": 8362
  },
  "./recon_inventory_guard.js": {
    "sha256": "9ba42b0e802fbf35d951d20e7983f422448fb118d270bd651f9f67c5d6c3c524",
    "bytes": 27958
  },
  "./peptides_v3.json": {
    "sha256": "c3660d9679142cc577334b1a9d0c8c2fd762ccdae5911378211386f2dacdc150",
    "bytes": 2519191
  },
  "./saju/saju_engine.obf.js": {
    "sha256": "004264877913426d9b1f3f7d11ac02a49b36210a6a6240f89d223d39663ee867",
    "bytes": 561641
  },
  "./saju/toitjeong.obf.js": {
    "sha256": "77a62db853cbbf0aa9f26f8e0fac32ab470ec5212589d35ef2f82740b5ae3449",
    "bytes": 35380
  },
  "./saju/saju_ui.obf.js": {
    "sha256": "ea4d73ca7ac2c3d748ed09a43ad70a761af3e378d01bb0dbe785f346b2d02e97",
    "bytes": 57314
  },
  "./saju/saju.css": {
    "sha256": "5e38f06a89a3c150190487ad97817f9b43333994c55f1c375a7c482966790600",
    "bytes": 11220
  },
  "./vendor/firebase-10.12.0/firebase-app.js": {
    "sha256": "5724d7a31a8feeba6b254358205bacdc8c31f18dd295eee4186476d93704332f",
    "bytes": 99357
  },
  "./vendor/firebase-10.12.0/firebase-auth.js": {
    "sha256": "c59396d0c7c77ee46b5d684232b476a5df9d58cf2875470bf5dc27c89d90d321",
    "bytes": 150955
  },
  "./vendor/firebase-10.12.0/firebase-firestore.js": {
    "sha256": "120a6c806ee450cda184842116c3aecff88799c29ec368b1811bb6f205fd16da",
    "bytes": 436533
  },
  "./vendor/qrcode-1.0.0.min.js": {
    "sha256": "c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36",
    "bytes": 19927
  },
  "./vendor/jsQR-1.4.0.min.js": {
    "sha256": "32214c74ee92d37de6d88276987690d996ce757668e82ca1709dba5e0be9fcce",
    "bytes": 130594
  }
} /* BUILD_HASHES_END */;
async function sha256(response) {
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
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
      const url = new URL(path, self.registration.scope);
      url.searchParams.set('build', CACHE_NAME);
      const response = await fetch(new Request(url, {cache:'no-store'}));
      if (!response.ok || response.type === 'opaque') throw new Error('Precache failed: ' + path);
      if (!ASSET_HASHES[path] || await sha256(response.clone()) !== ASSET_HASHES[path].sha256) {
        throw new Error('Precache content mismatch: ' + path);
      }
      return response;
    }));
    const existed = (await caches.keys()).includes(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(STATIC_ASSETS.map((path, index) => cache.put(new URL(path, self.registration.scope).href, responses[index])));
    } catch (error) { if (!existed) await caches.delete(CACHE_NAME); throw error; }
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
    const index = await cache.match(new URL('index.html', self.registration.scope).href);
    const indexSha256 = index ? await sha256(index.clone()) : null;
    event.ports[0].postMessage({type:'OFFLINE_CACHE_STATUS', version:CACHE_NAME,
      ready:missing.length === 0 && indexSha256 === ASSET_HASHES['./index.html']?.sha256,
      indexSha256, total:STATIC_ASSETS.length, missing});
  })());
});
