/*
 * READ//OS service worker
 * Caches the app shell so it loads with no network connection after the
 * first successful visit. User data (sessions/books/settings) lives in
 * localStorage on the page itself — this worker never touches it and
 * never caches anything dynamic or user-generated.
 *
 * Bump CACHE_VERSION whenever any precached file changes so clients pick
 * up the new assets instead of staying stuck on an old cached copy.
 */
const CACHE_VERSION = 'reados-v1';
const CACHE_NAME = 'reados-cache-' + CACHE_VERSION;

// All paths are relative to this file's own location, so this works
// whether the app is hosted at a domain root or a GitHub Pages project
// subpath (e.g. https://user.github.io/readOS/).
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('reados-cache-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the app shell, with a network-fallback that also
// refreshes the cache in the background (stale-while-revalidate-ish),
// and a same-origin-only policy — this app has no external dependencies,
// so we never intercept cross-origin requests.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (e.g. opening the URL directly) fall back to the cached
  // shell so a full offline reload still loads the app.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
