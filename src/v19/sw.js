/* SBP Accounting V19 — safe same-origin offline cache */
const CACHE='sbp-accounting-v19-release-v02c';
const FILES=[
 './','./index.html','./styles.css','./app.js?v=108',
 './vendor/xlsx.full.min.js','./manifest.webmanifest',
 './assets/sbp-app-icon.svg','./lucide-local.js',
 './palm-glass-theme.css?v=45','./assets/palm-wallpaper.svg',
 './palm-glass-theme.css','./assets/palm-plantation-wallpaper.svg'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(key=>key.startsWith('sbp-accounting-v19-')&&key!==CACHE).map(key=>caches.delete(key))
 )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET') return;
 const url=new URL(request.url);
 // Never intercept browser extensions, cross-origin requests, or unsupported schemes.
 if(url.protocol!=='https:'||url.origin!==self.location.origin) return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request);
  if(cached) return cached;
  try{
   const response=await fetch(request);
   if(response&&response.ok&&response.type==='basic'){
    try{await cache.put(request,response.clone());}catch(error){/* Cache quota/write failure must not break navigation. */}
   }
   return response;
  }catch(error){
   const fallback=await cache.match('./index.html');
   if(fallback) return fallback;
   throw error;
  }
 })());
});
