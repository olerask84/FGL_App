const CACHE_NAME = 'fgl-cache-v8';
const ASSETS = [
  './','./index.html','./styles.css','./app.js','./manifest.json',
  './assets/icons/FGL_192.png','./assets/icons/FGL_512.png','./assets/icons/FGL_192_VM.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME&&caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  e.respondWith(
    caches.match(req).then(cached=>cached||fetch(req).then(resp=>{
      if(req.method==='GET'&&resp.status===200&&resp.type==='basic'){
        const clone=resp.clone(); caches.open(CACHE_NAME).then(c=>c.put(req,clone));
      }
      return resp;
    }).catch(()=>caches.match('./index.html'))));
});
