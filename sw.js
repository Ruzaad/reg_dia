/* Service worker mínimo: cachea el cascarón de la app para carga rápida.
   Los datos (almacén y Supabase) SIEMPRE van a red — nunca se cachean. */
const CACHE = "samitex-v2";
const SHELL = ["index.html","operario.html","supervisora.html","ingenieria.html","style.css","app.js","ingenieria.js","manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return;          // Sheets y Supabase: siempre red
  e.respondWith(
    fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
