/* ============================================
   小手机 Service Worker
   作用：让 PWA 离线也能打开聊天界面
   ============================================ */

const CACHE_NAME = 'xiaoshouji-v03';
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
  if (event.request.method !== 'GET') return;
  // 不缓存任何东西，所有请求直接走网络
  // 这样每次都是最新代码
  event.respondWith(fetch(event.request));
});