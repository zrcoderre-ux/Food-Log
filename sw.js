/* PlateIQ service worker — offline app shell + smart runtime caching */
const VERSION = 'plateiq-v2-2026-07-04';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

// Core files that make the app usable offline.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

// Hosts we never want to cache aggressively (live data / auth).
const BYPASS_HOSTS = [
  'api.fitbit.com',
  'www.fitbit.com',
  'world.openfoodfacts.org',
  'accounts.google.com',
  'www.googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept live-data / auth hosts — let them go straight to network.
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // Navigations: serve the cached app shell first, fall back to network.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req).catch(() => caches.match('./')))
    );
    return;
  }

  // CDN assets (pdf.js, google fonts): stale-while-revalidate.
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Same-origin static: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetchAndCache(req, SHELL_CACHE))
  );
});

function fetchAndCache(req, cacheName) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const clone = res.clone();
      caches.open(cacheName).then((c) => c.put(req, clone));
    }
    return res;
  });
}

function staleWhileRevalidate(req) {
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}
