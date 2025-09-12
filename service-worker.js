// --- Service Worker for FGL (GitHub Pages) ---
const CACHE_NAME = 'fgl-cache-v16'; // bump på hver deploy
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icons/FGL_192.png',
  './assets/icons/FGL_512.png',
  './assets/icons/FGL_192_VM.png'
];

// Install: precache app-shell og aktiver straks
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate: ryd gamle caches, claim og sig til klienter at en ny version er klar
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
    await self.clients.claim();
    const clientsList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientsList) {
      client.postMessage({ type: 'NEW_VERSION' });
    }
  })());
});

// Fetch: Network-first for Google Sheets (gviz), cache-first for resten
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const isGViz = url.pathname.includes('/gviz/tq');

  if (isGViz) {
    // NETWORK-FIRST for Google Sheets
    e.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match(req)) // fallback til cache hvis offline
    );
    return;
  }

  // App-shell og statiske assets: CACHE-FIRST
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (req.method === 'GET' && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

