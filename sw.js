/* To-Do Pro service worker — offline app shell + runtime caching */
const VERSION = 'v1';
const SHELL = `todo-pro-shell-${VERSION}`;
const RUNTIME = `todo-pro-runtime-${VERSION}`;
const CORE = [
  './', 'index.html', 'style.css', 'script.js', 'cloud.js', 'firebase-config.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];
// During local development keep things fresh (network first)
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Never intercept live Firebase / Google auth traffic — the SDK handles its own offline cache
const BYPASS = /(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations|accounts\.google\.com|apis\.google\.com|\/__\/auth\/)/;
// Cacheable third-party static assets (fonts + Firebase SDK modules)
const STATIC_CDN = /(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs)/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (BYPASS.test(req.url)) return;

  // Page navigations: network first, fall back to cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(DEV ? networkFirst(req, SHELL) : staleWhileRevalidate(req, SHELL));
  } else if (STATIC_CDN.test(req.url)) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    })
  );
}
function networkFirst(req, cacheName) {
  return fetch(req)
    .then((res) => { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); return res; })
    .catch(() => caches.match(req));
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
