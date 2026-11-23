/* Gaana Tambola: keeps the page shell available offline.
   Song audio is not cached here; it lives in IndexedDB on the device. */
const CACHE = 'gaana-tambola-v1';
const SHELL = ['./', './index.html', './app.js?v=1', './data.js?v=1', '../../assets/site.css?v=20261031', '../../assets/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates show at once), cache as the fallback when the venue Wi-Fi is down.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: !fonts }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
