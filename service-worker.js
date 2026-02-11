// --- Service Worker for FGL (v38) ---
const CACHE_NAME = 'fgl-cache-v38';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './assets/icons/FGL_192.png', './assets/icons/FGL_512.png', './assets/icons/FGL_192_VM.png'
];8

// Install: precache + skip waiting
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_NAME);
    await Promise.allSettled(ASSETS.map((u) => c.add(u)));
  })());

  self.skipWaiting(); // Tving ny SW til at installere med det samme
});

// Activate: slet gamle caches, claim alle klienter, og giv besked om ny version
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );

    await self.clients.claim();

    // Giv besked til alle åbne faner (inkl. ukontrollerede lige før claim)
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: 'NEW_VERSION' });
    }
  })());
});

// Fetch: bevar din oprindelige strategi (med særlig håndtering for Google GViz)

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Din special-case for GViz
  const isGViz = url.pathname.includes('/gviz/tq');

  if (isGViz) {
    e.respondWith(
      fetch(req)
        .then(async (resp) => {
          // Cache kun GET, og klon straks
          if (req.method === 'GET' && resp.ok) {
            const clone = resp.clone();
            try {
              const c = await caches.open(CACHE_NAME);
              await c.put(req, clone);
            } catch (err) {
              // Valgfrit: log men lad ikke fejlen boble op
              console.warn('Cache put fejlede for GViz:', err);
            }
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Standard: cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then(async (resp) => {
          if (req.method === 'GET' && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone(); // klon straks
            try {
              const c = await caches.open(CACHE_NAME);
              await c.put(req, clone);
            } catch (err) {
              console.warn('Cache put fejlede:', err);
            }
          }
          return resp;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

