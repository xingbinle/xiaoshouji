/* ============================================
   小手机 Service Worker
   作用：让 PWA 离线也能打开聊天界面
   ============================================ */

const CACHE_NAME = 'xiaoshouji-v13';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './assets/icon-192.svg',
  './assets/icon-512.svg',
];

self.addEventListener('install', (event) => {
  // 不再预缓存任何资源，避免缓存过期的代码
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 删除所有旧缓存
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 只处理 GET 请求，其它一律放行
  if (event.request.method !== 'GET') return;

  // 用 try/catch 包住 respondWith，任何网络错误都能优雅降级
  // 避免出现 "FetchEvent.respondWith received an error" 崩溃页面
  event.respondWith(
    fetch(event.request).catch((err) => {
      console.warn('[SW] fetch failed, returning fallback:', err);
      // 降级：返回 503 响应，浏览器继续走网络
      return new Response('', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    })
  );
});