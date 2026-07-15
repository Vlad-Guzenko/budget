// Минимальный service worker — включает установку PWA и базовый офлайн-шелл.
const CACHE = "moto-v1";
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const { request } = e;
  // Supabase-запросы всегда идут в сеть
  if (request.url.includes("supabase")) return;
  if (request.method !== "GET") return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/")))
  );
});
