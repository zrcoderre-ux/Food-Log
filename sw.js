/* PlateIQ service worker — offline app shell + smart runtime caching */
const VERSION = 'plateiq-v29-2026-07-05';
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
  'world.openfoodfacts.org',
  'accounts.google.com',
  'www.googleapis.com',
  'supabase.co',
  'supabase.in',
  'api.nal.usda.gov',
  'health.googleapis.com',
  'oauth2.googleapis.com',
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

// Web Push: a server-sent push (energy check-in) shows a notification even
// when the app is fully closed.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'How’s your energy?';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Tap to log — Low · Medium · High',
    tag: 'energy-checkin', renotify: true,
    actions: [{ action: 'low', title: '🪫 Low' }, { action: 'medium', title: '🔋 Medium' }, { action: 'high', title: '⚡ High' }],
    data: { type: 'energy' }
  }));
});

// Energy check-in notifications: an action button (or tapping the body) opens
// the app and passes the chosen level so it can be logged.
self.addEventListener('notificationclick', (event) => {
  const level = event.action || '';
  event.notification.close();
  const url = './index.html#energy=' + (level || 'ask');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.postMessage({ type: 'energy', level }); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept live-data / auth hosts — let them go straight to network.
  if (BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // Navigations: network-FIRST so an online user always gets the latest app,
  // falling back to the cached shell only when offline. This is what makes
  // deploys show up without reinstalling.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put('./index.html', clone));
        return res;
      }).catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
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
