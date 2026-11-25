const CACHE_NAME='ultradashboard-pwa-v3';
const APP_SHELL=[
  './index.html',
  './accommodations.html',
  './settings.html',
  './styles.css?v=7',
  './dashboard-common.js?v=1',
  './accommodation-data.js?v=1',
  './dashboard.js?v=1',
  './settings.js?v=1',
  './schedule.js?v=2',
  './accommodation-map.js?v=4',
  './accommodations.js?v=4',
  './pwa.js?v=1',
  './data.json',
  './borderline700-logo.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const cacheNames=await caches.keys();
    await Promise.all(cacheNames
      .filter(name=>name.startsWith('ultradashboard-pwa-')&&name!==CACHE_NAME)
      .map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

async function fetchWithOfflineFallback(request) {
  const cache=await caches.open(CACHE_NAME);
  try {
    const response=await fetch(request);
    if(response.ok&&response.type==='basic') {
      await cache.put(request,response.clone());
    }
    return response;
  } catch(error) {
    const cached=await cache.match(request,{ignoreSearch:true});
    if(cached)return cached;
    if(request.mode==='navigate') {
      const startPage=new URL('./index.html',self.registration.scope);
      const fallback=await cache.match(startPage);
      if(fallback)return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
  if(!event.clientId&&request.mode!=='navigate')return;
  event.respondWith(fetchWithOfflineFallback(request));
});
