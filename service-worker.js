// --- Service Worker for FGL (v18) ---
const CACHE_NAME = 'fgl-cache-v27';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './assets/icons/FGL_192.png', './assets/icons/FGL_512.png', './assets/icons/FGL_192_VM.png'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { const keys = await caches.keys(); await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k))); await self.clients.claim(); const clientsList = await self.clients.matchAll({ type: 'window' }); for (const client of clientsList) client.postMessage({ type: 'NEW_VERSION' }); })()); });
self.addEventListener('fetch', (e) => { const req = e.request; const url = new URL(req.url); const isGViz = url.pathname.includes('/gviz/tq'); if (isGViz) { e.respondWith(fetch(req).then((resp) => { if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(req, resp.clone())); return resp; }).catch(() => caches.match(req))); return; } e.respondWith(caches.match(req).then((cached) => { if (cached) return cached; return fetch(req).then((resp) => { if (req.method === 'GET' && resp.status === 200 && resp.type === 'basic') { caches.open(CACHE_NAME).then(c => c.put(req, resp.clone())); } return resp; }).catch(() => caches.match('./index.html')); })); });
