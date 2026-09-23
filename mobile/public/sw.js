// MedBase Mobile — Service Worker（ADR-013）
// - 頁面（navigation）：網路優先，離線時用快取的 index.html，讓新部署能立即生效
// - /assets/*（檔名含雜湊）：快取優先，內容不會變
// - /api/*：一律走網路、不快取（含個人資料與密碼）
// 資料的離線快取由 App 自己存在 IndexedDB，不經過這裡
const CACHE = 'medbase-v2';
const SHELL = ['/', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
