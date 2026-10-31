const CACHE_NAME = "xyp3rn-music-shell-v2";
const CACHE_PREFIX = "xyp3rn-music-shell-";
const SHELL = [
  "/",
  "/app.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/active-orb-reference.jpg",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
  "/assets/fonts/Unbounded-VF.ttf",
  "/assets/fonts/OFL.txt"
];
const REVALIDATE = new Set(["/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Do not let an old service worker pin old application code after a deploy.
  if (REVALIDATE.has(url.pathname) || request.mode === "navigate") {
    const cacheKey = request.mode === "navigate" || url.pathname === "/index.html" ? "/" : url.pathname;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") await cache.put(cacheKey, response.clone());
        return response;
      } catch {
        return await cache.match(cacheKey) || Response.error();
      }
    })());
    return;
  }

  if (!url.pathname.startsWith("/assets/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    } catch {
      // In particular, never return index.html in place of a missing video.
      return Response.error();
    }
  })());
});
