/* ============================================
   小手机 Service Worker
   作用：让 PWA 秒开 + 离线可用
   策略：安装时预缓存核心资源，请求时缓存优先 + 后台更新
   ============================================ */

const CACHE_NAME = 'xiaoshouji-v33-dualzone-time'; // v33 cache bump: 双区记忆 + 时间锚点 + 红包 sanitizer 修复
const APP_VERSION_FOR_SW = 'v33'; // 与 app.js 保持，避免 UI 数字频繁跳动
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/themes/dark.css',
  './js/app.js',
  './js/crypto.js',
  './manifest.json',
  './assets/icon-192.svg',
  './assets/icon-512.svg',
];

// ===== install: 预缓存所有核心资源 =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐个缓存，单个失败不影响整体
      return Promise.allSettled(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] 预缓存失败:', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ===== activate: 清理旧缓存 =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ===== fetch: 缓存优先 + 后台更新（stale-while-revalidate） =====
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // 后台发起网络请求更新缓存
      const fetched = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        })
        .catch(() => cached); // 网络失败则降级到缓存

      // 有缓存就用缓存（秒开），没有就等网络
      return cached || fetched;
    })
  );
});