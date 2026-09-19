const VERSION = "morpheus-george-shell-8";
const SHELL = [
  "/",
  "/index.html",
  "/app-7.css",
  "/app-8.js",
  "/manifest.webmanifest",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/assets/pet/neutral.png",
  "/assets/pet/blink.png",
  "/assets/pet/happy.png",
  "/assets/pet/alert.png",
  "/assets/pet/thinking.png",
  "/assets/pet/celebration.png",
  "/assets/pet/concern.png",
  "/assets/pet/curiosity.png"
];
const API_HOST = "zadxvmpgngwtpsmdkcod.supabase.co";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.hostname === API_HOST) return;

  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/manifest.webmanifest")) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      const copy = response.clone();
      caches.open(VERSION).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match("/index.html"))));
    return;
  }

  event.respondWith(caches.match(request).then(hit => {
    const fresh = fetch(request).then(response => {
      if (response.ok) caches.open(VERSION).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => hit);
    return hit || fresh;
  }));
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
