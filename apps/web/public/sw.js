// КОНТУР service worker: the app shell keeps opening when the plant server is briefly out of reach.
// Pages go to the network first, so a new build is picked up at once; static files are served from the
// cache and refreshed behind the scenes. /api is never cached: an inspection must read live data, and
// without the server the app says so instead of showing stale readings.
// v2 drops v1 caches, which could hold another page under «/».
const CACHE = "kontur-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/brand/kontur-icon-192.png", "/brand/support-copy.css"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    // The app is one page at «/» (screens are query parameters). ar.html, stand.html and
    // presentation.html are pages of their own, often inside a frame: each is kept under its own
    // address and never answered with the app, or the AR frame would show a second copy of it.
    const page = url.pathname.endsWith(".html") && url.pathname !== "/index.html";
    const key = page ? url.pathname : "/";
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(key).then((cached) => cached || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
