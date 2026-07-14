/* SAMITEX — Service Worker mínimo (PWA) */
const CACHE = "samitex-v6";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  // Solo GET; deja pasar todo lo demás (RPC de Supabase, POST, etc.)
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});