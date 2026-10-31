const CACHE_NAME = "xyp3rn-music-shell-v1";
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

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/assets/idle-orb.mp4") {
    event.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match("/"))));
});
